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
//! Usage self-production: install also wraps the user's statusline (`~/.claude/clowder-statusline-wrap.sh`)
//! so Claude Code's statusline payload (context %/5h/7d budget) is teed to Clowder's usage spool before
//! delegating to the user's *original* statusline. The original statusLine value is base64-preserved inside
//! the wrapper's marker comment and restored — or removed, if there was none — on uninstall. Wrapping is
//! **fail-soft**: a failure here never blocks the (higher-value, lower-risk) session-tracking hook install.

use base64::Engine as _;
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

// ---- statusline wrap (usage self-production) ----

/// Marker line inside the wrapper script that carries the base64 of the user's original statusLine value.
const WRAP_MARKER: &str = "# clowder-original-json-b64:";

/// `~/.claude/clowder-statusline-wrap.sh` — the bash wrapper that tees the payload to Clowder's usage
/// spool, then runs the user's original statusline. Lives next to settings.json.
fn statusline_wrap_path() -> Option<PathBuf> {
    settings_path().and_then(|p| p.parent().map(|d| d.join("clowder-statusline-wrap.sh")))
}

/// True when a statusLine command is *our* wrapper — path-independent, matched by the script's basename.
fn is_clowder_statusline(cmd: Option<&str>) -> bool {
    cmd.is_some_and(|c| c.replace('\\', "/").to_lowercase().contains("clowder-statusline-wrap"))
}

/// Recover the user's original statusLine value from the wrapper's marker comment (`None` if the user had
/// none, or the marker is absent/corrupt).
fn read_wrap_original(wrap_path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(wrap_path).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix(WRAP_MARKER) {
            let b64 = rest.trim();
            if b64.is_empty() {
                return None;
            }
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            return serde_json::from_slice(&bytes).ok();
        }
    }
    None
}

/// Write the wrapper script (LF, no BOM). `original` is the statusLine value we delegate to — its inner
/// `command` gets the payload piped in; if there is none we print a minimal line so Claude Code still
/// renders something. `cb_exe` is the forward-slashed absolute path to clowder.exe.
fn write_wrapper(wrap_path: &Path, cb_exe: &str, original: Option<&Value>) -> Result<(), String> {
    let b64 = match original {
        Some(v) => base64::engine::general_purpose::STANDARD
            .encode(serde_json::to_vec(v).map_err(|e| e.to_string())?),
        None => String::new(),
    };
    let orig_cmd = original
        .and_then(|v| v.get("command"))
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty());
    let delegate = match orig_cmd {
        Some(cmd) => format!("printf '%s' \"$input\" | {cmd}"),
        None => "printf 'Claude Code\\n'".to_string(),
    };
    let lines: Vec<String> = vec![
        "#!/bin/sh".into(),
        "# Clowder statusline wrapper (auto-generated by Clowder session-tracking install).".into(),
        "# Tees the statusline payload to Clowder (context/5h/7d usage) then runs your original statusline."
            .into(),
        "# Your original statusLine is preserved in the marker below and restored on uninstall.".into(),
        format!("{WRAP_MARKER} {b64}"),
        "input=$(cat)".into(),
        format!("cb=\"{cb_exe}\""),
        "if [ -f \"$cb\" ]; then".into(),
        "  printf '%s' \"$input\" | \"$cb\" --beacon --statusline >/dev/null 2>&1 &".into(),
        "fi".into(),
        delegate,
    ];
    let script = lines.join("\n") + "\n";
    if let Some(dir) = wrap_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(wrap_path, script).map_err(|e| e.to_string())
}

/// Wrap the user's statusLine so Clowder tees usage, preserving the original in the wrapper's marker.
/// Idempotent: if statusLine is already our wrapper, we recover the *true* original rather than wrapping
/// the wrapper.
fn apply_statusline_install(root: &mut Value, wrap_path: &Path, cb_exe: &str) -> Result<(), String> {
    if !root.is_object() {
        *root = json!({});
    }
    let current = root.get("statusLine").cloned();
    let current_cmd = current.as_ref().and_then(|v| v.get("command")).and_then(|c| c.as_str());
    let original: Option<Value> = if is_clowder_statusline(current_cmd) {
        read_wrap_original(wrap_path)
    } else {
        current.clone().filter(|v| !v.is_null())
    };
    write_wrapper(wrap_path, cb_exe, original.as_ref())?;
    root.as_object_mut().unwrap().insert(
        "statusLine".into(),
        json!({ "type": "command", "command": "bash ~/.claude/clowder-statusline-wrap.sh" }),
    );
    Ok(())
}

/// Restore the user's original statusLine and delete the wrapper script. No-op on the settings if the
/// statusLine isn't ours (the user replaced it after install — leave their choice alone).
fn apply_statusline_uninstall(root: &mut Value, wrap_path: &Path) {
    let current_cmd =
        root.get("statusLine").and_then(|v| v.get("command")).and_then(|c| c.as_str());
    if is_clowder_statusline(current_cmd) {
        let original = read_wrap_original(wrap_path);
        if let Some(obj) = root.as_object_mut() {
            match original {
                Some(v) => {
                    obj.insert("statusLine".into(), v);
                }
                None => {
                    obj.remove("statusLine");
                }
            }
        }
    }
    let _ = std::fs::remove_file(wrap_path);
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
    let exe = exe_path().ok_or("cannot resolve clowder.exe path")?;
    backup(&path);
    let mut root = load(&path);
    apply_install(&mut root, &format!("\"{exe}\""));
    // Usage self-production via statusline wrap — fail-soft: never let it block session tracking.
    if let Some(wrap) = statusline_wrap_path() {
        if let Err(e) = apply_statusline_install(&mut root, &wrap, &exe) {
            eprintln!("[clowder] statusline wrap skipped: {e}");
        }
    }
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
    if let Some(wrap) = statusline_wrap_path() {
        apply_statusline_uninstall(&mut root, &wrap);
    }
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

    // ---- statusline wrap ----

    /// A distinct temp wrapper path per test (cargo runs tests in parallel threads).
    fn tmp_wrap(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("clowder-test-{name}"));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("clowder-statusline-wrap.sh");
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn statusline_wraps_and_preserves_full_original() {
        let wrap = tmp_wrap("wrap-preserve");
        let mut root = json!({ "statusLine": { "type": "command", "command": "npx ccstatusline@latest", "padding": 0 } });
        apply_statusline_install(&mut root, &wrap, "D:/x/clowder.exe").unwrap();
        // settings.json now points at our wrapper
        assert_eq!(root["statusLine"]["command"], "bash ~/.claude/clowder-statusline-wrap.sh");
        // script written with marker, delegate to original, and the usage tee
        let script = std::fs::read_to_string(&wrap).unwrap();
        assert!(script.contains(WRAP_MARKER));
        assert!(script.contains("npx ccstatusline@latest"), "delegate must pipe to original");
        assert!(script.contains("--beacon --statusline"), "must tee to clowder usage");
        assert!(!script.contains('\r'), "must be LF-only for /bin/sh");
        // the FULL original object is recoverable (not just the command string)
        let orig = read_wrap_original(&wrap).unwrap();
        assert_eq!(orig["command"], "npx ccstatusline@latest");
        assert_eq!(orig["padding"], 0);
    }

    #[test]
    fn statusline_uninstall_restores_original() {
        let wrap = tmp_wrap("wrap-restore");
        let mut root = json!({ "statusLine": { "type": "command", "command": "my-status --foo", "padding": 2 } });
        apply_statusline_install(&mut root, &wrap, "D:/x/clowder.exe").unwrap();
        apply_statusline_uninstall(&mut root, &wrap);
        assert_eq!(root["statusLine"]["command"], "my-status --foo");
        assert_eq!(root["statusLine"]["padding"], 2); // exact restore, padding intact
        assert!(!wrap.exists(), "wrapper script deleted on uninstall");
    }

    #[test]
    fn statusline_uninstall_removes_when_there_was_no_original() {
        let wrap = tmp_wrap("wrap-none");
        let mut root = json!({ "permissions": { "allow": ["Read"] } }); // no statusLine at all
        apply_statusline_install(&mut root, &wrap, "D:/x/clowder.exe").unwrap();
        assert_eq!(root["statusLine"]["command"], "bash ~/.claude/clowder-statusline-wrap.sh");
        apply_statusline_uninstall(&mut root, &wrap);
        assert!(root.get("statusLine").is_none(), "statusLine removed entirely, not left as wrapper");
        assert_eq!(root["permissions"]["allow"][0], "Read"); // unrelated settings untouched
    }

    #[test]
    fn statusline_reinstall_keeps_true_original() {
        let wrap = tmp_wrap("wrap-reinstall");
        let mut root = json!({ "statusLine": { "type": "command", "command": "original-line" } });
        apply_statusline_install(&mut root, &wrap, "D:/x/clowder.exe").unwrap();
        apply_statusline_install(&mut root, &wrap, "D:/y/clowder.exe").unwrap(); // wrap again
        let orig = read_wrap_original(&wrap).unwrap();
        assert_eq!(orig["command"], "original-line", "must not wrap our own wrapper");
    }

    #[test]
    fn statusline_wraps_vigil_and_restores_it() {
        let wrap = tmp_wrap("wrap-vigil");
        let mut root = json!({ "statusLine": { "type": "command", "command": "bash ~/.claude/vigil-statusline-wrap.sh" } });
        apply_statusline_install(&mut root, &wrap, "D:/x/clowder.exe").unwrap();
        let script = std::fs::read_to_string(&wrap).unwrap();
        assert!(script.contains("vigil-statusline-wrap"), "delegates to Vigil's wrapper, not clobbered");
        apply_statusline_uninstall(&mut root, &wrap);
        assert_eq!(root["statusLine"]["command"], "bash ~/.claude/vigil-statusline-wrap.sh"); // Vigil back
    }
}
