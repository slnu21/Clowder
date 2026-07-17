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

    // M2 adds: conpty.dll present and loaded, OpenConsole.exe paired, byte-lossless Korean round
    // trip through the PTY, coalescing flush count under flood. M5 adds: spool parse/sort/reap.

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
