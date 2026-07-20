import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `settings::Settings` (camelCase). */
export type Settings = {
  gitBashPath: string | null;
  shell: "bash" | "powershell";
  terminalFont: string;
  terminalFontSize: number;
  scrollback: number;
  startPath: string | null;
  favorites: string[];
  /** UI theme. Applied as `data-theme` on the document root. */
  theme: "dark" | "light";
  /** Accent key: amber | sage | clay | neutral. Applied as `data-accent`; everything derives from --accent. */
  accent: string;
  /** Chrome scale, 0.9–1.5. Multiplies every size token; the terminal is a separate axis. */
  uiScale: number;
  /** Is the left panel (explorer/workspace) shown? */
  leftPanel: boolean;
  /**
   * Right session rail. `null` means **never chosen** — resolved at runtime to "full" when session
   * tracking is installed and "hidden" when it isn't, so a user who doesn't track Claude Code sessions
   * never sees a rail they have no use for. Touching the toggle makes it an explicit choice.
   */
  rightRail: RailMode | null;
};

export type RailMode = "full" | "mini" | "hidden";

export const DEFAULT_SETTINGS: Settings = {
  gitBashPath: null,
  shell: "bash",
  terminalFont: "D2Coding",
  terminalFontSize: 14,
  scrollback: 5000,
  startPath: null,
  favorites: [],
  theme: "dark",
  accent: "amber",
  uiScale: 1,
  leftPanel: true,
  rightRail: null,
};

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

/** Settings-aware shell path (Git Bash or PowerShell) — replaces the old fixed default. */
export const resolveShell = () => invoke<string>("resolve_shell_cmd");
