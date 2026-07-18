import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { defaultShell, ptyClose, ptyResize, ptySpawn, ptyWrite } from "../../lib/tauri";

/**
 * A pool of live terminals keyed by leaf id, living **outside** React.
 *
 * Tiling and tabs constantly reshape the component tree: splitting a pane nests it deeper, switching
 * tabs unmounts a whole subtree. If the xterm/PTY lifecycle were tied to a React component, every
 * such move would dispose the terminal and kill its shell. So the xterm instance and its host `<div>`
 * are created once per leaf and kept here; `TerminalView` only *attaches* that div while mounted and
 * detaches (without disposing) on unmount. The PTY is closed only when the pane is truly gone
 * (`release`, called from the store's close actions).
 *
 * A side benefit: because `acquire` is idempotent per leaf id, React StrictMode's double-mount can no
 * longer spawn two shells — the second mount returns the same entry. (That double-mount is what
 * stranded the opening prompt before; see 2026-07-18-01.)
 *
 * **No WebGL addon, deliberately** — xterm falls back to the DOM renderer, and WebGL's glyph atlas
 * mangles CJK inside WebView2. Not installing it means the choice can't drift back.
 */
export type PoolEntry = {
  term: Xterm;
  fit: FitAddon;
  /** The persistent host element; moved between slots, never re-created. */
  el: HTMLDivElement;
  ptyId: number | null;
  released: boolean;
};

const pool = new Map<string, PoolEntry>();
/** Reverse index pty id → leaf id, so a correlated session row can focus its pane. */
const ptyToLeaf = new Map<number, string>();

export function acquire(leafId: string, cwd?: string): PoolEntry {
  const existing = pool.get(leafId);
  if (existing) return existing;

  const el = document.createElement("div");
  el.className = "xterm-host";
  const term = new Xterm({
    fontFamily: '"D2Coding", "Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    scrollback: 5000, // bounded: scrollback is the other place a flood turns into memory
    cursorBlink: true,
    theme: { background: "#16181d", foreground: "#d4d7dd" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);

  const entry: PoolEntry = { term, fit, el, ptyId: null, released: false };
  pool.set(leafId, entry);

  void (async () => {
    const shell = await defaultShell();
    if (entry.released) return;
    // Bytes, not text — xterm.js stitches partial UTF-8 sequences across writes.
    const id = await ptySpawn(
      { shell, cwd, cols: term.cols, rows: term.rows },
      (bytes) => term.write(bytes),
    );
    if (entry.released) {
      void ptyClose(id);
      return;
    }
    entry.ptyId = id;
    ptyToLeaf.set(id, leafId);
    term.onData((d) => void ptyWrite(id, d));
    term.onResize(({ cols, rows }) => void ptyResize(id, cols, rows));
  })();

  return entry;
}

/** Tear a pane down for good: close the shell, dispose the terminal, drop the entry. */
export function release(leafId: string): void {
  const entry = pool.get(leafId);
  if (!entry) return;
  entry.released = true;
  if (entry.ptyId !== null) {
    ptyToLeaf.delete(entry.ptyId);
    void ptyClose(entry.ptyId);
  }
  entry.term.dispose();
  entry.el.remove();
  pool.delete(leafId);
}

/** Leaf id running under a given pty id — resolves a correlated session's pane. */
export const leafIdForPty = (ptyId: number): string | undefined => ptyToLeaf.get(ptyId);

/** Type text straight into a pane's shell (drag & drop path insertion). */
export function writeToPane(leafId: string, data: string): void {
  const entry = pool.get(leafId);
  if (entry?.ptyId != null) void ptyWrite(entry.ptyId, data);
}

export function focusPane(leafId: string): void {
  pool.get(leafId)?.term.focus();
}
