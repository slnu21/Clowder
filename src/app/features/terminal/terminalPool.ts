import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { copyText, pasteText } from "../../lib/clipboard";
import { openTarget } from "../../lib/openTarget";
import { ptyClose, ptyResize, ptySpawn, ptyWrite, resolveLinkTarget } from "../../lib/tauri";
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
 *
 * The return type is `ITheme`, deliberately: it used to be narrowed to five keys, and a narrowed type
 * is how the ANSI sixteen went missing for so long — there was no slot to put them in and nothing
 * complained.
 */
function xtermTheme(): ITheme {
  const rs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => rs.getPropertyValue(name).trim() || fallback;
  const light = useSettings.getState().settings.theme === "light";
  const bg = v("--bg-inset", light ? "#f3f1ec" : "#0f0f0e");
  const ansi = (name: string, dark: string, lit: string) => v(`--ansi-${name}`, light ? lit : dark);
  return {
    background: bg,
    foreground: v("--text-1", light ? "#262420" : "#e8e6e1"),
    cursor: v("--accent", "#c8a15c"),
    cursorAccent: bg,
    selectionBackground: light ? "rgba(38,36,32,0.16)" : "rgba(232,230,225,0.16)",
    // No `selectionForeground` on purpose: leaving it unset keeps selected text in its own colour, so
    // a highlighted diff or log line still reads as a diff or log line.

    // The sixteen. Fallbacks matter — `getComputedStyle` returns "" for a property the stylesheet
    // hasn't defined yet during the very first paint, and an empty string would put xterm back on its
    // black-background defaults, which is the bug being fixed.
    black: ansi("black", "#3a3733", "#2b2925"),
    red: ansi("red", "#cf6b6b", "#a33a3a"),
    green: ansi("green", "#8faa6e", "#4f6b34"),
    yellow: ansi("yellow", "#d99a4e", "#8a5d00"),
    blue: ansi("blue", "#7f9cc0", "#2f5d8a"),
    magenta: ansi("magenta", "#b98bbd", "#8a4a86"),
    cyan: ansi("cyan", "#7fa8a0", "#2f6b63"),
    white: ansi("white", "#cfccc5", "#6a665e"),
    brightBlack: ansi("bright-black", "#6d6a63", "#7a766c"),
    brightRed: ansi("bright-red", "#e08c8c", "#8f2f2f"),
    brightGreen: ansi("bright-green", "#a8c489", "#3f5a28"),
    brightYellow: ansi("bright-yellow", "#edb96a", "#6f4a00"),
    brightBlue: ansi("bright-blue", "#9bb8d6", "#24496e"),
    brightMagenta: ansi("bright-magenta", "#d0a6d3", "#713a6e"),
    brightCyan: ansi("bright-cyan", "#9dc2ba", "#24564f"),
    brightWhite: ansi("bright-white", "#f2f0eb", "#3a3833"),
  };
}

/** Re-apply the current theme's palette to every live terminal (called when theme/accent changes). */
export function retheme(): void {
  const theme = xtermTheme();
  for (const entry of pool.values()) entry.term.options.theme = theme;
}

/**
 * Copy/paste bindings, following the Windows Terminal convention.
 *
 * `Ctrl+C` is the interesting one: it has to stay `^C` — interrupting a runaway command is the single
 * most important key in a terminal — but when there *is* a selection, nobody means "interrupt". So it
 * copies only in that case, exactly when `^C` would have had nothing to interrupt anyway.
 *
 * `Ctrl+V` is deliberately left alone: PSReadLine and readline both handle it themselves, and
 * intercepting it would break paste inside their line editors. `Ctrl+Shift+V` is ours.
 *
 * Returning `false` tells xterm to swallow the event instead of sending it to the shell.
 */
function clipboardKeys(term: Xterm): (e: KeyboardEvent) => boolean {
  return (e) => {
    if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
    const key = e.key.toLowerCase();
    if (key === "c" && (e.shiftKey || term.hasSelection())) {
      void copyText(term.getSelection());
      return false;
    }
    if (key === "v" && e.shiftKey) {
      // `term.paste` and not `ptyWrite`: it wraps the text in bracketed-paste markers when the app
      // asked for them, which is how a multi-line paste lands as one block instead of running every
      // line as a separate command.
      void pasteText().then((t) => t && term.paste(t));
      return false;
    }
    return true;
  };
}

/**
 * URLs and filesystem paths in terminal output, made clickable.
 *
 * There was no link handling at all before this: no matchers, and — the part that produced the
 * complaint — no `linkHandler`, so OSC 8 hyperlinks (the ones a program emits explicitly) fell through
 * to xterm's default, which is `window.open`. In a webview that means the OS opens it, so clicking a
 * `.md` path launched VS Code. Setting `linkHandler` is what closes that escape hatch; the two
 * matchers are what make plain text clickable in the first place.
 *
 * Paths are validated against the filesystem before they become links (`resolveLinkTarget` returns
 * null for anything that isn't there), which is why `provideLinks` is worth its async callback:
 * `and/or` in a sentence looks exactly like a relative path, and underlining it would be noise.
 */
function registerLinks(term: Xterm, cwd: () => string | undefined): void {
  const open = (text: string) => void openTarget(text, cwd());

  // Explicit OSC 8 hyperlinks. `range`/`text` are xterm's; the URI is what the program declared.
  term.options.linkHandler = {
    activate: (_event, uri) => open(uri),
  };

  term.registerLinkProvider({
    provideLinks(y, cb) {
      const row = readRow(term, y);
      if (!row) return cb(undefined);
      cb(matches(row, URL_RE, y).map((m) => ({ ...m, activate: () => open(m.text) })));
    },
  });

  term.registerLinkProvider({
    provideLinks(y, cb) {
      const row = readRow(term, y);
      if (!row) return cb(undefined);
      const found = matches(row, PATH_RE, y).filter((m) => !URL_RE.test(m.text));
      if (found.length === 0) return cb(undefined);
      // Ask Rust which of these actually exist, then offer only those.
      void Promise.all(found.map((m) => resolveLinkTarget(cwd(), m.text))).then((targets) =>
        cb(found.filter((_, i) => targets[i]).map((m) => ({ ...m, activate: () => open(m.text) }))),
      );
    },
  });
}

/**
 * One row as text, plus the cell each character sits in.
 *
 * `translateToString` would be shorter and wrong here: a Hangul syllable is one character but two
 * cells, so on any line containing Korean — which, in a Claude Code pane, is most of them — string
 * offsets stop matching column numbers and the underline drifts left of the link. Walking the cells
 * is the only way to keep the two coordinate systems tied together.
 */
function readRow(term: Xterm, y: number): { text: string; startCell: number[]; endCell: number[] } | null {
  const line = term.buffer.active.getLine(y - 1);
  if (!line) return null;
  let text = "";
  const startCell: number[] = [];
  const endCell: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue; // the trailing half of a wide character — already accounted for
    const chars = cell.getChars() || " ";
    for (const ch of chars) {
      text += ch;
      startCell.push(x);
      endCell.push(x + width - 1);
    }
  }
  return text.trim() ? { text, startCell, endCell } : null;
}

/** Regex hits on one row, as xterm link ranges (1-based columns, inclusive on both ends). */
function matches(row: { text: string; startCell: number[]; endCell: number[] }, re: RegExp, y: number) {
  const out: { text: string; range: { start: { x: number; y: number }; end: { x: number; y: number } } }[] = [];
  re.lastIndex = 0; // the `g` flag makes these stateful, and the same instance is reused every row
  for (let m = re.exec(row.text); m; m = re.exec(row.text)) {
    const last = m.index + m[0].length - 1;
    out.push({
      text: m[0],
      range: {
        start: { x: row.startCell[m.index] + 1, y },
        end: { x: row.endCell[last] + 1, y },
      },
    });
  }
  return out;
}

/** http(s)/mailto. Trailing punctuation is left to `openTarget`'s trimming, not the pattern. */
const URL_RE = /\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/g;

/**
 * Path-shaped text: a drive-rooted or MSYS-rooted absolute path, or a relative one with a separator
 * (so a bare word is never a candidate). An optional `:line:col` tail rides along because that is how
 * every tool — including Claude Code — prints a location.
 */
const PATH_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?(?:[\w.~%$@+-]+[\\/])+[\w.~%$@+-]+(?::\d+){0,2}/g;

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
  term.attachCustomKeyEventHandler(clipboardKeys(term));
  // `cwd` as a thunk, not a value: it is the pane's launch directory today, but once panes can be
  // moved and re-targeted the resolver should follow whatever the leaf currently says.
  registerLinks(term, () => cwd);
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

/**
 * Put a pane's terminal into `host` and make it usable again.
 *
 * Moving a pane changes its parent, and React unmounts/remounts on a parent change even when the `key`
 * is identical. `acquire` is idempotent so xterm and the PTY survive that — but three things do not,
 * and all three are invisible until someone tries to type:
 *
 * - **fit**: if the new box happens to match the old one, no ResizeObserver fires and cols/rows stay
 *   sized for the container the pane just left. So refit unconditionally, on the next frame (the box
 *   has no layout yet during this one).
 * - **scrollback position**: detaching from the document destroys `.xterm-viewport`'s box and the view
 *   snaps to the bottom. `detach` remembers `viewportY`; this restores it.
 * - **focus**: a detached terminal blurs and never comes back on its own — which reads as "typing is
 *   dead after a drag". `setActivePane`'s `focusPane` runs *before* the remount, so it can't help here.
 *
 * `focus` is passed in rather than read from the workspace store: the store already imports this module,
 * and reaching back would make the cycle real.
 */
export function attach(
  leafId: string,
  host: HTMLElement,
  opts: { cwd?: string; focus?: boolean } = {},
): PoolEntry {
  const entry = acquire(leafId, opts.cwd);
  host.appendChild(entry.el);
  requestAnimationFrame(() => {
    if (host.clientHeight > 0 && host.clientWidth > 0) entry.fit.fit();
    const y = savedScroll.get(leafId);
    if (y != null) {
      entry.term.scrollToLine(y);
      savedScroll.delete(leafId);
    }
    if (opts.focus) entry.term.focus();
  });
  return entry;
}

/** Take a pane's terminal out of `host`, remembering what the DOM is about to forget. */
export function detach(leafId: string, host: HTMLElement): void {
  const entry = pool.get(leafId);
  if (!entry) return;
  savedScroll.set(leafId, entry.term.buffer.active.viewportY);
  if (entry.el.parentNode === host) host.removeChild(entry.el);
}

/** Scroll position parked across a detach/attach pair. */
const savedScroll = new Map<string, number>();

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
  savedScroll.delete(leafId);
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

/**
 * Right-click in a terminal: copy if something is selected, otherwise paste — the Windows Terminal
 * behaviour, and the reason a terminal doesn't need a context menu at all. Lives here rather than in
 * `TileTree` so every piece of xterm knowledge stays in one file.
 */
export async function copyOrPaste(leafId: string): Promise<void> {
  const term = pool.get(leafId)?.term;
  if (!term) return;
  if (term.hasSelection()) {
    await copyText(term.getSelection());
    term.clearSelection(); // feedback: the highlight going away is what says "copied"
    return;
  }
  const text = await pasteText();
  if (text) term.paste(text);
}
