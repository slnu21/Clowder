//! Filesystem listing for the explorer sidebar.
//!
//! The Rust side has the same full filesystem access as any desktop process, which is why deck does
//! not register Tauri's `fs` plugin at all — its JS-side scopes and path-traversal guards exist to
//! contain a webview, and an explorer that can only see one folder is exactly what we're building
//! this app to escape. (md-reader reached the same conclusion; see its `commands/fs_ops.rs`.)
//!
//! **Listing is one level and lazy.** md-reader's `read_dir_tree` recurses to depth 8, which is
//! right for importing a project folder and fatal for `C:\` — this is a replacement, not a harvest.

use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Read a file as UTF-8 text. Used by the md/html viewers; the frontend normalizes newlines.
#[tauri::command(async)]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Read a file's bytes as base64 — for inlining a document's relative images as data URIs.
/// (The asset protocol is blocked by CSP for fetch, so images come through IPC like md-reader's.)
#[tauri::command(async)]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

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
#[tauri::command(async)]
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
#[tauri::command(async)]
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

/// Open a folder in Windows File Explorer.
///
/// A command of our own rather than the opener plugin's `openPath`: that one needs
/// `opener:allow-open-path` with a scope, and a scope wide enough for an explorer that roams the whole
/// disk is a webview-wide licence to launch *any* file with whatever program claims its extension —
/// the very thing `openTarget` refuses to do. This can only ever show a folder. (Files go through the
/// already-granted `revealItemInDir`, which selects them in their parent.)
///
/// `(async)` because it spawns a process (ADR 0003). Spawned, not waited on: `explorer.exe` hands the
/// window to the running shell and exits — with exit code 1 even on success, so there is nothing
/// useful to wait for.
#[tauri::command(async)]
pub fn open_folder_in_explorer(path: String) -> Result<(), String> {
    let dir = explorer_folder(&path)?;
    // Absolute path to the system copy, so a stray `explorer.exe` on PATH can't stand in for it.
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    std::process::Command::new(Path::new(&root).join("explorer.exe"))
        .arg(dir)
        .spawn()
        .map(drop)
        .map_err(|e| format!("explorer: {e}"))
}

/// The folder `open_folder_in_explorer` may open: an existing directory, nothing else. `explorer.exe`
/// given a file *runs* it (via its association), so a file must never reach it from here.
fn explorer_folder(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.is_dir() {
        Ok(p)
    } else {
        Err(format!("not a directory: {path}"))
    }
}

/// Where the explorer opens: the configured start path if set, else the Workspace folder, else the
/// user profile.
#[tauri::command(async)]
pub fn default_root() -> Option<String> {
    if let Some(configured) = crate::settings::start_root() {
        return Some(configured);
    }
    let home = std::env::var_os("USERPROFILE")?;
    let ws = Path::new(&home).join("Documents").join("Workspace");
    let pick = if ws.is_dir() { ws } else { Path::new(&home).to_path_buf() };
    Some(pick.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The guard is the whole safety story of `open_folder_in_explorer`: `explorer.exe <file>` opens the
    /// file with its associated program, so anything but a directory has to stop here.
    #[test]
    fn explorer_folder_admits_only_directories() {
        let dir = std::env::temp_dir().join("clowder-test-explorer-folder");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("run-me.cmd");
        fs::write(&file, "echo hi").unwrap();

        assert!(explorer_folder(dir.to_str().unwrap()).is_ok(), "a directory opens");
        assert!(explorer_folder("C:\\").is_ok(), "a drive root opens");
        assert!(explorer_folder(file.to_str().unwrap()).is_err(), "a file must never reach explorer.exe");
        assert!(explorer_folder(dir.join("missing").to_str().unwrap()).is_err(), "a missing path is refused");
        assert!(explorer_folder("").is_err(), "an empty path is refused");

        let _ = fs::remove_dir_all(&dir);
    }
}
