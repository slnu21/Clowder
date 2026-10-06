import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveLang, translate, type MsgKey } from "./i18n";

/**
 * The catalogue is typed (`EN: Record<MsgKey, string>`), so a *missing* key is a compile error.
 * What the type can't see is an empty string, a stale placeholder, or a translation that silently
 * dropped an interpolation slot the other language still has — those are what these cover.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translate", () => {
  it("returns the string for the requested language", () => {
    expect(translate("ko", "common.refresh")).toBe("새로고침");
    expect(translate("en", "common.refresh")).toBe("Refresh");
  });

  it("substitutes named placeholders", () => {
    expect(translate("en", "ports.killTitle", { pid: 4321 })).toBe("Kill PID 4321");
    expect(translate("ko", "ports.killTitle", { pid: 4321 })).toBe("PID 4321 종료");
  });

  it("leaves a placeholder alone when the caller didn't supply it", () => {
    // Better a visible `{pid}` than a silent "Kill PID undefined".
    expect(translate("en", "ports.killTitle", { other: 1 })).toBe("Kill PID {pid}");
  });

  it("passes the raw string through when there are no params", () => {
    expect(translate("en", "sessions.none")).toBe("No sessions");
  });

  it("falls back to Korean for a key missing from a catalogue", () => {
    // Reachable only if a catalogue is edited to drop a key at runtime; the type prevents it at build.
    const key = "does.not.exist" as MsgKey;
    expect(translate("en", key)).toBe("does.not.exist");
  });
});

describe("resolveLang", () => {
  it("passes an explicit choice through", () => {
    expect(resolveLang("ko")).toBe("ko");
    expect(resolveLang("en")).toBe("en");
  });

  it("follows the locale on auto", () => {
    vi.stubGlobal("navigator", { language: "ko-KR" });
    expect(resolveLang("auto")).toBe("ko");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(resolveLang("auto")).toBe("en");
  });

  it("treats any non-Korean locale as English", () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    expect(resolveLang("auto")).toBe("en");
  });
});

describe("catalogue integrity", () => {
  // Sampled across every area rather than every key: the point is to catch a whole area that was
  // added to one catalogue and forgotten in the other, plus the interpolated strings.
  const KEYS: MsgKey[] = [
    "common.refresh",
    "titlebar.railToggle",
    "explorer.openTerminalHere",
    "explorer.addFavorite",
    "explorer.openInFileExplorer",
    "workspace.colorSwatch",
    "workspace.resetTerminal",
    "workspace.resetTerminalHint",
    "welcome.hint",
    "sessions.statusAwaitingPermission",
    "sessions.meterCtx",
    "sessions.ownerUnknown",
    "settings.footer",
    "settings.language",
    "git.notRepo",
    "ports.showSystemN",
    "docker.none",
    "k8s.namespace",
    "ssh.noConfig",
    "task.none",
    "snippets.runTitle",
    "viewer.openFailed",
    "rail.sessions",
  ];

  it("has a non-empty string in both languages", () => {
    for (const key of KEYS) {
      expect(translate("ko", key), `ko/${key}`).not.toBe("");
      expect(translate("en", key), `en/${key}`).not.toBe("");
      // An untranslated key falls through to the key name itself — that is the failure we want to see.
      expect(translate("en", key), `en/${key} is untranslated`).not.toBe(key);
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const slots = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of KEYS) {
      expect(slots(translate("en", key)), `placeholders differ for ${key}`).toEqual(
        slots(translate("ko", key)),
      );
    }
  });
});
