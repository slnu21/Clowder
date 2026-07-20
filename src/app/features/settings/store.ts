import { create } from "zustand";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from "../../lib/settings";
import { retheme } from "../terminal/terminalPool";

/**
 * The single settings store. Loaded once at startup (before the app renders, so the first terminal
 * already sees the user's font/scrollback **and** theme/accent), then updated in place. The terminal
 * pool reads it synchronously via `useSettings.getState()`; the popover subscribes reactively.
 *
 * Persistence is best-effort — a failed save is swallowed in Rust, matching Vigil's pattern.
 */

/** Reflect theme + accent onto the document root; every CSS token (and the terminal palette) derives
 * from `data-theme` / `data-accent` / the resulting `--accent`. One write re-tints the whole app. */
function applyAppearance(s: Settings): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-accent", s.accent);
  // Every size token is `calc(Npx * var(--ui-scale))`, so one write resizes the whole chrome. The
  // terminal is deliberately untouched — its size is `terminalFontSize`, a separate axis.
  root.style.setProperty("--ui-scale", String(s.uiScale));
}

type State = {
  settings: Settings;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
};

export const useSettings = create<State>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  load: async () => {
    try {
      const settings = await getSettings();
      set({ settings });
      applyAppearance(settings);
    } catch {
      // Keep defaults; a missing/corrupt file is not fatal — but the defaults still reach the DOM.
      applyAppearance(get().settings);
    }
  },
  update: (patch) => {
    const prev = get().settings;
    const next = { ...prev, ...patch };
    set({ settings: next });
    void saveSettings(next);
    const themed = next.theme !== prev.theme || next.accent !== prev.accent;
    if (themed || next.uiScale !== prev.uiScale) {
      applyAppearance(next);
      // Scale alone never touches the terminal palette, so don't pay for a re-theme of every terminal.
      if (themed) retheme(); // live terminals keep running; only their palette flips
    }
  },
}));
