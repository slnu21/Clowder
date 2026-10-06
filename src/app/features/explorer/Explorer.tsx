import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { openFolderInExplorer, type Entry } from "../../lib/tauri";
import SettingsPopover from "../settings/SettingsPopover";
import { useSettings } from "../settings/store";
import { viewerKindFor } from "../workspace/model";
import { isFavorite, toggleFavorite } from "./favorites";
import FolderNav from "./FolderNav";
import { useExplorer } from "./store";
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
  const t = useT();
  const [tab, setTab] = useState<"explorer" | "workspace">("explorer");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const request = useExplorer((s) => s.request);
  const favorites = useSettings((s) => s.settings.favorites);
  const update = useSettings((s) => s.update);

  // A folder revealed from elsewhere has to bring its tab with it — FolderNav is unmounted while
  // workspace is showing, so the request would land nowhere.
  useEffect(() => {
    if (request) setTab("explorer");
  }, [request]);

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
          {t("explorer.tab")}
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
            {t("explorer.openTerminalHere")}
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
                {t("explorer.openInViewer")}
              </button>
            );
          })()}
          {/* Folders open as themselves; a file opens its parent with the file selected. */}
          <button
            onClick={() => {
              const { path, isDir } = menu.entry;
              void (isDir ? openFolderInExplorer(path) : revealItemInDir(path));
              setMenu(null);
            }}
          >
            {t("explorer.openInFileExplorer")}
          </button>
          {/* One toggle, so the menu never needs to know where the row came from: a row in the
              favourites section is by definition already a favourite, and reads "remove". Folders
              only — a file favourite would just fail silently when clicked (`listDir` throws and
              `navigate` swallows it). */}
          <button
            disabled={!menu.entry.isDir}
            onClick={() => {
              update({ favorites: toggleFavorite(favorites, menu.entry.path) });
              setMenu(null);
            }}
          >
            {isFavorite(favorites, menu.entry.path)
              ? t("explorer.removeFavorite")
              : t("explorer.addFavorite")}
          </button>
        </div>
      )}
    </div>
  );
}
