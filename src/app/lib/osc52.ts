/**
 * OSC 52 — `ESC ] 52 ; Pc ; Pd ST`, the sequence a program uses to put text on the host clipboard.
 *
 * **Why this exists at all.** A fullscreen TUI is talking to a pipe, not a window; it cannot reach the
 * system clipboard itself. OSC 52 is how tmux, vim and Claude Code ask the terminal to do it. This app
 * registered exactly one OSC handler (7, for cwd), and xterm 6.0.0's core registers 0·1·2·4·8·10·11·12·
 * 104·110·111·112 — **not 52**. An unhandled OSC sequence is silently discarded by the parser, so the
 * clipboard was never written and nothing was printed either: the only visible symptom was the TUI's own
 * "copied" message being a lie.
 *
 * Split out as a pure function (like `osc7ToPath`) so the parsing and the refusal rules can be tested
 * without a terminal.
 */

/** Cap on the base64 payload — ~750KB of text. A runaway program shouldn't get to allocate freely. */
export const OSC52_MAX_B64 = 1_000_000;

/**
 * Is this a **read** request (`Pd` = `?`) — the program asking for the clipboard's contents?
 *
 * Always refused, and the asymmetry with writes is the point. Letting a program *set* the clipboard is
 * the standard terminal bargain, and the user asked for it by selecting text. Letting one *read* it would
 * let anything running in any pane — including a shell at the far end of an ssh session — exfiltrate
 * whatever was last copied, which could be a password. No user intent balances that.
 *
 * Exported and checked separately for a reason: `atob("?")` throws anyway, so folding this into the
 * decode path would make the guard **untestable** — remove it and every test still passes, because the
 * base64 decoder happens to reject `?` too. A guard that can't be shown to do anything is a guard that
 * gets deleted by the next person. This one fails a test of its own if it stops working.
 */
export function isOsc52ReadRequest(data: string): boolean {
  const semi = data.indexOf(";");
  return semi >= 0 && data.slice(semi + 1) === "?";
}

/**
 * The text an OSC 52 payload asks to put on the clipboard, or `null` when the request must be ignored.
 *
 * `data` is everything after `52;` — i.e. `Pc ; Pd`. `Pc` (the target: `c`, `p`, `s`, `0`-`7`, or empty)
 * is deliberately **not** distinguished: Windows has no primary selection, so every target is the one
 * clipboard.
 *
 * Refused: read requests (above), missing separator, empty payload, over the size cap, malformed base64.
 */
export function osc52ToText(data: string, maxB64: number = OSC52_MAX_B64): string | null {
  if (isOsc52ReadRequest(data)) return null;
  const semi = data.indexOf(";");
  if (semi < 0) return null;
  const payload = data.slice(semi + 1);
  if (!payload || payload.length > maxB64) return null;
  return b64ToText(payload);
}

/**
 * base64 → text, **through bytes**. `atob` gives one character per byte, so a Korean syllable arrives as
 * three separate characters; decoding those as UTF-8 is the only way back to the string the program sent.
 * (The same reason PTY output is piped as bytes and never through a Rust `String` — see `pty.rs`.)
 *
 * `fatal: false` is deliberate: a program that base64s Latin-1 shouldn't lose the whole copy, it should
 * get replacement characters where it went wrong.
 */
function b64ToText(b64: string): string | null {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null; // malformed base64 is the program's bug, not something to throw over
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const text = new TextDecoder().decode(bytes);
  return text || null;
}
