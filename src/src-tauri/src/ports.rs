//! Listening TCP ports and the process that owns each — a right-rail panel data source.
//!
//! Uses `GetExtendedTcpTable` (the `windows` crate is already a dependency) rather than shelling out
//! to `netstat`: no console window to flash, no locale-dependent parsing, and it plays to the Win32
//! muscle deck already has. **Fail-soft throughout** — any API failure yields an empty list, never an
//! error the UI must render. IPv4 listening sockets only for now (IPv6 is a follow-up).

use crate::correlate::ProcTable;
use core::ffi::c_void;
use serde::Serialize;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
};
use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

/// AF_INET — passed as a raw DWORD so we don't pull in the WinSock feature for one constant.
const AF_INET: u32 = 2;
/// `MIB_TCP_STATE_LISTEN`.
const TCP_LISTEN: u32 = 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRow {
    pub port: u16,
    pub pid: u32,
    pub process: String,
    pub addr: String,
    /// Owned by a Windows OS/service process (svchost, System, …) — noise for a dev workflow. The
    /// frontend hides these by default; the row is still returned so a toggle can reveal it.
    pub system: bool,
}

/// Listening TCP ports with their owning process, sorted by port. Fail-soft: empty on any failure.
#[tauri::command(async)]
pub fn list_ports() -> Vec<PortRow> {
    // One process snapshot, shared with the session correlation/liveness code (`correlate::ProcTable`).
    // `None` means we could not get a believable snapshot — the rows still come back, just unnamed.
    let table = ProcTable::capture();
    let mut rows = collect_listeners();
    for r in &mut rows {
        if let Some(n) = table.as_ref().and_then(|t| t.name(r.pid)) {
            r.process = n.to_string();
        }
        r.system = is_system_process(&r.process, r.pid);
    }
    rows.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    rows
}

/// Terminate a process by pid. Returns a message on failure so the UI can show it inline (there is no
/// toast system — failures are rendered on the row).
#[tauri::command(async)]
pub fn kill_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("잘못된 PID".into());
    }
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|e| e.to_string())?;
        let res = TerminateProcess(handle, 1).map_err(|e| e.to_string());
        let _ = CloseHandle(handle);
        res
    }
}

/// Read the TCP table twice (size, then fill) and keep the LISTEN rows. Empty on any failure.
fn collect_listeners() -> Vec<PortRow> {
    unsafe {
        let mut size: u32 = 0;
        // First call sizes the buffer (returns ERROR_INSUFFICIENT_BUFFER, which we ignore).
        let _ = GetExtendedTcpTable(None, &mut size, false, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
        if size == 0 {
            return Vec::new();
        }
        // A u32 buffer, not Vec<u8>: the table is all DWORDs and casting a byte vec would be
        // under-aligned. `size` is in bytes; round up to whole words.
        let words = (size as usize + 3) / 4;
        let mut buf: Vec<u32> = vec![0; words];
        let ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut size,
            false,
            AF_INET,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if ret != 0 {
            return Vec::new(); // NO_ERROR == 0; anything else → fail-soft empty
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let n = table.dwNumEntries as usize;
        let entries = std::slice::from_raw_parts(table.table.as_ptr(), n);
        entries
            .iter()
            .filter(|row| is_listening(row.dwState))
            .map(|row| PortRow {
                port: port_from_be(row.dwLocalPort),
                pid: row.dwOwningPid,
                process: String::new(), // filled from the name map by the caller
                addr: ipv4_from_ne(row.dwLocalAddr),
                system: false, // decided by the caller once the name is filled
            })
            .collect()
    }
}

/// The port is in the low word of the DWORD in network byte order; `from_be` gives host order.
pub fn port_from_be(dw_local_port: u32) -> u16 {
    u16::from_be((dw_local_port & 0xFFFF) as u16)
}

/// The IPv4 address DWORD is stored network-order, i.e. octet order in memory.
pub fn ipv4_from_ne(dw_addr: u32) -> String {
    let b = dw_addr.to_ne_bytes();
    format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3])
}

/// `MIB_TCP_STATE_LISTEN` — the only state a "listening port" panel cares about.
pub fn is_listening(state: u32) -> bool {
    state == TCP_LISTEN
}

/// Is this listener owned by a Windows OS/service process (svchost, System, …)? Those are the ones a
/// dev doesn't care about — the panel hides them by default. Deliberately a **short allow-list of core
/// OS processes**, not a heuristic: a user-installed service (sqlservr, postgres, redis) is *not*
/// system and should stay visible. pid 0/4 are System Idle / System; an empty name is almost always
/// one of those with a name we couldn't read.
pub fn is_system_process(name: &str, pid: u32) -> bool {
    if pid == 0 || pid == 4 {
        return true;
    }
    let n = name.to_ascii_lowercase();
    if n.is_empty() {
        return true;
    }
    matches!(
        n.as_str(),
        "system"
            | "svchost.exe"
            | "services.exe"
            | "lsass.exe"
            | "wininit.exe"
            | "winlogon.exe"
            | "smss.exe"
            | "csrss.exe"
            | "spoolsv.exe"
            | "searchindexer.exe"
    )
}

#[cfg(test)]
mod tests {
    use super::{ipv4_from_ne, is_listening, port_from_be};

    #[test]
    fn port_round_trips_through_network_order() {
        // `to_be` is the inverse of `from_be` — build the DWORD the way the API stores it.
        for p in [22u16, 80, 443, 3000, 8080, 65535] {
            assert_eq!(port_from_be(p.to_be() as u32), p);
        }
    }

    #[test]
    fn ipv4_reads_octets_in_memory_order() {
        assert_eq!(ipv4_from_ne(u32::from_ne_bytes([127, 0, 0, 1])), "127.0.0.1");
        assert_eq!(ipv4_from_ne(0), "0.0.0.0");
        assert_eq!(ipv4_from_ne(u32::from_ne_bytes([192, 168, 0, 1])), "192.168.0.1");
    }

    #[test]
    fn only_listen_state_counts() {
        assert!(is_listening(2)); // LISTEN
        assert!(!is_listening(1)); // CLOSED
        assert!(!is_listening(5)); // ESTABLISHED
    }

    #[test]
    fn system_processes_are_flagged_but_user_servers_are_not() {
        use super::is_system_process;
        // core OS processes / System pid — hidden by default
        assert!(is_system_process("svchost.exe", 1234));
        assert!(is_system_process("SVCHOST.EXE", 1234)); // case-insensitive
        assert!(is_system_process("System", 4));
        assert!(is_system_process("", 4)); // System with an unreadable name
        assert!(is_system_process("anything", 4)); // pid 4 is System regardless of name
        // user processes and user-installed services — stay visible
        assert!(!is_system_process("node.exe", 5000));
        assert!(!is_system_process("python.exe", 8000));
        assert!(!is_system_process("sqlservr.exe", 1433));
        assert!(!is_system_process("postgres.exe", 5432));
    }
}
