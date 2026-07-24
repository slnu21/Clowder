import Icon from "../../components/Icon";
import type { RightPanelDef, RightPanelId } from "./registry";

/**
 * The segmented icon strip in the rail header — one tab per available panel, shown only when there's
 * more than one (a single panel shows a plain label instead). Owns the "which panel" axis; the rail's
 * width axis (full/mini/hidden) stays on the TitleBar button, deliberately a separate control.
 */
export default function RailSwitch({
  panels,
  active,
  onPick,
}: {
  panels: RightPanelDef[];
  active: RightPanelId;
  onPick: (id: RightPanelId) => void;
}) {
  return (
    <div className="rail-switch" role="tablist">
      {panels.map((p) => (
        <button
          key={p.id}
          className={"rail-tab" + (p.id === active ? " on" : "")}
          role="tab"
          aria-selected={p.id === active}
          title={p.label}
          onClick={() => onPick(p.id)}
        >
          <Icon name={p.icon} size={14} />
          {p.Badge && <p.Badge />}
        </button>
      ))}
    </div>
  );
}
