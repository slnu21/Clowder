import { invoke } from "./invoke";
import type { LanguageSetting } from "./i18n";

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
  /**
   * Terminal palette, a **separate axis** from the UI theme (applied as `data-term-theme`). `"follow"`
   * tracks `theme`; `"dark"`/`"light"` pin it. Default `"dark"`: most CLI/TUI colour schemes — including
   * the truecolor output the app can't re-map — assume a dark background, so a light app can still keep a
   * readable terminal.
   */
  terminalTheme: TerminalTheme;
  /** Accent key: amber | sage | clay | neutral. Applied as `data-accent`; everything derives from --accent. */
  accent: string;
  /** Chrome scale, 0.9–1.5. Multiplies every size token; the terminal is a separate axis. */
  uiScale: number;
  /** UI language. `"auto"` follows the OS/WebView locale; see `lib/i18n.ts`. */
  language: LanguageSetting;
  /** Is the left panel (explorer/workspace) shown? */
  leftPanel: boolean;
  /**
   * Right session rail. `null` means **never chosen** — resolved at runtime to "full" when session
   * tracking is installed and "hidden" when it isn't, so a user who doesn't track Claude Code sessions
   * never sees a rail they have no use for. Touching the toggle makes it an explicit choice.
   */
  rightRail: RailMode | null;
  /**
   * Which panel the right rail shows. Orthogonal to `rightRail` (that's the width axis). Defaults to
   * `"sessions"`; a value whose panel isn't registered yet falls back to the first available panel.
   */
  rightPanel: RightPanelId;
};

export type RailMode = "full" | "mini" | "hidden";
/** The registry of right-rail panels. The canonical id list lives here (part of the Settings shape);
 *  `features/rail/registry.ts` imports it so `lib` stays a leaf. Not every id is implemented yet. */
export type RightPanelId = "sessions" | "ports" | "ssh" | "git" | "k8s" | "docker" | "task" | "snippets";
export type TerminalTheme = "follow" | "dark" | "light";

export const DEFAULT_SETTINGS: Settings = {
  gitBashPath: null,
  shell: "bash",
  terminalFont: "D2Coding",
  terminalFontSize: 14,
  scrollback: 5000,
  startPath: null,
  favorites: [],
  theme: "dark",
  terminalTheme: "dark",
  accent: "amber",
  uiScale: 1,
  language: "auto",
  leftPanel: true,
  rightRail: null,
  rightPanel: "sessions",
};

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

/** Settings-aware shell path (Git Bash or PowerShell) — replaces the old fixed default. */
export const resolveShell = () => invoke<string>("resolve_shell_cmd");
