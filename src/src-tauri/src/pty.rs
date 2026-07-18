use base64::Engine as _;
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

/// Frame budget for coalescing PTY output. A shell can emit thousands of small writes per second;
/// forwarding each one costs an IPC hop and a JSON serialisation, which is what actually freezes the
/// UI under a flood. Tauri's own docs say the event system is "not designed for low latency or high
/// throughput", and that applies to Channel too — Channel removes the fanout, not the serialisation.
/// So we batch on the **producer** side: by the time bytes reach the frontend they've been paid for.
const FRAME: Duration = Duration::from_millis(16);

/// Flush early if a frame accumulates more than this. Bounds memory under `yes`-style floods and
/// keeps a single frame from becoming a multi-megabyte payload.
const MAX_FRAME_BYTES: usize = 256 * 1024;

/// One chunk of PTY output.
///
/// **`data` is base64 of the raw bytes, never a String.** Decoding to UTF-8 in Rust would split a
/// Korean character whose 3 bytes straddle a read boundary — a mangled glyph, not a slow one. The
/// frontend decodes to `Uint8Array` and hands that to xterm.js, whose parser stitches partial
/// sequences across writes. This is correctness, not optimisation.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyChunk {
    pub data: String,
}

pub struct Pane {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
    /// Kept so the child is reaped on close rather than left behind.
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// The spawned shell's OS pid — an ancestor of any `claude.exe` run in this pane, so session
    /// correlation can walk up to it. `None` if portable-pty couldn't report it.
    shell_pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyState {
    panes: Mutex<HashMap<u64, Pane>>,
    next_id: AtomicU64,
}

impl PtyState {
    /// pty id → spawned shell pid, for session correlation. Skips panes with no reported pid.
    pub fn pane_pids(&self) -> HashMap<u64, u32> {
        self.panes
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(&id, p)| p.shell_pid.map(|pid| (id, pid)))
            .collect()
    }
}

/// Wrap a shell so its console starts in UTF-8.
///
/// Git Bash inherits the ConPTY console's OEM code page (CP949 on a Korean Windows), and a TUI that
/// writes UTF-8 bytes straight to the console renders as mojibake. `chcp.com 65001` fixes the page,
/// then `exec` replaces the wrapper so no extra shell lingers in the process tree.
///
/// Claude Code calls `SetConsoleOutputCP(65001)` itself at startup, so *its* output is fine either
/// way — this is for everything else the user runs.
fn build_command(shell: &str, cwd: Option<&str>) -> CommandBuilder {
    let lower = shell.to_lowercase();
    let mut cmd = if lower.ends_with("bash.exe") {
        let mut c = CommandBuilder::new(shell);
        c.arg("-c");
        c.arg(r#"chcp.com 65001 >/dev/null 2>&1; exec "$BASH" --login -i"#);
        c
    } else if lower.ends_with("powershell.exe") || lower.ends_with("pwsh.exe") {
        // PowerShell inherits the ConPTY console's OEM code page (CP949 here), so a program writing
        // UTF-8 bytes renders as mojibake — the same trap `chcp 65001` fixes for bash. Force the
        // console encodings to UTF-8 at startup, then stay interactive (`-NoExit`). pwsh (PS7) is
        // already UTF-8, so this is a no-op there and the fix for Windows PowerShell 5.1.
        let mut c = CommandBuilder::new(shell);
        c.arg("-NoExit");
        c.arg("-Command");
        c.arg(
            "$OutputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
             [Console]::InputEncoding=[System.Text.Encoding]::UTF8",
        );
        c
    } else {
        CommandBuilder::new(shell)
    };
    if let Some(d) = cwd {
        cmd.cwd(d);
    }
    cmd
}

#[tauri::command]
pub fn pty_spawn(
    state: tauri::State<'_, PtyState>,
    shell: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<PtyChunk>,
) -> Result<u64, String> {
    let sys = NativePtySystem::default();
    let pair = sys
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;

    let child = pair
        .slave
        .spawn_command(build_command(&shell, cwd.as_deref()))
        .map_err(|e| format!("spawn {shell}: {e}"))?;

    let reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

    let shell_pid = child.process_id();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.panes.lock().unwrap().insert(id, Pane { pair, writer, child, shell_pid });

    std::thread::spawn(move || read_loop(reader, on_data));

    Ok(id)
}

/// Drain the PTY to the frontend, coalescing at most one message per 16 ms frame.
///
/// A blocking `read` returns up to 64 KiB at once, so it already batches a burst — but on a **quiet**
/// terminal it blocks indefinitely, which used to strand the shell's opening prompt in the buffer
/// until the user pressed a key (the prompt arrived in the first read, the frame timer hadn't elapsed
/// yet, and the next read blocked forever waiting for bytes that never came). So reading runs on its
/// own thread and this forwarder times the frame independently of when the next byte arrives: it
/// blocks for the first byte (zero CPU while idle), then coalesces for one frame and flushes. The
/// prompt now shows within 16 ms of arriving, floods still collapse into ≤60 messages/sec.
fn read_loop(mut reader: Box<dyn Read + Send>, channel: Channel<PtyChunk>) {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break, // EOF or error — dropping tx tells the forwarder to stop
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break; // forwarder gone (pane closed)
                    }
                }
            }
        }
    });

    let mut pending: Vec<u8> = Vec::new();
    loop {
        // Block until there's something to send — the first byte starts the frame.
        match rx.recv() {
            Ok(chunk) => pending.extend_from_slice(&chunk),
            Err(_) => break, // reader thread ended
        }
        let frame_start = Instant::now();
        // Gather whatever else arrives within this frame, bounded by MAX_FRAME_BYTES.
        while pending.len() < MAX_FRAME_BYTES {
            let Some(remaining) = FRAME.checked_sub(frame_start.elapsed()) else {
                break; // frame elapsed
            };
            match rx.recv_timeout(remaining) {
                Ok(chunk) => pending.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    let _ = flush(&channel, &mut pending);
                    return;
                }
            }
        }
        if flush(&channel, &mut pending).is_err() {
            break; // frontend dropped the channel (pane closed)
        }
    }
}

fn flush(channel: &Channel<PtyChunk>, pending: &mut Vec<u8>) -> Result<(), tauri::Error> {
    if pending.is_empty() {
        return Ok(());
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&pending[..]);
    pending.clear();
    channel.send(PtyChunk { data })
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, PtyState>, id: u64, data: String) -> Result<(), String> {
    let mut panes = state.panes.lock().unwrap();
    let pane = panes.get_mut(&id).ok_or("no such pane")?;
    pane.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    pane.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let panes = state.panes.lock().unwrap();
    let pane = panes.get(&id).ok_or("no such pane")?;
    pane.pair
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_close(state: tauri::State<'_, PtyState>, id: u64) -> Result<(), String> {
    if let Some(mut pane) = state.panes.lock().unwrap().remove(&id) {
        let _ = pane.child.kill();
        let _ = pane.child.wait();
    }
    Ok(())
}

/// Default shell: Git Bash if it's where Git for Windows puts it, else PowerShell.
/// M7 turns this into a setting; hardcoding the search keeps M2 to one concern.
pub fn default_shell() -> String {
    for base in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(base) {
            let p = std::path::Path::new(&root).join("Git").join("bin").join("bash.exe");
            if p.is_file() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    "powershell.exe".into()
}

/// Spawn a shell, run one command, and return its raw output bytes. Used by `--selftest` to prove
/// the byte path end to end without a window.
pub fn probe(shell: &str, command: &str, wait: Duration) -> Result<Vec<u8>, String> {
    let sys = NativePtySystem::default();
    let pair = sys
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-c");
    cmd.arg(command);
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
    let out = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&out);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            sink.lock().unwrap().extend_from_slice(&buf[..n]);
        }
    });

    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    // The reader thread needs a moment to drain what the child wrote before exiting.
    std::thread::sleep(Duration::from_millis(150));
    let bytes = out.lock().unwrap().clone();
    Ok(bytes)
}
