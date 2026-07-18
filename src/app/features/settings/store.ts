import { create } from "zustand";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from "../../lib/settings";

/**
 * The single settings store. Loaded once at startup (before the app renders, so the first terminal
 * already sees the user's font/scrollback), then updated in place. The terminal pool reads it
 * synchronously via `useSettings.getState()`; the popover subscribes reactively.
 *
 * Persistence is best-effort — a failed save is swallowed in Rust, matching Vigil's pattern.
 */
type State = {
  settings: Settings;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
};

export const useSettings = create<State>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  load: async () => {
    try {
      set({ settings: await getSettings() });
    } catch {
      // Keep defaults; a missing/corrupt file is not fatal.
    }
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    void saveSettings(next);
  },
}));
