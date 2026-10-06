import { describe, expect, it } from "vitest";
import { clearLineKeys, isStranded, recoverySequence, type TermModes } from "./tuiRecovery";

const clean: TermModes = { mouseTrackingMode: "none", bufferType: "normal" };

describe("isStranded", () => {
  it("is false for an ordinary shell prompt", () => {
    expect(isStranded(clean)).toBe(false);
  });

  it("catches mouse tracking left on by a killed TUI", () => {
    for (const mode of ["x10", "vt200", "drag", "any"] as const) {
      expect(isStranded({ ...clean, mouseTrackingMode: mode })).toBe(true);
    }
  });

  it("catches the alternate screen left on by a killed TUI", () => {
    expect(isStranded({ ...clean, bufferType: "alternate" })).toBe(true);
  });
});

describe("recoverySequence", () => {
  it("turns every mouse tracking mode and encoding off", () => {
    const { seq } = recoverySequence({ mouseTrackingMode: "any", bufferType: "normal" });
    for (const p of ["1000", "1002", "1003", "1006", "1016"]) expect(seq).toContain(`\x1b[?${p}l`);
  });

  it("shows the cursor and closes a dangling synchronized-output frame", () => {
    const { seq } = recoverySequence({ mouseTrackingMode: "any", bufferType: "normal" });
    expect(seq).toContain("\x1b[?25h");
    expect(seq).toContain("\x1b[?2026l");
  });

  it("leaves the alternate screen only when on it, and says the prompt went with it", () => {
    const alt = recoverySequence({ mouseTrackingMode: "any", bufferType: "alternate" });
    expect(alt.seq).toContain("\x1b[?1049l");
    expect(alt.leftAltScreen).toBe(true);

    // 1049l also restores the saved cursor — sent on the normal buffer it would jump the prompt to a stale spot.
    const normal = recoverySequence({ mouseTrackingMode: "any", bufferType: "normal" });
    expect(normal.seq).not.toContain("\x1b[?1049l");
    expect(normal.leftAltScreen).toBe(false);
  });

  it("never touches ConPTY's focus reporting or the shell's bracketed paste", () => {
    const { seq } = recoverySequence({ mouseTrackingMode: "any", bufferType: "alternate" });
    expect(seq).not.toContain("1004");
    expect(seq).not.toContain("2004");
  });
});

describe("clearLineKeys", () => {
  it("uses readline's keys for Git Bash", () => {
    expect(clearLineKeys("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("\x05\x15");
  });

  it("uses PSReadLine's keys for both PowerShells — readline's do nothing there", () => {
    for (const ps of ["powershell.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "PowerShell.EXE"]) {
      expect(clearLineKeys(ps)).toBe("\x1b[F\x1b[1;5H");
    }
  });

  it("sends nothing to a shell it doesn't know, or before the shell is known", () => {
    expect(clearLineKeys("cmd.exe")).toBe("");
    expect(clearLineKeys(null)).toBe("");
  });
});
