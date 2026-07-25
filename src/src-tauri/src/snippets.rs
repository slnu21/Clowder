//! Command snippets — a small persisted list a user runs often. Stored as one JSON file at
//! `%APPDATA%\deck\snippets.json`, Vigil's `SettingsStore` pattern: every read/write is best-effort and
//! **never throws** (missing/corrupt → empty). The frontend owns the list; these two commands load and
//! store it whole.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    /// Optional display label; empty → show the command itself. `#[serde(default)]` keeps snippets
    /// saved before labels existed loadable (no `label` key → empty).
    #[serde(default)]
    pub label: String,
    pub command: String,
}

fn file() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("deck").join("snippets.json"))
}

/// The saved snippets. Empty on a missing or corrupt file.
#[tauri::command]
pub fn get_snippets() -> Vec<Snippet> {
    file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default()
}

/// Persist the whole list. Best-effort — reports an error string but the caller keeps its in-memory copy.
#[tauri::command]
pub fn set_snippets(snippets: Vec<Snippet>) -> Result<(), String> {
    let path = file().ok_or("APPDATA unavailable")?;
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&snippets).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
