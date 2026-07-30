import { useEffect, useRef } from "react";

/**
 * When the window last lost focus. One listener for the whole app; every hook instance reads it.
 *
 * Module scope rather than per-hook state on purpose: "how long was the app in the background" is a
 * property of the window, not of any one panel, and eight panels each tracking it would be eight
 * answers to the same question.
 */
let blurAt = 0;
window.addEventListener("blur", () => {
  blurAt = Date.now();
});

export type FocusRefreshOptions = {
  /** Skip the refresh if the window was away for less than this. A glance elsewhere changes nothing. */
  minBackgroundMs?: number;
  /** Never re-run more often than this, however many focus events arrive. */
  throttleMs?: number;
};

/**
 * Re-run `fn` when the window regains focus — but only if it was actually away long enough for the
 * answer to have changed, and never more often than `throttleMs`.
 *
 * **Why the guards exist.** Every rail panel used to hang a bare `window.addEventListener("focus", …)`
 * — eight of them, with no conditions — so a one-second alt-tab re-ran the lot. On a machine with
 * docker and kubectl installed that is four external processes per focus, and back when those commands
 * still ran on the main thread it froze typing for seconds: `pty_write` sat queued behind a probe
 * nobody asked for. Moving the commands off that thread (see `lib.rs`) is the safety net; this is the
 * policy — the cheapest fix for work that didn't need doing is not doing it.
 *
 * Mounting does **not** refresh: callers already fetch on mount, and the right dependencies for that
 * differ per panel (`[]` for ports, `[cwd]` for git). `lastRun` starts at mount time so that first
 * fetch also counts against the throttle.
 *
 * `fn` is held in a ref, so passing an inline closure — or one that depends on `cwd` — does not
 * re-register the listener on every render. GitPanel and TaskPanel used to tear theirs down and rebuild
 * it on every `cd`.
 */
export function useFocusRefresh(fn: () => void, opts: FocusRefreshOptions = {}): void {
  const { minBackgroundMs = 1500, throttleMs = 3000 } = opts;
  const latest = useRef(fn);
  latest.current = fn;
  const lastRun = useRef(Date.now());

  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - blurAt < minBackgroundMs) return;
      if (now - lastRun.current < throttleMs) return;
      lastRun.current = now;
      latest.current();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [minBackgroundMs, throttleMs]);
}
