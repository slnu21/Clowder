//! User settings — one JSON file at `%APPDATA%\deck\settings.json`, no SQLite, no settings window.
//!
//! Vigil's `SettingsStore` pattern: every read/write is best-effort and **never throws** — a missing
//! or corrupt file falls back to defaults, and a failed save is swallowed. A default file is seeded
//! on first run so the user has something to inspect.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Explicit Git Bash location; falls back to a search when empty.
    pub git_bash_path: Option<String>,
    /// Which shell new terminals open. `"bash"` | `"powershell"`.
    pub shell: String,
    /// Primary terminal font family (CJK users care — this is a real setting, not chrome).
    pub terminal_font: String,
    pub terminal_font_size: u16,
    pub scrollback: u32,
    /// Where the explorer opens to; falls back to the home directory when empty.
    pub start_path: Option<String>,
    /// Pinned roots shown above the drives in the explorer.
    pub favorites: Vec<String>,
    /// UI theme: `"dark"` | `"light"`. Applied as `data-theme` on the document root.
    pub theme: String,
    /// Accent key: `"amber"` | `"sage"` | `"clay"` | `"neutral"`. The whole UI derives from one
    /// `--accent` token, so this single choice re-tints everything (theme-tuned in CSS).
    pub accent: String,
    /// Chrome scale, 0.9–1.5. Multiplies every CSS size token; the terminal has its own font size.
    pub ui_scale: f32,
    /// Is the left panel (explorer/workspace) shown?
    pub left_panel: bool,
    /// Right session rail: `"full"` | `"mini"` | `"hidden"`, or `None` for **never chosen**.
    ///
    /// `None` is not the same as `"full"`: it resolves at runtime to `full` when session tracking is
    /// installed and `hidden` when it isn't, so someone who doesn't use Claude Code session tracking
    /// never sees a rail they have no use for. Once they touch the toggle it becomes their choice and
    /// stops tracking the install state.
    pub right_rail: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            git_bash_path: None,
            shell: "bash".into(),
            terminal_font: "D2Coding".into(),
            terminal_font_size: 14,
            scrollback: 5000,
            start_path: None,
            favorites: Vec::new(),
            theme: "dark".into(),
            accent: "amber".into(),
            ui_scale: 1.0,
            left_panel: true,
            right_rail: None,
        }
    }
}

fn dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("deck"))
}

fn file() -> Option<PathBuf> {
    dir().map(|d| d.join("settings.json"))
}

/// Load settings, seeding a default file on first run. Never fails — corrupt/missing → defaults.
pub fn load() -> Settings {
    let Some(path) = file() else { return Settings::default() };
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default()
    } else {
        let s = Settings::default();
        let _ = save(&s); // seed-on-first-run, best-effort
        s
    }
}

/// Persist settings. Best-effort: a failure is reported but never panics the app.
pub fn save(s: &Settings) -> Result<(), String> {
    let path = file().ok_or("APPDATA unavailable")?;
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Resolve the shell exe path from settings: PowerShell (pwsh preferred) or Git Bash.
pub fn resolve_shell() -> String {
    let s = load();
    match s.shell.as_str() {
        "powershell" => powershell_path(),
        _ => bash_path(s.git_bash_path.as_deref()),
    }
}

/// Prefer PowerShell 7 (`pwsh.exe`, UTF-8 by default) but fall back to Windows PowerShell.
/// Either way the spawn wrapper (see `pty::build_command`) forces UTF-8 so Korean isn't mangled.
fn powershell_path() -> String {
    for base in ["ProgramFiles", "ProgramW6432"] {
        if let Some(root) = std::env::var_os(base) {
            let p = Path::new(&root).join("PowerShell").join("7").join("pwsh.exe");
            if p.is_file() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    "powershell.exe".into()
}

fn bash_path(explicit: Option<&str>) -> String {
    if let Some(p) = explicit {
        if !p.is_empty() && Path::new(p).is_file() {
            return p.to_string();
        }
    }
    crate::pty::default_shell()
}

/// The configured explorer start folder, if set and still a real directory. `None` means "unset" —
/// the caller picks its own fallback.
pub fn start_root() -> Option<String> {
    let p = load().start_path?;
    (!p.is_empty() && Path::new(&p).is_dir()).then_some(p)
}

#[tauri::command]
pub fn get_settings() -> Settings {
    load()
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    save(&settings)
}

/// Settings-aware shell resolution for the frontend (replaces the old fixed `default_shell`).
#[tauri::command]
pub fn resolve_shell_cmd() -> String {
    resolve_shell()
}
