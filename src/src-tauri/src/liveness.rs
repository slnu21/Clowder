//! Is a session's owning `claude.exe` still alive? A direct port of Vigil's `Liveness.cs`.
//!
//! **Uses the `windows` crate, not `sysinfo`, on purpose.** `sysinfo`'s `start_time()` is Unix
//! *seconds*, but the spool records the creation time as a FILETIME (100-ns ticks). Converting loses
//! sub-second precision — and that precision is the whole point: it's what distinguishes the original
//! process from a **reused PID**. So we call `GetProcessTimes` and compare the raw FILETIME.

use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

/// 2 seconds in 100-ns FILETIME ticks — generous slack for any conversion rounding.
const TICK_TOLERANCE: i64 = 20_000_000;

/// `false` ⇒ the owner is gone (or its PID was reused) ⇒ the session is dead and reapable.
/// Errs toward `true` (don't reap) whenever it can't get a definite answer.
pub fn is_owner_alive(pid: i32, started_at: Option<&str>) -> bool {
    if pid <= 0 {
        return true; // unknown owner (legacy/foreign spool): never reap
    }
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid as u32) {
            Ok(h) => h,
            // ERROR_ACCESS_DENIED (0x80070005) ⇒ the process exists but we can't inspect it; don't
            // falsely reap. Any other failure ⇒ no such process ⇒ dead.
            Err(e) => return e.code().0 as u32 == 0x8007_0005,
        };

        let mut creation = FILETIME::default();
        let (mut exit, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default());
        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(handle);

        if !ok {
            return true; // opened but couldn't read times: don't reap on a transient
        }
        let expected = match started_at.and_then(|s| s.parse::<i64>().ok()) {
            Some(v) => v,
            None => return true, // no recorded start time to verify against
        };
        let actual = ((creation.dwHighDateTime as i64) << 32) | (creation.dwLowDateTime as i64);
        (actual - expected).abs() <= TICK_TOLERANCE // mismatch ⇒ reused PID ⇒ dead
    }
}
