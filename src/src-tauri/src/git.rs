//! Git status of a folder — a right-rail panel data source.
//!
//! Shells out to `git` (no `git2`/`gix` crate: zero added dependency/license surface, and `git` is
//! already the tool this app is built around). **Fail-soft**: git missing or the folder not a repo →
//! `is_repo: false`, never an error. `CREATE_NO_WINDOW` on every spawn — a windowless GUI process that
//! spawns a console child pops a console window otherwise (see devlog 2026-07-21-05).

use serde::Serialize;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub root: Option<String>,
    /// Current branch, or `(detached)` when on a detached HEAD.
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub conflicts: u32,
}

/// Git status of `cwd`. `is_repo: false` when `cwd` isn't a work tree (or git is absent). Fail-soft.
#[tauri::command]
pub fn git_status(cwd: String) -> GitStatus {
    let root = match run_git(&cwd, &["rev-parse", "--show-toplevel"]) {
        Some(out) if !out.trim().is_empty() => out.trim().to_string(),
        _ => return GitStatus::default(), // not a repo, or git not found
    };
    let porcelain = run_git(&cwd, &["status", "--porcelain=v2", "--branch"]).unwrap_or_default();
    let mut st = parse_porcelain(&porcelain);
    st.is_repo = true;
    st.root = Some(root);
    st
}

/// Run `git -C <cwd> <args>` and return stdout, or `None` on spawn failure / non-zero exit.
fn run_git(cwd: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — no console flash (2026-07-21-05)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Lossy is fine here: we parse the porcelain header and status codes, not paths, and never feed
    // this back into a PTY (where byte-exactness matters).
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Parse `git status --porcelain=v2 --branch`: branch head, ahead/behind, and staged/unstaged/
/// untracked/conflict counts. Pure — the FFI-free part that `cargo test` covers.
pub fn parse_porcelain(text: &str) -> GitStatus {
    let mut st = GitStatus::default();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            st.branch = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for tok in rest.split_whitespace() {
                if let Some(a) = tok.strip_prefix('+') {
                    st.ahead = a.parse().unwrap_or(0);
                } else if let Some(b) = tok.strip_prefix('-') {
                    st.behind = b.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ").or_else(|| line.strip_prefix("2 ")) {
            // ordinary/renamed change: first token is the two-char <XY> staged/unstaged field.
            if let Some(xy) = rest.split_whitespace().next() {
                let mut c = xy.chars();
                if c.next().is_some_and(|x| x != '.') {
                    st.staged += 1;
                }
                if c.next().is_some_and(|y| y != '.') {
                    st.unstaged += 1;
                }
            }
        } else if line.starts_with("u ") {
            st.conflicts += 1;
        } else if line.starts_with("? ") {
            st.untracked += 1;
        }
    }
    st
}

#[cfg(test)]
mod tests {
    use super::parse_porcelain;

    const SAMPLE: &str = "\
# branch.oid abc123
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 M. N... 100644 100644 100644 aaa bbb staged.txt
1 .M N... 100644 100644 100644 ccc ddd modified.txt
1 MM N... 100644 100644 100644 eee fff both.txt
u UU N... 100644 100644 100644 100644 ggg hhh iii conflict.txt
? untracked.txt
";

    #[test]
    fn parses_branch_ahead_behind_and_counts() {
        let st = parse_porcelain(SAMPLE);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.ahead, 2);
        assert_eq!(st.behind, 1);
        assert_eq!(st.staged, 2); // M. and MM
        assert_eq!(st.unstaged, 2); // .M and MM
        assert_eq!(st.conflicts, 1);
        assert_eq!(st.untracked, 1);
    }

    #[test]
    fn clean_repo_is_all_zero() {
        let st = parse_porcelain("# branch.head main\n# branch.ab +0 -0\n");
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind, st.staged, st.unstaged, st.untracked), (0, 0, 0, 0, 0));
    }

    #[test]
    fn detached_head_and_empty_are_handled() {
        assert_eq!(parse_porcelain("# branch.head (detached)\n").branch.as_deref(), Some("(detached)"));
        let empty = parse_porcelain("");
        assert_eq!(empty.branch, None);
        assert_eq!(empty.staged, 0);
    }
}
