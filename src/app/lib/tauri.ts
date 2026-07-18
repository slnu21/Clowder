import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Single window onto the Rust side. Every command goes through a typed wrapper here rather than
 * `invoke("...")` scattered across components — md-reader's `lib/tauri.ts` pattern.
 */

export type PtyChunk = { data: string };

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  /** Hidden by attribute or leading dot — dimmed, not hidden. */
  hidden: boolean;
};

/** Path to the shell we spawn by default (Git Bash if installed, else PowerShell). */
export const defaultShell = () => invoke<string>("default_shell");

/** Tree roots. Drives only — deck has no workspace to be scoped to. */
export const listDrives = () => invoke<Entry[]>("list_drives");

/** One level, lazily. Never recursive: a recursive listing of `C:\` would hang the app. */
export const listDir = (path: string) => invoke<Entry[]>("list_dir", { path });

/** Convenience starting point, not a workspace. */
export const defaultRoot = () => invoke<string | null>("default_root");

/** Read a file as text, normalizing newlines to LF (md/html viewers). */
export async function readFile(path: string): Promise<string> {
  const s = await invoke<string>("read_file", { path });
  return s.replace(/\r\n?/g, "\n");
}

/** Read a file's bytes as base64 — for inlining a document's relative images as data URIs. */
export const readFileBase64 = (path: string) => invoke<string>("read_file_base64", { path });

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
