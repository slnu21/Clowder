import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { listDir, type Entry } from "../../lib/tauri";
import { basename, viewerKindFor } from "../workspace/model";
import { sortEntries, useActiveCwd } from "./util";

/**
 * The workspace tab: a project tree **rooted at the folder the active terminal was launched in**. Unlike
 * the 탐색기 tab it stays bounded to that subtree, so an expanding tree (VS Code-style) is the right
 * shape here. It follows tab/pane focus — switch to a terminal opened elsewhere and the root re-roots.
 */
export default function WorkspaceTree({
  onOpenFile,
  onMenu,
}: {
  onOpenFile: (path: string, kind: "md" | "html") => void;
  onMenu: (e: React.MouseEvent, entry: Entry) => void;
}) {
  const cwd = useActiveCwd();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map());

  // Re-root whenever the active terminal's folder changes.
  useEffect(() => {
    setExpanded(new Set());
    setChildren(new Map());
    if (cwd) void load(cwd).then(() => setExpanded(new Set([cwd])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  async function load(path: string) {
    try {
      const kids = await listDir(path);
      setChildren((m) => new Map(m).set(path, sortEntries(kids)));
    } catch {
      setChildren((m) => new Map(m).set(path, []));
    }
  }

  async function toggle(entry: Entry) {
    if (!entry.isDir) return;
    const next = new Set(expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      if (!children.has(entry.path)) await load(entry.path);
    }
    setExpanded(next);
  }

  function activate(entry: Entry) {
    if (entry.isDir) {
      void toggle(entry);
      return;
    }
    const kind = viewerKindFor(entry.name);
    if (kind) onOpenFile(entry.path, kind);
  }

  if (!cwd) {
    return <div className="placeholder">활성 터미널 없음</div>;
  }

  const root: Entry = { name: basename(cwd), path: cwd, isDir: true, hidden: false };

  return (
    <div className="tree">
      <Node entry={root} depth={0} expanded={expanded} children_={children} onToggle={activate} onMenu={onMenu} />
    </div>
  );
}

function Node({
  entry,
  depth,
  expanded,
  children_,
  onToggle,
  onMenu,
}: {
  entry: Entry;
  depth: number;
  expanded: Set<string>;
  children_: Map<string, Entry[]>;
  onToggle: (e: Entry) => void;
  onMenu: (ev: React.MouseEvent, e: Entry) => void;
}) {
  const isOpen = expanded.has(entry.path);
  const kids = children_.get(entry.path);

  return (
    <>
      <div
        className={"row" + (entry.hidden ? " dim" : "")}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onToggle(entry)}
        onContextMenu={(e) => onMenu(e, entry)}
        title={entry.path}
      >
        <span className="twisty">
          {entry.isDir ? <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} /> : null}
        </span>
        <Icon name={entry.isDir ? "folder" : "file"} className={entry.isDir ? "folder" : "file"} size={14} />
        <span className="name">{entry.name}</span>
      </div>

      {isOpen &&
        kids?.map((k) => (
          <Node
            key={k.path}
            entry={k}
            depth={depth + 1}
            expanded={expanded}
            children_={children_}
            onToggle={onToggle}
            onMenu={onMenu}
          />
        ))}
    </>
  );
}
