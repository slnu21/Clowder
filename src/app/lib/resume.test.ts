import { describe, expect, it } from "vitest";
import { ago, resumeCommand } from "./resume";

const ID = "39f7d04d-7f7b-4739-9c59-d9c73c56ade0";

describe("resumeCommand", () => {
  it("builds claude's resume line for a UUID", () => {
    expect(resumeCommand("claude", ID)).toBe(`claude -r ${ID}`);
    expect(resumeCommand("claude", ID.toUpperCase())).toBe(`claude -r ${ID.toUpperCase()}`);
  });

  it("refuses anything that isn't a bare UUID — this string is typed into a shell", () => {
    for (const bad of [
      "",
      "abc",
      `${ID}; rm -rf ~`,
      `${ID}\nwhoami`,
      `$(whoami)`,
      ` ${ID}`,
      ID.slice(0, 35),
      ID.replace(/-/g, "_"),
    ]) {
      expect(resumeCommand("claude", bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("knows no other agent yet", () => {
    expect(resumeCommand("codex", ID)).toBeNull();
  });
});

describe("ago", () => {
  const now = 1_700_000_000_000;
  const min = 60_000;
  it("buckets into minutes, hours, days", () => {
    expect(ago(now - 30_000, now)).toEqual({ key: "recent.justNow" });
    expect(ago(now - 5 * min, now)).toEqual({ key: "recent.minutesAgo", n: 5 });
    expect(ago(now - 59 * min, now)).toEqual({ key: "recent.minutesAgo", n: 59 });
    expect(ago(now - 60 * min, now)).toEqual({ key: "recent.hoursAgo", n: 1 });
    expect(ago(now - 25 * 60 * min, now)).toEqual({ key: "recent.daysAgo", n: 1 });
  });

  it("treats a future time (clock skew) as just now", () => {
    expect(ago(now + 10 * min, now)).toEqual({ key: "recent.justNow" });
  });
});
