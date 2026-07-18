import { useState } from "react";
import Icon from "../../components/Icon";
import type { Entry } from "../../lib/tauri";
import SettingsPopover from "../settings/SettingsPopover";
import { viewerKindFor } from "../workspace/model";
import FolderNav from "./FolderNav";
import WorkspaceTree from "./WorkspaceTree";

/**
 * The left region: a two-tab panel over one shared right-click menu.
 * - **탐색기** — a single-folder navigator over the whole filesystem (roam anywhere; deck's reason to
 *   exist, since VS Code's explorer is bound to the folder you opened).
 * - **workspace** — a project tree scoped to the active terminal's launch folder.
 *
 * The context menu (여기서 터미널 열기 / 뷰어) lives here so both views share one instance.
 */
export default function Explorer({
  onOpenTerminal,
  onOpenFile,
}: {
  onOpenTerminal: (cwd: string) => void;
  onOpenFile: (path: string, kind: "md" | "html") => void;
}) {
  const [tab, setTab] = useState<"explorer" | "workspace">("explorer");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);

  const openMenu = (e: React.MouseEvent, entry: Entry) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  return (
    <div className="pane explorer" onClick={() => setMenu(null)}>
      <div className="side-tabs">
        <button
          type="button"
          className={"side-tab" + (tab === "explorer" ? " on" : "")}
          aria-pressed={tab === "explorer"}
          onClick={() => setTab("explorer")}
        >
          <Icon name="folder" size={13} />
          탐색기
        </button>
        <button
          type="button"
          className={"side-tab" + (tab === "workspace" ? " on" : "")}
          aria-pressed={tab === "workspace"}
          onClick={() => setTab("workspace")}
        >
          <Icon name="terminal" size={13} />
          workspace
        </button>
        <SettingsPopover />
      </div>

      {tab === "explorer" ? (
        <FolderNav onOpenFile={onOpenFile} onMenu={openMenu} />
      ) : (
        <WorkspaceTree onOpenFile={onOpenFile} onMenu={openMenu} />
      )}

      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }}>
          <button
            disabled={!menu.entry.isDir}
            onClick={() => {
              onOpenTerminal(menu.entry.path);
              setMenu(null);
            }}
          >
            여기서 터미널 열기
          </button>
          {(() => {
            const kind = menu.entry.isDir ? null : viewerKindFor(menu.entry.name);
            return (
              <button
                disabled={!kind}
                onClick={() => {
                  if (kind) onOpenFile(menu.entry.path, kind);
                  setMenu(null);
                }}
              >
                열기 (뷰어)
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}
