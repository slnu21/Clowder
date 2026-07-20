import { useEffect } from "react";
import { create } from "zustand";
import { beaconStatus } from "../../lib/beacon";
import type { RailMode } from "../../lib/settings";
import { useSettings } from "../settings/store";

/**
 * Panel visibility — the left explorer and the right session rail.
 *
 * The stored `rightRail` is `null` until the user touches the toggle, and `null` resolves to whether
 * session tracking is installed: a user who doesn't track Claude Code sessions shouldn't be given a
 * column of empty rail. Once they choose, the choice sticks and stops following the install state.
 *
 * The install probe lives here, not in `Sessions`: the answer decides whether the rail is shown at all,
 * so it can't be owned by the thing being shown. It's one cheap IPC call on mount and on focus, and only
 * while the setting is still `null`; `Sessions` keeps its own richer status for the partial-install notice.
 */
type PanelState = {
  /** `null` = not probed yet — treated as "not installed" so nothing flashes open then shut. */
  trackingInstalled: boolean | null;
  probe: () => Promise<void>;
};

export const usePanels = create<PanelState>((set) => ({
  trackingInstalled: null,
  probe: async () => {
    try {
      const s = await beaconStatus();
      set({ trackingInstalled: s.hooks });
    } catch {
      /* fail-soft: an unreachable backend leaves the rail hidden, which is the quieter wrong answer */
    }
  },
}));

/** Probe once on mount and whenever the window regains focus (tracking can be installed elsewhere). */
export function useTrackingProbe(): void {
  const probe = usePanels((p) => p.probe);
  const rail = useSettings((s) => s.settings.rightRail);
  useEffect(() => {
    if (rail !== null) return; // an explicit choice doesn't need the install state at all
    void probe();
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [rail, probe]);
}

/** The rail mode actually in effect, with `null` resolved. */
export function useRailMode(): RailMode {
  const rail = useSettings((s) => s.settings.rightRail);
  const installed = usePanels((p) => p.trackingInstalled);
  return rail ?? (installed ? "full" : "hidden");
}

const RAIL_CYCLE: RailMode[] = ["full", "mini", "hidden"];

/** Cycle full → mini → hidden → full. Writing the resolved value is what turns a default into a choice. */
export function cycleRail(current: RailMode): RailMode {
  return RAIL_CYCLE[(RAIL_CYCLE.indexOf(current) + 1) % RAIL_CYCLE.length];
}
