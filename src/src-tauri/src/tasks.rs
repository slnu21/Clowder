//! Runnable tasks in a folder — a right-rail panel data source.
//!
//! Reads the folder's manifests (package.json scripts, Makefile targets, justfile recipes) and returns
//! one-click tasks whose command spawns in a terminal pane. Bound to the active pane's cwd (which now
//! tracks `cd` via OSC 7). Pure parsers — no tool is run to list; the run happens in the pane. **Fail-
//! soft**: a missing/malformed manifest is simply skipped.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub name: String,
    /// The shell command the pane runs (e.g. `npm run build`).
    pub command: String,
    /// Which manifest it came from: `npm` | `make` | `just`.
    pub source: String,
}

/// Tasks found in `cwd`'s manifests, in file order (npm, then make, then just).
#[tauri::command]
pub fn list_tasks(cwd: String) -> Vec<Task> {
    let dir = Path::new(&cwd);
    let mut tasks = Vec::new();
    if let Ok(s) = std::fs::read_to_string(dir.join("package.json")) {
        tasks.extend(parse_package_scripts(&s));
    }
    for mk in ["Makefile", "makefile", "GNUmakefile"] {
        if let Ok(s) = std::fs::read_to_string(dir.join(mk)) {
            tasks.extend(parse_makefile_targets(&s));
            break;
        }
    }
    for jf in ["justfile", ".justfile", "Justfile"] {
        if let Ok(s) = std::fs::read_to_string(dir.join(jf)) {
            tasks.extend(parse_justfile_recipes(&s));
            break;
        }
    }
    tasks
}

/// `scripts` keys from a package.json → `npm run <name>`. Order is preserved (serde_json's
/// `preserve_order` feature is on). Malformed JSON → no tasks.
pub fn parse_package_scripts(json: &str) -> Vec<Task> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    v.get("scripts")
        .and_then(|s| s.as_object())
        .map(|obj| {
            obj.keys()
                .map(|k| Task {
                    name: k.clone(),
                    command: format!("npm run {k}"),
                    source: "npm".into(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Column-0 `target:` lines → `make <target>`. Skips indented recipe bodies, comments, `.PHONY`-style
/// dot targets, and `NAME := value` variable assignments.
pub fn parse_makefile_targets(text: &str) -> Vec<Task> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.starts_with(|c: char| c == ' ' || c == '\t' || c == '#' || c == '.') {
            continue;
        }
        let Some(colon) = line.find(':') else { continue };
        if line[colon..].starts_with(":=") {
            continue; // variable assignment, not a target
        }
        let name = line[..colon].trim();
        if !name.is_empty() && name.chars().all(is_task_name_char) {
            out.push(Task { name: name.into(), command: format!("make {name}"), source: "make".into() });
        }
    }
    out
}

/// Column-0 `recipe:` lines (optionally with params) → `just <recipe>`. Skips indented bodies,
/// comments, and `name := value` assignments.
pub fn parse_justfile_recipes(text: &str) -> Vec<Task> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.starts_with(|c: char| c == ' ' || c == '\t' || c == '#') {
            continue;
        }
        let Some(colon) = line.find(':') else { continue };
        if line[colon..].starts_with(":=") {
            continue; // assignment
        }
        // the recipe name is the first token before the ':' (params follow it, before the colon)
        let name = line[..colon].split_whitespace().next().unwrap_or("").trim();
        if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
            out.push(Task { name: name.into(), command: format!("just {name}"), source: "just".into() });
        }
    }
    out
}

fn is_task_name_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '.'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_package_scripts_in_order() {
        let json = r#"{"name":"x","scripts":{"dev":"vite","build":"tsc && vite build","test":"vitest run"}}"#;
        let t = parse_package_scripts(json);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["dev", "build", "test"]);
        assert_eq!(t[1].command, "npm run build");
        assert_eq!(t[0].source, "npm");
    }

    #[test]
    fn no_scripts_or_bad_json_is_empty() {
        assert!(parse_package_scripts(r#"{"name":"x"}"#).is_empty());
        assert!(parse_package_scripts("not json").is_empty());
    }

    #[test]
    fn parses_makefile_targets_only() {
        let mk = "# comment\nCC := gcc\nbuild: deps\n\tcargo build\ntest:\n\tcargo test\n.PHONY: build test\n";
        let t = parse_makefile_targets(mk);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["build", "test"]);
        assert_eq!(t[0].command, "make build");
    }

    #[test]
    fn parses_justfile_recipes() {
        let jf = "set shell := [\"bash\"]\nbuild:\n    cargo build\nrun host port:\n    echo {{host}}\n";
        let t = parse_justfile_recipes(jf);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["build", "run"]);
        assert_eq!(t[1].command, "just run");
    }
}
