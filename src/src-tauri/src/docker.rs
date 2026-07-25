//! Docker containers — a right-rail panel data source.
//!
//! Shells out to `docker` (no crate). **Fail-soft**: docker absent or the daemon down → empty / not
//! available, never an error. `CREATE_NO_WINDOW` on every spawn (a GUI process spawning a console child
//! pops a window otherwise). Verbs: start/stop (state), and exec-shell / logs (spawn a terminal pane).

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub running: bool,
}

/// Is docker usable (installed + daemon responding)? Distinguishes "no docker" from "zero containers",
/// so the panel can show an empty list rather than vanishing.
#[tauri::command]
pub fn docker_ok() -> bool {
    run_docker(&["ps", "-q"]).is_some()
}

/// All containers (running and stopped). Empty on any failure.
#[tauri::command]
pub fn docker_containers() -> Vec<DockerContainer> {
    match run_docker(&["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"]) {
        Some(out) => parse_containers(&out),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn docker_start(id: String) -> Result<(), String> {
    run_docker_checked(&["start", &id])
}

#[tauri::command]
pub fn docker_stop(id: String) -> Result<(), String> {
    run_docker_checked(&["stop", &id])
}

/// Parse tab-separated `docker ps` rows (ID, Names, Image, Status). `running` is derived from the
/// status text — docker prints "Up 3 hours" for a live container, "Exited (0) …" for a stopped one.
pub fn parse_containers(text: &str) -> Vec<DockerContainer> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split('\t');
            let id = f.next()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let name = f.next().unwrap_or("").trim().to_string();
            let image = f.next().unwrap_or("").trim().to_string();
            let status = f.next().unwrap_or("").trim().to_string();
            let running = status.starts_with("Up");
            Some(DockerContainer { id, name, image, status, running })
        })
        .collect()
}

fn run_docker(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("docker")
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_docker_checked(args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;
    let out = std::process::Command::new("docker")
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
    use super::{parse_containers, DockerContainer};

    #[test]
    fn parses_running_and_stopped() {
        let out = "abc123\tweb\tnginx:latest\tUp 3 hours\ndef456\tdb\tpostgres:16\tExited (0) 2 minutes ago\n";
        assert_eq!(
            parse_containers(out),
            vec![
                DockerContainer {
                    id: "abc123".into(),
                    name: "web".into(),
                    image: "nginx:latest".into(),
                    status: "Up 3 hours".into(),
                    running: true,
                },
                DockerContainer {
                    id: "def456".into(),
                    name: "db".into(),
                    image: "postgres:16".into(),
                    status: "Exited (0) 2 minutes ago".into(),
                    running: false,
                },
            ]
        );
    }

    #[test]
    fn empty_is_empty() {
        assert!(parse_containers("").is_empty());
        assert!(parse_containers("\n").is_empty());
    }
}
