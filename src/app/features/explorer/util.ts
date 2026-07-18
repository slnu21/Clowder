import type { Entry } from "../../lib/tauri";
import { findLeaf, firstTerminalCwd } from "../workspace/model";
import { useWorkspace } from "../workspace/store";

/** Directories first, then files, each alphabetical (case-insensitive). */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Parent of a Windows path. A drive root (`C:\`) returns `null` — the caller shows the roots screen. */
export function parentOf(p: string): string | null {
  const norm = p.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(norm)) return null; // drive root → 내 컴퓨터
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (idx <= 0) return null;
  const parent = norm.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? parent + "\\" : parent; // keep "C:\" not "C:"
}

/**
 * The folder the workspace tab scopes to: the active pane's terminal cwd if it has one, else the
 * active tab's first terminal. `undefined` when no terminal in view was launched in a folder.
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
