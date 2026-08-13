//! The process snapshot, and session↔pane correlation built on it.
//!
//! **Correlation**: the beacon records each session's owning `claude.exe` pid. We walk **up** from that
//! pid through the process ancestry; if we reach a pid we spawned for a pane (portable-pty's child),
//! that pane owns the session. This is the reverse of the beacon's own ancestor walk.
//!
//! **Why the process tree and not cwd matching**: two sessions started in the same folder are exactly
//! how this gets used, and cwd matching collapses them onto one pane. The ancestry is unambiguous —
//! each `claude.exe` traces back to a different pane shell.
//!
//! **Why [`ProcTable`] is shared**: this snapshot used to exist in three copies (here for parent pids,
//! `ports` for names, `beacon` for both). Folding them into one type is not just deduplication — the
//! liveness check decides a session is dead when the recorded pid's image name no longer matches what
//! the beacon recorded, and that verdict is only sound if producer and consumer compare the **same
//! way**. One type means one comparison.

use std::collections::HashMap;
use std::time::Duration;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// The image name a session's owner must have.
///
/// **One constant, shared by producer and consumer, on purpose.** The beacon records a session's pid
/// only when it finds an ancestor with this name; liveness later declares a session dead when that
/// pid's name no longer matches. That verdict is sound *only* because both sides use the same
/// predicate — if the producer ever accepted a name the consumer rejects, live sessions would be
/// reaped. Widening this set is therefore not a local change: it loosens PID-reuse detection too.
pub const CLAUDE_IMAGE: &str = "claude.exe";

pub fn is_claude_image(name: &str) -> bool {
    name.eq_ignore_ascii_case(CLAUDE_IMAGE)
}

/// A snapshot smaller than this is not a machine state we believe in — Windows never runs a handful of
/// processes. Treating a truncated enumeration as truth would mean "every session's owner vanished",
/// which is this app's worst failure: reaping live sessions.
const MIN_PLAUSIBLE_PROCESSES: usize = 16;

/// Is a snapshot of this size worth believing? Pure — the guard that keeps a bad enumeration from
/// being read as mass death.
pub fn is_plausible_table(len: usize) -> bool {
    len >= MIN_PLAUSIBLE_PROCESSES
}

/// One snapshot of the whole process table: pid → (parent pid, image name).
///
/// Image names keep their **original casing** — the ports panel renders them and `is_system_process`
/// matches on them. Comparisons here are case-insensitive instead.
pub struct ProcTable {
    rows: HashMap<u32, (u32, String)>,
}

impl ProcTable {
    /// Take a snapshot, or `None` if we could not get a believable one.
    ///
    /// `CreateToolhelp32Snapshot` fails with `ERROR_BAD_LENGTH` when processes are being created or
    /// destroyed mid-walk — documented, transient, and *routine* on a busy machine. The old code took
    /// the first failure as final, which is how a session's owner pid came to be recorded as null and
    /// then never judged again. Retry briefly.
    pub fn capture() -> Option<ProcTable> {
        for attempt in 0..3 {
            if let Some(table) = Self::capture_once() {
                return Some(table);
            }
            if attempt < 2 {
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        None
    }

    fn capture_once() -> Option<ProcTable> {
        let mut rows: HashMap<u32, (u32, String)> = HashMap::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry = PROCESSENTRY32W::default();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    rows.insert(
                        entry.th32ProcessID,
                        (entry.th32ParentProcessID, exe_name(&entry.szExeFile)),
                    );
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        is_plausible_table(rows.len()).then_some(ProcTable { rows })
    }

    pub fn parent(&self, pid: u32) -> Option<u32> {
        self.rows.get(&pid).map(|(parent, _)| *parent)
    }

    pub fn name(&self, pid: u32) -> Option<&str> {
        self.rows.get(&pid).map(|(_, name)| name.as_str())
    }

    /// Is this pid running right now? A running process is always enumerated, so `false` is a
    /// **definite** answer — unlike `OpenProcess`, which can be refused by permissions.
    pub fn contains(&self, pid: u32) -> bool {
        self.rows.contains_key(&pid)
    }

    pub fn process_count(&self) -> usize {
        self.rows.len()
    }

    /// The ancestry chain from `pid` upward as (pid, name) pairs, nearest ancestor first, `pid`
    /// included. Stops at the 24-hop cap, at pid 0, at an unknown pid, or on a cycle. Pure given the
    /// table — the walk policy that consumes it is tested separately.
    pub fn chain(&self, pid: u32) -> Vec<(u32, &str)> {
        let mut out = Vec::new();
        let mut cur = pid;
        for _ in 0..24 {
            if cur == 0 {
                break;
            }
            let Some((parent, name)) = self.rows.get(&cur) else { break };
            out.push((cur, name.as_str()));
            if *parent == cur {
                break; // self-parent: corrupt snapshot
            }
            cur = *parent;
        }
        out
    }

    #[cfg(test)]
    pub fn from_parents(pairs: impl IntoIterator<Item = (u32, u32)>) -> ProcTable {
        ProcTable {
            rows: pairs.into_iter().map(|(pid, parent)| (pid, (parent, String::new()))).collect(),
        }
    }

    #[cfg(test)]
    pub fn from_rows(rows: impl IntoIterator<Item = (u32, u32, &'static str)>) -> ProcTable {
        ProcTable {
            rows: rows.into_iter().map(|(pid, parent, name)| (pid, (parent, name.to_string()))).collect(),
        }
    }
}

fn exe_name(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Walk up from `claude_pid`; return the pty id of the first ancestor that is a known pane shell.
///
/// `panes` maps pty id → the shell pid we spawned for it. The 24-hop cap mirrors the beacon and
/// guards against a cycle in a corrupt snapshot.
pub fn find_owning_pane(
    table: &ProcTable,
    claude_pid: u32,
    panes: &HashMap<u64, u32>,
) -> Option<u64> {
    let by_pid: HashMap<u32, u64> = panes.iter().map(|(&pty, &pid)| (pid, pty)).collect();
    let mut pid = claude_pid;
    for _ in 0..24 {
        if pid == 0 {
            break;
        }
        if let Some(&pty) = by_pid.get(&pid) {
            return Some(pty);
        }
        match table.parent(pid) {
            Some(p) if p != pid => pid = p,
            _ => break,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{find_owning_pane, is_plausible_table, ProcTable};
    use std::collections::HashMap;

    // Ancestry: claude(100) -> loginbash(90) -> usrbash(80) -> paneshell(70) -> deck(10)
    fn tree() -> ProcTable {
        ProcTable::from_parents([(100, 90), (90, 80), (80, 70), (70, 10), (10, 0)])
    }

    #[test]
    fn matches_owning_pane_through_the_chain() {
        let panes = HashMap::from([(1u64, 70u32)]); // pty 1's shell is pid 70
        assert_eq!(find_owning_pane(&tree(), 100, &panes), Some(1));
    }

    #[test]
    fn two_sessions_same_folder_map_to_their_own_panes() {
        // A second session under a different pane shell (71), even if cwd were identical.
        let t = ProcTable::from_parents([
            (100, 90),
            (90, 80),
            (80, 70),
            (70, 10),
            (10, 0),
            (200, 190),
            (190, 71),
            (71, 10),
        ]);
        let panes = HashMap::from([(1u64, 70u32), (2u64, 71u32)]);
        assert_eq!(find_owning_pane(&t, 100, &panes), Some(1));
        assert_eq!(find_owning_pane(&t, 200, &panes), Some(2));
    }

    #[test]
    fn foreign_session_has_no_pane() {
        // claude launched outside deck: its ancestry never reaches a known pane shell.
        let panes = HashMap::from([(1u64, 70u32)]);
        let foreign = ProcTable::from_parents([(500u32, 400u32), (400, 1u32)]);
        assert_eq!(find_owning_pane(&foreign, 500, &panes), None);
    }

    #[test]
    fn stops_on_a_cycle() {
        let cyclic = ProcTable::from_parents([(100u32, 90u32), (90, 100)]);
        let panes = HashMap::from([(1u64, 70u32)]);
        assert_eq!(find_owning_pane(&cyclic, 100, &panes), None);
    }

    /// A truncated enumeration must never be mistaken for the machine's real state — that is what
    /// would turn a snapshot glitch into "every session is dead".
    #[test]
    fn implausible_table_sizes_are_rejected() {
        assert!(!is_plausible_table(0));
        assert!(!is_plausible_table(1));
        assert!(!is_plausible_table(15));
        assert!(is_plausible_table(16));
        assert!(is_plausible_table(400));
    }

    #[test]
    fn chain_walks_up_and_stops_on_a_cycle() {
        let t = ProcTable::from_rows([
            (100, 90, "clowder.exe"),
            (90, 80, "cmd.exe"),
            (80, 0, "claude.exe"),
        ]);
        let names: Vec<&str> = t.chain(100).into_iter().map(|(_, n)| n).collect();
        assert_eq!(names, ["clowder.exe", "cmd.exe", "claude.exe"]);

        let cyclic = ProcTable::from_rows([(1, 2, "a.exe"), (2, 1, "b.exe")]);
        assert_eq!(cyclic.chain(1).len(), 24); // capped, not infinite
    }
}
