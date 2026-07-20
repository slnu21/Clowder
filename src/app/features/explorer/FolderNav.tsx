import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { entryDragProps } from "./useEntryDrag";
import { defaultRoot, listDir, listDrives, type Entry } from "../../lib/tauri";
import { useSettings } from "../settings/store";
import { basename, viewerKindFor } from "../workspace/model";
import { useExplorer } from "./store";
import { parentOf, sortEntries } from "./util";

/**
 * The 탐색기 tab: a single-folder navigator, not a growing tree. It shows one directory at a time with
 * a `..` row to step out; clicking a folder replaces the view with that folder. A drive root steps out
 * to the "내 컴퓨터" roots screen (favorites + drives). This is the whole point of deck's explorer —
 * roam the entire filesystem, unbound from any workspace.
 */
export default function FolderNav({
  onOpenFile,
  onMenu,
}: {
  onOpenFile: (path: string, kind: "md" | "html") => void;
  onMenu: (e: React.MouseEvent, entry: Entry) => void;
}) {
  const [cwd, setCwd] = useState<string | null>(null); // null = 내 컴퓨터 (roots)
  const [entries, setEntries] = useState<Entry[]>([]);
  const [drives, setDrives] = useState<Entry[]>([]);
  const favorites = useSettings((s) => s.settings.favorites);

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

  const favEntries: Entry[] = favorites.map((p) => ({ name: basename(p), path: p, isDir: true, hidden: false }));

  return (
    <>
      <div className="side-head">
        <button className="side-home" title="내 컴퓨터" onClick={() => void navigate(null)}>
          <Icon name="folder" size={14} />
        </button>
        <span className="path" title={cwd ?? "내 컴퓨터"}>
          {cwd ?? "내 컴퓨터"}
        </span>
      </div>

      <div className="tree">
        {cwd === null ? (
          <>
            {favEntries.length > 0 && <div className="tree-label">즐겨찾기</div>}
            {favEntries.map((e) => (
              <FolderRow key={"fav:" + e.path} entry={e} onActivate={activate} onMenu={onMenu} />
            ))}
            <div className="tree-label">드라이브</div>
            {drives.map((e) => (
              <FolderRow key={e.path} entry={e} onActivate={activate} onMenu={onMenu} />
            ))}
          </>
        ) : (
          <>
            <div className="row up" onClick={() => void navigate(parentOf(cwd))} title="상위 폴더">
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
