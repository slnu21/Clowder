import { invoke } from "@tauri-apps/api/core";

/**
 * Clowder's session-tracking hooks. `beacon_install` adds `clowder.exe --beacon` hook groups to
 * `~/.claude/settings.json` (backed up, surgical — see `beacon_install.rs`); the running `--beacon`
 * headless mode writes the spool the rail reads. All are safe/idempotent and never touch other tools'
 * hooks.
 */

/**
 * Install is two independent halves — hooks (sessions) and statusLine (usage) — and the second can fail
 * on its own. Reporting one boolean is what let the rail claim "installed" while usage stayed empty.
 */
export type BeaconStatus = {
  hooks: boolean;
  statusline: boolean;
  binary: boolean;
  /** The user already has a statusline of their own — install wraps it instead of asking. */
  userStatusline: boolean;
  lastHookAt: string | null;
  lastUsageAt: string | null;
};

/** What our statusline shows a user who had none: collect silently, or draw Clowder's own line. */
export type StatuslineMode = "none" | "clowder";

export const beaconStatus = () => invoke<BeaconStatus>("beacon_status");
export const beaconInstall = (mode?: StatuslineMode) => invoke<void>("beacon_install", { mode });
export const beaconUninstall = () => invoke<void>("beacon_uninstall");
