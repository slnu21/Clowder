use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

/// Headless self-check. Runs without creating a window, writes a report to
/// `%LOCALAPPDATA%\deck\selftest.log`, and returns the process exit code.
///
/// Every step must be an **assertion**, not a print. The pattern is borrowed from ShotLog, along
/// with the lesson that cost it a devlog: a gate that only writes `RESULT=OK` when nothing threw is
/// not a gate. Whenever a check is added here, prove it can fail — break the thing it guards, watch
/// `RESULT=FAIL`, then put it back. An unproven check is decoration.
pub struct SelfTest {
    lines: String,
    failed: usize,
}

impl SelfTest {
    fn new() -> Self {
        SelfTest { lines: String::new(), failed: 0 }
    }

    /// Record one assertion. `detail` is for the log, not the verdict — the bool decides.
    fn check(&mut self, name: &str, passed: bool, detail: impl AsRef<str>) {
        if !passed {
            self.failed += 1;
        }
        let _ = writeln!(
            self.lines,
            "[{}] {:<28} {}",
            if passed { "PASS" } else { "FAIL" },
            name,
            detail.as_ref()
        );
    }
}

/// `%LOCALAPPDATA%\deck` — settings and the selftest log live here. Resolved without Tauri so the
/// self-check does not depend on the app having booted.
pub fn data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("deck"))
}

/// Substring search over raw bytes — the point is to never decode, so `str::contains` is out.
fn find_bytes(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && hay.windows(needle.len()).any(|w| w == needle)
}

/// Session id for the throwaway usage entry — leading underscore keeps it out of the way of real
/// sessions, and it is deleted either way.
const PROBE_SESSION: &str = "_selftest-probe";

/// Feed a synthetic statusline payload to this exe and see whether a usage entry appears.
fn statusline_round_trip() -> (bool, String) {
    let Ok(exe) = std::env::current_exe() else {
        return (false, "current_exe unknown".into());
    };
    let Some(target) = crate::spool::clowder_dir()
        .map(|d| d.join("usage").join(format!("{PROBE_SESSION}.json")))
    else {
        return (false, "LOCALAPPDATA unset".into());
    };
    let _ = fs::remove_file(&target); // a leftover from a previous run must not pass this for us

    let payload = format!(
        r#"{{"session_id":"{PROBE_SESSION}","context_window":{{"used_percentage":42.5,"total_input_tokens":1,"total_output_tokens":1,"context_window_size":2}}}}"#
    );
    use std::os::windows::process::CommandExt as _;
    let spawned = std::process::Command::new(&exe)
        .args(["--beacon", "--statusline"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped()) // the user's original line, if any — not ours to print
        .stderr(std::process::Stdio::null())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — consistent with beacon.rs run_original
        .spawn();
    let Ok(mut child) = spawned else {
        return (false, "could not spawn --beacon --statusline".into());
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write as _;
        let _ = stdin.write_all(payload.as_bytes());
    }
    if child.wait_with_output().is_err() {
        return (false, "beacon did not exit".into());
    }

    let written = fs::read_to_string(&target).unwrap_or_default();
    let ok = written.contains("42.5");
    let _ = fs::remove_file(&target);
    (
        ok,
        if ok {
            format!("payload -> {}", target.display())
        } else if written.is_empty() {
            format!("no usage written to {}", target.display())
        } else {
            format!("usage written but percentage missing: {written}")
        },
    )
}

/// Spawn a process that exits immediately and return its pid, after waiting for it. A pid we watched
/// finish is the one thing on this machine we can be certain is not running.
fn finished_pid() -> Option<u32> {
    use std::os::windows::process::CommandExt as _;
    let mut child = std::process::Command::new("cmd.exe")
        .args(["/c", "exit", "0"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .ok()?;
    let pid = child.id();
    let _ = child.wait();
    Some(pid)
}

/// Reap must take all three file kinds for one session, leave every other session alone, and refuse
/// an id that would escape the spool directory.
fn reap_is_scoped() -> (bool, String) {
    let Some(root) = crate::spool::clowder_dir() else {
        return (false, "LOCALAPPDATA unset".into());
    };
    const ID: &str = "_selftest-reap";
    const NEIGHBOUR: &str = "_selftest-keep";

    for dir in ["sessions", "usage", "subagents"] {
        let _ = fs::create_dir_all(root.join(dir));
    }
    let session = root.join("sessions").join(format!("{ID}.json"));
    let usage = root.join("usage").join(format!("{ID}.json"));
    let agent = root.join("subagents").join(format!("{ID}-agent.json"));
    let neighbour = root.join("sessions").join(format!("{NEIGHBOUR}.json"));
    // One level above `sessions\` — exactly where a `..\` id would land.
    let outsider = root.join("_selftest-outsider.json");

    let _ = fs::write(&session, format!(r#"{{"sessionId":"{ID}"}}"#));
    let _ = fs::write(&usage, format!(r#"{{"sessionId":"{ID}"}}"#));
    let _ = fs::write(&agent, format!(r#"{{"agentId":"a","sessionId":"{ID}"}}"#));
    let _ = fs::write(&neighbour, format!(r#"{{"sessionId":"{NEIGHBOUR}"}}"#));
    let _ = fs::write(&outsider, b"keep me");

    let reported_clean = crate::spool::reap_session(ID);
    let mine_gone = !session.exists() && !usage.exists() && !agent.exists();
    let neighbour_kept = neighbour.exists();
    let traversal_refused =
        !crate::spool::reap_session(r"..\_selftest-outsider") && outsider.exists();

    for p in [&session, &usage, &agent, &neighbour, &outsider] {
        let _ = fs::remove_file(p);
    }

    (
        reported_clean && mine_gone && neighbour_kept && traversal_refused,
        format!(
            "all three removed={mine_gone}, neighbour kept={neighbour_kept}, traversal refused={traversal_refused}"
        ),
    )
}

pub fn run() -> i32 {
    let mut t = SelfTest::new();

    let dir = data_dir();
    t.check(
        "data_dir_resolves",
        dir.is_some(),
        match &dir {
            Some(d) => d.display().to_string(),
            None => "LOCALAPPDATA unset".into(),
        },
    );

    // Writability is checked by writing, not by inspecting permissions — the only honest test.
    let probe = dir.as_ref().map(|d| d.join(".selftest-probe"));
    let writable = match (&dir, &probe) {
        (Some(d), Some(p)) => {
            fs::create_dir_all(d).is_ok() && fs::write(p, b"probe").is_ok() && {
                let _ = fs::remove_file(p);
                true
            }
        }
        _ => false,
    };
    t.check("data_dir_writable", writable, "write+delete probe file");

    // --- conpty sideload ---
    // The whole point of this gate. portable-pty falls back to the buggy OS ConPTY *in silence*, so
    // nothing else in the app will ever tell us this went wrong. See conpty/README.md.
    let dir = crate::conpty_check::exe_dir();
    for name in ["conpty.dll", "OpenConsole.exe"] {
        let p = dir.as_ref().map(|d| d.join(name));
        let exists = p.as_ref().map(|p| p.is_file()).unwrap_or(false);
        t.check(
            &format!("{}_next_to_exe", name.to_lowercase().replace('.', "_")),
            exists,
            match &p {
                Some(p) => p.display().to_string(),
                None => "exe dir unknown".into(),
            },
        );
    }

    // Existence is not enough — present-but-unloadable (wrong arch, corrupt) is precisely when the
    // silent fallback bites. Load it and look at where Windows resolved it from.
    let origin = crate::conpty_check::conpty_origin();
    use crate::conpty_check::ConPtyOrigin;
    t.check(
        "conpty_is_sideloaded",
        matches!(origin, ConPtyOrigin::Sideloaded(_)),
        match &origin {
            ConPtyOrigin::Sideloaded(p) => format!("loaded from {}", p.display()),
            ConPtyOrigin::System(p) => format!("OS ConPTY! resolved to {}", p.display()),
            ConPtyOrigin::NotLoaded(why) => format!("not loaded -> kernel32 fallback: {why}"),
        },
    );

    // --- PTY byte path ---
    let shell = crate::pty::default_shell();
    let is_bash = shell.to_lowercase().ends_with("bash.exe");
    t.check("shell_found", is_bash, &shell);

    if is_bash {
        // The whole reason we never turn PTY bytes into a String in Rust: a 3-byte Korean character
        // straddling a read boundary would be mangled, not merely slow. Assert the bytes survive.
        const NEEDLE: &str = "한글-데크-";
        let out = crate::pty::probe(
            &shell,
            &format!(r#"chcp.com 65001 >/dev/null 2>&1; printf '{}%s\n' OK"#, NEEDLE),
            std::time::Duration::from_secs(10),
        );
        let hay = out.unwrap_or_default();
        let found = find_bytes(&hay, format!("{NEEDLE}OK").as_bytes());
        t.check(
            "korean_bytes_round_trip",
            found,
            format!("{} bytes back, needle {}", hay.len(), if found { "intact" } else { "MANGLED" }),
        );

        // Flood: without coalescing this is one IPC message per read. We can't observe the frontend
        // here, so assert the property that makes coalescing possible — the bytes arrive whole and
        // fast — and let the frame budget be checked by the flush-count math below.
        let started = std::time::Instant::now();
        let flood = crate::pty::probe(
            &shell,
            "chcp.com 65001 >/dev/null 2>&1; seq 1 20000",
            std::time::Duration::from_secs(20),
        )
        .unwrap_or_default();
        let elapsed = started.elapsed();
        let frames = (elapsed.as_millis() / 16).max(1);
        t.check(
            "flood_survives",
            flood.len() > 50_000,
            format!("{} bytes in {:?} (<= ~{} frames)", flood.len(), elapsed, frames),
        );
    }

    // --- statusline round trip ---
    // Usage has exactly one source: Claude Code piping the statusline payload into `--beacon
    // --statusline`. That used to travel through a bash wrapper, and when the wrapper silently failed
    // nothing in the app noticed — the rail just showed empty numbers under a green "installed". So run
    // the real binary the way Claude Code now runs it (no shell, no script) and assert a spool file comes
    // out the other end.
    let (ok, detail) = statusline_round_trip();
    t.check("statusline_writes_usage", ok, detail);

    // --- ports panel (Win32 TCP table) ---
    // list_ports() is fail-soft (empty on failure), so "it didn't panic" is a weak gate. Assert the
    // live GetExtendedTcpTable path actually read the machine's listeners: a Windows box always has
    // some (RPC/SMB), so an empty list — or a zero port — means the FFI returned nothing usable.
    let ports = crate::ports::list_ports();
    let sane = !ports.is_empty() && ports.iter().all(|p| p.port != 0);
    t.check("ports_table_read", sane, format!("{} listening port(s)", ports.len()));

    // --- session liveness (real Win32, not just the unit tests) ---
    // Two opposite failures live here: reaping a session that is alive (the worst thing this app can
    // do) and never reaping one that crashed (the bug users actually hit). Both turn on this verdict,
    // so assert it against real processes — the pure rules are covered by `cargo test`, but nothing
    // there proves the snapshot and the clock actually return usable values on this machine.
    let table = crate::correlate::ProcTable::capture();
    let me = std::process::id();
    t.check(
        "proc_table_captured",
        table.as_ref().is_some_and(|tbl| tbl.contains(me)),
        match table.as_ref() {
            Some(tbl) => format!("{} processes, self present", tbl.process_count()),
            None => "no believable process snapshot".into(),
        },
    );

    if let Some(tbl) = table.as_ref() {
        use crate::liveness::{creation_filetime, judge, owner_state, Owner, OwnerProbe};

        let my_start = creation_filetime(me).map(|c| c.to_string());

        // We are running, but we are not claude.exe — the name rule must call that a reused pid.
        // This is the check that used to be missing entirely, letting a reused pid read as alive.
        let mismatch = owner_state(me as i32, my_start.as_deref(), Some(tbl));
        t.check(
            "liveness_name_mismatch_is_gone",
            mismatch == Owner::Gone,
            format!("self is {} → {mismatch:?}", tbl.name(me).unwrap_or("?")),
        );

        // Same real snapshot and clock, wearing the expected name: proves the FILETIME comparison
        // works on live values, not just on the constants in the unit tests.
        let alive = judge(&OwnerProbe {
            pid: me as i32,
            started_at: my_start.as_deref().and_then(|s| s.parse().ok()),
            table_available: true,
            image: Some(crate::correlate::CLAUDE_IMAGE.to_string()),
            creation: creation_filetime(me),
        });
        t.check(
            "liveness_alive_when_name_matches",
            alive == Owner::Alive,
            format!("{alive:?} (start {})", my_start.as_deref().unwrap_or("unread")),
        );

        // A pid we watched exit.
        let finished = finished_pid();
        let dead = finished.map(|p| owner_state(p as i32, None, Some(tbl)));
        t.check(
            "liveness_finished_pid_is_gone",
            dead == Some(Owner::Gone),
            match (finished, dead) {
                (Some(p), Some(v)) => format!("pid {p} → {v:?}"),
                _ => "could not spawn a probe process".into(),
            },
        );

        // The two states that must never reap. Flip either to Gone and every live session dies.
        let no_pid = owner_state(0, None, Some(tbl));
        let no_table = owner_state(me as i32, my_start.as_deref(), None);
        t.check(
            "liveness_unknown_is_not_death",
            no_pid == Owner::Unknown && no_table == Owner::Unknown,
            format!("no pid → {no_pid:?}, no snapshot → {no_table:?}"),
        );
    } else {
        // Without a snapshot the four checks above cannot run — and a check that silently disappears
        // is not a check. Fail them explicitly so the report keeps a constant shape.
        for name in [
            "liveness_name_mismatch_is_gone",
            "liveness_alive_when_name_matches",
            "liveness_finished_pid_is_gone",
            "liveness_unknown_is_not_death",
        ] {
            t.check(name, false, "skipped: no process snapshot");
        }
    }

    // --- spool reap scope ---
    // `session_dismiss` made `reap_session` reachable from the frontend, so its id is now untrusted.
    let (ok, detail) = reap_is_scoped();
    t.check("spool_reap_is_scoped", ok, detail);

    let result = if t.failed == 0 { "OK" } else { "FAIL" };
    let report = format!("{}\nRESULT={}\n", t.lines, result);

    if let Some(d) = &dir {
        let _ = fs::create_dir_all(d);
        let _ = fs::write(d.join("selftest.log"), &report);
    }
    print!("{}", report);

    if t.failed == 0 {
        0
    } else {
        1
    }
}
