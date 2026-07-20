//! Resolving a piece of terminal text into something openable.
//!
//! The frontend's link provider finds *candidates* — anything shaped like a path — and asks here
//! whether each one is real before it draws an underline. That order matters: a terminal is full of
//! text that merely looks like a path (`src/foo`, `and/or`, a fragment of prose), and underlining
//! things that don't exist teaches people not to trust the underline. Existence is the filter.
//!
//! Parsing is separated from the filesystem check so the shapes can be table-tested.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub path: String,
    pub is_dir: bool,
    /// From a `file:12` or `file:12:5` suffix. Nothing consumes it yet — the md viewer has no
    /// line addressing — but dropping it at the parse step would mean re-deriving it later.
    pub line: Option<u32>,
}

/// Split a `path:line:col` suffix off a candidate. Windows drive letters keep their colon:
/// only a colon followed by digits **to the end** is a position.
fn split_position(raw: &str) -> (&str, Option<u32>) {
    let mut rest = raw;
    let mut line = None;
    // Peel at most twice, right to left: `:col` then `:line`.
    for _ in 0..2 {
        let Some(idx) = rest.rfind(':') else { break };
        let (head, tail) = rest.split_at(idx);
        let digits = &tail[1..];
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            break;
        }
        // A bare `C:` is a drive, not a position — and neither is `12` on its own.
        if head.is_empty() || head.len() == 1 {
            break;
        }
        line = digits.parse().ok();
        rest = head;
    }
    (rest, line)
}

/// Trim the punctuation a terminal wraps paths in.
///
/// Parentheses need counting, not stripping: `C:\Program Files (x86)\node.exe` and `C:\a (1).md` are
/// paths whose parens belong to them, while `(src/app.tsx)` is a path prose put in brackets. A
/// balanced pair around the whole candidate is wrapping; a closing paren with no opener to match is
/// leftover punctuation; anything else is part of the name.
fn trim_delimiters(s: &str) -> &str {
    let mut s = s.trim_matches(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | '`'));
    s = s.trim_end_matches(|c: char| matches!(c, ',' | ';' | '.' | '!' | '?'));
    if s.starts_with('(') && s.ends_with(')') && s.len() >= 2 {
        return &s[1..s.len() - 1];
    }
    if s.ends_with(')') && s.matches(')').count() > s.matches('(').count() {
        return &s[..s.len() - 1];
    }
    s
}

/// `/c/Users/me` and `/cygdrive/c/Users/me` are how Git Bash prints Windows paths. Neither is a real
/// path to anything else on this machine, so translating them is unambiguous.
fn from_msys(s: &str) -> Option<PathBuf> {
    let rest = s.strip_prefix("/cygdrive/").or_else(|| s.strip_prefix('/'))?;
    let mut chars = rest.chars();
    let drive = chars.next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    match chars.next() {
        None => Some(PathBuf::from(format!("{}:\\", drive.to_ascii_uppercase()))),
        Some('/') => {
            let tail = rest[2..].replace('/', "\\");
            Some(PathBuf::from(format!("{}:\\{tail}", drive.to_ascii_uppercase())))
        }
        _ => None,
    }
}

/// Turn a candidate into an absolute path, without touching the filesystem.
///
/// `base` is the pane's working directory. Relative candidates are only meaningful against it, and a
/// pane that never got a cwd simply has no relative links — better than resolving against whatever
/// the app's process directory happens to be.
pub fn resolve(base: Option<&str>, raw: &str) -> Option<(PathBuf, Option<u32>)> {
    let trimmed = trim_delimiters(raw);
    if trimmed.is_empty() {
        return None;
    }
    let (body, line) = split_position(trimmed);
    let body = trim_delimiters(body);
    if body.is_empty() {
        return None;
    }

    if let Some(p) = from_msys(body) {
        return Some((p, line));
    }
    let p = Path::new(body);
    if p.is_absolute() {
        return Some((p.to_path_buf(), line));
    }
    let base = base.filter(|b| !b.is_empty())?;
    Some((Path::new(base).join(body), line))
}

/// Resolve, then confirm it exists. `None` means "don't make this a link".
#[tauri::command]
pub fn resolve_link_target(base: Option<String>, raw: String) -> Option<LinkTarget> {
    let (path, line) = resolve(base.as_deref(), &raw)?;
    let meta = std::fs::metadata(&path).ok()?;
    Some(LinkTarget {
        path: path.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
        line,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_split_but_drive_letters_survive() {
        let cases: &[(&str, &str, Option<u32>)] = &[
            ("src/app.tsx:12:5", "src/app.tsx", Some(12)),
            ("src/app.tsx:12", "src/app.tsx", Some(12)),
            ("src/app.tsx", "src/app.tsx", None),
            ("C:\\src\\app.tsx:12", "C:\\src\\app.tsx", Some(12)),
            ("C:\\src\\app.tsx", "C:\\src\\app.tsx", None),
            // A lone drive letter must not be read as `C` at line 3.
            ("C:3", "C:3", None),
            ("notes.md:", "notes.md:", None),
        ];
        for (input, path, line) in cases {
            assert_eq!(split_position(input), (*path, *line), "input {input}");
        }
    }

    #[test]
    fn delimiters_come_off_without_eating_the_path() {
        assert_eq!(trim_delimiters("'C:\\a b\\c.md'"), "C:\\a b\\c.md");
        assert_eq!(trim_delimiters("see src/app.tsx,"), "see src/app.tsx");
        assert_eq!(trim_delimiters("(src/app.tsx)"), "src/app.tsx");
        assert_eq!(trim_delimiters("src/app.tsx)"), "src/app.tsx");
        // Parens that belong to the name stay put.
        assert_eq!(trim_delimiters("C:\\a (1).md"), "C:\\a (1).md");
        assert_eq!(trim_delimiters("C:\\Program Files (x86)\\node.exe"), "C:\\Program Files (x86)\\node.exe");
    }

    #[test]
    fn msys_paths_become_windows_paths() {
        assert_eq!(from_msys("/c/Users/me"), Some(PathBuf::from("C:\\Users\\me")));
        assert_eq!(from_msys("/cygdrive/d/tmp"), Some(PathBuf::from("D:\\tmp")));
        assert_eq!(from_msys("/c"), Some(PathBuf::from("C:\\")));
        // Not a drive — a real POSIX-looking path we should leave alone.
        assert_eq!(from_msys("/usr/bin"), None);
        assert_eq!(from_msys("relative/path"), None);
    }

    #[test]
    fn relative_needs_a_base_and_absolute_does_not() {
        assert_eq!(
            resolve(Some("C:\\work"), "docs/notes.md:3"),
            Some((PathBuf::from("C:\\work\\docs/notes.md"), Some(3)))
        );
        assert_eq!(resolve(None, "docs/notes.md"), None);
        assert_eq!(resolve(None, "C:\\work\\notes.md"), Some((PathBuf::from("C:\\work\\notes.md"), None)));
        assert_eq!(resolve(Some(""), "docs/notes.md"), None);
    }
}
