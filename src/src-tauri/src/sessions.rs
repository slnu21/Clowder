//! Assemble the session board from the beacon spool and push it to the frontend.
//!
//! deck is a read-only consumer: a single background thread polls the spool, merges each snapshot
//! into a stable model (so a card doesn't flicker as its status changes), runs a liveness sweep that
//! latches dead sessions and reaps their stale spool files after a grace period, and emits the
//! assembled board to the frontend only when it actually changed.
//!
//! **Why poll instead of a FileSystemWatcher.** A liveness timer is needed regardless (a process
//! dying never touches its spool file, so only a periodic check catches it). Folding the spool
//! re-read into that same ~500 ms timer means one thread and no `notify` dependency; the FSW's whole
//! reason for the plan's debounce/rescan/retry defenses was that it drops and duplicates events,
//! which a poll simply doesn't. Sub-second latency is plenty for "don't miss a permission prompt".

use crate::liveness::is_owner_alive;
use crate::spool::{self, SessionRecord};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_millis(500);
/// Liveness is cheaper to check on a slower cadence than the spool re-read.
const LIVENESS_EVERY: u32 = 20; // 20 × 500 ms = 10 s, matching Vigil's sweep
/// How long a dead session lingers (shown as 종료됨) before its spool file is reaped.
const DEAD_GRACE: Duration = Duration::from_secs(15);

pub const EVENT: &str = "sessions:update";

// ---- frontend-facing snapshot (camelCase JSON) ----

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubagentView {
    pub agent_id: String,
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub started_at: Option<String>,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub session_id: String,
    pub status: String,
    /// 0..=4 — also the sort order (permission first, dead last).
    pub rank: u8,
    pub status_since: Option<String>,
    pub cwd: Option<String>,
    pub project: String,
    pub message: Option<String>,
    pub tool_name: Option<String>,
    pub ctx_percent: Option<f64>,
    pub ctx_tokens: Option<String>,
    /// Correlated PTY id (the pane running this session), or null for a foreign/uncorrelated session.
    pub pane_id: Option<u64>,
    pub subagents: Vec<SubagentView>,
}

#[derive(Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageView {
    pub five_hour_pct: Option<f64>,
    pub five_hour_resets_at: Option<String>,
    pub seven_day_pct: Option<f64>,
    pub seven_day_resets_at: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionsSnapshot {
    pub sessions: Vec<SessionView>,
    pub usage: UsageView,
    pub waiting_count: u32,
}

// ---- internal model (survives across ticks so cards stay stable) ----

#[derive(Default)]
struct Session {
    /// Dead is terminal: a stale spool record must never resurrect a session whose owner is gone.
    dead: bool,
    dead_since: Option<Instant>,
    status: String,
    status_since: Option<String>,
    cwd: Option<String>,
    message: Option<String>,
    tool_name: Option<String>,
    claude_pid: Option<i32>,
    claude_started_at: Option<String>,
    ctx_percent: Option<f64>,
    ctx_tokens: Option<String>,
}

impl Session {
    fn apply(&mut self, r: &SessionRecord) {
        self.status = normalize_status(r.status.as_deref());
        self.status_since = r.status_since.clone();
        self.cwd = r.cwd.clone();
        self.message = r.message.clone();
        self.tool_name = r.tool_name.clone();
        self.claude_pid = r.claude_pid;
        self.claude_started_at = r.claude_started_at.clone();
    }
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, Session>,
}

pub struct SessionsState {
    last: Arc<Mutex<SessionsSnapshot>>,
}

impl SessionsState {
    pub fn snapshot(&self) -> SessionsSnapshot {
        self.last.lock().unwrap().clone()
    }
}

/// Initial load for the frontend; live updates arrive via the [`EVENT`] emit.
#[tauri::command]
pub fn sessions_snapshot(state: tauri::State<'_, SessionsState>) -> SessionsSnapshot {
    state.snapshot()
}

/// Spawn the polling thread and return the state to `manage`. The command layer reads `last` for the
/// initial load; the thread emits [`EVENT`] on every change.
pub fn start(app: AppHandle) -> SessionsState {
    let inner = Arc::new(Mutex::new(Inner::default()));
    let last = Arc::new(Mutex::new(SessionsSnapshot::default()));

    let t_last = Arc::clone(&last);
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            let do_liveness = tick == 0 || tick % LIVENESS_EVERY == 0; // startup sweep, then every 10 s
            let snapshot = assemble(&inner, do_liveness);
            {
                let mut prev = t_last.lock().unwrap();
                if *prev != snapshot {
                    *prev = snapshot.clone();
                    let _ = app.emit(EVENT, &snapshot);
                }
            }
            tick = tick.wrapping_add(1);
            std::thread::sleep(POLL);
        }
    });

    SessionsState { last }
}

fn assemble(inner: &Arc<Mutex<Inner>>, do_liveness: bool) -> SessionsSnapshot {
    let records = spool::read_sessions();
    let mut inner = inner.lock().unwrap();

    // Merge spool records into the live model (Dead sessions are terminal — skip their apply).
    let mut seen = std::collections::HashSet::new();
    for r in &records {
        let Some(id) = r.session_id.clone() else { continue };
        seen.insert(id.clone());
        let s = inner.sessions.entry(id).or_default();
        if !s.dead {
            s.apply(r);
        }
    }

    if do_liveness {
        // Latch newly-dead owners.
        for s in inner.sessions.values_mut() {
            if !s.dead && !is_owner_alive(s.claude_pid.unwrap_or(0), s.claude_started_at.as_deref()) {
                s.dead = true;
                s.dead_since = Some(Instant::now());
            }
        }
        // Reap spool files of sessions that have shown 종료됨 long enough.
        let reap: Vec<String> = inner
            .sessions
            .iter()
            .filter(|(_, s)| s.dead && s.dead_since.is_some_and(|t| t.elapsed() > DEAD_GRACE))
            .map(|(id, _)| id.clone())
            .collect();
        for id in reap {
            if let Some(p) = spool::session_path(&id) {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    // Drop sessions whose spool file is gone (SessionEnd, or a reap by us or Vigil).
    inner.sessions.retain(|id, _| seen.contains(id));

    // Usage: newest account-wide window, plus per-session exact context.
    let usage_records = spool::read_usage();
    let usage = account_usage(&usage_records);
    let mut ctx: HashMap<String, (Option<f64>, Option<String>)> = HashMap::new();
    for u in &usage_records {
        let Some(id) = &u.session_id else { continue };
        let Some(c) = &u.context else { continue };
        let tokens = match (c.total_input_tokens, c.context_window_size) {
            (Some(it), Some(ws)) if ws > 0 => Some(format!("{} / {}", kilo(it), kilo(ws))),
            _ => None,
        };
        ctx.insert(id.clone(), (c.used_percentage, tokens));
    }
    for (id, s) in inner.sessions.iter_mut() {
        if let Some((pct, tok)) = ctx.get(id) {
            s.ctx_percent = *pct;
            s.ctx_tokens = tok.clone();
        }
    }

    // Subagents grouped by session.
    let mut subs: HashMap<String, Vec<SubagentView>> = HashMap::new();
    for sa in spool::read_subagents() {
        let (Some(agent_id), Some(session_id)) = (sa.agent_id.clone(), sa.session_id.clone()) else {
            continue;
        };
        subs.entry(session_id).or_default().push(SubagentView {
            agent_id,
            agent_type: sa.agent_type,
            description: sa.description,
            status: sa.status,
            started_at: sa.started_at,
        });
    }

    // Build the sorted view.
    let mut sessions: Vec<SessionView> = inner
        .sessions
        .iter()
        .map(|(id, s)| {
            let status = if s.dead { "dead".to_string() } else { s.status.clone() };
            SessionView {
                session_id: id.clone(),
                rank: status_rank(&status),
                status,
                status_since: s.status_since.clone(),
                cwd: s.cwd.clone(),
                project: project_name(s.cwd.as_deref()),
                message: s.message.clone(),
                tool_name: s.tool_name.clone(),
                ctx_percent: s.ctx_percent,
                ctx_tokens: s.ctx_tokens.clone(),
                pane_id: None, // correlation lands in Phase B
                subagents: subs.remove(id).unwrap_or_default(),
            }
        })
        .collect();
    // Rank first (who needs the user), then stable by id so equal-rank order doesn't jitter.
    sessions.sort_by(|a, b| a.rank.cmp(&b.rank).then_with(|| a.session_id.cmp(&b.session_id)));

    let waiting_count = sessions.iter().filter(|s| s.rank <= 1).count() as u32;

    SessionsSnapshot { sessions, usage, waiting_count }
}

fn account_usage(records: &[spool::UsageRecord]) -> UsageView {
    // Account limits are identical across sessions, so the most recent read wins.
    let newest = records
        .iter()
        .filter(|r| r.five_hour.is_some() || r.seven_day.is_some())
        .max_by(|a, b| a.ts.cmp(&b.ts));
    match newest {
        Some(r) => UsageView {
            five_hour_pct: r.five_hour.as_ref().and_then(|w| w.used_percentage),
            five_hour_resets_at: r.five_hour.as_ref().and_then(|w| w.resets_at.clone()),
            seven_day_pct: r.seven_day.as_ref().and_then(|w| w.used_percentage),
            seven_day_resets_at: r.seven_day.as_ref().and_then(|w| w.resets_at.clone()),
        },
        None => UsageView::default(),
    }
}

/// Unknown or missing status collapses to idle, exactly like Vigil's `Parse`.
fn normalize_status(s: Option<&str>) -> String {
    match s {
        Some("awaiting_permission") => "awaiting_permission",
        Some("awaiting_input") => "awaiting_input",
        Some("working") => "working",
        Some("dead") => "dead",
        _ => "idle",
    }
    .to_string()
}

fn status_rank(s: &str) -> u8 {
    match s {
        "awaiting_permission" => 0,
        "awaiting_input" => 1,
        "working" => 2,
        "idle" => 3,
        "dead" => 4,
        _ => 3,
    }
}

fn project_name(cwd: Option<&str>) -> String {
    match cwd {
        Some(c) if !c.is_empty() => {
            let trimmed = c.trim_end_matches(['\\', '/']);
            let seg = trimmed.rsplit(['\\', '/']).next().unwrap_or(trimmed);
            if seg.is_empty() { c.to_string() } else { seg.to_string() }
        }
        _ => "?".to_string(),
    }
}

fn kilo(n: i64) -> String {
    if n >= 1000 {
        format!("{:.1}k", n as f64 / 1000.0)
    } else {
        n.to_string()
    }
}
