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
};

export const DEFAULT_SETTINGS: Settings = {
  gitBashPath: null,
  shell: "bash",
  terminalFont: "D2Coding",
  terminalFontSize: 14,
  scrollback: 5000,
  startPath: null,
  favorites: [],
};

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

/** Settings-aware shell path (Git Bash or PowerShell) — replaces the old fixed default. */
export const resolveShell = () => invoke<string>("resolve_shell_cmd");
