import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Single window onto the Rust side. Every command goes through a typed wrapper here rather than
 * `invoke("...")` scattered across components — md-reader's `lib/tauri.ts` pattern.
 */

export type PtyChunk = { data: string };

/** Path to the shell we spawn by default (Git Bash if installed, else PowerShell). */
export const defaultShell = () => invoke<string>("default_shell");

/**
 * Start a shell and stream its output.
 *
 * `onData` gets **base64 of raw PTY bytes**, never text: decoding in Rust would split a Korean
 * character across a read boundary. Callers hand the decoded `Uint8Array` straight to xterm.js,
 * whose parser stitches partial sequences across writes.
 *
 * A Channel per pane — its lifetime is tied to the pane, and there is no global event fanout for
 * the frontend to filter.
 */
export function ptySpawn(
  opts: { shell: string; cwd?: string; cols: number; rows: number },
  onData: (bytes: Uint8Array) => void,
): Promise<number> {
  const channel = new Channel<PtyChunk>();
  channel.onmessage = (msg) => onData(b64ToBytes(msg.data));
  return invoke<number>("pty_spawn", { ...opts, onData: channel });
}

export const ptyWrite = (id: number, data: string) => invoke<void>("pty_write", { id, data });
export const ptyResize = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const ptyClose = (id: number) => invoke<void>("pty_close", { id });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
