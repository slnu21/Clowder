/**
 * Where each viewer pane was left off reading, kept **outside** React.
 *
 * The centre region mounts only the active tab's tree (`Workspace`), so leaving a tab unmounts its
 * panes. A terminal survives that trip — `terminalPool` keeps the xterm instance alive and parks its
 * scrollback position in a module map of its own — but a viewer is an ordinary component: every mount
 * builds a fresh `<iframe>` and rebuilds `srcdoc` from the file, and a brand-new document starts at the
 * top. The reading position was the one thing with nowhere to live. This is that place.
 *
 * It covers the two remounts that have nothing to do with tabs as well: a split or a move remounts the
 * pane tree (`TileTree`'s `structureKey`), and a theme flip rebuilds the document deliberately (the
 * tokens are baked into `srcdoc`, so a rebuild is the only way to retheme it).
 *
 * The offset is recorded by a listener **inside the frame** rather than read back when the component
 * unmounts: nothing then depends on React's teardown order, and a document replaced *without* an
 * unmount — the theme flip — is covered by the same code.
 */

/**
 * pane id → path → offset. Keyed by pane **and** path because `retargetViewer` aims a pane at a new
 * file, which must open at the top rather than inherit the previous document's place. Nested rather than
 * joined into one string key: forgetting a pane is then a single `delete`, with no argument about which
 * separator byte a Windows path can't contain.
 */
const offsets = new Map<string, Map<string, number>>();

/**
 * Restore this pane's remembered offset into a freshly loaded viewer document, and keep recording it.
 *
 * Call from the iframe's `onLoad`, where the document is already final — images are inlined data URIs
 * that `load` waits for, mermaid is baked to inline SVG before `srcdoc` is set, and the reader fonts are
 * system fonts (no webfont reflow). So there is no late relayout to fight and one restore is enough.
 *
 * An absolute offset, not a fraction: when the file grew while the tab was away — the pane next door is
 * usually an agent editing it — the same pixel is still the same sentence. A file that shrank clamps to
 * the bottom, and the listener writes the clamped value straight back, so it corrects itself.
 */
export function trackViewerScroll(leafId: string, path: string, doc: Document): void {
  // An `<iframe>` with no `src` fires `load` once for its initial empty document, before `srcdoc` is
  // ever set (a srcdoc document's URL is `about:srcdoc`, never `about:blank`). Recording *that* one
  // would overwrite the memory with 0 — precisely the bug this file exists to fix.
  if (doc.URL === "about:blank" || !doc.body) return;
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const byPath = offsets.get(leafId) ?? new Map<string, number>();
  offsets.set(leafId, byPath);
  const remembered = byPath.get(path);
  if (remembered) scroller.scrollTop = remembered;
  // One number into a map — cheap enough to take every scroll event unthrottled, and `passive` keeps it
  // off the scrolling path entirely. The listener dies with the document it was attached to.
  doc.addEventListener("scroll", () => byPath.set(path, scroller.scrollTop), { passive: true });
}

/**
 * Forget a pane's offsets. Called beside `release` when a pane is truly gone — and, like `release`,
 * **never** on a move, detach or retarget: those reshape the tree around a pane that is still there.
 */
export function forgetViewerScroll(leafId: string): void {
  offsets.delete(leafId);
}
