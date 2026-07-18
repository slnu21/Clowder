//! Correlate a session to the pane running it, by the process tree.
//!
//! The beacon records each session's owning `claude.exe` pid. We walk **up** from that pid through
//! the process ancestry; if we reach a pid we spawned for a pane (portable-pty's child), that pane
//! owns the session. This is the reverse of the beacon's own `FindClaudeAncestor` walk.
//!
//! **Why the process tree and not cwd matching**: two sessions started in the same folder are exactly
//! how this gets used, and cwd matching collapses them onto one pane. The ancestry is unambiguous —
//! each `claude.exe` traces back to a different pane shell.

use std::collections::HashMap;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Snapshot the whole process table as pid → parent-pid. Empty on failure (fail-soft).
pub fn build_parent_map() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return map,
        };
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    map
}

/// Walk up from `claude_pid`; return the pty id of the first ancestor that is a known pane shell.
///
/// `panes` maps pty id → the shell pid we spawned for it. The 24-hop cap mirrors the beacon and
/// guards against a cycle in a corrupt snapshot.
pub fn find_owning_pane(
    parent: &HashMap<u32, u32>,
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
        match parent.get(&pid) {
            Some(&p) if p != pid => pid = p,
            _ => break,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::find_owning_pane;
    use std::collections::HashMap;

    // Ancestry: claude(100) -> loginbash(90) -> usrbash(80) -> paneshell(70) -> deck(10)
    fn tree() -> HashMap<u32, u32> {
        HashMap::from([(100, 90), (90, 80), (80, 70), (70, 10), (10, 0)])
    }

    #[test]
    fn matches_owning_pane_through_the_chain() {
        let panes = HashMap::from([(1u64, 70u32)]); // pty 1's shell is pid 70
        assert_eq!(find_owning_pane(&tree(), 100, &panes), Some(1));
    }

    #[test]
    fn two_sessions_same_folder_map_to_their_own_panes() {
        // A second session under a different pane shell (71), even if cwd were identical.
        let mut t = tree();
        t.extend([(200, 190), (190, 71), (71, 10)]);
        let panes = HashMap::from([(1u64, 70u32), (2u64, 71u32)]);
        assert_eq!(find_owning_pane(&t, 100, &panes), Some(1));
        assert_eq!(find_owning_pane(&t, 200, &panes), Some(2));
    }

    #[test]
    fn foreign_session_has_no_pane() {
        // claude launched outside deck: its ancestry never reaches a known pane shell.
        let panes = HashMap::from([(1u64, 70u32)]);
        let foreign = HashMap::from([(500u32, 400u32), (400, 1u32)]);
        assert_eq!(find_owning_pane(&foreign, 500, &panes), None);
    }

    #[test]
    fn stops_on_a_cycle() {
        let cyclic = HashMap::from([(100u32, 90u32), (90, 100)]);
        let panes = HashMap::from([(1u64, 70u32)]);
        assert_eq!(find_owning_pane(&cyclic, 100, &panes), None);
    }
}
