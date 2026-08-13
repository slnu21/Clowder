//! Is a session's owning `claude.exe` still alive?
//!
//! **Uses the `windows` crate, not `sysinfo`, on purpose.** `sysinfo`'s `start_time()` is Unix
//! *seconds*, but the spool records the creation time as a FILETIME (100-ns ticks). Converting loses
//! sub-second precision — and that precision is the whole point: it's what distinguishes the original
//! process from a **reused PID**. So we call `GetProcessTimes` and compare the raw FILETIME.
//!
//! # Certain vs. unable to tell
//!
//! This module answers with [`Owner`], not a bool, because "alive" and "I couldn't find out" are
//! different facts and only one of them may lead to deleting a session. The old boolean folded five
//! situations into two values and resolved four of them to *alive*, so a session whose pid was
//! unknown, or whose pid had been reused by a protected process, was never reaped — the card stayed
//! on the rail forever, and a restart re-ran the same verdict.
//!
//! The fix is not a longer timeout; it is a **better source**. [`ProcTable`] lists every running
//! process with its image name regardless of permissions, so:
//!
//! - a pid that is absent from the snapshot is **definitely** gone (a running process is always
//!   enumerated), and
//! - a pid whose image name is not [`CLAUDE_IMAGE`] is **definitely** a reused pid, because the
//!   beacon only ever records an ancestor with that name.
//!
//! Those two facts absorb the cases that used to leak. What remains [`Owner::Unknown`] is only
//! "no pid was recorded" and "we could not get a believable snapshot" — and **`Unknown` never reaps**.
//! There is deliberately no time-based fallback: sessions here are left running for long stretches,
//! so "it has been quiet for a while" is not evidence of death.

use crate::correlate::{is_claude_image, ProcTable};
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

/// 2 seconds in 100-ns FILETIME ticks — generous slack for any conversion rounding.
const TICK_TOLERANCE: i64 = 20_000_000;

/// What we were able to establish about a session's owning process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    /// Proven running: present in the snapshot under the expected name.
    Alive,
    /// Proven not running: absent from the snapshot, or the pid now belongs to something else.
    /// **The only verdict that reaps.**
    Gone,
    /// No verdict — no recorded pid, or no believable snapshot. Never reaps.
    Unknown,
}

/// Everything Win32 could observe, as plain data. This struct is the boundary between the impure
/// probe and the pure verdict, so the rules below can be tested without a live process.
#[derive(Debug, Clone)]
pub struct OwnerProbe {
    /// The pid the beacon recorded. `<= 0` means it never found one.
    pub pid: i32,
    /// Creation FILETIME recorded alongside the pid, parsed.
    pub started_at: Option<i64>,
    /// Did we get a believable process snapshot at all? **`false` must never read as "gone"** — that
    /// mistake would reap every session at once.
    pub table_available: bool,
    /// Image name the snapshot reported for `pid`. `None` *with* `table_available` means the pid is
    /// not running.
    pub image: Option<String>,
    /// `GetProcessTimes` result, when we looked.
    pub creation: Option<i64>,
}

/// The verdict rules. Pure — no Win32 here, so every branch is a unit test.
pub fn judge(p: &OwnerProbe) -> Owner {
    if p.pid <= 0 {
        return Owner::Unknown; // beacon never identified an owner
    }
    if !p.table_available {
        return Owner::Unknown; // a failed enumeration is not evidence of death
    }
    let Some(image) = p.image.as_deref() else {
        return Owner::Gone; // running processes are always enumerated
    };
    if !is_claude_image(image) {
        return Owner::Gone; // pid reused: the beacon only records CLAUDE_IMAGE ancestors
    }
    match (p.started_at, p.creation) {
        // Same name, different birth instant ⇒ a *different* claude.exe wearing the old pid.
        (Some(expected), Some(actual)) => {
            if (actual - expected).abs() <= TICK_TOLERANCE {
                Owner::Alive
            } else {
                Owner::Gone
            }
        }
        // Name matches and the process exists; not reading its clock doesn't weaken that.
        _ => Owner::Alive,
    }
}

/// Observe, then judge. The thin impure shell: it decides *what to look at*, [`judge`] decides what
/// it means.
pub fn owner_state(pid: i32, started_at: Option<&str>, table: Option<&ProcTable>) -> Owner {
    // This function only decides **what to look up**; every verdict comes from `judge`.
    //
    // It used to return `Unknown` directly for "no pid" and "no table", which read as a harmless
    // shortcut but meant those two rules existed in two places — and the copy here shadowed the one
    // in `judge`, so breaking `judge` left the selftest green. A guard you cannot break is not a
    // guard (see the OSC 52 note in CLAUDE.md). Now the shortcut only skips syscalls.
    let image = table
        .filter(|_| pid > 0)
        .and_then(|t| t.name(pid as u32))
        .map(str::to_string);
    // Only worth a handle when the name already matches: that's the one case where the birth instant
    // can still change the answer (same-name pid reuse).
    let creation = match image.as_deref() {
        Some(name) if is_claude_image(name) => creation_filetime(pid as u32),
        _ => None,
    };
    judge(&OwnerProbe {
        pid,
        started_at: started_at.and_then(|s| s.parse::<i64>().ok()),
        table_available: table.is_some(),
        image,
        creation,
    })
}

/// A process's creation FILETIME, or `None` if it can't be read (access denied, or it just exited).
pub fn creation_filetime(pid: u32) -> Option<i64> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut creation = FILETIME::default();
        let (mut exit, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default());
        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(handle);
        ok.then(|| ((creation.dwHighDateTime as i64) << 32) | (creation.dwLowDateTime as i64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A probe that would come back `Alive`, so each test can spoil exactly one thing.
    fn alive_probe() -> OwnerProbe {
        OwnerProbe {
            pid: 4242,
            started_at: Some(133_700_000_000_000_000),
            table_available: true,
            image: Some("claude.exe".to_string()),
            creation: Some(133_700_000_000_000_000),
        }
    }

    #[test]
    fn baseline_probe_is_alive() {
        assert_eq!(judge(&alive_probe()), Owner::Alive);
    }

    /// The single most important rule here. A snapshot we could not take says nothing about who is
    /// running; reading it as "gone" would reap every live session in one sweep.
    #[test]
    fn unknown_when_no_snapshot() {
        let p = OwnerProbe { table_available: false, image: None, ..alive_probe() };
        assert_eq!(judge(&p), Owner::Unknown);
    }

    /// Sessions whose owner was never identified are left alone — the user clears them by hand.
    #[test]
    fn unknown_without_a_recorded_pid() {
        for pid in [0, -1] {
            let p = OwnerProbe { pid, ..alive_probe() };
            assert_eq!(judge(&p), Owner::Unknown, "pid {pid}");
        }
    }

    /// Absent from a good snapshot ⇒ definitely not running.
    #[test]
    fn gone_when_absent_from_the_table() {
        let p = OwnerProbe { image: None, creation: None, ..alive_probe() };
        assert_eq!(judge(&p), Owner::Gone);
    }

    /// The verdict that used to leak: the pid exists but now belongs to something else. Deleting the
    /// name check makes this `Alive` again.
    #[test]
    fn pid_reuse_by_name_is_definite() {
        for name in ["explorer.exe", "MsMpEng.exe", "node.exe"] {
            let p = OwnerProbe { image: Some(name.to_string()), ..alive_probe() };
            assert_eq!(judge(&p), Owner::Gone, "{name} must not pass as an owner");
        }
    }

    #[test]
    fn image_name_match_is_case_insensitive() {
        for name in ["CLAUDE.EXE", "Claude.Exe"] {
            let p = OwnerProbe { image: Some(name.to_string()), ..alive_probe() };
            assert_eq!(judge(&p), Owner::Alive, "{name}");
        }
    }

    /// Same name, different birth instant ⇒ reused pid. This is why the FILETIME precision exists.
    #[test]
    fn same_name_pid_reuse_is_caught_by_creation_time() {
        let base = 133_700_000_000_000_000i64;
        let cases = [
            (base + TICK_TOLERANCE, Owner::Alive), // exactly at tolerance
            (base - TICK_TOLERANCE, Owner::Alive),
            (base + TICK_TOLERANCE + 1, Owner::Gone), // just past it
            (base - TICK_TOLERANCE - 1, Owner::Gone),
        ];
        for (creation, want) in cases {
            let p = OwnerProbe { started_at: Some(base), creation: Some(creation), ..alive_probe() };
            assert_eq!(judge(&p), want, "creation {creation}");
        }
    }

    /// Access denied / a clock we couldn't read does not weaken "it exists under the right name".
    /// These are the old `true`-leaking paths, now definite.
    #[test]
    fn unreadable_clock_still_counts_as_alive() {
        let no_creation = OwnerProbe { creation: None, ..alive_probe() };
        assert_eq!(judge(&no_creation), Owner::Alive);

        let no_recorded_start = OwnerProbe { started_at: None, ..alive_probe() };
        assert_eq!(judge(&no_recorded_start), Owner::Alive);
    }

    /// The live shell, exercised against this very process: it must agree with `judge` and, above
    /// all, must not report a running process as gone.
    #[test]
    fn owner_state_sees_this_process_as_alive() {
        let table = ProcTable::capture().expect("a real machine has a process table");
        let me = std::process::id();
        let my_name = table.name(me).expect("we are running").to_string();

        // Our own image isn't claude.exe, so the name rule correctly calls it a reused pid.
        assert_eq!(owner_state(me as i32, None, Some(&table)), Owner::Gone, "{my_name}");
        // No table ⇒ no verdict, whatever the pid.
        assert_eq!(owner_state(me as i32, None, None), Owner::Unknown);
        assert_eq!(owner_state(0, None, Some(&table)), Owner::Unknown);
    }
}
