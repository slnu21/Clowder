import { create } from "zustand";
import { useSettings } from "../settings/store";
import { focusPane, release } from "../terminal/terminalPool";
import {
  basename,
  collectLeafIds,
  Direction,
  DropZone,
  findLeaf,
  firstLeafId,
  Leaf,
  makeTerminalLeaf,
  makeViewerLeaf,
  moveLeaf,
  nextId,
  nextTint,
  Node,
  removeLeaf,
  setLeafProps,
  setSizes,
  splitLeaf,
  splitLeafAt,
  Tab,
  updateLeaf,
} from "./model";

/** Label for a shell-less terminal (no launch folder) — reflects the configured shell, not a fixed
 * "bash". Read at creation time, matching how font/scrollback apply to newly opened terminals. */
function shellLabel(): string {
  return useSettings.getState().settings.shell === "powershell" ? "PowerShell" : "bash";
}

function newTerminalTab(cwd?: string): Tab {
  const label = shellLabel();
  const leaf = makeTerminalLeaf(cwd, label);
  return { id: nextId("tab"), title: cwd ? basename(cwd) : label, root: leaf };
}

type State = {
  tabs: Tab[];
  activeTabId: string;
  /** The pane a split/close acts on and that focus follows. */
  activePaneId: string | null;

  setActiveTab: (tabId: string) => void;
  setActivePane: (paneId: string) => void;
  /** Reveal and focus a specific leaf wherever it lives (a session row clicking through to its pane). */
  focusLeaf: (leafId: string) => void;
  /** From the explorer: every "open terminal here" is its own tab. */
  openTerminalTab: (cwd: string) => void;
  /** Open a document (md/html) as its own viewer tab; re-focus an existing tab for the same path. */
  openViewerTab: (path: string, kind: "md" | "html") => void;
  newTab: () => void;
  closeTab: (tabId: string) => void;
  splitPane: (paneId: string, dir: Direction) => void;
  /** Split `paneId` and put an arbitrary leaf in the new slot (viewer drops, link opens). */
  splitPaneWith: (paneId: string, dir: Direction, leaf: Leaf, side?: "before" | "after") => void;
  /** Move a pane beside another. No-op when the drop wouldn't change anything. */
  movePane: (sourceId: string, targetId: string, zone: DropZone) => void;
  /** Lift a pane out into a tab of its own (drop on empty tab-strip space). */
  detachPaneToNewTab: (paneId: string) => void;
  /** Point an existing viewer pane at a different document. Terminals are never retargeted. */
  retargetViewer: (paneId: string, path: string, kind: "md" | "html") => void;
  /** Set a pane's colour deliberately; `null` returns it to the automatic (unfilled) state. */
  setPaneTint: (paneId: string, tint: number | null) => void;
  closePane: (paneId: string) => void;
  updateSizes: (splitId: string, sizes: number[]) => void;
};

export const useWorkspace = create<State>((set, get) => ({
  // Start empty — the workspace shows a welcome screen until the user opens a terminal or a file.
  // (No forced first terminal; that was the old behaviour item 2 asked to remove.)
  tabs: [],
  activeTabId: "",
  activePaneId: null,

  setActiveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    set({ activeTabId: tabId, activePaneId: firstLeafId(tab.root) });
  },

  setActivePane: (paneId) => {
    set({ activePaneId: paneId });
    focusPane(paneId);
  },

  focusLeaf: (leafId) => {
    const tab = get().tabs.find((t) => collectLeafIds(t.root).includes(leafId));
    if (!tab) return; // pane already closed — the session's shell outlived its tile
    set({ activeTabId: tab.id, activePaneId: leafId });
    focusPane(leafId);
  },

  openTerminalTab: (cwd) => {
    const tab = newTerminalTab(cwd);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activePaneId: firstLeafId(tab.root) }));
  },

  openViewerTab: (path, kind) => {
    const s = get();
    // Re-focus an already-open single-pane viewer for this file rather than stacking duplicates.
    const existing = s.tabs.find((t) => t.root.kind === "leaf" && t.root.path === path);
    if (existing) {
      set({ activeTabId: existing.id, activePaneId: existing.root.id });
      return;
    }
    const leaf = makeViewerLeaf(path, kind);
    const tab: Tab = { id: nextId("tab"), title: leaf.title, root: leaf };
    set({ tabs: [...s.tabs, tab], activeTabId: tab.id, activePaneId: leaf.id });
  },

  newTab: () => {
    const tab = newTerminalTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activePaneId: firstLeafId(tab.root) }));
  },

  closeTab: (tabId) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    // Free every shell this tab owned before dropping it.
    for (const leafId of collectLeafIds(tab.root)) release(leafId);

    const tabs = s.tabs.filter((t) => t.id !== tabId);
    if (tabs.length === 0) {
      set({ tabs, activeTabId: "", activePaneId: null }); // last tab closed → back to welcome
      return;
    }

    let { activeTabId } = s;
    if (activeTabId === tabId) {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      activeTabId = (tabs[Math.min(idx, tabs.length - 1)] ?? tabs[0]).id;
    }
    const active = tabs.find((t) => t.id === activeTabId)!;
    set({ tabs, activeTabId, activePaneId: firstLeafId(active.root) });
  },

  splitPane: (paneId, dir) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const target = findLeaf(tab.root, paneId);
    if (!target) return;
    // A split inherits the pane's cwd — splitting a project terminal gives you another in the same dir.
    const leaf = makeTerminalLeaf(target.cwd, shellLabel());
    // Colour arrives the moment a tab stops being a single pane — that's when "which one is which"
    // starts to cost something, and a lone terminal shouldn't be decorated for nothing. The pane being
    // split is coloured first so the newcomer's index is computed against it.
    const seeded = target.tint ? tab.root : setLeafProps(tab.root, paneId, { tint: nextTint(tab.root) });
    leaf.tint = nextTint(seeded);
    const root = splitLeaf(seeded, paneId, dir, leaf);
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)),
      activePaneId: leaf.id,
    });
  },

  splitPaneWith: (paneId, dir, leaf, side = "after") => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || !findLeaf(tab.root, paneId)) return;
    const target = findLeaf(tab.root, paneId)!;
    const seeded = target.tint ? tab.root : setLeafProps(tab.root, paneId, { tint: nextTint(tab.root) });
    const placed: Leaf = leaf.tint ? leaf : { ...leaf, tint: nextTint(seeded) };
    const root = splitLeafAt(seeded, paneId, dir, placed, side);
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)),
      activePaneId: placed.id,
    });
  },

  // ⚠️ INVARIANT for movePane / detachPaneToNewTab / splitPaneWith / retargetViewer:
  // **never call `release()`**. These reshape the tree around a pane that is still running. Writing
  // detach as "closePane + openTerminalTab" is the tempting version and it kills the shell.
  movePane: (sourceId, targetId, zone) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const root = moveLeaf(tab.root, sourceId, targetId, zone);
    if (!root) return; // no-op drop: don't churn the tree (or Allotment) for nothing
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)),
      activePaneId: sourceId,
    });
  },

  detachPaneToNewTab: (paneId) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, paneId);
    if (!leaf) return;
    const pruned = removeLeaf(tab.root, paneId);
    if (!pruned) return; // the tab's only pane — detaching it would just re-create the same tab
    const fresh: Tab = { id: nextId("tab"), title: leaf.title, root: leaf };
    set({
      tabs: [...s.tabs.map((t) => (t.id === tab.id ? { ...t, root: pruned } : t)), fresh],
      activeTabId: fresh.id,
      activePaneId: leaf.id,
    });
  },

  retargetViewer: (paneId, path, kind) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, paneId);
    // Guard, not a formality: turning a terminal leaf into a viewer orphans its pool entry and the
    // shell survives forever with nothing able to reach it.
    if (!leaf || leaf.content === "terminal") return;
    const root = updateLeaf(tab.root, paneId, { content: kind, path, title: basename(path) });
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)) });
  },

  setPaneTint: (paneId, tint) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    // `tintFill` is the record that a human chose this, and that is what earns the filled header.
    // Clearing goes all the way back to "no colour at all", not to some default colour.
    const root = setLeafProps(tab.root, paneId, {
      tint: tint ?? undefined,
      tintFill: tint != null ? true : undefined,
    });
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)) });
  },

  closePane: (paneId) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab) return;
    const root: Node | undefined = removeLeaf(tab.root, paneId);
    release(paneId);
    if (!root) {
      get().closeTab(tab.id); // last pane gone → close the tab
      return;
    }
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)),
      activePaneId: firstLeafId(root),
    });
  },

  updateSizes: (splitId, sizes) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, root: setSizes(t.root, splitId, sizes) } : t)),
    }));
  },
}));
