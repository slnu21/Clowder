import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { entryDragProps } from "./useEntryDrag";
import { defaultRoot, listDir, listDrives, type Entry } from "../../lib/tauri";
import { useSettings } from "../settings/store";
import { viewerKindFor } from "../workspace/model";
import { favLabel, isFavorite, toggleFavorite } from "./favorites";
import { useExplorer } from "./store";
import { parentOf, sortEntries } from "./util";

/**
 * The 탐색기 tab: a single-folder navigator, not a growing tree. It shows one directory at a time with
 * a `..` row to step out; clicking a folder replaces the view with that folder. A drive root steps out
 * to the "내 컴퓨터" roots screen. This is the whole point of deck's explorer — roam the entire
 * filesystem, unbound from any workspace.
 *
 * Favourites sit at the top of the tree **on both screens**. They used to render only on the roots
 * screen, which meant jumping between two projects required walking all the way back out; a
 * collapsible section costs one row when it's in the way and nothing at all when collapsed.
 */
export default function FolderNav({
  onOpenFile,
  onMenu,
}: {
  onOpenFile: (path: string, kind: "md" | "html") => void;
  onMenu: (e: React.MouseEvent, entry: Entry) => void;
}) {
  const t = useT();
  const [cwd, setCwd] = useState<string | null>(null); // null = the roots screen
  const [entries, setEntries] = useState<Entry[]>([]);
  const [drives, setDrives] = useState<Entry[]>([]);
  const [favOpen, setFavOpen] = useState(true);
  const favorites = useSettings((s) => s.settings.favorites);
  const update = useSettings((s) => s.update);

  const request = useExplorer((s) => s.request);

  useEffect(() => {
    void (async () => {
      setDrives(await listDrives());
      // A reveal request that arrived before we mounted wins: its effect has already navigated, and
      // resolving `defaultRoot` takes long enough that we would otherwise land on top of it.
      if (useExplorer.getState().request) return;
      const start = await defaultRoot();
      await navigate(start ?? null);
    })();
  }, []);

  // Someone outside the panel asked for a folder (a clicked path in terminal output). Same
  // `navigate` as a click, so an unreadable directory is handled the same way too.
  useEffect(() => {
    if (request) void navigate(request.path);
  }, [request]);

  async function navigate(path: string | null) {
    if (path === null) {
      setCwd(null);
      setEntries([]);
      return;
    }
    try {
      const kids = await listDir(path);
      setEntries(sortEntries(kids));
      setCwd(path);
    } catch {
      // Permission denied / disconnected drive — leave the current view in place.
    }
  }

  function activate(entry: Entry) {
    if (entry.isDir) {
      void navigate(entry.path);
      return;
    }
    const kind = viewerKindFor(entry.name);
    if (kind) onOpenFile(entry.path, kind);
  }

  const favEntries: Entry[] = favorites.map((p) => ({
    name: favLabel(p),
    path: p,
    isDir: true,
    hidden: false,
  }));
  const pinned = cwd !== null && isFavorite(favorites, cwd);

  return (
    <>
      <div className="side-head">
        <button className="side-home" title={t("explorer.myComputer")} onClick={() => void navigate(null)}>
          <Icon name="folder" size={14} />
        </button>
        <span className="path" title={cwd ?? t("explorer.myComputer")}>
          {cwd ?? t("explorer.myComputer")}
        </span>
        {/* Pin the folder you're standing in. Deliberately *not* the disclosure control for the list
            below — reaching for "show me my favourites" must never quietly unpin the current one. */}
        {cwd !== null && (
          <button
            className={"side-fav" + (pinned ? " on" : "")}
            title={pinned ? t("explorer.removeFavorite") : t("explorer.addFavorite")}
            aria-label={pinned ? t("explorer.removeFavorite") : t("explorer.addFavorite")}
            aria-pressed={pinned}
            onClick={() => update({ favorites: toggleFavorite(favorites, cwd) })}
          >
            <Icon name="star" size={14} />
          </button>
        )}
      </div>

      <div className="tree">
        {favEntries.length > 0 && (
          <>
            <button
              type="button"
              className="tree-group"
              aria-expanded={favOpen}
              onClick={() => setFavOpen((open) => !open)}
            >
              <Icon name={favOpen ? "chevron-down" : "chevron-right"} size={12} />
              <span>{t("common.favorites")}</span>
              <span className="tree-group-count">{favEntries.length}</span>
            </button>
            {favOpen &&
              favEntries.map((e) => (
                <FolderRow key={"fav:" + e.path} entry={e} onActivate={activate} onMenu={onMenu} />
              ))}
          </>
        )}

        {cwd === null ? (
          <>
            <div className="tree-label">{t("explorer.drives")}</div>
            {drives.map((e) => (
              <FolderRow key={e.path} entry={e} onActivate={activate} onMenu={onMenu} />
            ))}
          </>
        ) : (
          <>
            <div className="row up" onClick={() => void navigate(parentOf(cwd))} title={t("explorer.parentFolder")}>
              <span className="twisty">
                <Icon name="level-up" size={12} />
              </span>
              <span className="name">..</span>
            </div>
            {entries.map((e) => (
              <FolderRow key={e.path} entry={e} onActivate={activate} onMenu={onMenu} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function FolderRow({
  entry,
  onActivate,
  onMenu,
}: {
  entry: Entry;
  onActivate: (e: Entry) => void;
  onMenu: (ev: React.MouseEvent, e: Entry) => void;
}) {
  return (
    <div
      className={"row" + (entry.hidden ? " dim" : "")}
      {...entryDragProps(entry.path, entry.isDir)}
      onClick={() => onActivate(entry)}
      onContextMenu={(e) => onMenu(e, entry)}
      title={entry.path}
    >
      <span className="twisty" />
      <Icon name={entry.isDir ? "folder" : "file"} className={entry.isDir ? "folder" : "file"} size={14} />
      <span className="name">{entry.name}</span>
      {entry.isDir && <Icon name="chevron-right" size={13} className="chev" />}
    </div>
  );
}
