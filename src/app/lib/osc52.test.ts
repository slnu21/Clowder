import { describe, expect, it } from "vitest";
import { isOsc52ReadRequest, osc52ToText } from "./osc52";

/**
 * What a program actually emits: base64 of the UTF-8 bytes, after `Pc;`.
 *
 * Built with `TextEncoder`/`btoa` rather than node's `Buffer` — no `@types/node` in this project, and
 * this way the fixture is the exact mirror of the decode path under test.
 */
const enc = (text: string, pc = "c") => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${pc};${btoa(bin)}`;
};

describe("osc52ToText", () => {
  it("decodes what a TUI asks to copy", () => {
    expect(osc52ToText(enc("hello"))).toBe("hello");
  });

  it("keeps Korean intact — the reason it decodes through bytes", () => {
    // `atob` alone yields one char per byte, so this is exactly the case that breaks without a
    // TextDecoder: three bytes per syllable.
    expect(osc52ToText(enc("한글 복사 테스트"))).toBe("한글 복사 테스트");
    expect(osc52ToText(enc("emoji 🐈 and ﬁ ligature"))).toBe("emoji 🐈 and ﬁ ligature");
  });

  it("preserves newlines and trailing whitespace (a multi-line copy is one block)", () => {
    expect(osc52ToText(enc("line1\nline2\n"))).toBe("line1\nline2\n");
  });

  it("accepts every clipboard target, since Windows has only one", () => {
    for (const pc of ["c", "p", "s", "0", "7", ""]) {
      expect(osc52ToText(enc("x", pc))).toBe("x");
    }
  });

  it("refuses a read request", () => {
    expect(osc52ToText("c;?")).toBeNull();
    expect(osc52ToText("p;?")).toBeNull();
  });

  // Tested on its own because `osc52ToText("c;?")` would return null even with the guard removed —
  // `atob("?")` throws. Only this test actually fails if the exfiltration guard stops working.
  it("identifies a read request distinctly from a write", () => {
    expect(isOsc52ReadRequest("c;?")).toBe(true);
    expect(isOsc52ReadRequest("p;?")).toBe(true);
    expect(isOsc52ReadRequest(";?")).toBe(true); // empty Pc is legal
    expect(isOsc52ReadRequest(enc("?"))).toBe(false); // base64 of "?" is a write of "?"
    expect(isOsc52ReadRequest(enc("hello"))).toBe(false);
    expect(isOsc52ReadRequest("c;??")).toBe(false); // only a bare "?" is the read form
    expect(isOsc52ReadRequest("?")).toBe(false); // no separator — not a valid request at all
  });

  it("refuses malformed input rather than throwing", () => {
    expect(osc52ToText("")).toBeNull(); // no separator at all
    expect(osc52ToText("c")).toBeNull(); // no separator
    expect(osc52ToText("c;")).toBeNull(); // empty payload
    expect(osc52ToText("c;!!!not base64!!!")).toBeNull();
  });

  it("refuses a payload over the cap", () => {
    const big = enc("x".repeat(200));
    expect(osc52ToText(big, 50)).toBeNull();
    expect(osc52ToText(big)).toBe("x".repeat(200)); // and accepts it under the default cap
  });
});
