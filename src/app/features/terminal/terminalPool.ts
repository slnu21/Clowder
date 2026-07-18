import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ptyClose, ptyResize, ptySpawn, ptyWrite } from "../../lib/tauri";
import { resolveShell } from "../../lib/settings";
import { useSettings } from "../settings/store";

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

/**
 * The xterm colours, read live from the app's design tokens so a terminal matches whatever theme and
 * accent are active. `--accent`/`--bg-inset` resolve to the theme-tuned hex the CSS already computed,
 * so the cursor tracks the user's accent choice. `retheme()` re-applies these to every open terminal
 * when the theme flips — the shells keep running, only their palette changes.
 */
function xtermTheme(): { background: string; foreground: string; cursor: string; cursorAccent: string; selectionBackground: string } {
  const rs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => rs.getPropertyValue(name).trim() || fallback;
  const light = useSettings.getState().settings.theme === "light";
  const bg = v("--bg-inset", light ? "#f3f1ec" : "#0f0f0e");
  return {
    background: bg,
    foreground: v("--text-1", light ? "#262420" : "#e8e6e1"),
    cursor: v("--accent", "#c8a15c"),
    cursorAccent: bg,
    selectionBackground: light ? "rgba(38,36,32,0.16)" : "rgba(232,230,225,0.16)",
  };
}

/** Re-apply the current theme's palette to every live terminal (called when theme/accent changes). */
export function retheme(): void {
  const theme = xtermTheme();
  for (const entry of pool.values()) entry.term.options.theme = theme;
}

export function acquire(leafId: string, cwd?: string): PoolEntry {
  const existing = pool.get(leafId);
  if (existing) return existing;

  const s = useSettings.getState().settings; // synchronous read; loaded before the first spawn
  const el = document.createElement("div");
  el.className = "xterm-host";
  const term = new Xterm({
    fontFamily: `"${s.terminalFont}", "Cascadia Mono", Consolas, monospace`,
    fontSize: s.terminalFontSize,
    scrollback: s.scrollback, // bounded: scrollback is the other place a flood turns into memory
    cursorBlink: true,
    theme: xtermTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);

  const entry: PoolEntry = { term, fit, el, ptyId: null, released: false };
  pool.set(leafId, entry);

  void (async () => {
    const shell = await resolveShell();
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
