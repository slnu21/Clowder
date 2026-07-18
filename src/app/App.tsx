import Explorer from "./features/explorer/Explorer";
import Sessions from "./features/sessions/Sessions";
import Workspace from "./features/workspace/Workspace";
import { useWorkspace } from "./features/workspace/store";

/**
 * The three regions. Left = full filesystem explorer, centre = tabbed/tileable workspace, right =
 * session tree (M5). "Open terminal here" from the explorer opens the folder as its own tab.
 */
export default function App() {
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);
  const openViewerTab = useWorkspace((s) => s.openViewerTab);

  return (
    <div className="deck">
      <Explorer onOpenTerminal={openTerminalTab} onOpenFile={openViewerTab} />

      <Workspace />

      <Sessions />
    </div>
  );
}
