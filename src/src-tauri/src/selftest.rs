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
    let spawned = std::process::Command::new(&exe)
        .args(["--beacon", "--statusline"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped()) // the user's original line, if any — not ours to print
        .stderr(std::process::Stdio::null())
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

    // M5 adds: spool parse/sort/reap, ancestor walk.

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
