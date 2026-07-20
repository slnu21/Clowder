import { useState } from "react";
import Icon from "../../components/Icon";
import TileTree from "./TileTree";
import Welcome from "./Welcome";
import { useDrag } from "./dragStore";
import { useWorkspace } from "./store";

/**
 * The centre region: a tab strip over one visible pane tree. Only the active tab's tree is mounted;
 * hidden tabs' terminals stay alive in the pool, so switching back is instant and lossless.
 */
export default function Workspace() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const setActiveTab = useWorkspace((s) => s.setActiveTab);
  const closeTab = useWorkspace((s) => s.closeTab);
  const newTab = useWorkspace((s) => s.newTab);
  const detachPaneToNewTab = useWorkspace((s) => s.detachPaneToNewTab);
  const [detachArmed, setDetachArmed] = useState(false);

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <main className="pane workspace">
      {/* Dropping a pane on the empty part of the strip pulls it out into its own tab. Cross-tab
          merging is deliberately not offered: a tab button is a 1-D target that can't express "which
          pane, which side", and the destination tab isn't even mounted to preview. Detaching carries
          no such ambiguity. */}
      <div
        className={"tabstrip" + (detachArmed ? " detach-armed" : "")}
        onDragOver={(e) => {
          if (useDrag.getState().payload?.kind !== "pane") return;
          if (e.target !== e.currentTarget) return; // over a tab button, not the empty space
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDetachArmed(true);
        }}
        onDragLeave={(e) => e.target === e.currentTarget && setDetachArmed(false)}
        onDrop={(e) => {
          const payload = useDrag.getState().payload;
          setDetachArmed(false);
          if (payload?.kind !== "pane" || e.target !== e.currentTarget) return;
          e.preventDefault();
          useDrag.getState().end();
          detachPaneToNewTab(payload.paneId);
        }}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            className={"tab" + (t.id === activeTabId ? " active" : "")}
            onMouseDown={() => setActiveTab(t.id)}
            title={t.title}
          >
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              title="탭 닫기"
              onMouseDown={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        <button className="tab-new" title="새 탭" onClick={newTab}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="tabbody">{active ? <TileTree key={active.id} node={active.root} /> : <Welcome />}</div>
    </main>
  );
}
