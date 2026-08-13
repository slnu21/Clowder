import { describe, expect, it } from "vitest";
import type { Entry } from "../../lib/tauri";
import { parentOf, sortEntries } from "./util";

const entry = (name: string, isDir: boolean): Entry => ({ name, path: "C:\\x\\" + name, isDir, hidden: false });

describe("sortEntries", () => {
  it("puts directories first, then sorts case-insensitively", () => {
    const sorted = sortEntries([
      entry("readme.md", false),
      entry("Src", true),
      entry("APP.tsx", false),
      entry("docs", true),
    ]).map((e) => e.name);
    expect(sorted).toEqual(["docs", "Src", "APP.tsx", "readme.md"]);
  });

  it("sorts Korean names too", () => {
    const sorted = sortEntries([entry("한글", true), entry("가나", true)]).map((e) => e.name);
    expect(sorted).toEqual(["가나", "한글"]);
  });

  it("does not mutate its input", () => {
    const input = [entry("b", false), entry("a", true)];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(["b", "a"]);
  });
});

describe("parentOf", () => {
  it("walks up one level, keeping the drive root's separator", () => {
    expect(parentOf("C:\\Users\\me\\deck")).toBe("C:\\Users\\me");
    expect(parentOf("C:\\Users")).toBe("C:\\"); // not "C:"
    expect(parentOf("C:/Users/me")).toBe("C:/Users");
  });

  it("returns null at a drive root, so the caller shows 내 컴퓨터", () => {
    expect(parentOf("C:\\")).toBeNull();
    expect(parentOf("C:")).toBeNull();
  });

  it("ignores trailing separators", () => {
    expect(parentOf("C:\\Users\\me\\")).toBe("C:\\Users");
  });
});
