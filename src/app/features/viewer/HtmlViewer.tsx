import { useEffect, useRef, useState } from "react";
import { sanitizeDocument } from "../../lib/sanitize";
import { readFile } from "../../lib/tauri";

/**
 * HTML viewer (new — md-reader only *exports* HTML, never opens it). Reads the file, strips scripts
 * and event handlers with DOMPurify, and shows the result in a **script-less sandbox iframe**
 * (`allow-same-origin`, never `allow-scripts`). So this is a *static* preview: a self-contained
 * artifact (inline styles, data-URI assets) renders fully; anything relying on JS or relative files
 * is inert by design. Interactive HTML belongs in a real browser.
 */
export default function HtmlViewer({ path }: { path: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await readFile(path);
        if (cancelled) return;
        const iframe = iframeRef.current;
        if (iframe) iframe.srcdoc = sanitizeDocument(raw);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const onLoad = () => {
    iframeRef.current?.contentDocument?.addEventListener("contextmenu", (e) => e.preventDefault());
  };

  if (error) return <div className="viewer-error">열기 실패: {error}</div>;
  return (
    <div className="viewer">
      <iframe ref={iframeRef} className="viewer-frame" sandbox="allow-same-origin" title={path} onLoad={onLoad} />
    </div>
  );
}
