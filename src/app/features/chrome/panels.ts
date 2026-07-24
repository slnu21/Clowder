import type { RailMode } from "../../lib/settings";
import { useSettings } from "../settings/store";

/**
 * The right rail's **width** mode (full / mini / hidden), resolved from settings. Orthogonal to which
 * panel it shows (`rightPanel`, owned by the rail header switcher).
 *
 * `rightRail` is `null` until the user touches the toggle. It used to resolve to "hidden" when Claude
 * session tracking wasn't installed — back when the rail held only the (empty) session board. The rail
 * now hosts panels that don't need Claude at all (ports, ssh…), so a never-chosen rail always has
 * something worth showing and defaults to open. An explicit choice still wins.
 */
export function useRailMode(): RailMode {
  const rail = useSettings((s) => s.settings.rightRail);
  return rail ?? "full";
}

const RAIL_CYCLE: RailMode[] = ["full", "mini", "hidden"];

/** Cycle full → mini → hidden → full. Writing the resolved value is what turns a default into a choice. */
export function cycleRail(current: RailMode): RailMode {
  return RAIL_CYCLE[(RAIL_CYCLE.indexOf(current) + 1) % RAIL_CYCLE.length];
}
