import { create } from "zustand";
import { focusPane, release } from "../terminal/terminalPool";
import {
  basename,
  collectLeafIds,
  Direction,
  findLeaf,
  firstLeafId,
  makeTerminalLeaf,
  makeViewerLeaf,
  nextId,
  Node,
  removeLeaf,
  setSizes,
  splitLeaf,
  Tab,
} from "./model";

function newTerminalTab(cwd?: string): Tab {
  const leaf = makeTerminalLeaf(cwd);
  return { id: nextId("tab"), title: cwd ? basename(cwd) : "bash", root: leaf };
}

const firstTab = newTerminalTab();

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
  closePane: (paneId: string) => void;
  updateSizes: (splitId: string, sizes: number[]) => void;
};

export const useWorkspace = create<State>((set, get) => ({
  tabs: [firstTab],
  activeTabId: firstTab.id,
  activePaneId: firstLeafId(firstTab.root),

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

    let tabs = s.tabs.filter((t) => t.id !== tabId);
    if (tabs.length === 0) tabs = [newTerminalTab()]; // always keep one tab open

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
    const leaf = makeTerminalLeaf(target.cwd);
    const root = splitLeaf(tab.root, paneId, dir, leaf);
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)),
      activePaneId: leaf.id,
    });
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
