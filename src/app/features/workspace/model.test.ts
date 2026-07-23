import { describe, expect, it } from "vitest";
import {
  collectLeafIds,
  Direction,
  DropZone,
  findLeaf,
  Leaf,
  makeTerminalLeaf,
  moveLeaf,
  nextId,
  Node,
  removeLeaf,
  splitLeaf,
  splitLeafAt,
} from "./model";

// The pane tree is the model behind item 1 ("closing one split closes a sibling — or the whole tab").
// In a release build ids are unique per session, so the tree ops *should* remove exactly the targeted
// leaf and never invent a duplicate. These tests pin that, and the fuzz at the bottom hunts a sequence of
// split/move/close/detach that would break it — the closest thing to reproducing the reported bug from
// the pure model.

const leaf = (): Leaf => makeTerminalLeaf(undefined, "sh");

/** Count how many leaves in `node` carry `id` — must never exceed 1. */
function countLeaf(node: Node, id: string): number {
  return collectLeafIds(node).filter((x) => x === id).length;
}

/** Structural invariants of a single tab tree: every split has ≥2 children, ids are unique within it. */
function assertWellFormed(node: Node): void {
  const ids = collectLeafIds(node);
  expect(new Set(ids).size, `duplicate leaf id within a tab: ${ids.join(",")}`).toBe(ids.length);
  const walk = (n: Node): void => {
    if (n.kind === "split") {
      expect(n.children.length, "a split must never be left with <2 children").toBeGreaterThanOrEqual(2);
      n.children.forEach(walk);
    }
  };
  walk(node);
}

describe("removeLeaf", () => {
  it("removes exactly the target and collapses a split left with one child", () => {
    const a = leaf(), b = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [a, b] };
    const after = removeLeaf(root, a.id);
    // b is promoted in place of the collapsed split — the survivor, not a copy of it.
    expect(after).toBe(b);
    expect(countLeaf(after!, b.id)).toBe(1);
    expect(countLeaf(after!, a.id)).toBe(0);
  });

  it("returns undefined only for the last leaf (the caller closes the tab)", () => {
    const only = leaf();
    expect(removeLeaf(only, only.id)).toBeUndefined();
    expect(removeLeaf(only, "nope")).toBe(only); // unknown id is a no-op, never a collapse
  });

  it("removes a single leaf from a 3-way split, leaving the other two", () => {
    const a = leaf(), b = leaf(), c = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [a, b, c] };
    const after = removeLeaf(root, b.id)!;
    expect(collectLeafIds(after).sort()).toEqual([a.id, c.id].sort());
    assertWellFormed(after);
  });

  it("removes only ONE leaf even if a duplicate id somehow exists (cascade guard)", () => {
    // Hand-build a malformed tree with the same id twice — the exact condition that used to take a
    // sibling (or the whole tab) down. `removeLeaf` is single-target, so it drops one and leaves the rest.
    const dup1: Leaf = { kind: "leaf", id: "dup", content: "terminal", title: "a" };
    const dup2: Leaf = { kind: "leaf", id: "dup", content: "terminal", title: "b" };
    const other = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [dup1, dup2, other] };
    const after = removeLeaf(root, "dup")!;
    expect(collectLeafIds(after).filter((x) => x === "dup").length).toBe(1); // exactly one dup survived
    expect(countLeaf(after, other.id)).toBe(1); // the unrelated sibling is untouched
  });

  it("removes ONLY the targeted leaf — never a sibling (the item-1 guarantee)", () => {
    // Build a nested tree and close each leaf in turn; every close drops exactly one.
    const ids = [leaf(), leaf(), leaf(), leaf()];
    let root: Node = {
      kind: "split", id: nextId("s"), dir: "row",
      children: [ids[0], { kind: "split", id: nextId("s"), dir: "column", children: [ids[1], ids[2], ids[3]] }],
    };
    const before = collectLeafIds(root);
    const target = ids[2].id;
    const after = removeLeaf(root, target)!;
    expect(collectLeafIds(after).sort()).toEqual(before.filter((x) => x !== target).sort());
  });
});

describe("moveLeaf", () => {
  it("is a no-op for center or self", () => {
    const a = leaf(), b = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [a, b] };
    expect(moveLeaf(root, a.id, b.id, "center")).toBeNull();
    expect(moveLeaf(root, a.id, a.id, "right")).toBeNull();
  });

  it("sibling fast-path reorders in place and keeps every id exactly once", () => {
    const a = leaf(), b = leaf(), c = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [a, b, c] };
    const after = moveLeaf(root, a.id, c.id, "right")!;
    expect(after).not.toBeNull();
    for (const id of [a.id, b.id, c.id]) expect(countLeaf(after, id)).toBe(1);
    assertWellFormed(after);
  });

  it("general path splits the PRUNED tree, so the moved leaf is never duplicated", () => {
    // Move across nesting: source and target don't share a same-direction parent.
    const a = leaf(), b = leaf(), c = leaf();
    const root: Node = {
      kind: "split", id: nextId("s"), dir: "row",
      children: [a, { kind: "split", id: nextId("s"), dir: "column", children: [b, c] }],
    };
    const after = moveLeaf(root, a.id, c.id, "bottom")!;
    for (const id of [a.id, b.id, c.id]) expect(countLeaf(after, id)).toBe(1);
    assertWellFormed(after);
  });
});

describe("splitLeafAt", () => {
  it("wraps the target in a 2-child split without touching siblings", () => {
    const a = leaf(), b = leaf();
    const root: Node = { kind: "split", id: nextId("s"), dir: "row", children: [a, b] };
    const fresh = leaf();
    const after = splitLeaf(root, a.id, "column", fresh);
    expect(collectLeafIds(after).sort()).toEqual([a.id, b.id, fresh.id].sort());
    assertWellFormed(after);
  });
});

// ── fuzz: random split/move/close/detach across tabs, asserting the invariants every step ──────────────
//
// Models the store's structural ops on the pure model (the store adds tint/focus, neither of which
// touches ids or shape). If any sequence produces a duplicate id, a degenerate split, or a close that
// removes more than its target, this fails with the seed — a concrete reproduction.

type Tab = { id: string; root: Node };

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS: Direction[] = ["row", "column"];
const ZONES: DropZone[] = ["left", "right", "top", "bottom", "center"];

function runSequence(seed: number, steps: number): void {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  let tabs: Tab[] = [{ id: nextId("tab"), root: leaf() }];

  const allIds = () => tabs.flatMap((t) => collectLeafIds(t.root));
  const invariant = (label: string) => {
    const ids = allIds();
    expect(new Set(ids).size, `[seed ${seed}] duplicate id across tabs after ${label}: ${ids.join(",")}`).toBe(ids.length);
    tabs.forEach((t) => assertWellFormed(t.root));
  };

  for (let i = 0; i < steps; i++) {
    if (tabs.length === 0) tabs.push({ id: nextId("tab"), root: leaf() });
    const op = pick(["split", "split", "move", "close", "detach", "newtab"] as const);
    const tab = pick(tabs);
    const ids = collectLeafIds(tab.root);

    if (op === "newtab") {
      tabs.push({ id: nextId("tab"), root: leaf() });
    } else if (op === "split") {
      const target = pick(ids);
      tab.root = splitLeafAt(tab.root, target, pick(DIRS), leaf(), pick(["before", "after"]));
    } else if (op === "move" && ids.length >= 2) {
      const src = pick(ids);
      const dst = pick(ids.filter((x) => x !== src));
      const next = moveLeaf(tab.root, src, dst, pick(ZONES));
      if (next) tab.root = next;
    } else if (op === "detach" && ids.length >= 2) {
      const target = pick(ids);
      const found = findLeaf(tab.root, target)!;
      const pruned = removeLeaf(tab.root, target);
      if (pruned) {
        tab.root = pruned;
        tabs.push({ id: nextId("tab"), root: found }); // the SAME leaf object moves to a new tab
      }
    } else if (op === "close") {
      const target = pick(ids);
      const before = new Set(ids);
      const next = removeLeaf(tab.root, target);
      if (next === undefined) {
        tabs = tabs.filter((t) => t !== tab); // last pane → tab closes
      } else {
        tab.root = next;
        // Close must drop exactly the target and keep every other leaf in that tab.
        const after = new Set(collectLeafIds(next));
        for (const id of before) {
          if (id === target) expect(after.has(id), `[seed ${seed}] target ${id} survived close`).toBe(false);
          else expect(after.has(id), `[seed ${seed}] sibling ${id} vanished on close of ${target}`).toBe(true);
        }
      }
    }
    invariant(op);
  }
}

describe("fuzz: split/move/close/detach never duplicate or cascade", () => {
  it("holds across many random sequences", () => {
    for (let seed = 1; seed <= 300; seed++) runSequence(seed, 60);
  });
});
