//! Read Vigil's beacon spool — deck is a **read-only consumer** of the same IPC Vigil watches.
//!
//! The beacon (owned by Vigil, the sole hook producer) writes three spools under
//! `%LOCALAPPDATA%\Vigil\`: `sessions\<id>.json` (status + owning claude pid), `usage\<id>.json`
//! (context fill + account 5h/7d budget), and `subagents\<agent_id>.json` (live sub-agents). deck
//! never writes here except to reap a spool whose owning process is provably dead (see `sessions`).
//!
//! Reads are lock-tolerant: the beacon writes via temp+rename, but a reader can still catch a
//! transient sharing violation, so each file gets three quick attempts before it's skipped.

use serde::Deserialize;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

/// One `sessions\<id>.json`. Field names mirror the beacon's `SpoolOut` (camelCase).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: Option<String>,
    pub status: Option<String>,
    pub status_since: Option<String>,
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    pub message: Option<String>,
    pub tool_name: Option<String>,
    pub tool_detail: Option<String>,
    /// Owning claude.exe pid and its creation FILETIME (as a string) — for liveness + correlation.
    pub claude_pid: Option<i32>,
    pub claude_started_at: Option<String>,
    /// Which spool root this came from (0 = Clowder, 1 = Vigil), filled by the reader. Only used to
    /// break a merge tie in favour of the richer record — never serialized.
    #[serde(skip)]
    pub root_rank: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub session_id: Option<String>,
    pub ts: Option<String>,
    pub context: Option<UsageContext>,
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageContext {
    pub used_percentage: Option<f64>,
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
    pub context_window_size: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percentage: Option<f64>,
    pub resets_at: Option<String>,
}

/// One `subagents\<agent_id>.json`. Mirrors the beacon's `SubagentOut`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentRecord {
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub started_at: Option<String>,
}

/// `%LOCALAPPDATA%\Vigil` — Vigil's beacon spool root. `None` if LOCALAPPDATA is unset (never on Windows).
pub fn vigil_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Vigil"))
}

/// `%LOCALAPPDATA%\Clowder` — Clowder's OWN spool root, written by `clowder.exe --beacon`. Reading both
/// this and Vigil's makes the rail self-sufficient (works without Vigil) yet loses nothing when Vigil is
/// present.
pub fn clowder_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Clowder"))
}

/// The two spool roots we read, Clowder's first (its records win a tie on merge).
fn roots() -> Vec<PathBuf> {
    [clowder_dir(), vigil_dir()].into_iter().flatten().collect()
}

/// Is this string safe to interpolate into a spool file name?
///
/// Until now `reap_session` was only ever called with ids that came *out of* spool file names, so a
/// traversal was impossible. The `session_dismiss` command puts it behind the frontend, where an id
/// like `..\..\something` would delete an arbitrary file. The guard therefore lives **next to the
/// deletion**, not at the command — that way every caller, present and future, is covered.
pub fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && !id.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])
}

/// Delete every spool file derived from a session id, in **both** roots — a dead session may live in
/// either. Returns whether nothing is left behind.
///
/// `usage/` used to be skipped here *and* on `SessionEnd`, which is why that directory only ever grew.
/// Sub-agent files are named by agent id, so they have to be opened to find their session.
pub fn reap_session(session_id: &str) -> bool {
    if !is_safe_session_id(session_id) {
        return false;
    }
    let mut clean = true;
    for root in roots() {
        for sub in ["sessions", "usage"] {
            let path = root.join(sub).join(format!("{session_id}.json"));
            let _ = std::fs::remove_file(&path);
            clean &= !path.exists();
        }
        let Ok(entries) = std::fs::read_dir(root.join("subagents")) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let mine = try_read::<SubagentRecord>(&path)
                .and_then(|r| r.session_id)
                .is_some_and(|id| id == session_id);
            if mine {
                let _ = std::fs::remove_file(&path);
                clean &= !path.exists();
            }
        }
    }
    clean
}

pub fn read_sessions() -> Vec<SessionRecord> {
    read_dir_ranked("sessions")
        .into_iter()
        .map(|(mut r, rank): (SessionRecord, u8)| {
            r.root_rank = rank;
            r
        })
        .filter(|r| r.session_id.as_deref().is_some_and(|s| !s.is_empty()))
        .collect()
}

pub fn read_usage() -> Vec<UsageRecord> {
    read_dir("usage")
}

/// `(session id, mtime as unix seconds)` for every `usage/<id>.json` in both roots.
///
/// Usage files are written by `--statusline`, which fires on every render and is **not** tied to the
/// hook lifecycle — so they outlive their sessions when a session dies without `SessionEnd`. The id
/// is the file stem, which is why no parsing is needed here.
pub fn usage_entries() -> Vec<(String, u64)> {
    let mut out = Vec::new();
    for root in roots() {
        let Ok(entries) = std::fs::read_dir(root.join("usage")) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            out.push((stem.to_string(), mtime));
        }
    }
    out
}

pub fn read_subagents() -> Vec<SubagentRecord> {
    read_dir("subagents")
}

/// Read every `*.json` in `<root>/<name>` across both spool roots, skipping unreadable/half-written files.
/// Deduplication (a session written by both beacons) is the caller's concern — the orchestrator keeps the
/// freshest by `statusSince`.
fn read_dir<T: for<'de> Deserialize<'de>>(name: &str) -> Vec<T> {
    read_dir_ranked(name).into_iter().map(|(rec, _)| rec).collect()
}

/// As [`read_dir`], but each record is paired with the index of the root it came from (see
/// [`roots`]). The session merge uses it to break an exact tie deterministically.
fn read_dir_ranked<T: for<'de> Deserialize<'de>>(name: &str) -> Vec<(T, u8)> {
    let mut out = Vec::new();
    for (rank, root) in roots().into_iter().enumerate() {
        let dir = root.join(name);
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Some(rec) = try_read(&path) {
                out.push((rec, rank as u8));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::is_safe_session_id;

    #[test]
    fn real_session_ids_are_accepted() {
        assert!(is_safe_session_id("3f88d467-291f-477e-b82f-4c0bf2f064dc"));
        assert!(is_safe_session_id("_selftest-probe"));
    }

    /// `session_dismiss` hands this a string from the frontend. Every one of these would otherwise
    /// name a file outside the spool.
    #[test]
    fn traversal_and_separators_are_rejected() {
        for bad in [
            "",
            ".",
            "..",
            "../../etc",
            r"..\..\Windows\System32\config",
            "a/b",
            r"a\b",
            "C:evil",
            "star*",
            "quote\"",
            "pipe|",
        ] {
            assert!(!is_safe_session_id(bad), "{bad:?} must be rejected");
        }
        assert!(!is_safe_session_id(&"x".repeat(129)));
    }
}

fn try_read<T: for<'de> Deserialize<'de>>(path: &std::path::Path) -> Option<T> {
    for attempt in 0..3 {
        match std::fs::read(path) {
            Ok(bytes) => return serde_json::from_slice(&bytes).ok(), // garbage/partial → skip
            Err(_) if attempt < 2 => thread::sleep(Duration::from_millis(20)), // mid-write → retry
            Err(_) => return None,
        }
    }
    None
}
