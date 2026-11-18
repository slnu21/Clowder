import type { MsgKey } from "./i18n";

/**
 * Resuming an agent session = a terminal tab in the session's folder running the agent's own resume
 * command. Pure, so the one place a session id meets a shell line is tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shell line that resumes `sessionId`, or `null` when it can't be built safely. The id comes from a
 * file name on disk and is typed into a shell, so anything but a bare UUID is refused here — Rust
 * filters the same way, and this is the check that sits next to the command line.
 *
 * `claude -r <id>` continues under the **same** id (`--fork-session` is the opt-out), which is what
 * lets the live card come back instead of a new one appearing.
 */
export function resumeCommand(agent: string, sessionId: string): string | null {
  if (!UUID.test(sessionId)) return null;
  switch (agent) {
    case "claude":
      return `claude -r ${sessionId}`;
    default:
      return null;
  }
}

/** "How long ago", as a catalogue key plus count — resolved by the caller so it follows the language. */
export type Ago = { key: MsgKey; n?: number };

/** Coarse relative time for a list row. A clock skew into the future reads as "just now". */
export function ago(thenMs: number, nowMs: number): Ago {
  const min = Math.floor(Math.max(0, nowMs - thenMs) / 60_000);
  if (min < 1) return { key: "recent.justNow" };
  if (min < 60) return { key: "recent.minutesAgo", n: min };
  const h = Math.floor(min / 60);
  if (h < 24) return { key: "recent.hoursAgo", n: h };
  return { key: "recent.daysAgo", n: Math.floor(h / 24) };
}
