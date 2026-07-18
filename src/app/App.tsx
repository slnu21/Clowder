import TitleBar from "./features/chrome/TitleBar";
import ResizeHandles from "./features/chrome/ResizeHandles";
import Explorer from "./features/explorer/Explorer";
import Sessions from "./features/sessions/Sessions";
import Workspace from "./features/workspace/Workspace";
import { useWorkspace } from "./features/workspace/store";

/**
 * The window: a custom title bar over the three regions. Left = full filesystem explorer, centre =
 * tabbed/tileable workspace, right = session tree. "Open terminal here" from the explorer opens the
 * folder as its own tab. `ResizeHandles` restores edge resizing under the frameless window.
 */
export default function App() {
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);
  const openViewerTab = useWorkspace((s) => s.openViewerTab);

  return (
    <div className="app-root">
      <TitleBar />

      <div className="deck">
        <Explorer onOpenTerminal={openTerminalTab} onOpenFile={openViewerTab} />

        <Workspace />

        <Sessions />
      </div>

      <ResizeHandles />
    </div>
  );
}
