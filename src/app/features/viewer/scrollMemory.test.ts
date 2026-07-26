import { describe, expect, it } from "vitest";
import { forgetViewerScroll, trackViewerScroll } from "./scrollMemory";

// `trackViewerScroll` takes a `Document` and touches four things on it — `URL`, `body`,
// `scrollingElement` and `addEventListener` — so a stub covers it exactly, with no DOM environment and
// no new dependency. What is worth pinning is the behaviour that is invisible until someone loses their
// place: the restore itself, the `about:blank` guard (the initial empty document must not overwrite the
// memory with 0), and that a pane pointed at a different file starts at the top.

type FakeDoc = Document & { scroll: (y: number) => void };

/** A document that records its scroll listener, so a test can drive scrolling like a user would. */
function fakeDoc(url = "about:srcdoc", scrollHeight = 5000, clientHeight = 800): FakeDoc {
  const listeners: (() => void)[] = [];
  let top = 0;
  const scroller = {
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      // The browser clamps to the scrollable range; a shorter document is how a restore lands short.
      top = Math.max(0, Math.min(v, scrollHeight - clientHeight));
    },
  };
  return {
    URL: url,
    body: {} as HTMLElement,
    scrollingElement: scroller as unknown as Element,
    documentElement: scroller as unknown as HTMLElement,
    addEventListener: (type: string, fn: () => void) => type === "scroll" && listeners.push(fn),
    // Test-only handle: move the scroller and fire what the real document would.
    scroll: (y: number) => {
      scroller.scrollTop = y;
      for (const fn of listeners) fn();
    },
  } as unknown as FakeDoc;
}

const scrollTopOf = (doc: FakeDoc) => (doc.scrollingElement as unknown as { scrollTop: number }).scrollTop;

describe("viewer scroll memory", () => {
  it("restores the offset a pane was left at when its document is rebuilt", () => {
    const first = fakeDoc();
    trackViewerScroll("pane1", "C:/notes/a.md", first);
    first.scroll(1200); // the user reads down the page

    // Tab switch: the pane unmounts and comes back with a brand-new document at the top.
    const rebuilt = fakeDoc();
    expect(scrollTopOf(rebuilt)).toBe(0);
    trackViewerScroll("pane1", "C:/notes/a.md", rebuilt);
    expect(scrollTopOf(rebuilt)).toBe(1200);
  });

  it("ignores the initial empty document instead of letting it erase the memory", () => {
    const doc = fakeDoc();
    trackViewerScroll("pane2", "C:/notes/a.md", doc);
    doc.scroll(900);

    // An `<iframe>` with no `src` fires `load` for `about:blank` before `srcdoc` is ever set. If that
    // document were tracked, its listener would report 0 and the place would be gone.
    const blank = fakeDoc("about:blank");
    trackViewerScroll("pane2", "C:/notes/a.md", blank);
    blank.scroll(0);

    const rebuilt = fakeDoc();
    trackViewerScroll("pane2", "C:/notes/a.md", rebuilt);
    expect(scrollTopOf(rebuilt)).toBe(900);
  });

  it("keeps a place per file, so retargeting a pane opens at the top", () => {
    const a = fakeDoc();
    trackViewerScroll("pane3", "C:/notes/a.md", a);
    a.scroll(700);

    // Dropping another document on the pane (`retargetViewer`) reuses the pane id.
    const b = fakeDoc();
    trackViewerScroll("pane3", "C:/notes/b.md", b);
    expect(scrollTopOf(b)).toBe(0);

    // ...and coming back to the first file still lands where it was.
    const againA = fakeDoc();
    trackViewerScroll("pane3", "C:/notes/a.md", againA);
    expect(scrollTopOf(againA)).toBe(700);
  });

  it("keeps panes independent", () => {
    const one = fakeDoc();
    const two = fakeDoc();
    trackViewerScroll("pane4", "C:/notes/a.md", one);
    trackViewerScroll("pane5", "C:/notes/a.md", two);
    one.scroll(400);
    two.scroll(2000);

    const oneAgain = fakeDoc();
    const twoAgain = fakeDoc();
    trackViewerScroll("pane4", "C:/notes/a.md", oneAgain);
    trackViewerScroll("pane5", "C:/notes/a.md", twoAgain);
    expect(scrollTopOf(oneAgain)).toBe(400);
    expect(scrollTopOf(twoAgain)).toBe(2000);
  });

  it("forgets a closed pane", () => {
    const doc = fakeDoc();
    trackViewerScroll("pane6", "C:/notes/a.md", doc);
    doc.scroll(1500);

    forgetViewerScroll("pane6"); // what `closePane` / `closeTab` do beside `release`

    const reopened = fakeDoc();
    trackViewerScroll("pane6", "C:/notes/a.md", reopened);
    expect(scrollTopOf(reopened)).toBe(0);
  });

  it("clamps into a document that shrank, and records the clamped place", () => {
    const tall = fakeDoc();
    trackViewerScroll("pane7", "C:/notes/a.md", tall);
    tall.scroll(4000);

    // The agent in the next pane cut the file down while the tab was away: 1200 of scrollable range.
    const short = fakeDoc("about:srcdoc", 2000, 800);
    trackViewerScroll("pane7", "C:/notes/a.md", short);
    expect(scrollTopOf(short)).toBe(1200);
    // The restore itself is not what corrects the memory — a real scroll event is. Fire one, as the
    // browser does when the offset changes, and the remembered value follows the document.
    short.scroll(1200);

    const again = fakeDoc("about:srcdoc", 2000, 800);
    trackViewerScroll("pane7", "C:/notes/a.md", again);
    expect(scrollTopOf(again)).toBe(1200);
  });
});
