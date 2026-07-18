import Explorer from "./features/explorer/Explorer";
import Workspace from "./features/workspace/Workspace";
import { useWorkspace } from "./features/workspace/store";

/**
 * The three regions. Left = full filesystem explorer, centre = tabbed/tileable workspace, right =
 * session tree (M5). "Open terminal here" from the explorer opens the folder as its own tab.
 */
export default function App() {
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);

  return (
    <div className="deck">
      <Explorer onOpenTerminal={openTerminalTab} />

      <Workspace />

      <aside className="pane sessions">
        <div className="pane-title">세션</div>
        <div className="placeholder">M5</div>
      </aside>
    </div>
  );
}
