import { useEffect, useRef } from "react";
import { acquire } from "./terminalPool";

/**
 * A thin mount point for a pooled terminal. It attaches the leaf's persistent xterm host while
 * mounted and detaches it on unmount — it never disposes the terminal or closes the PTY. That lets a
 * pane survive splits and tab switches (the shell keeps running while its tab is hidden); teardown is
 * the store's job via `release`.
 */
export default function TerminalView({ leafId, cwd }: { leafId: string; cwd?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const entry = acquire(leafId, cwd);
    host.appendChild(entry.el);

    // Fit only once the host has a real size (Vite injects CSS from JS in dev, so the first tick can
    // measure a zero box). The observer also covers every later resize and tab reveal.
    const refit = () => {
      if (host.clientHeight > 0 && host.clientWidth > 0) entry.fit.fit();
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      ro.disconnect();
      if (entry.el.parentNode === host) host.removeChild(entry.el);
    };
  }, [leafId, cwd]);

  return <div className="terminal-host" ref={hostRef} />;
}
