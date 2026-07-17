//! Filesystem listing for the explorer sidebar.
//!
//! The Rust side has the same full filesystem access as any desktop process, which is why deck does
//! not register Tauri's `fs` plugin at all — its JS-side scopes and path-traversal guards exist to
//! contain a webview, and an explorer that can only see one folder is exactly what we're building
//! this app to escape. (md-reader reached the same conclusion; see its `commands/fs_ops.rs`.)
//!
//! **Listing is one level and lazy.** md-reader's `read_dir_tree` recurses to depth 8, which is
//! right for importing a project folder and fatal for `C:\` — this is a replacement, not a harvest.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Hidden by attribute or leading dot. The frontend dims these rather than hiding them: in a
    /// repo, `.git` and `.claude` are things you go looking for.
    pub hidden: bool,
}

/// Roots for the tree. Drives only — there is no workspace, by design.
#[tauri::command]
pub fn list_drives() -> Vec<Entry> {
    let mut out = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        // `is_dir` on a drive root is a cheap existence probe and skips empty CD/card readers.
        if Path::new(&root).is_dir() {
            out.push(Entry { name: root.clone(), path: root, is_dir: true, hidden: false });
        }
    }
    out
}

/// One level of `path`. Folders first, then name — the only rule worth keeping from md-reader.
///
/// Unreadable children are skipped rather than failing the whole listing: one
/// permission-denied folder shouldn't blank the tree.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }

    let mut entries: Vec<Entry> = fs::read_dir(dir)
        .map_err(|e| format!("{path}: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            // `file_type()` comes from the directory entry itself — no extra stat, and it does not
            // follow symlinks into somewhere slow or absent.
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let hidden = name.starts_with('.') || is_hidden_attr(&e);
            Entry { name, path: p.to_string_lossy().into_owned(), is_dir, hidden }
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[cfg(windows)]
fn is_hidden_attr(e: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    e.metadata()
        .map(|m| m.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_hidden_attr(_e: &fs::DirEntry) -> bool {
    false
}

/// Where the explorer opens. The Workspace folder if it exists, else the user profile — a
/// convenience default only; M7 makes it a setting.
#[tauri::command]
pub fn default_root() -> Option<String> {
    let home = std::env::var_os("USERPROFILE")?;
    let ws = Path::new(&home).join("Documents").join("Workspace");
    let pick = if ws.is_dir() { ws } else { Path::new(&home).to_path_buf() };
    Some(pick.to_string_lossy().into_owned())
}
