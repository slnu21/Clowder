import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TINT_COUNT } from "./model";
import { useWorkspace } from "./store";

/**
 * The per-pane colour picker: a dot in the tile header that opens eight swatches plus "기본".
 *
 * Portalled to `body` with a fixed position anchored to the dot, the same shape `SettingsPopover` uses —
 * a pane header lives inside Allotment's transformed, overflow-clipped panes, so anything rendered in
 * place would be cut off by its own tile.
 */
export default function TintPicker({ paneId, tint }: { paneId: string; tint?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dotRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const setPaneTint = useWorkspace((s) => s.setPaneTint);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = dotRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: Math.max(6, r.right - 132) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Both refs, as in SettingsPopover: without the popover ref a click *inside* the popover counts as
    // "outside" and closes it before the swatch handler runs.
    const onDown = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (!dotRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (v: number | null) => {
    setPaneTint(paneId, v);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={dotRef}
        type="button"
        title="페인 색"
        className="tile-tint-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="tile-tint-dot" />
      </button>
      {open &&
        createPortal(
          <div className="tint-pop" ref={popRef} style={{ top: pos.top, left: pos.left }}>
            {Array.from({ length: TINT_COUNT }, (_, i) => i + 1).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={`색 ${v}`}
                aria-pressed={tint === v}
                className={"tint-sw" + (tint === v ? " on" : "")}
                style={{ ["--sw"]: `var(--tint-${v})` } as React.CSSProperties}
                onClick={() => pick(v)}
              />
            ))}
            <button type="button" className="tint-clear" onClick={() => pick(null)}>
              기본
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
