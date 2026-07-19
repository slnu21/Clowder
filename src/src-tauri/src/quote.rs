//! Quote a filesystem path so it survives being typed into a running shell.
//!
//! Drag & drop drops a *path*, which is data, not a command — a file literally named `$(rm -rf ~)`
//! or `'; git push --force #` must reach the shell as one inert argument, never as syntax. Double
//! quotes are wrong here: both shells still expand `$` and backtick inside them. Single quotes are
//! the only fully literal form, so we wrap in single quotes and escape any embedded single quote.
//!
//! This is deliberately a Rust pure function with a table test rather than a few lines of TypeScript:
//! it's the one place a filename turns into shell input, the failure mode is command injection, and
//! `cargo test` is a real gate (no invented tooling).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellKind {
    /// POSIX single-quoting: close, escaped quote, reopen — `'` → `'\''`.
    Bash,
    /// PowerShell single-quoting: a literal `'` is doubled — `'` → `''`.
    Power,
}

pub fn quote_path(path: &str, shell: ShellKind) -> String {
    match shell {
        ShellKind::Bash => format!("'{}'", path.replace('\'', "'\\''")),
        ShellKind::Power => format!("'{}'", path.replace('\'', "''")),
    }
}

/// Tauri command backing the frontend's drop handler.
#[tauri::command]
pub fn quote_path_cmd(path: String, shell: String) -> String {
    let kind = if shell.eq_ignore_ascii_case("power") || shell.eq_ignore_ascii_case("powershell") {
        ShellKind::Power
    } else {
        ShellKind::Bash
    };
    quote_path(&path, kind)
}

#[cfg(test)]
mod tests {
    use super::{quote_path, ShellKind::*};

    #[test]
    fn table() {
        // (input, bash, powershell)
        let cases = [
            (r"C:\Users\me\a.txt", r"'C:\Users\me\a.txt'", r"'C:\Users\me\a.txt'"),
            ("plain", "'plain'", "'plain'"),
            ("with space", "'with space'", "'with space'"),
            // The whole point: metacharacters stay literal inside single quotes.
            ("$(rm -rf ~)", "'$(rm -rf ~)'", "'$(rm -rf ~)'"),
            ("`backtick`", "'`backtick`'", "'`backtick`'"),
            ("a && b", "'a && b'", "'a && b'"),
            ("한글 폴더", "'한글 폴더'", "'한글 폴더'"),
            // An embedded single quote is the only thing that needs escaping — and the two shells
            // escape it differently, which is the reason this isn't shell-agnostic.
            ("o'brien", r"'o'\''brien'", "'o''brien'"),
            ("'; evil #", r"''\''; evil #'", "'''; evil #'"),
        ];
        for (input, bash, power) in cases {
            assert_eq!(quote_path(input, Bash), bash, "bash: {input}");
            assert_eq!(quote_path(input, Power), power, "power: {input}");
        }
    }
}
