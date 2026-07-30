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
    /// `git` itself isn't installed / on PATH — distinct from `is_repo: false` (a real folder that
    /// just isn't a repo). Lets the panel say "git 미설치" instead of "저장소 아님".
    pub git_missing: bool,
}

/// Git status of `cwd`. `is_repo: false` when `cwd` isn't a work tree (or git is absent). Fail-soft.
#[tauri::command(async)]
pub fn git_status(cwd: String) -> GitStatus {
    let root = match try_git(&cwd, &["rev-parse", "--show-toplevel"]) {
        GitRun::NotFound => return GitStatus { git_missing: true, ..Default::default() },
        GitRun::Failed => return GitStatus::default(), // git ran, but this isn't a work tree
        GitRun::Ok(out) if out.trim().is_empty() => return GitStatus::default(),
        GitRun::Ok(out) => out.trim().to_string(),
    };
    let porcelain = match try_git(&cwd, &["status", "--porcelain=v2", "--branch"]) {
        GitRun::Ok(o) => o,
        _ => String::new(),
    };
    let mut st = parse_porcelain(&porcelain);
    st.is_repo = true;
    st.root = Some(root);
    st
}

/// Outcome of a `git` invocation: the exe wasn't found, it ran but failed (e.g. not a repo), or it
/// succeeded with stdout. Distinguishing the first two is what lets the panel say "git 미설치".
enum GitRun {
    NotFound,
    Failed,
    Ok(String),
}

/// Run `git -C <cwd> <args>`. `NotFound` when git can't even be spawned (not installed / not on PATH).
fn try_git(cwd: &str, args: &[&str]) -> GitRun {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — no console flash (2026-07-21-05)
        .output();
    match out {
        Err(_) => GitRun::NotFound, // spawn failed → git isn't there
        // Lossy is fine: we parse the porcelain header/status codes, not paths, and never feed this
        // back into a PTY (where byte-exactness matters).
        Ok(o) if o.status.success() => GitRun::Ok(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(_) => GitRun::Failed,
    }
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
