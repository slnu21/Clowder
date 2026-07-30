//! Kubernetes context switching + pod exec — a right-rail panel data source.
//!
//! Shells out to `kubectl` (no crate). **Fail-soft**: kubectl absent, no kubeconfig, or an unreachable
//! cluster → empty results, never an error. Context listing reads the kubeconfig (cheap); pod listing
//! hits the cluster and is bounded by `--request-timeout` so an unreachable cluster can't hang the panel.
//! `CREATE_NO_WINDOW` on every spawn (a GUI process spawning a console child pops a window otherwise).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeContexts {
    pub contexts: Vec<String>,
    pub current: Option<String>,
}

/// The kubeconfig's contexts and which one is current. Empty if kubectl/config is absent.
#[tauri::command(async)]
pub fn kubectl_contexts() -> KubeContexts {
    let contexts = run_kubectl(&["config", "get-contexts", "-o", "name"])
        .map(|o| o.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default();
    let current = run_kubectl(&["config", "current-context"])
        .map(|o| o.trim().to_string())
        .filter(|s| !s.is_empty());
    KubeContexts { contexts, current }
}

/// Switch the current context. Returns kubectl's stderr on failure (shown inline).
#[tauri::command(async)]
pub fn kubectl_use_context(name: String) -> Result<(), String> {
    run_kubectl_checked(&["config", "use-context", &name])
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KubePod {
    pub name: String,
    pub ready: String,
    pub status: String,
}

/// Pods in the current context/namespace. Bounded (`--request-timeout`) and fail-soft (empty on any
/// failure, including an unreachable cluster).
#[tauri::command(async)]
pub fn kubectl_pods() -> Vec<KubePod> {
    match run_kubectl(&["get", "pods", "--no-headers", "--request-timeout=5s"]) {
        Some(out) => parse_pods(&out),
        None => Vec::new(),
    }
}

/// Parse `kubectl get pods --no-headers` (columns: NAME READY STATUS RESTARTS AGE). We keep the first
/// three; whitespace-split is stable for these fixed leading columns.
pub fn parse_pods(text: &str) -> Vec<KubePod> {
    text.lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let name = cols.next()?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(KubePod {
                name,
                ready: cols.next().unwrap_or("").to_string(),
                status: cols.next().unwrap_or("").to_string(),
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeNamespaces {
    pub namespaces: Vec<String>,
    pub current: Option<String>,
}

/// Cluster namespaces + the current context's namespace. Bounded (cluster query) + fail-soft.
#[tauri::command(async)]
pub fn kubectl_namespaces() -> KubeNamespaces {
    let namespaces = run_kubectl(&["get", "namespaces", "-o", "name", "--request-timeout=5s"])
        .map(|o| parse_ns_names(&o))
        .unwrap_or_default();
    let current = run_kubectl(&["config", "view", "--minify", "-o", "jsonpath={..namespace}"])
        .map(|o| o.trim().to_string())
        .filter(|s| !s.is_empty());
    KubeNamespaces { namespaces, current }
}

/// Set the current context's namespace. Returns kubectl's stderr on failure.
#[tauri::command(async)]
pub fn kubectl_use_namespace(name: String) -> Result<(), String> {
    run_kubectl_checked(&["config", "set-context", "--current", &format!("--namespace={name}")])
}

/// `kubectl get namespaces -o name` prints `namespace/<n>` per line — strip the prefix.
pub fn parse_ns_names(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().trim_start_matches("namespace/").to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn run_kubectl(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("kubectl")
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_kubectl_checked(args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("kubectl")
        .args(args)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_pods, KubePod};

    #[test]
    fn parses_pod_rows() {
        let out = "web-1 1/1 Running 0 2d\napi-abc 0/1 CrashLoopBackOff 5 1h\n";
        assert_eq!(
            parse_pods(out),
            vec![
                KubePod { name: "web-1".into(), ready: "1/1".into(), status: "Running".into() },
                KubePod { name: "api-abc".into(), ready: "0/1".into(), status: "CrashLoopBackOff".into() },
            ]
        );
    }

    #[test]
    fn empty_and_blank_lines_are_skipped() {
        assert!(parse_pods("").is_empty());
        assert!(parse_pods("\n  \n").is_empty());
    }

    #[test]
    fn parses_namespace_names_stripping_prefix() {
        use super::parse_ns_names;
        assert_eq!(
            parse_ns_names("namespace/default\nnamespace/kube-system\n"),
            vec!["default".to_string(), "kube-system".to_string()]
        );
        assert!(parse_ns_names("").is_empty());
    }
}
