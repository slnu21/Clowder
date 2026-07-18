import { invoke } from "@tauri-apps/api/core";

/**
 * Clowder's session-tracking hooks. `beacon_install` adds `clowder.exe --beacon` hook groups to
 * `~/.claude/settings.json` (backed up, surgical — see `beacon_install.rs`); the running `--beacon`
 * headless mode writes the spool the rail reads. All are safe/idempotent and never touch other tools'
 * hooks.
 */
export const beaconInstalled = () => invoke<boolean>("beacon_installed");
export const beaconInstall = () => invoke<void>("beacon_install");
export const beaconUninstall = () => invoke<void>("beacon_uninstall");
