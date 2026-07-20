/**
 * The workspace layout model: a tab holds a tree of panes, split recursively.
 *
 * Everything here is **pure and immutable** — the store swaps whole trees rather than mutating, so
 * React reconciles by node `id` (stable across a split elsewhere in the tree) and the terminal pool
 * keeps a pane's shell alive regardless of how the tree is reshaped around it. No serialization: the
 * whole model lives in memory for the session (session restore is explicitly out of v1 scope).
 */

export type Direction = "row" | "column";

/** A leaf can hold any of these; only `terminal` is wired in M4, md/html land in M6. */
export type LeafKind = "terminal" | "md" | "html";

export type Leaf = {
  kind: "leaf";
  id: string;
  content: LeafKind;
  title: string;
  /** Terminal working directory (spawn cwd, never a `cd` injection). */
  cwd?: string;
  /** md/html file path (M6). */
  path?: string;
  /** Palette index 1..TINT_COUNT. Auto-assigned on split so siblings are told apart at a glance. */
  tint?: number;
  /** The user picked this colour deliberately — only then does the head get a fill. */
  tintFill?: boolean;
};

export type Split = {
  kind: "split";
  id: string;
  dir: Direction;
  children: Node[];
  /** Pixel sizes captured from Allotment's onChange; used to restore proportions across remounts. */
  sizes?: number[];
};

export type Node = Leaf | Split;

export type Tab = {
  id: string;
  title: string;
  root: Node;
};

let counter = 0;
/** Monotonic per-session id. A counter (not a UUID) keeps ids short and debuggable in the DOM. */
export const nextId = (prefix: string): string => `${prefix}${++counter}`;

/** Last path segment, for a terminal tab/pane title. Handles both separators and trailing slashes. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const seg = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return seg.length > 0 ? seg : trimmed; // a drive root like "C:\" has no segment
}

export function makeTerminalLeaf(cwd?: string, fallbackTitle = "bash"): Leaf {
  return { kind: "leaf", id: nextId("p"), content: "terminal", cwd, title: cwd ? basename(cwd) : fallbackTitle };
}

/** How many `--tint-N` tokens exist (see App.css). */
export const TINT_COUNT = 8;

/**
 * The lowest palette index not already used **in this tab**.
 *
 * Tab-scoped rather than a module counter: closing a pane hands its colour back, so close-then-split
 * doesn't march the palette forward forever. Past the palette size it wraps — eight distinguishable
 * panes is already more than one screen wants.
 */
export function nextTint(root: Node): number {
  const used = new Set<number>();
  const walk = (n: Node): void => {
    if (n.kind === "leaf") {
      if (n.tint) used.add(n.tint);
      return;
    }
    n.children.forEach(walk);
  };
  walk(root);
  for (let i = 1; i <= TINT_COUNT; i++) if (!used.has(i)) return i;
  return (used.size % TINT_COUNT) + 1;
}

export function makeViewerLeaf(path: string, content: "md" | "html"): Leaf {
  return { kind: "leaf", id: nextId("p"), content, path, title: basename(path) };
}

/** Which viewer (if any) opens a file, by extension. `null` = not a viewable document. */
export function viewerKindFor(name: string): "md" | "html" | null {
  if (/\.(md|markdown|mdx|txt)$/i.test(name)) return "md";
  if (/\.html?$/i.test(name)) return "html";
  return null;
}

export function findLeaf(node: Node, id: string): Leaf | undefined {
  if (node.kind === "leaf") return node.id === id ? node : undefined;
  for (const c of node.children) {
    const hit = findLeaf(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Left-most leaf — the fallback for "which pane is active" after a structural change. */
export function firstLeafId(node: Node): string {
  return node.kind === "leaf" ? node.id : firstLeafId(node.children[0]);
}

export function collectLeafIds(node: Node, acc: string[] = []): string[] {
  if (node.kind === "leaf") acc.push(node.id);
  else for (const c of node.children) collectLeafIds(c, acc);
  return acc;
}

/**
 * cwd of the first terminal leaf in a tree — used to scope the workspace explorer tab to the folder a
 * terminal was launched in. `undefined` if no terminal in the tree has a cwd (e.g. a blank `새 탭`).
 */
export function firstTerminalCwd(node: Node): string | undefined {
  if (node.kind === "leaf") return node.content === "terminal" ? node.cwd : undefined;
  for (const c of node.children) {
    const cwd = firstTerminalCwd(c);
    if (cwd) return cwd;
  }
  return undefined;
}

/**
 * Replace leaf `targetId` with a split of `[thatLeaf, newLeaf]`. Branches that don't contain the
 * target are rebuilt with the SAME `id`, so React keeps their subtrees (and Allotment its sizes).
 */
export function splitLeafAt(
  node: Node,
  targetId: string,
  dir: Direction,
  newNode: Node,
  side: "before" | "after",
): Node {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    const children = side === "before" ? [newNode, node] : [node, newNode];
    return { kind: "split", id: nextId("s"), dir, children };
  }
  return { ...node, children: node.children.map((c) => splitLeafAt(c, targetId, dir, newNode, side)) };
}

/** The original two-argument split — every existing call site keeps working unchanged. */
export const splitLeaf = (node: Node, targetId: string, dir: Direction, newLeaf: Leaf): Node =>
  splitLeafAt(node, targetId, dir, newLeaf, "after");

/** Patch one leaf in place (immutably). `undefined` in the patch clears the field. */
export function setLeafProps(node: Node, targetId: string, patch: Partial<Leaf>): Node {
  if (node.kind === "leaf") return node.id === targetId ? { ...node, ...patch } : node;
  return { ...node, children: node.children.map((c) => setLeafProps(c, targetId, patch)) };
}

/**
 * Remove leaf `targetId`. A split left with one child collapses into that child; removing the last
 * leaf returns `undefined` (the caller closes the now-empty tab). Sizes are dropped on the affected
 * split so the survivors redistribute evenly.
 */
export function removeLeaf(node: Node, targetId: string): Node | undefined {
  if (node.kind === "leaf") return node.id === targetId ? undefined : node;
  const kids = node.children
    .map((c) => removeLeaf(c, targetId))
    .filter((c): c is Node => c !== undefined);
  if (kids.length === 0) return undefined;
  if (kids.length === 1) return kids[0];
  const removed = kids.length !== node.children.length;
  return { ...node, children: kids, sizes: removed ? undefined : node.sizes };
}

// ── moving a pane ──────────────────────────────────────────────────────────────────────────────

/** Where inside a pane a drop landed. `center` is deliberately not a move — see `moveLeaf`. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** The split that has `childId` as a direct child, if any. */
function parentSplit(node: Node, childId: string): Split | undefined {
  if (node.kind === "leaf") return undefined;
  if (node.children.some((c) => c.id === childId)) return node;
  for (const c of node.children) {
    const found = parentSplit(c, childId);
    if (found) return found;
  }
  return undefined;
}

/** Swap one node for another by id, rebuilding only the branch that contains it. */
function replaceNode(node: Node, id: string, next: Node): Node {
  if (node.id === id) return next;
  if (node.kind === "leaf") return node;
  return { ...node, children: node.children.map((c) => replaceNode(c, id, next)) };
}

/** Reorder `sizes` the same way the children were reordered, so a sibling move keeps its proportions. */
function permuteSizes(sizes: number[] | undefined, from: number, to: number): number[] | undefined {
  if (!sizes || sizes.length === 0) return undefined;
  const next = sizes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const ZONE_DIR: Record<Exclude<DropZone, "center">, Direction> = {
  left: "row",
  right: "row",
  top: "column",
  bottom: "column",
};

/**
 * Move leaf `sourceId` next to `targetId` on the given side. Returns the new root, or `null` when the
 * move is a no-op (same pane, already in that position, or `center`).
 *
 * **`center` is not a swap.** There's no affordance for it, so the result is always a surprise; VS Code,
 * iTerm and tmux all read a centre drop as "into this container", not "trade places". Leaving it unused
 * also frees it as the primary target for explorer drops, so the two drag sources never fight over the
 * same overlay region.
 *
 * The sibling fast-path is the reason this isn't just remove-then-split: when the source and target
 * already share a split of the same direction, reordering the children array preserves the split's id
 * **and** its sizes, so Allotment neither remounts nor forgets the layout the user dragged out.
 */
export function moveLeaf(root: Node, sourceId: string, targetId: string, zone: DropZone): Node | null {
  if (zone === "center" || sourceId === targetId) return null;
  const dir = ZONE_DIR[zone];
  const before = zone === "left" || zone === "top";

  const parent = parentSplit(root, sourceId);
  if (parent && parent.dir === dir && parent.children.some((c) => c.id === targetId)) {
    const from = parent.children.findIndex((c) => c.id === sourceId);
    const targetIdx = parent.children.findIndex((c) => c.id === targetId);
    // Index of the target *after* the source is lifted out — inserting before/after is relative to that.
    const to = (targetIdx > from ? targetIdx - 1 : targetIdx) + (before ? 0 : 1);
    if (to === from) return null; // already exactly there
    const children = parent.children.slice();
    const [moved] = children.splice(from, 1);
    children.splice(to, 0, moved);
    return replaceNode(root, parent.id, {
      ...parent,
      children,
      sizes: permuteSizes(parent.sizes, from, to),
    });
  }

  const source = findLeaf(root, sourceId);
  if (!source) return null;
  // Split the **pruned** tree, never the original: applying it to `root` leaves the source in two
  // places at once, which shows up much later as a duplicated pane id.
  const pruned = removeLeaf(root, sourceId);
  if (!pruned || !findLeaf(pruned, targetId)) return null;
  return splitLeafAt(pruned, targetId, dir, source, before ? "before" : "after");
}

/** Patch any node (leaf or split) by id — used to retarget a viewer without touching the tree shape. */
export function updateLeaf(node: Node, id: string, patch: Partial<Leaf>): Node {
  return setLeafProps(node, id, patch);
}

/** Store new pixel sizes on split `splitId` (from Allotment's onChange). */
export function setSizes(node: Node, splitId: string, sizes: number[]): Node {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) };
}
