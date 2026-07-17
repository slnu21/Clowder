import { useEffect, useState } from "react";
import { defaultRoot, listDir, listDrives, type Entry } from "../../lib/tauri";

/**
 * Full-filesystem explorer. Roots are drives; there is no workspace, which is the whole point —
 * VS Code's explorer is bound to the folder you opened, and that binding is what deck exists to
 * escape.
 *
 * **Children load on expand, one level at a time.** Never recursive: md-reader's `read_dir_tree`
 * walks to depth 8, which is right for importing a project and would hang on `C:\`.
 */
export default function Explorer({ onOpenTerminal }: { onOpenTerminal: (cwd: string) => void }) {
  const [roots, setRoots] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** path -> children. Absence means "not loaded yet"; an empty array means "loaded, empty". */
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map());
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);

  useEffect(() => {
    void (async () => {
      const drives = await listDrives();
      setRoots(drives);
      // Walk open to a sensible starting folder so the tree isn't a wall of drive letters.
      const start = await defaultRoot();
      if (start) void revealPath(start);
    })();
  }, []);

  async function load(path: string) {
    if (children.has(path)) return;
    try {
      const kids = await listDir(path);
      setChildren((m) => new Map(m).set(path, kids));
    } catch {
      // Permission denied, disconnected drive: mark it loaded-and-empty so we don't retry forever.
      setChildren((m) => new Map(m).set(path, []));
    }
  }

  /** Expand every ancestor of `path` so a deep default lands visible. */
  async function revealPath(path: string) {
    const parts = path.split("\\").filter(Boolean);
    let cur = parts[0] + "\\";
    const open: string[] = [cur];
    for (const p of parts.slice(1)) {
      cur = cur.endsWith("\\") ? cur + p : cur + "\\" + p;
      open.push(cur);
    }
    for (const p of open) await load(p);
    setExpanded(new Set(open));
  }

  async function toggle(entry: Entry) {
    if (!entry.isDir) return;
    const next = new Set(expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      await load(entry.path);
    }
    setExpanded(next);
  }

  return (
    <div className="pane explorer" onClick={() => setMenu(null)}>
      <div className="pane-title">탐색기</div>
      <div className="tree">
        {roots.map((r) => (
          <Node
            key={r.path}
            entry={r}
            depth={0}
            expanded={expanded}
            children_={children}
            onToggle={toggle}
            onMenu={(e, entry) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, entry });
            }}
          />
        ))}
      </div>

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
        </div>
      )}
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
        className={`row${entry.hidden ? " dim" : ""}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onToggle(entry)}
        onContextMenu={(e) => onMenu(e, entry)}
        title={entry.path}
      >
        <span className="twisty">{entry.isDir ? (isOpen ? "▾" : "▸") : ""}</span>
        <span className="icon">{entry.isDir ? "📁" : "📄"}</span>
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
