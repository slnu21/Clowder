import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { defaultShell, ptyClose, ptyResize, ptySpawn, ptyWrite } from "../../lib/tauri";

/**
 * One terminal pane: an xterm.js instance bound to a PTY in Rust.
 *
 * **No WebGL addon, deliberately.** xterm.js falls back to the DOM renderer when none is loaded,
 * and the WebGL renderer's glyph atlas mangles CJK inside WebView2 (cc-pane hit this and switched
 * its Windows default to DOM for the same reason). Not installing the addon at all means the choice
 * can't drift back by accident.
 */
export default function Terminal({ cwd }: { cwd?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let paneId: number | null = null;

    const term = new Xterm({
      fontFamily: '"D2Coding", "Cascadia Mono", Consolas, monospace',
      fontSize: 14,
      // Bounded on purpose: scrollback is the other place a flood turns into memory.
      scrollback: 5000,
      cursorBlink: true,
      theme: { background: "#16181d", foreground: "#d4d7dd" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Only fit once the host actually has a size. In dev, Vite injects CSS from JS, so this effect
    // can run before `.terminal { flex: 1 }` applies — fit() would then measure a zero-height box
    // and settle on ~0 rows. The observer covers both the arrival of the stylesheet and every later
    // resize. (This is a guard, not the fix for the cold-start blank — that was a PTY flush race in
    // pty.rs where the shell's opening prompt never left the coalescing buffer.)
    const refit = () => {
      if (host.clientHeight > 0 && host.clientWidth > 0) fit.fit();
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(host);

    (async () => {
      const shell = await defaultShell();
      if (disposed) return;

      // Bytes, not text — xterm.js stitches partial UTF-8 sequences across writes.
      const id = await ptySpawn(
        { shell, cwd, cols: term.cols, rows: term.rows },
        (bytes) => term.write(bytes),
      );
      if (disposed) {
        void ptyClose(id);
        return;
      }
      paneId = id;
      term.onData((d) => void ptyWrite(id, d));
      term.onResize(({ cols, rows }) => void ptyResize(id, cols, rows));
    })();

    return () => {
      disposed = true;
      ro.disconnect();
      if (paneId !== null) void ptyClose(paneId);
      term.dispose();
    };
  }, [cwd]);

  return <div className="terminal" ref={hostRef} />;
}
