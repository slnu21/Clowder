/**
 * Recovering a terminal that a killed TUI left behind.
 *
 * A fullscreen TUI (Claude Code among them) turns on terminal modes when it starts — mouse tracking,
 * the alternate screen, a hidden cursor — and turns them off when it exits. **When it is killed instead**
 * (`TerminateProcess`; a security product did it in the reported case) nobody turns them off: ConPTY
 * passes the modes through verbatim and does not undo them when the client dies (measured — see the
 * 2026-10-06 devlog). The shell comes back to a terminal still in TUI mode:
 *
 * - **mouse tracking on**: every mouse move sends `\e[<35;x;yM`; readline doesn't know it, rings the bell
 *   and types `35;x;yM` into the line. The line grows with every move and readline redraws all of it each
 *   time — that is the CPU climbing until the machine slows down.
 * - **alternate screen + hidden cursor**: the prompt is drawn into the dead TUI's last frame with no
 *   visible cursor, which reads as "frozen".
 *
 * The signal that the TUI is gone is the shell's prompt: both shells emit OSC 7 right before it (see
 * `pty::build_command`), and **no TUI is in the foreground while a shell prompt is drawn**. So at OSC 7
 * we look for modes only a TUI would hold and, if any is up, put them down.
 *
 * Deliberately **not** touched:
 * - `?1004` focus reporting — ConPTY turns it on itself at startup (`\e[?1004h\e[?9001h`) for its own
 *   focus tracking. Turning it off would break that, for every pane, forever.
 * - `?2004` bracketed paste — readline turns it on at every prompt; it is the shell's mode, not the TUI's.
 */

/** The slice of xterm state the decision needs — plain data so it can be tested without a terminal. */
export type TermModes = {
  /** `term.modes.mouseTrackingMode`. */
  mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any";
  /** `term.buffer.active.type`. */
  bufferType: "normal" | "alternate";
};

/** True when a shell prompt is being drawn over modes only a (now dead) TUI would have left on. */
export function isStranded(m: TermModes): boolean {
  return m.mouseTrackingMode !== "none" || m.bufferType === "alternate";
}

const MOUSE_OFF =
  "\x1b[?1000l" + // vt200 (press/release)
  "\x1b[?1002l" + // drag
  "\x1b[?1003l" + // any motion
  "\x1b[?1006l" + // SGR encoding
  "\x1b[?1016l"; // SGR-pixels encoding

/**
 * What to write into xterm (not the PTY — this is the terminal's own state) to undo a stranded TUI.
 *
 * `leftAltScreen` says whether the prompt that triggered this was drawn on the alternate screen: our
 * write lands **after** the chunk being parsed, so leaving the alternate screen takes that prompt with it
 * and the caller has to ask the shell to draw it again.
 */
export function recoverySequence(m: TermModes): { seq: string; leftAltScreen: boolean } {
  const leftAltScreen = m.bufferType === "alternate";
  const seq =
    MOUSE_OFF +
    (leftAltScreen ? "\x1b[?1049l" : "") + // back to the normal buffer, cursor restored to where the TUI saved it
    "\x1b[?2026l" + // end a synchronized-output frame the TUI may have opened and never closed
    "\x1b[?25h"; // cursor visible
  return { seq, leftAltScreen };
}

/** Ctrl+L: bash (readline) and PowerShell (PSReadLine) both clear the screen and redraw the prompt. */
export const REDRAW_PROMPT = "\x0c";

/**
 * Keys that empty the shell's input line, wherever the cursor is in it — sent by the manual reset
 * before `REDRAW_PROMPT`.
 *
 * Clearing the screen is not enough: what a stranded mouse typed (`35;10;5M…`) lives in the **line
 * editor's buffer**, not on the screen, and Ctrl+L redraws the prompt *with* that buffer. Each line
 * editor needs its own keys, and neither shell understands the other's (measured through ConPTY with
 * the cursor mid-line — see the 2026-10-06 devlog):
 * - readline: Ctrl+E (end of line), Ctrl+U (kill to start).
 * - PSReadLine, Windows mode: End, then Ctrl+Home (`BackwardDeleteInput`). Ctrl+E/Ctrl+U do nothing.
 *
 * Unknown shells (cmd) get nothing rather than a guess: a key a line editor doesn't know may be
 * inserted as text, which is the problem being fixed.
 */
export function clearLineKeys(shell: string | null): string {
  const s = (shell ?? "").toLowerCase();
  if (s.endsWith("bash.exe")) return "\x05\x15";
  if (s.endsWith("powershell.exe") || s.endsWith("pwsh.exe")) return "\x1b[F\x1b[1;5H";
  return "";
}

/**
 * Re-asserted after a manual full reset (`term.reset()` is RIS and clears **every** mode). Focus reporting
 * belongs to ConPTY, which asked for it once at startup and will not ask again — see the note above.
 */
export const AFTER_FULL_RESET = "\x1b[?1004h";
