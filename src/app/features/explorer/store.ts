import { create } from "zustand";

/**
 * A one-shot "show me this folder" request for the explorer panel.
 *
 * The 탐색기 tab owns its own cwd and listing, and it should keep owning them — the panel knows how to
 * fall back when a directory turns out to be unreadable, and lifting that into a global store would
 * mean re-deriving it. So this carries an *intent*, not state: something elsewhere (a clicked path in
 * terminal output) asks for a folder, `FolderNav` navigates there the way it always does.
 *
 * The nonce is what makes it one-shot — asking for the folder you are already looking at still has to
 * fire, and an unchanged `path` alone wouldn't.
 */
type ExplorerState = {
  request: { path: string; nonce: number } | null;
  reveal: (path: string) => void;
};

export const useExplorer = create<ExplorerState>((set) => ({
  request: null,
  reveal: (path) => set((s) => ({ request: { path, nonce: (s.request?.nonce ?? 0) + 1 } })),
}));
