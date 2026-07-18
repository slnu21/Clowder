//! Clowder's own hook beacon — `clowder.exe --beacon --event <E>` (and `--beacon --statusline`).
//!
//! A faithful Rust port of Vigil's `Vigil.Beacon` (Program/Subagents/BeaconNative/BeaconJson). Claude
//! Code hooks spawn this headless; it reads the hook JSON from stdin, maps the event to a session
//! status, records the owning `claude.exe` ancestor (pid + creation FILETIME) for liveness/correlation,
//! and writes Clowder's **own** spool under `%LOCALAPPDATA%\Clowder\{sessions,usage,subagents}` — so the
//! rail works without Vigil installed.
//!
//! Invariants (same as Vigil): writes NOTHING to stdout/stderr and never panics. SessionStart/
//! UserPromptSubmit stdout is injected into the model, and Stop stdout can force Claude to keep working.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

// ---- hook input (snake_case JSON from stdin) ----

#[derive(Deserialize, Default)]
struct HookInput {
    session_id: Option<String>,
    transcript_path: Option<String>,
    cwd: Option<String>,
    notification_type: Option<String>,
    message: Option<String>,
    tool_name: Option<String>,
    tool_input: Option<ToolInput>,
    agent_id: Option<String>,
    agent_type: Option<String>,
    background_tasks: Option<Vec<BackgroundTask>>,
}

#[derive(Deserialize, Default)]
struct ToolInput {
    command: Option<String>,
    file_path: Option<String>,
}

#[derive(Deserialize, Clone)]
struct BackgroundTask {
    id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    status: Option<String>,
    description: Option<String>,
    agent_type: Option<String>,
}

// ---- statusline input (usage) ----

#[derive(Deserialize, Default)]
struct StatuslineInput {
    session_id: Option<String>,
    context_window: Option<SlContext>,
    rate_limits: Option<SlRateLimits>,
}
#[derive(Deserialize, Default)]
struct SlContext {
    used_percentage: Option<f64>,
    total_input_tokens: Option<i64>,
    total_output_tokens: Option<i64>,
    context_window_size: Option<i64>,
}
#[derive(Deserialize, Default)]
struct SlRateLimits {
    five_hour: Option<SlWindow>,
    seven_day: Option<SlWindow>,
}
#[derive(Deserialize, Default)]
struct SlWindow {
    used_percentage: Option<f64>,
    resets_at: Option<i64>, // Claude sends Unix seconds
}

// ---- spool output (camelCase, matches spool::* readers) ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpoolOut {
    session_id: String,
    status: String,
    status_since: String,
    event: String,
    cwd: Option<String>,
    transcript_path: Option<String>,
    message: Option<String>,
    tool_name: Option<String>,
    tool_detail: Option<String>,
    claude_pid: Option<i32>,
    claude_started_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SubagentOut {
    agent_id: String,
    session_id: String,
    agent_type: Option<String>,
    description: Option<String>,
    status: Option<String>,
    started_at: Option<String>,
    cwd: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageOut {
    session_id: Option<String>,
    ts: String,
    context: Option<UsageContextOut>,
    five_hour: Option<UsageWindowOut>,
    seven_day: Option<UsageWindowOut>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageContextOut {
    used_percentage: Option<f64>,
    total_input_tokens: Option<i64>,
    total_output_tokens: Option<i64>,
    context_window_size: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageWindowOut {
    used_percentage: Option<f64>,
    resets_at: Option<String>,
}

// ---- entry ----

/// Dispatched from `main` when `--beacon` is present. Silent + never panics.
pub fn run(args: &[String]) {
    if args.iter().any(|a| a == "--statusline") {
        run_statusline();
        return;
    }
    let ev = parse_event(args);
    let raw = read_stdin();
    let input: HookInput = parse_json(&raw).unwrap_or_default();

    let session_id = input
        .session_id
        .clone()
        .or_else(|| std::env::var("CLAUDE_CODE_SESSION_ID").ok())
        .filter(|s| !s.is_empty());
    let Some(session_id) = session_id else { return };

    let Some(sessions) = subdir("sessions") else { return };
    let _ = std::fs::create_dir_all(&sessions);
    let target = sessions.join(format!("{session_id}.json"));

    match ev.as_str() {
        "SessionEnd" => {
            let _ = std::fs::remove_file(&target);
            subagents_remove_for_session(&session_id);
            return;
        }
        "SubagentStart" => {
            subagents_write(&session_id, &input);
            return;
        }
        "SubagentStop" => {
            subagents_remove(input.agent_id.as_deref());
            subagents_reconcile(&session_id, input.background_tasks.as_deref(), input.agent_id.as_deref());
            return;
        }
        "Stop" => subagents_reconcile(&session_id, input.background_tasks.as_deref(), None),
        _ => {}
    }

    let Some(status) = map_status(&ev, input.notification_type.as_deref()) else {
        return; // unmodelled event: leave the spool alone (don't demote a Stop's awaiting_input)
    };

    let (pid, created) = find_claude_ancestor();
    let out = SpoolOut {
        session_id: session_id.clone(),
        status: status.to_string(),
        status_since: now_iso(),
        event: ev,
        cwd: input.cwd,
        transcript_path: input.transcript_path,
        message: input.message,
        tool_name: input.tool_name,
        tool_detail: input.tool_input.and_then(|t| t.command.or(t.file_path)),
        claude_pid: (pid > 0).then_some(pid),
        claude_started_at: created.map(|c| c.to_string()),
    };
    if let Ok(json) = serde_json::to_string(&out) {
        write_atomic(&target, &json);
    }
}

fn run_statusline() {
    let raw = read_stdin();
    let Some(input) = parse_json::<StatuslineInput>(&raw) else { return };

    let context = input.context_window.map(|c| UsageContextOut {
        used_percentage: c.used_percentage,
        total_input_tokens: c.total_input_tokens,
        total_output_tokens: c.total_output_tokens,
        context_window_size: c.context_window_size,
    });
    let to_window = |w: Option<SlWindow>| {
        w.and_then(|w| {
            w.used_percentage.map(|p| UsageWindowOut {
                used_percentage: Some(p),
                resets_at: w.resets_at.map(unix_to_iso),
            })
        })
    };
    let rate = input.rate_limits.unwrap_or_default();
    let five = to_window(rate.five_hour);
    let seven = to_window(rate.seven_day);

    // Nothing usable this render — don't churn the file.
    if context.as_ref().and_then(|c| c.used_percentage).is_none() && five.is_none() && seven.is_none() {
        return;
    }

    let file_key = input.session_id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "_account".into());
    let out = UsageOut {
        session_id: input.session_id.filter(|s| !s.is_empty()),
        ts: now_iso(),
        context,
        five_hour: five,
        seven_day: seven,
    };
    let Some(dir) = subdir("usage") else { return };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string(&out) {
        write_atomic(&dir.join(format!("{file_key}.json")), &json);
    }
}

/// Event → status, or `None` for "no status change" (caller skips the write). Mirrors Vigil exactly.
fn map_status(ev: &str, notification_type: Option<&str>) -> Option<&'static str> {
    match ev {
        "SessionStart" => Some("idle"),
        "UserPromptSubmit" => Some("working"),
        "Stop" => Some("awaiting_input"),
        "Notification" => match notification_type {
            Some("permission_prompt") | Some("elicitation_dialog") => Some("awaiting_permission"),
            Some("idle_prompt") | Some("agent_needs_input") | Some("agent_completed") => Some("awaiting_input"),
            _ => None,
        },
        _ => None,
    }
}

// ---- subagents (port of Subagents.cs) ----

fn is_safe_id(id: Option<&str>) -> bool {
    matches!(id, Some(s) if !s.is_empty() && !s.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']))
}

fn subagents_write(session_id: &str, input: &HookInput) {
    if !is_safe_id(input.agent_id.as_deref()) {
        return;
    }
    subagent_write_file(&SubagentOut {
        agent_id: input.agent_id.clone().unwrap(),
        session_id: session_id.to_string(),
        agent_type: input.agent_type.clone(),
        description: None,
        status: Some("running".into()),
        started_at: Some(now_iso()),
        cwd: input.cwd.clone(),
    });
}

fn subagents_remove(agent_id: Option<&str>) {
    if !is_safe_id(agent_id) {
        return;
    }
    if let Some(dir) = subdir("subagents") {
        let _ = std::fs::remove_file(dir.join(format!("{}.json", agent_id.unwrap())));
    }
}

fn subagents_remove_for_session(session_id: &str) {
    for (path, rec) in subagents_load() {
        if rec.session_id == session_id {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Make this session's rows match `tasks`: drop what's gone, enrich/adopt what's running. `None` list =
/// no snapshot (do nothing); empty list = nothing running (drop all). `finished_id` (a SubagentStop's own
/// id) is excluded so its still-"running" snapshot entry can't resurrect the row we just deleted.
fn subagents_reconcile(session_id: &str, tasks: Option<&[BackgroundTask]>, finished_id: Option<&str>) {
    let Some(tasks) = tasks else { return };
    let mut live: HashMap<String, BackgroundTask> = HashMap::new();
    for t in tasks {
        if t.kind.as_deref() == Some("subagent") && is_safe_id(t.id.as_deref()) {
            live.insert(t.id.clone().unwrap(), t.clone());
        }
    }
    if let Some(fid) = finished_id {
        live.remove(fid);
    }

    for (path, mut rec) in subagents_load() {
        if rec.session_id != session_id {
            continue; // another session's children aren't ours to judge
        }
        match live.remove(&rec.agent_id) {
            None => {
                let _ = std::fs::remove_file(path);
            }
            Some(t) => {
                if rec.description.is_none() {
                    rec.description = t.description;
                }
                if rec.agent_type.is_none() {
                    rec.agent_type = t.agent_type;
                }
                if t.status.is_some() {
                    rec.status = t.status;
                }
                subagent_write_file(&rec);
            }
        }
    }

    // Running but unknown to us — a SubagentStart we missed. Adopt rather than stay blind.
    for t in live.into_values() {
        if let Some(id) = t.id.clone() {
            subagent_write_file(&SubagentOut {
                agent_id: id,
                session_id: session_id.to_string(),
                agent_type: t.agent_type,
                description: t.description,
                status: Some(t.status.unwrap_or_else(|| "running".into())),
                started_at: Some(now_iso()),
                cwd: None,
            });
        }
    }
}

fn subagents_load() -> Vec<(PathBuf, SubagentOut)> {
    let Some(dir) = subdir("subagents") else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(rec) = serde_json::from_slice::<SubagentOut>(&bytes) {
                out.push((path, rec));
            }
        }
    }
    out
}

fn subagent_write_file(rec: &SubagentOut) {
    if !is_safe_id(Some(&rec.agent_id)) {
        return;
    }
    if let Some(dir) = subdir("subagents") {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string(rec) {
            write_atomic(&dir.join(format!("{}.json", rec.agent_id)), &json);
        }
    }
}

// ---- process ancestry (port of BeaconNative.cs) ----

/// Walk up from this process to the nearest `claude.exe` ancestor; return its pid + creation FILETIME.
fn find_claude_ancestor() -> (i32, Option<i64>) {
    let mut parent: HashMap<u32, u32> = HashMap::new();
    let mut name: HashMap<u32, String> = HashMap::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return (0, None),
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                parent.insert(e.th32ProcessID, e.th32ParentProcessID);
                name.insert(e.th32ProcessID, exe_name(&e.szExeFile));
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }

    let mut pid = unsafe { GetCurrentProcessId() };
    for _ in 0..24 {
        if pid == 0 {
            break;
        }
        if name.get(&pid).is_some_and(|n| n.eq_ignore_ascii_case("claude.exe")) {
            return (pid as i32, creation_filetime(pid));
        }
        match parent.get(&pid) {
            Some(&p) if p != pid => pid = p,
            _ => break,
        }
    }
    (0, None)
}

fn exe_name(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn creation_filetime(pid: u32) -> Option<i64> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut c = FILETIME::default();
        let (mut ex, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        let ok = GetProcessTimes(h, &mut c, &mut ex, &mut k, &mut u).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| ((c.dwHighDateTime as i64) << 32) | (c.dwLowDateTime as i64))
    }
}

// ---- helpers ----

fn subdir(name: &str) -> Option<PathBuf> {
    crate::spool::clowder_dir().map(|d| d.join(name))
}

fn parse_event(args: &[String]) -> String {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--event" {
            if let Some(v) = it.next() {
                return v.clone();
            }
        }
    }
    String::new()
}

fn read_stdin() -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut buf);
    buf
}

fn parse_json<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Option<T> {
    if bytes.is_empty() {
        return None;
    }
    // Strip a UTF-8 BOM if present.
    let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { &bytes[3..] } else { bytes };
    serde_json::from_slice(slice).ok()
}

/// Write via temp + atomic rename (readers can catch a torn file otherwise). Rust's `rename` replaces on
/// Windows.
fn write_atomic(target: &std::path::Path, contents: &str) {
    let tmp = target.with_extension("json.tmp");
    if std::fs::write(&tmp, contents).is_ok() {
        let _ = std::fs::rename(&tmp, target);
    }
}

/// Current UTC as ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`). No dependency — civil-from-days.
fn now_iso() -> String {
    unix_to_iso(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0))
}

fn unix_to_iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 → (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}
