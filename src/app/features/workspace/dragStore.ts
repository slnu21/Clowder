import { create } from "zustand";
import type { DropZone } from "./model";

/** MIME used for in-app pane drags. Its *presence* is the signal; the payload lives in this store. */
export const PANE_MIME = "application/x-clowder-pane";
/** MIME for explorer entries. Payload is JSON — see `useEntryDrag`. */
export const PATH_MIME = "application/x-clowder-path";

export type DragKind = "pane" | "path";

export type DragPayload =
  | { kind: "pane"; paneId: string }
  | { kind: "path"; path: string; isDir: boolean };

/**
 * Drag state, deliberately **its own store**.
 *
 * `dragover` fires ~60×/s. If this lived in `useWorkspace`, every one of those would re-render the whole
 * `TileTree` — and a remount mid-drag is exactly the thing this feature exists to avoid. Components
 * subscribe with scalar selectors so only the two panes that changed re-render.
 */
type DragState = {
  payload: DragPayload | null;
  overPaneId: string | null;
  zone: DropZone | null;
  begin: (payload: DragPayload) => void;
  over: (paneId: string, zone: DropZone) => void;
  /** Idempotent: `dragend` and `drop` both call it, and one of them may not fire at all. */
  end: () => void;
};

export const useDrag = create<DragState>((set) => ({
  payload: null,
  overPaneId: null,
  zone: null,
  begin: (payload) => set({ payload, overPaneId: null, zone: null }),
  over: (paneId, zone) => set({ overPaneId: paneId, zone }),
  end: () => set({ payload: null, overPaneId: null, zone: null }),
}));

/**
 * Safety net for a `dragend` that never arrives (dropping onto a non-target, or the OS cancelling).
 * Without it the overlay stays lit forever. Installed once at module load — the app has one window.
 */
if (typeof window !== "undefined") {
  const clear = () => useDrag.getState().end();
  window.addEventListener("dragend", clear);
  window.addEventListener("drop", clear);
}
