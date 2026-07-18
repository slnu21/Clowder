//! Install/uninstall Clowder's Claude Code hooks, editing `~/.claude/settings.json` **surgically** — a
//! port of Vigil's `InstallerCli`. Uses the mutable JSON DOM so unrelated settings and other tools'
//! hooks (Vigil's beacon, atlas, the user's own) are preserved; removal touches only Clowder's own hook
//! groups, matched by a path-independent marker. Every write backs settings up first.
//!
//! Safety, per the user's requirement:
//! - **Always recoverable**: a one-time `settings.json.bak-clowder` plus a timestamped copy under
//!   `%LOCALAPPDATA%\Clowder\settings-backups\` on *every* modification.
//! - **Surgical removal**: only entries whose command is a Clowder beacon are removed, so anything added
//!   later (by the user or another tool) survives an uninstall.
//!
//! Usage (statusline → usage spool) is intentionally not auto-installed here; the beacon supports
//! `--statusline` but wrapping the user's statusline is a separate, higher-risk step.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// (event, async?, timeout secs?). SessionEnd blocks briefly so the final delete lands; the rest are async.
const EVENTS: &[(&str, bool, Option<i64>)] = &[
    ("SessionStart", true, None),
    ("UserPromptSubmit", true, None),
    ("Notification", true, None),
    ("Stop", true, None),
    ("SubagentStart", true, None),
    ("SubagentStop", true, None),
    ("SessionEnd", false, Some(5)),
];

fn settings_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join(".claude").join("settings.json"))
}

/// This running exe, forward-slashed, as the hook command target.
fn exe_path() -> Option<String> {
    std::env::current_exe().ok().map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// A hook command that runs Clowder's beacon — matched independent of install path (the exe is always
/// `clowder.exe`, and `--beacon` is Clowder-specific; Vigil's `beacon.exe --event` matches neither).
fn is_clowder_command(cmd: Option<&str>) -> bool {
    match cmd {
        Some(c) => {
            let n = c.replace('\\', "/").to_lowercase();
            n.contains("clowder") && n.contains("--beacon")
        }
        None => false,
    }
}

/// Drop Clowder beacon entries from an event's groups; delete groups left empty. Preserves every other
/// hook.
fn remove_clowder(groups: &mut Vec<Value>) {
    groups.retain_mut(|group| {
        let Some(list) = group.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            return true; // not a hook group — leave untouched
        };
        list.retain(|h| !is_clowder_command(h.get("command").and_then(|c| c.as_str())));
        !list.is_empty()
    });
}

/// Add Clowder's hook group to every event (removing any stale Clowder entry first — idempotent).
fn apply_install(root: &mut Value, cmd_base: &str) {
    if !root.is_object() {
        *root = json!({});
    }
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();

    for (ev, is_async, timeout) in EVENTS {
        let arr = hooks.entry(*ev).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        remove_clowder(arr);

        let mut hook = serde_json::Map::new();
        hook.insert("type".into(), json!("command"));
        hook.insert("command".into(), json!(format!("{cmd_base} --beacon --event {ev}")));
        if let Some(t) = timeout {
            hook.insert("timeout".into(), json!(t));
        }
        if *is_async {
            hook.insert("async".into(), json!(true));
        }
        arr.push(json!({ "hooks": [Value::Object(hook)] }));
    }
}

/// Remove Clowder's hook groups from every event, leaving all else intact.
fn apply_uninstall(root: &mut Value) {
    if let Some(hooks) = root.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (ev, _, _) in EVENTS {
            if let Some(arr) = hooks.get_mut(*ev).and_then(|a| a.as_array_mut()) {
                remove_clowder(arr);
            }
        }
    }
}

fn is_installed(root: &Value) -> bool {
    let Some(hooks) = root.get("hooks").and_then(|h| h.as_object()) else {
        return false;
    };
    EVENTS.iter().any(|(ev, _, _)| {
        hooks
            .get(*ev)
            .and_then(|a| a.as_array())
            .is_some_and(|groups| {
                groups.iter().any(|g| {
                    g.get("hooks").and_then(|h| h.as_array()).is_some_and(|list| {
                        list.iter().any(|h| is_clowder_command(h.get("command").and_then(|c| c.as_str())))
                    })
                })
            })
    })
}

// ---- file I/O ----

fn load(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .filter(|t| !t.trim().is_empty())
        .and_then(|t| serde_json::from_str(&t).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn save(path: &Path, root: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Back up settings before touching it: a one-time `.bak-clowder` (the true pristine copy) plus a
/// timestamped copy under `%LOCALAPPDATA%\Clowder\settings-backups\` on every write.
fn backup(path: &Path) {
    if !path.exists() {
        return;
    }
    let once = path.with_extension("json.bak-clowder");
    if !once.exists() {
        let _ = std::fs::copy(path, &once);
    }
    if let Some(dir) = crate::spool::clowder_dir().map(|d| d.join("settings-backups")) {
        if std::fs::create_dir_all(&dir).is_ok() {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = std::fs::copy(path, dir.join(format!("settings-{ts}.json")));
        }
    }
}

// ---- Tauri commands ----

#[tauri::command]
pub fn beacon_installed() -> bool {
    match settings_path() {
        Some(p) => is_installed(&load(&p)),
        None => false,
    }
}

#[tauri::command]
pub fn beacon_install() -> Result<(), String> {
    let path = settings_path().ok_or("USERPROFILE unavailable")?;
    let cmd_base = format!("\"{}\"", exe_path().ok_or("cannot resolve clowder.exe path")?);
    backup(&path);
    let mut root = load(&path);
    apply_install(&mut root, &cmd_base);
    save(&path, &root)
}

#[tauri::command]
pub fn beacon_uninstall() -> Result<(), String> {
    let path = settings_path().ok_or("USERPROFILE unavailable")?;
    if !path.exists() {
        return Ok(());
    }
    backup(&path);
    let mut root = load(&path);
    apply_uninstall(&mut root);
    save(&path, &root)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Settings that already carry Vigil + atlas hooks and an unrelated key — nothing here may be lost.
    fn sample() -> Value {
        json!({
            "permissions": { "allow": ["Read"] },
            "hooks": {
                "SessionStart": [
                    { "hooks": [
                        { "type": "command", "command": "bash ~/.claude/atlas-brief.sh" }
                    ] },
                    { "hooks": [
                        { "type": "command", "command": "\"C:/Users/x/AppData/Local/Vigil/bin/beacon.exe\" --event SessionStart", "async": true }
                    ] }
                ]
            }
        })
    }

    #[test]
    fn install_adds_clowder_and_preserves_everything() {
        let mut root = sample();
        apply_install(&mut root, "\"D:/build/clowder.exe\"");
        assert!(is_installed(&root));
        // all 7 events now present
        let hooks = root["hooks"].as_object().unwrap();
        for (ev, _, _) in EVENTS {
            assert!(hooks.contains_key(*ev), "missing {ev}");
        }
        // Vigil + atlas survive on SessionStart, plus the new Clowder group = 3 groups.
        let ss = hooks["SessionStart"].as_array().unwrap();
        assert_eq!(ss.len(), 3);
        let cmds: Vec<&str> = ss
            .iter()
            .filter_map(|g| g["hooks"][0]["command"].as_str())
            .collect();
        assert!(cmds.iter().any(|c| c.contains("atlas-brief")));
        assert!(cmds.iter().any(|c| c.contains("Vigil/bin/beacon")));
        assert!(cmds.iter().any(|c| c.contains("clowder.exe") && c.contains("--beacon")));
        // unrelated settings untouched
        assert_eq!(root["permissions"]["allow"][0], "Read");
    }

    #[test]
    fn install_is_idempotent() {
        let mut root = sample();
        apply_install(&mut root, "\"D:/build/clowder.exe\"");
        apply_install(&mut root, "\"D:/build/clowder.exe\"");
        // exactly one Clowder group on SessionStart (not two)
        let ss = root["hooks"]["SessionStart"].as_array().unwrap();
        let clowder = ss
            .iter()
            .filter(|g| is_clowder_command(g["hooks"][0]["command"].as_str()))
            .count();
        assert_eq!(clowder, 1);
        assert_eq!(ss.len(), 3); // atlas + vigil + one clowder
    }

    #[test]
    fn uninstall_removes_only_clowder() {
        let mut root = sample();
        apply_install(&mut root, "\"D:/build/clowder.exe\"");
        apply_uninstall(&mut root);
        assert!(!is_installed(&root));
        // Vigil + atlas still there; the empty events Clowder added collapse to empty arrays.
        let ss = root["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(ss.len(), 2);
        let cmds: Vec<&str> = ss.iter().filter_map(|g| g["hooks"][0]["command"].as_str()).collect();
        assert!(cmds.iter().any(|c| c.contains("atlas-brief")));
        assert!(cmds.iter().any(|c| c.contains("Vigil/bin/beacon")));
        // a later user addition to an event Clowder had touched must survive uninstall
        assert_eq!(root["permissions"]["allow"][0], "Read");
    }

    #[test]
    fn uninstall_preserves_later_additions_in_clowder_events() {
        let mut root = json!({ "hooks": {} });
        apply_install(&mut root, "\"D:/build/clowder.exe\"");
        // Simulate another tool adding its own Stop hook after Clowder installed.
        root["hooks"]["Stop"].as_array_mut().unwrap().push(json!({
            "hooks": [ { "type": "command", "command": "bash ~/.claude/other-tool.sh" } ]
        }));
        apply_uninstall(&mut root);
        let stop = root["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert!(stop[0]["hooks"][0]["command"].as_str().unwrap().contains("other-tool"));
    }
}
