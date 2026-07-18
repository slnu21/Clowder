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

export function makeTerminalLeaf(cwd?: string): Leaf {
  return { kind: "leaf", id: nextId("p"), content: "terminal", cwd, title: cwd ? basename(cwd) : "bash" };
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
 * Replace leaf `targetId` with a split of `[thatLeaf, newLeaf]`. Branches that don't contain the
 * target are rebuilt with the SAME `id`, so React keeps their subtrees (and Allotment its sizes).
 */
export function splitLeaf(node: Node, targetId: string, dir: Direction, newLeaf: Leaf): Node {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    return { kind: "split", id: nextId("s"), dir, children: [node, newLeaf] };
  }
  return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf)) };
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

/** Store new pixel sizes on split `splitId` (from Allotment's onChange). */
export function setSizes(node: Node, splitId: string, sizes: number[]): Node {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) };
}
