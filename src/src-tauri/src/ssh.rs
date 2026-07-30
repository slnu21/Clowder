//! SSH hosts from `~/.ssh/config` — a right-rail panel data source.
//!
//! Hand-parses the config (no crate) and returns the concrete `Host` entries. The panel's verb is
//! "connect", which spawns a terminal pane running `ssh <host>` — so this only needs to surface the
//! names. **Fail-soft**: a missing or unreadable config yields an empty list, never an error.
//!
//! Scope: `Host`/`HostName`/`User`/`Port`. Wildcard patterns (`*`, `?`, `!`) are skipped — they're
//! defaults for other hosts, not something to connect to. `Include` and `Match` are out of scope (noted
//! so the omission is deliberate, not forgotten).

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    pub host: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
}

/// Parsed `Host` entries from `~/.ssh/config`. Empty if the file is absent/unreadable (fail-soft).
#[tauri::command(async)]
pub fn ssh_hosts() -> Vec<SshHost> {
    match config_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(text) => parse_ssh_config(&text),
        None => Vec::new(),
    }
}

/// `%USERPROFILE%\.ssh\config` (fallback `$HOME`).
fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".ssh").join("config"))
}

/// Parse an ssh_config into concrete hosts. Keywords are case-insensitive; a value is separated from
/// its keyword by whitespace and/or `=`. A `Host` line opens a block (possibly several patterns); the
/// following `HostName`/`User`/`Port` fill every pattern in that block.
pub fn parse_ssh_config(text: &str) -> Vec<SshHost> {
    let mut hosts: Vec<SshHost> = Vec::new();
    let mut current: Vec<usize> = Vec::new(); // indices into `hosts` for the open block's patterns

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = split_kv(line);
        match key.to_ascii_lowercase().as_str() {
            "host" => {
                current.clear();
                for pat in value.split_whitespace() {
                    if pat.chars().any(|c| matches!(c, '*' | '?' | '!')) {
                        continue; // a pattern/default, not a concrete host
                    }
                    current.push(hosts.len());
                    hosts.push(SshHost {
                        host: pat.to_string(),
                        host_name: None,
                        user: None,
                        port: None,
                    });
                }
            }
            "hostname" if !value.is_empty() => {
                for &i in &current {
                    hosts[i].host_name = Some(value.to_string());
                }
            }
            "user" if !value.is_empty() => {
                for &i in &current {
                    hosts[i].user = Some(value.to_string());
                }
            }
            "port" => {
                if let Ok(p) = value.parse::<u16>() {
                    for &i in &current {
                        hosts[i].port = Some(p);
                    }
                }
            }
            _ => {}
        }
    }
    hosts
}

/// Split a config line into (keyword, value). The delimiter is the first whitespace or `=`; any run of
/// whitespace/`=` between them is consumed (so `Port=22`, `Port 22` and `Port = 22` all parse alike).
fn split_kv(line: &str) -> (&str, &str) {
    match line.find(|c: char| c.is_whitespace() || c == '=') {
        Some(i) => {
            let value = line[i..].trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();
            (&line[..i], value)
        }
        None => (line, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_ssh_config, SshHost};

    #[test]
    fn parses_basic_block() {
        let hosts = parse_ssh_config(
            "Host prod\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n",
        );
        assert_eq!(
            hosts,
            vec![SshHost {
                host: "prod".into(),
                host_name: Some("10.0.0.5".into()),
                user: Some("deploy".into()),
                port: Some(2222),
            }]
        );
    }

    #[test]
    fn one_block_multiple_patterns_fills_all() {
        let hosts = parse_ssh_config("Host a b\n  User root\n");
        assert_eq!(hosts.len(), 2);
        assert!(hosts.iter().all(|h| h.user.as_deref() == Some("root")));
        assert_eq!(hosts[0].host, "a");
        assert_eq!(hosts[1].host, "b");
    }

    #[test]
    fn skips_wildcards_comments_and_blanks() {
        let hosts = parse_ssh_config(
            "# global defaults\nHost *\n  User nobody\n\nHost web?\n\nHost real\n  HostName ex.com\n",
        );
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "real");
        assert_eq!(hosts[0].host_name.as_deref(), Some("ex.com"));
        assert_eq!(hosts[0].user, None); // the `Host *` block must not leak into `real`
    }

    #[test]
    fn keywords_are_case_insensitive_and_eq_form() {
        let hosts = parse_ssh_config("HOST box\nhostname=example.org\nPORT = 22\n");
        assert_eq!(hosts[0].host_name.as_deref(), Some("example.org"));
        assert_eq!(hosts[0].port, Some(22));
    }

    #[test]
    fn empty_and_junk_are_harmless() {
        assert!(parse_ssh_config("").is_empty());
        assert!(parse_ssh_config("\n\n#only a comment\n").is_empty());
        // a bad port is ignored, the host still stands
        let hosts = parse_ssh_config("Host x\n  Port notanumber\n");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].port, None);
    }
}
