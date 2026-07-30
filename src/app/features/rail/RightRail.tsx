import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusRefresh } from "../../lib/useFocusRefresh";
import { useRailMode } from "../chrome/panels";
import { useSettings } from "../settings/store";
import Sessions from "../sessions/Sessions";
import RailSwitch from "./RailSwitch";
import { RIGHT_PANELS, SESSIONS, type RightPanelDef } from "./registry";

/**
 * The right rail's host. Replaces the hard-wired `<Sessions/>` in the third grid column: it keeps the
 * `pane sessions` class (App.css's grid/collapse selectors key off it), owns the header, and renders
 * whichever panel the user selected.
 *
 * Two orthogonal axes: the **width** (full/mini/hidden, `rightRail`) stays on the TitleBar; **which
 * panel** (`rightPanel`) lives in the header switcher here. The narrow rail is a sessions-only glance
 * by design — its 40px chrome is bespoke to sessions and ignores the panel choice.
 */
export default function RightRail() {
  const rail = useRailMode();
  const rightPanel = useSettings((s) => s.settings.rightPanel);
  const update = useSettings((s) => s.update);
  const visible = useVisiblePanels();

  if (rail === "mini") return <Sessions variant="mini" />;

  const active = visible.find((p) => p.id === rightPanel) ?? visible[0] ?? SESSIONS;
  const showSwitch = visible.length > 1;

  return (
    <aside className="pane sessions">
      {showSwitch ? (
        <div className="rail-head">
          <RailSwitch
            panels={visible}
            active={active.id}
            onPick={(id) => update({ rightPanel: id })}
          />
        </div>
      ) : (
        <div className="pane-title">
          {active.label}
          {active.Badge && <active.Badge />}
        </div>
      )}
      <active.Body />
    </aside>
  );
}

/**
 * The panels worth showing right now. A panel without `available` is always in; one with `available`
 * is included only once its probe resolves true.
 *
 * **Probed on mount, then at most every five minutes.** This runs for *every* registered panel, not
 * just the visible one, so it is the one place in the app that pays for panels the user isn't looking
 * at — `docker_ok` and `kubectl_contexts` are external processes, and on a machine with both installed
 * that was four of them on **every** window focus while the active panel was Sessions, which needs
 * none of it. What it asks ("is kubectl installed") does not change between alt-tabs; five minutes
 * still catches a tool that appears mid-session, which is what the original focus probe was for.
 */
function useVisiblePanels(): RightPanelDef[] {
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  const cancelled = useRef(false);

  const probe = useCallback(() => {
    for (const p of RIGHT_PANELS) {
      if (!p.available) continue;
      Promise.resolve(p.available())
        .then((ok) => {
          if (!cancelled.current) setAvail((a) => (a[p.id] === ok ? a : { ...a, [p.id]: ok }));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    probe();
    return () => {
      cancelled.current = true;
    };
  }, [probe]);
  useFocusRefresh(probe, { throttleMs: 300_000 });

  return RIGHT_PANELS.filter((p) => !p.available || avail[p.id]);
}
