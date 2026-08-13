import { describe, expect, it } from "vitest";
import { favLabel, isFavorite, normalizeFavPath, removeFavorite, toggleFavorite } from "./favorites";

describe("normalizeFavPath", () => {
  it("drops trailing separators but keeps a drive root whole", () => {
    expect(normalizeFavPath("C:\\Users\\me\\deck\\")).toBe("C:\\Users\\me\\deck");
    expect(normalizeFavPath("C:\\Users\\me\\deck//")).toBe("C:\\Users\\me\\deck");
    expect(normalizeFavPath("  C:\\w  ")).toBe("C:\\w");
    for (const root of ["C:", "C:\\", "C:/", "c:\\\\"]) {
      expect(normalizeFavPath(root)).toBe(root.slice(0, 2) + "\\");
    }
  });

  it("leaves a UNC prefix alone", () => {
    expect(normalizeFavPath("\\\\server\\share\\")).toBe("\\\\server\\share");
  });
});

describe("isFavorite", () => {
  const favs = ["C:\\Users\\me\\deck", "D:\\"];

  it("ignores case and separator style", () => {
    // The real failure this prevents: the star reads "not a favourite" and a duplicate gets added.
    expect(isFavorite(favs, "c:/users/ME/deck")).toBe(true);
    expect(isFavorite(favs, "C:\\Users\\me\\deck\\")).toBe(true);
    expect(isFavorite(favs, "d:/")).toBe(true);
  });

  it("does not match a different folder or an empty path", () => {
    expect(isFavorite(favs, "C:\\Users\\me\\deck2")).toBe(false);
    expect(isFavorite(favs, "C:\\Users\\me")).toBe(false);
    expect(isFavorite(favs, "")).toBe(false);
    expect(isFavorite([], "C:\\anything")).toBe(false);
  });
});

describe("toggleFavorite", () => {
  it("round-trips and never creates a case variant duplicate", () => {
    const once = toggleFavorite([], "C:\\Users\\me\\deck");
    expect(once).toEqual(["C:\\Users\\me\\deck"]);

    // Same folder, different casing/separator → removes rather than adding a second entry.
    expect(toggleFavorite(once, "c:/users/me/deck")).toEqual([]);
  });

  it("stores the user's own casing", () => {
    expect(toggleFavorite([], "C:\\Users\\Me\\Deck")).toEqual(["C:\\Users\\Me\\Deck"]);
  });

  it("keeps other entries and their order", () => {
    const favs = ["C:\\a", "C:\\b", "C:\\c"];
    expect(toggleFavorite(favs, "C:\\b")).toEqual(["C:\\a", "C:\\c"]);
    expect(toggleFavorite(favs, "C:\\d")).toEqual(["C:\\a", "C:\\b", "C:\\c", "C:\\d"]);
  });

  it("refuses to add an empty path", () => {
    expect(toggleFavorite(["C:\\a"], "   ")).toEqual(["C:\\a"]);
  });

  it("does not mutate the input", () => {
    const favs = ["C:\\a"];
    toggleFavorite(favs, "C:\\b");
    expect(favs).toEqual(["C:\\a"]);
  });
});

describe("removeFavorite", () => {
  it("removes by folded path", () => {
    expect(removeFavorite(["C:\\A", "C:\\B"], "c:/a")).toEqual(["C:\\B"]);
  });
});

describe("favLabel", () => {
  it("uses the last segment, and the root itself for a drive", () => {
    expect(favLabel("C:\\Users\\me\\deck")).toBe("deck");
    expect(favLabel("C:\\Users\\me\\deck\\")).toBe("deck");
    expect(favLabel("C:\\")).toBe("C:\\");
    expect(favLabel("D:")).toBe("D:\\");
    expect(favLabel("C:\\작업\\한글 폴더")).toBe("한글 폴더");
  });
});
