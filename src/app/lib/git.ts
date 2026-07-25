import { invoke } from "@tauri-apps/api/core";

/** Git status of a folder. Mirrors Rust `git::GitStatus` (camelCase). */
export type GitStatus = {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  gitMissing: boolean;
};

/** Git status of `cwd`. Fail-soft in Rust — `isRepo: false` when it isn't a repo or git is absent. */
export const gitStatus = (cwd: string) => invoke<GitStatus>("git_status", { cwd });
