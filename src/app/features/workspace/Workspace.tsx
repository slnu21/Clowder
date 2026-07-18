import Icon from "../../components/Icon";
import TileTree from "./TileTree";
import Welcome from "./Welcome";
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

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <main className="pane workspace">
      <div className="tabstrip">
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
