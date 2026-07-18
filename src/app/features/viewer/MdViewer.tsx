import { useEffect, useRef, useState } from "react";
import { createMarkdown } from "../../lib/markdown";
import { renderMermaid } from "../../lib/mermaid";
import { dirOf, inlineImages } from "../../lib/previewImages";
import { buildDoc } from "../../lib/renderDoc";
import { sanitizeHtml } from "../../lib/sanitize";
import { readFile } from "../../lib/tauri";

/**
 * Markdown viewer: read the file, render (markdown-it → DOMPurify → relative-image inline → mermaid),
 * and inject the self-contained document into a **script-less sandbox iframe** (`allow-same-origin`
 * only — never `allow-scripts`). Harvested from md-reader's Preview, minus the editor machinery it
 * had (no worker, scroll-sync, TOC, or font settings) since deck only reads.
 */
export default function MdViewer({ path }: { path: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const src = await readFile(path);
        if (cancelled) return;
        const md = createMarkdown();
        const clean = sanitizeHtml(md.render(src));
        const withImg = await inlineImages(clean, dirOf(path));
        const body = await renderMermaid(withImg);
        if (cancelled) return;
        const iframe = iframeRef.current;
        if (iframe) iframe.srcdoc = buildDoc(body, "img{cursor:zoom-in}.md{max-width:880px;margin:0 auto}");
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Esc closes the image lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // same-origin (no scripts) lets us attach listeners without injecting script into the frame.
  const onLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener("contextmenu", (e) => e.preventDefault());
    doc.addEventListener("click", (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "IMG") {
        const src = (el as HTMLImageElement).currentSrc || el.getAttribute("src") || "";
        if (src) setLightbox(src);
      }
    });
  };

  if (error) return <div className="viewer-error">열기 실패: {error}</div>;
  return (
    <div className="viewer">
      <iframe ref={iframeRef} className="viewer-frame" sandbox="allow-same-origin" title={path} onLoad={onLoad} />
      {lightbox && (
        <div className="lightbox" role="dialog" aria-label="image" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}
