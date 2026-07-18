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
#[derive(Debug, Clone, Deserialize)]
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

/// Delete a session's spool file from **both** roots — a dead session may live in either.
pub fn reap_session(session_id: &str) {
    for root in roots() {
        let _ = std::fs::remove_file(root.join("sessions").join(format!("{session_id}.json")));
    }
}

pub fn read_sessions() -> Vec<SessionRecord> {
    read_dir("sessions")
        .into_iter()
        .filter(|r: &SessionRecord| r.session_id.as_deref().is_some_and(|s| !s.is_empty()))
        .collect()
}

pub fn read_usage() -> Vec<UsageRecord> {
    read_dir("usage")
}

pub fn read_subagents() -> Vec<SubagentRecord> {
    read_dir("subagents")
}

/// Read every `*.json` in `<root>/<name>` across both spool roots, skipping unreadable/half-written files.
/// Deduplication (a session written by both beacons) is the caller's concern — the orchestrator keeps the
/// freshest by `statusSince`.
fn read_dir<T: for<'de> Deserialize<'de>>(name: &str) -> Vec<T> {
    let mut out = Vec::new();
    for root in roots() {
        let dir = root.join(name);
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Some(rec) = try_read(&path) {
                out.push(rec);
            }
        }
    }
    out
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
