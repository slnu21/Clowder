import { describe, expect, it } from "vitest";
import { osc7ToPath } from "./osc7";

describe("osc7ToPath", () => {
  it("normalizes MSYS (Git Bash) paths", () => {
    expect(osc7ToPath("file:///c/Users/raltl")).toBe("C:\\Users\\raltl");
    expect(osc7ToPath("file:///d/proj/app")).toBe("D:\\proj\\app");
  });

  it("normalizes PowerShell drive paths", () => {
    expect(osc7ToPath("file:///C:/Users/raltl")).toBe("C:\\Users\\raltl");
  });

  it("keeps Korean and spaces intact (no percent-decoding)", () => {
    expect(osc7ToPath("file:///c/사용자/내 폴더")).toBe("C:\\사용자\\내 폴더");
    expect(osc7ToPath("file:///c/100%/x")).toBe("C:\\100%\\x");
  });

  it("handles drive roots", () => {
    expect(osc7ToPath("file:///c/")).toBe("C:\\");
    expect(osc7ToPath("file:///c")).toBe("C:\\");
    expect(osc7ToPath("file:///C:/")).toBe("C:\\");
  });

  it("accepts an explicit host segment", () => {
    expect(osc7ToPath("file://DESKTOP/c/Users")).toBe("C:\\Users");
  });

  it("rejects non-drive paths and junk", () => {
    expect(osc7ToPath("file:///HKLM/SOFTWARE")).toBeUndefined();
    expect(osc7ToPath("not a uri")).toBeUndefined();
    expect(osc7ToPath("")).toBeUndefined();
  });
});
