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
//! Path robustness: install stages this exe to a **stable per-user path** (`%LOCALAPPDATA%\Clowder\bin\
//! clowder.exe`) and points the hooks + wrapper there, so tracking keeps working if the app itself is
//! moved or reinstalled elsewhere. Startup refreshes that copy (when the running exe is newer) so an app
//! update propagates its beacon logic without a reinstall.
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

/// `~/.claude/clowder-statusline-wrap.sh` — the **legacy** bash wrapper (pre-native passthrough). Kept
/// only so an existing install can be migrated and removed.
fn statusline_wrap_path() -> Option<PathBuf> {
    settings_path().and_then(|p| p.parent().map(|d| d.join("clowder-statusline-wrap.sh")))
}

/// `~/.claude/clowder-statusline.json` — where the user's original statusLine value now lives, next to
/// settings.json. Replaces the base64 marker inside the old shell script: no shell, no script, just data.
fn statusline_state_path() -> Option<PathBuf> {
    settings_path().and_then(|p| p.parent().map(|d| d.join("clowder-statusline.json")))
}

/// The statusLine command we install: the staged beacon invoked **directly**. No shell and no script file
/// stand between Claude Code and us.
///
/// Why that matters: Claude Code runs the statusLine command through Git Bash *when Git Bash is
/// installed, and through PowerShell when it is not* (documented). The old `bash ~/…wrap.sh` therefore
/// resolved `bash` from PowerShell's PATH on a Git-Bash-less machine — where `bash.exe` is usually the
/// WSL stub in `WindowsApps`, which exits 1 with no distro installed. A statusLine command that fails
/// renders as a **blank status line, silently** (also documented), so the failure is invisible.
fn statusline_command(beacon: &str) -> String {
    format!("\"{beacon}\" --beacon --statusline")
}

/// True when a statusLine command is *ours* — the native invocation or the legacy wrapper script.
/// Path-independent: the native form is matched by its flags, the legacy one by the script's basename.
fn is_clowder_statusline(cmd: Option<&str>) -> bool {
    cmd.is_some_and(|c| {
        let n = c.replace('\\', "/").to_lowercase();
        n.contains("clowder-statusline-wrap")
            || (n.contains("clowder") && n.contains("--beacon") && n.contains("--statusline"))
    })
}

/// What to render when the user had no statusline of their own (their choice at install time).
/// `none` = stay invisible and only collect usage; `clowder` = draw Clowder's own one-line summary.
fn normalize_mode(mode: Option<&str>) -> &'static str {
    match mode {
        Some("clowder") => "clowder",
        _ => "none",
    }
}

/// Read the sidecar at `path`: `(original statusLine value, mode)`. `None` when there is no sidecar at
/// all — which the beacon reads as "not installed by us", and it then prints nothing.
fn read_statusline_state(path: &Path) -> Option<(Option<Value>, String)> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let original = v.get("original").filter(|o| !o.is_null()).cloned();
    let mode = normalize_mode(v.get("mode").and_then(|m| m.as_str())).to_string();
    Some((original, mode))
}

/// The sidecar at its real location — what the beacon consults on every statusline render.
pub fn statusline_state() -> Option<(Option<Value>, String)> {
    read_statusline_state(&statusline_state_path()?)
}

fn write_statusline_state(path: &Path, original: Option<&Value>, mode: &str) -> Result<(), String> {
    let body = json!({ "original": original.cloned().unwrap_or(Value::Null), "mode": normalize_mode(Some(mode)) });
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
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

/// Point statusLine at the beacon directly, preserving the user's original in the sidecar.
///
/// Idempotent in the way that matters: when the current statusLine is already ours we recover the **true**
/// original (from the sidecar, or from the legacy wrapper's marker) instead of preserving ourselves and
/// losing it. `mode` only matters when there is no original.
fn apply_statusline_install(
    root: &mut Value,
    state_path: &Path,
    wrap_path: &Path,
    beacon: &str,
    mode: &str,
) -> Result<(), String> {
    if !root.is_object() {
        *root = json!({});
    }
    let current = root.get("statusLine").cloned();
    let current_cmd = current.as_ref().and_then(|v| v.get("command")).and_then(|c| c.as_str());
    let original: Option<Value> = if is_clowder_statusline(current_cmd) {
        read_statusline_state(state_path)
            .and_then(|(o, _)| o)
            .or_else(|| read_wrap_original(wrap_path))
    } else {
        current.clone().filter(|v| !v.is_null())
    };
    write_statusline_state(state_path, original.as_ref(), mode)?;
    root.as_object_mut().unwrap().insert(
        "statusLine".into(),
        json!({ "type": "command", "command": statusline_command(beacon) }),
    );
    let _ = std::fs::remove_file(wrap_path); // the shell wrapper has no job left
    Ok(())
}

/// Restore the user's original statusLine and delete our sidecar. No-op on the settings if the statusLine
/// isn't ours (the user replaced it after install — leave their choice alone).
fn apply_statusline_uninstall(root: &mut Value, state_path: &Path, wrap_path: &Path) {
    let current_cmd =
        root.get("statusLine").and_then(|v| v.get("command")).and_then(|c| c.as_str());
    if is_clowder_statusline(current_cmd) {
        let original = read_statusline_state(state_path)
            .and_then(|(o, _)| o)
            .or_else(|| read_wrap_original(wrap_path));
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
    let _ = std::fs::remove_file(state_path);
    let _ = std::fs::remove_file(wrap_path);
}

/// Move a pre-native install onto the sidecar: lift the original out of the wrapper's base64 marker,
/// repoint statusLine at the beacon, delete the `.sh`. Fail-soft and idempotent — a machine with no
/// wrapper leaves here untouched.
///
/// Runs at startup rather than at install time because the whole point is to fix installs the user is
/// *already* carrying, without making them click anything.
fn migrate_statusline_wrapper(beacon: &str) {
    let (Some(path), Some(state_path), Some(wrap_path)) =
        (settings_path(), statusline_state_path(), statusline_wrap_path())
    else {
        return;
    };
    migrate_statusline_wrapper_at(&path, &state_path, &wrap_path, beacon);
}

fn migrate_statusline_wrapper_at(path: &Path, state_path: &Path, wrap_path: &Path, beacon: &str) {
    if !wrap_path.exists() {
        return;
    }
    // The old wrapper printed `Claude Code` when there was no original, so "clowder" preserves what the
    // user currently sees; with an original, mode is unused.
    let original = read_wrap_original(wrap_path);
    if write_statusline_state(state_path, original.as_ref(), "clowder").is_err() {
        return; // leave the working wrapper in place rather than orphan the original
    }
    let mut root = load(path);
    let current_cmd = root.get("statusLine").and_then(|v| v.get("command")).and_then(|c| c.as_str());
    if is_clowder_statusline(current_cmd) {
        backup(path);
        if let Some(obj) = root.as_object_mut() {
            obj.insert(
                "statusLine".into(),
                json!({ "type": "command", "command": statusline_command(beacon) }),
            );
        }
        if save(path, &root).is_err() {
            return;
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

// ---- beacon binary staging (path robustness) ----

/// `%LOCALAPPDATA%\Clowder\bin` — a stable per-user home for the beacon binary, referenced by the hooks
/// and the statusline wrapper so session tracking survives the app being moved or reinstalled elsewhere.
fn beacon_bin_dir() -> Option<PathBuf> {
    crate::spool::clowder_dir().map(|d| d.join("bin"))
}

/// Should we (re)stage the beacon binary? Yes if the staged copy is missing or the running exe is newer
/// (an app update must propagate to the staged copy). Any stat error resolves to "yes" — copying is
/// cheaper than running a stale beacon.
fn should_restage(dst: &Path, src: &Path) -> bool {
    match (
        std::fs::metadata(dst).and_then(|m| m.modified()),
        std::fs::metadata(src).and_then(|m| m.modified()),
    ) {
        (Ok(staged), Ok(running)) => running > staged,
        _ => true,
    }
}

/// Copy `src` into `bin_dir/clowder.exe` (temp+rename) when stale. Returns the forward-slashed stable
/// path, or `None` if nothing is staged. A failed copy is non-fatal: a locked dst (a beacon running from
/// it at that instant) keeps the existing copy, which is still a valid beacon.
fn stage_binary(src: &Path, bin_dir: &Path) -> Option<String> {
    std::fs::create_dir_all(bin_dir).ok()?;
    let dst = bin_dir.join("clowder.exe");
    if should_restage(&dst, src) {
        let tmp = bin_dir.join("clowder.exe.new");
        if std::fs::copy(src, &tmp).is_ok() {
            let _ = std::fs::rename(&tmp, &dst); // dst locked → keep the old (still-valid) copy
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    dst.exists().then(|| dst.to_string_lossy().replace('\\', "/"))
}

/// Stage this exe to the stable bin path. `None` if staging failed (caller falls back to `current_exe`).
fn ensure_beacon_binary() -> Option<String> {
    let src = std::env::current_exe().ok()?;
    stage_binary(&src, &beacon_bin_dir()?)
}

/// Delete the staged beacon binary on uninstall — nothing references it once the hooks are gone. Fail-soft.
fn remove_beacon_binary() {
    if let Some(dir) = beacon_bin_dir() {
        let _ = std::fs::remove_file(dir.join("clowder.exe"));
    }
}

/// Refresh the staged beacon binary on app startup **iff** tracking is installed — so an app update
/// propagates its new beacon logic without a reinstall. Cheap (just a stat) on a normal launch.
pub fn refresh_beacon_binary_on_startup() {
    let Some(path) = settings_path() else { return };
    if is_installed(&load(&path)) {
        if let Some(beacon) = ensure_beacon_binary().or_else(exe_path) {
            migrate_statusline_wrapper(&beacon);
        }
    }
}

// ---- Tauri commands ----

/// What the rail needs to tell the truth about tracking. `hooks` alone used to stand in for "installed",
/// which is exactly the combination the user hits when hooks land but usage never arrives: the UI says
/// installed, the numbers stay empty, and nothing in the app admits the gap.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeaconStatus {
    /// Clowder's hook groups are present in settings.json.
    pub hooks: bool,
    /// statusLine points at our beacon (the only source of usage).
    pub statusline: bool,
    /// The staged `%LOCALAPPDATA%\Clowder\bin\clowder.exe` exists — hooks reference it by that path.
    pub binary: bool,
    /// The user has a statusLine of their own that we would be wrapping. Drives whether install asks.
    pub user_statusline: bool,
    /// Newest spool write, ISO-8601 — "installed but nothing has arrived" is a distinct state.
    pub last_hook_at: Option<String>,
    pub last_usage_at: Option<String>,
}

/// Newest mtime under a Clowder spool subdir, as ISO-8601.
fn newest_spool_write(sub: &str) -> Option<String> {
    let dir = crate::spool::clowder_dir()?.join(sub);
    let newest = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok()?.metadata().ok()?.modified().ok())
        .max()?;
    let secs = newest.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    Some(crate::beacon::unix_to_iso(secs))
}

#[tauri::command]
pub fn beacon_status() -> BeaconStatus {
    let root = settings_path().map(|p| load(&p)).unwrap_or_else(|| json!({}));
    let cmd = root.get("statusLine").and_then(|v| v.get("command")).and_then(|c| c.as_str());
    let ours = is_clowder_statusline(cmd);
    BeaconStatus {
        hooks: is_installed(&root),
        statusline: ours,
        binary: beacon_bin_dir().is_some_and(|d| d.join("clowder.exe").exists()),
        // Ours doesn't count as theirs, and the sidecar remembers what we displaced.
        user_statusline: if ours {
            statusline_state().and_then(|(o, _)| o).is_some()
        } else {
            cmd.is_some_and(|c| !c.is_empty())
        },
        last_hook_at: newest_spool_write("sessions"),
        last_usage_at: newest_spool_write("usage"),
    }
}

/// `mode` decides what the status line shows for a user who had none: `"none"` (collect silently) or
/// `"clowder"` (draw our own line). Ignored when we're wrapping an original.
#[tauri::command]
pub fn beacon_install(mode: Option<String>) -> Result<(), String> {
    let path = settings_path().ok_or("USERPROFILE unavailable")?;
    // Prefer the stable staged binary so hooks survive the app moving; fall back to the running exe.
    let beacon = ensure_beacon_binary().or_else(exe_path).ok_or("cannot resolve clowder.exe path")?;
    backup(&path);
    let mut root = load(&path);
    apply_install(&mut root, &format!("\"{beacon}\""));
    // Usage self-production — fail-soft: never let it block session tracking.
    if let (Some(state), Some(wrap)) = (statusline_state_path(), statusline_wrap_path()) {
        let mode = normalize_mode(mode.as_deref());
        if let Err(e) = apply_statusline_install(&mut root, &state, &wrap, &beacon, mode) {
            eprintln!("[clowder] statusline install skipped: {e}");
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
    if let (Some(state), Some(wrap)) = (statusline_state_path(), statusline_wrap_path()) {
        apply_statusline_uninstall(&mut root, &state, &wrap);
    }
    save(&path, &root)?;
    remove_beacon_binary(); // tidy: drop the staged copy now that nothing references it
    Ok(())
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

    // ---- statusline (native passthrough) ----

    /// A distinct temp dir per test (cargo runs tests in parallel threads) holding the pair of paths the
    /// statusline functions work on.
    fn tmp_paths(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("clowder-test-{name}"));
        let _ = std::fs::create_dir_all(&dir);
        let state = dir.join("clowder-statusline.json");
        let wrap = dir.join("clowder-statusline-wrap.sh");
        let _ = std::fs::remove_file(&state);
        let _ = std::fs::remove_file(&wrap);
        (state, wrap)
    }

    const BEACON: &str = "C:/Users/me/AppData/Local/Clowder/bin/clowder.exe";

    #[test]
    fn statusline_calls_the_beacon_directly_and_preserves_the_full_original() {
        let (state, wrap) = tmp_paths("sl-preserve");
        let mut root = json!({ "statusLine": { "type": "command", "command": "npx ccstatusline@latest", "padding": 0 } });
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "none").unwrap();
        // No shell and no script stand between Claude Code and the beacon — that was the whole bug.
        let cmd = root["statusLine"]["command"].as_str().unwrap();
        assert_eq!(cmd, format!("\"{BEACON}\" --beacon --statusline"));
        assert!(!cmd.contains("bash"), "must not depend on a bash on PATH");
        assert!(!cmd.contains(".sh"), "must not depend on a script file");
        // the FULL original object survives in the sidecar (not just the command string)
        let (orig, _) = read_statusline_state(&state).unwrap();
        let orig = orig.unwrap();
        assert_eq!(orig["command"], "npx ccstatusline@latest");
        assert_eq!(orig["padding"], 0);
    }

    #[test]
    fn statusline_uninstall_restores_original() {
        let (state, wrap) = tmp_paths("sl-restore");
        let mut root = json!({ "statusLine": { "type": "command", "command": "my-status --foo", "padding": 2 } });
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "none").unwrap();
        apply_statusline_uninstall(&mut root, &state, &wrap);
        assert_eq!(root["statusLine"]["command"], "my-status --foo");
        assert_eq!(root["statusLine"]["padding"], 2); // exact restore, padding intact
        assert!(!state.exists(), "sidecar deleted on uninstall");
    }

    #[test]
    fn statusline_uninstall_removes_when_there_was_no_original() {
        let (state, wrap) = tmp_paths("sl-none");
        let mut root = json!({ "permissions": { "allow": ["Read"] } }); // no statusLine at all
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "none").unwrap();
        assert!(root["statusLine"]["command"].as_str().unwrap().contains("--statusline"));
        apply_statusline_uninstall(&mut root, &state, &wrap);
        assert!(root.get("statusLine").is_none(), "statusLine removed entirely, not left as ours");
        assert_eq!(root["permissions"]["allow"][0], "Read"); // unrelated settings untouched
    }

    #[test]
    fn statusline_mode_is_recorded_only_as_asked() {
        let (state, wrap) = tmp_paths("sl-mode");
        let mut root = json!({});
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "clowder").unwrap();
        assert_eq!(read_statusline_state(&state).unwrap().1, "clowder");
        // Anything we don't recognise means "stay quiet" — a user who had no statusline never gets
        // handed one by accident.
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "garbage").unwrap();
        assert_eq!(read_statusline_state(&state).unwrap().1, "none");
    }

    #[test]
    fn statusline_reinstall_keeps_true_original() {
        let (state, wrap) = tmp_paths("sl-reinstall");
        let mut root = json!({ "statusLine": { "type": "command", "command": "original-line" } });
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "none").unwrap();
        apply_statusline_install(&mut root, &state, &wrap, "D:/other/clowder.exe", "none").unwrap();
        let (orig, _) = read_statusline_state(&state).unwrap();
        assert_eq!(orig.unwrap()["command"], "original-line", "must not preserve ourselves as the original");
    }

    /// The upgrade path that matters: a user carrying the old bash wrapper must end up on the native
    /// command with their original intact, without clicking anything.
    #[test]
    fn legacy_wrapper_migrates_to_sidecar() {
        let (state, wrap) = tmp_paths("sl-migrate");
        let settings = wrap.parent().unwrap().join("settings.json");
        // A pre-native install: statusLine points at the .sh, the original lives in its marker.
        let original = json!({ "type": "command", "command": "bash ~/.claude/statusline-command.sh" });
        let b64 = base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(&original).unwrap());
        std::fs::write(&wrap, format!("#!/bin/sh\n{WRAP_MARKER} {b64}\ninput=$(cat)\n")).unwrap();
        save(
            &settings,
            &json!({ "statusLine": { "type": "command", "command": "bash ~/.claude/clowder-statusline-wrap.sh" } }),
        )
        .unwrap();

        migrate_statusline_wrapper_at(&settings, &state, &wrap, BEACON);

        let root = load(&settings);
        assert_eq!(root["statusLine"]["command"].as_str().unwrap(), format!("\"{BEACON}\" --beacon --statusline"));
        let (orig, _) = read_statusline_state(&state).unwrap();
        assert_eq!(orig.unwrap()["command"], "bash ~/.claude/statusline-command.sh");
        assert!(!wrap.exists(), "the .sh is gone once its contents moved");
        // And it stays put on a second run.
        migrate_statusline_wrapper_at(&settings, &state, &wrap, BEACON);
        assert_eq!(read_statusline_state(&state).unwrap().0.unwrap()["command"], "bash ~/.claude/statusline-command.sh");
    }

    /// Migration must not touch a statusLine the user replaced with their own after installing.
    #[test]
    fn migration_leaves_a_user_replaced_statusline_alone() {
        let (state, wrap) = tmp_paths("sl-migrate-user");
        let settings = wrap.parent().unwrap().join("settings.json");
        std::fs::write(&wrap, format!("#!/bin/sh\n{WRAP_MARKER} \n")).unwrap();
        save(&settings, &json!({ "statusLine": { "type": "command", "command": "my-own-line" } })).unwrap();
        migrate_statusline_wrapper_at(&settings, &state, &wrap, BEACON);
        assert_eq!(load(&settings)["statusLine"]["command"], "my-own-line");
    }

    // ---- beacon binary staging ----

    #[test]
    fn stage_binary_copies_to_stable_path() {
        let dir = std::env::temp_dir().join("clowder-test-bin-copy");
        let _ = std::fs::remove_dir_all(&dir);
        let src = std::env::temp_dir().join("clowder-test-srcexe-1");
        std::fs::write(&src, b"FAKEEXE-v1").unwrap();
        let p = stage_binary(&src, &dir).unwrap();
        assert!(p.ends_with("/clowder.exe"), "returns forward-slashed stable path, got {p}");
        assert_eq!(std::fs::read(dir.join("clowder.exe")).unwrap(), b"FAKEEXE-v1");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn should_restage_true_when_dst_missing() {
        let src = std::env::temp_dir().join("clowder-test-srcexe-2");
        std::fs::write(&src, b"x").unwrap();
        let missing = std::env::temp_dir().join("clowder-test-bin-missing").join("clowder.exe");
        let _ = std::fs::remove_file(&missing);
        assert!(should_restage(&missing, &src), "a missing staged copy must restage");
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn statusline_wraps_vigil_and_restores_it() {
        let (state, wrap) = tmp_paths("sl-vigil");
        let mut root = json!({ "statusLine": { "type": "command", "command": "bash ~/.claude/vigil-statusline-wrap.sh" } });
        apply_statusline_install(&mut root, &state, &wrap, BEACON, "none").unwrap();
        let (orig, _) = read_statusline_state(&state).unwrap();
        assert_eq!(
            orig.unwrap()["command"],
            "bash ~/.claude/vigil-statusline-wrap.sh",
            "Vigil's wrapper is the original we delegate to, not something we clobber"
        );
        apply_statusline_uninstall(&mut root, &state, &wrap);
        assert_eq!(root["statusLine"]["command"], "bash ~/.claude/vigil-statusline-wrap.sh"); // Vigil back
    }
}
