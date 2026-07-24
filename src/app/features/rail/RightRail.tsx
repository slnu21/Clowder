import { useEffect, useState } from "react";
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
 * is included only once its probe resolves true. Probed on mount and on window focus (a config/tool can
 * appear while the app is backgrounded), mirroring how the tracking probe works elsewhere. In M1 no
 * panel has `available`, so this resolves to the full list immediately.
 */
function useVisiblePanels(): RightPanelDef[] {
  const [avail, setAvail] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      for (const p of RIGHT_PANELS) {
        if (!p.available) continue;
        Promise.resolve(p.available())
          .then((ok) => {
            if (!cancelled) setAvail((a) => (a[p.id] === ok ? a : { ...a, [p.id]: ok }));
          })
          .catch(() => {});
      }
    };
    run();
    window.addEventListener("focus", run);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", run);
    };
  }, []);
  return RIGHT_PANELS.filter((p) => !p.available || avail[p.id]);
}
