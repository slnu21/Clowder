import TitleBar from "./features/chrome/TitleBar";
import ResizeHandles from "./features/chrome/ResizeHandles";
import { useRailMode, useTrackingProbe } from "./features/chrome/panels";
import Explorer from "./features/explorer/Explorer";
import Sessions from "./features/sessions/Sessions";
import Workspace from "./features/workspace/Workspace";
import { useSettings } from "./features/settings/store";
import { useWorkspace } from "./features/workspace/store";
import type { RailMode } from "./lib/settings";

/**
 * The window: a custom title bar over the three regions. Left = full filesystem explorer, centre =
 * tabbed/tileable workspace, right = session tree. "Open terminal here" from the explorer opens the
 * folder as its own tab. `ResizeHandles` restores edge resizing under the frameless window.
 */
export default function App() {
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);
  const openViewerTab = useWorkspace((s) => s.openViewerTab);
  const leftPanel = useSettings((s) => s.settings.leftPanel);
  const rail = useRailMode();
  useTrackingProbe();

  return (
    <div className="app-root">
      <TitleBar />

      {/* Widths are CSS variables keyed off these attributes — the panes themselves don't know they're
          collapsible. Collapsed panes stay **mounted** and are hidden in CSS: dropping a child would let
          grid auto-placement slide the workspace into the collapsed 0px column. */}
      <div className="deck" data-left={leftPanel ? "on" : "off"} data-rail={railAttr(rail)}>
        <Explorer onOpenTerminal={openTerminalTab} onOpenFile={openViewerTab} />

        <Workspace />

        <Sessions variant={rail === "mini" ? "mini" : "full"} />
      </div>

      <ResizeHandles />
    </div>
  );
}

/** `full` needs no attribute — it's the width the grid already declares. */
function railAttr(rail: RailMode): string | undefined {
  return rail === "full" ? undefined : rail === "mini" ? "mini" : "off";
}
