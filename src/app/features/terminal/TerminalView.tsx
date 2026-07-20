import { useEffect, useRef } from "react";
import { useWorkspace } from "../workspace/store";
import { attach, detach } from "./terminalPool";

/**
 * A thin mount point for a pooled terminal. It attaches the leaf's persistent xterm host while
 * mounted and detaches it on unmount — it never disposes the terminal or closes the PTY. That lets a
 * pane survive splits, tab switches **and moves** (the shell keeps running while its tab is hidden, or
 * while React remounts it under a new parent); teardown is the store's job via `release`.
 *
 * Everything that has to survive a move (refit, scrollback, focus) lives in the pool, not here — this
 * component only says when the host appears and disappears.
 */
export default function TerminalView({ leafId, cwd }: { leafId: string; cwd?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Read once, imperatively: subscribing would re-run this effect on every focus change and thrash
    // the very attachment we're protecting.
    const focus = useWorkspace.getState().activePaneId === leafId;
    const entry = attach(leafId, host, { cwd, focus });

    // The observer covers later resizes and tab reveals; the attach-time fit covers the move itself.
    const refit = () => {
      if (host.clientHeight > 0 && host.clientWidth > 0) entry.fit.fit();
    };
    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      ro.disconnect();
      detach(leafId, host);
    };
  }, [leafId, cwd]);

  return <div className="terminal-host" ref={hostRef} />;
}
