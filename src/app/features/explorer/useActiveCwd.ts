import { findLeaf, firstTerminalCwd } from "../workspace/model";
import { useWorkspace } from "../workspace/store";

/**
 * The folder the workspace tab scopes to: the active pane's terminal cwd if it has one, else the
 * active tab's first terminal. `undefined` when no terminal in view was launched in a folder.
 *
 * Kept out of `util.ts` so that file stays a leaf: this hook reaches the workspace store, which pulls
 * in the terminal pool and `@xterm/xterm` (plus its CSS import) behind it, and the vitest run for
 * `sortEntries`/`parentOf` is a plain node environment with no DOM.
 */
export function useActiveCwd(): string | undefined {
  return useWorkspace((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return undefined;
    const active = s.activePaneId ? findLeaf(tab.root, s.activePaneId) : undefined;
    if (active?.content === "terminal" && active.cwd) return active.cwd;
    return firstTerminalCwd(tab.root);
  });
}
