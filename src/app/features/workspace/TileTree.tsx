import { Allotment } from "allotment";
import "allotment/dist/style.css";
import Icon from "../../components/Icon";
import TerminalView from "../terminal/TerminalView";
import { copyOrPaste, writeToPane } from "../terminal/terminalPool";
import HtmlViewer from "../viewer/HtmlViewer";
import MdViewer from "../viewer/MdViewer";
import { PANE_MIME, useDrag } from "./dragStore";
import { zoneFor } from "./dropZone";
import {
  Direction,
  DropZone,
  Leaf,
  makeTerminalLeaf,
  makeViewerLeaf,
  Node,
  viewerKindFor,
} from "./model";
import TintPicker from "./TintPicker";
import { useWorkspace } from "./store";
import { quotePath, ShellKind } from "../../lib/quote";

/**
 * An explorer entry dropped on a pane. Two rules cover the whole table: **centre keeps the old
 * behaviour** (insert the path, or retarget a viewer) and **an edge makes a new pane**. Because the old
 * behaviour survives intact at the centre, this is purely additive.
 */
async function dropEntry(
  payload: { path: string; isDir: boolean },
  leaf: Leaf,
  zone: DropZone,
  setActivePane: (id: string) => void,
): Promise<void> {
  const ws = useWorkspace.getState();
  const dir: Direction = zone === "top" || zone === "bottom" ? "column" : "row";
  const side = zone === "left" || zone === "top" ? "before" : "after";
  // `isDir` is carried in the payload, never derived: a *folder* named `notes.md` would otherwise open
  // in the markdown viewer.
  const kind = payload.isDir ? null : viewerKindFor(payload.path);

  if (zone !== "center") {
    if (payload.isDir) ws.splitPaneWith(leaf.id, dir, makeTerminalLeaf(payload.path), side);
    else if (kind) ws.splitPaneWith(leaf.id, dir, makeViewerLeaf(payload.path, kind), side);
    // Any other file at an edge: no zone was offered, so nothing happens. We don't guess.
    return;
  }

  if (leaf.content !== "terminal") {
    if (kind) ws.retargetViewer(leaf.id, payload.path, kind);
    return;
  }
  setActivePane(leaf.id);
  const quoted = await quotePath(payload.path, shellKind(leaf));
  writeToPane(leaf.id, quoted + " ");
}

/** Recursively render one tab's pane tree: leaves become panes, splits become Allotment rows/columns. */
export default function TileTree({ node }: { node: Node }) {
  if (node.kind === "leaf") return <PaneFrame leaf={node} />;

  // Allotment measures its children once on mount and never reconciles a changed child set — add,
  // remove, reorder or a flipped orientation all leave the old layout on screen until it remounts (which
  // is why switching tabs "fixed" a move, and why closing a pane could blank the survivors). Keying it on
  // the structure — orientation + child ids in order — remounts it exactly when the shape changes and
  // never merely on a divider drag (sizes aren't in the key). Pooled terminals survive the remount, so
  // the shells keep running; `preferredSize` restores the proportions from the (permuted) sizes.
  const structureKey = node.dir + ":" + node.children.map((c) => c.id).join(",");

  return (
    <Allotment
      key={structureKey}
      vertical={node.dir === "column"}
      onChange={(sizes) => useWorkspace.getState().updateSizes(node.id, sizes)}
    >
      {node.children.map((child, i) => (
        <Allotment.Pane key={child.id} preferredSize={node.sizes?.[i]}>
          <TileTree node={child} />
        </Allotment.Pane>
      ))}
    </Allotment>
  );
}

function PaneFrame({ leaf }: { leaf: Leaf }) {
  const active = useWorkspace((s) => s.activePaneId === leaf.id);
  const setActivePane = useWorkspace((s) => s.setActivePane);
  const splitPane = useWorkspace((s) => s.splitPane);
  const closePane = useWorkspace((s) => s.closePane);
  // Scalar selectors: this component must not re-render because some *other* pane is hovered.
  const dragging = useDrag((d) => d.payload !== null);
  const zone = useDrag((d) => (d.overPaneId === leaf.id ? d.zone : null));

  const onDragOver = (e: React.DragEvent) => {
    // Without preventDefault there is no `drop` event at all — the single most common HTML5 DnD bug.
    e.preventDefault();
    const inApp = useDrag.getState().payload;
    e.dataTransfer.dropEffect = inApp?.kind === "pane" ? "move" : "copy";
    const rect = e.currentTarget.getBoundingClientRect();
    const z = zoneFor(rect, e.clientX, e.clientY);
    useDrag.getState().over(leaf.id, z);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const drag = useDrag.getState();
    const payload = drag.payload;
    const z = drag.zone ?? "center";
    drag.end();

    if (payload?.kind === "pane") {
      // `center` is not a move (see `moveLeaf`) — dropping a pane on itself does nothing, loudly.
      useWorkspace.getState().movePane(payload.paneId, leaf.id, z);
      return;
    }
    if (payload?.kind === "path") {
      await dropEntry(payload, leaf, z, setActivePane);
      return;
    }
    // Nothing in the store → this came from outside the app. Only the OS file drop reaches here, and
    // only the centre behaviour is available for it (the filename isn't knowable during dragover).
    const raw = dropPath(e);
    if (!raw) return;
    setActivePane(leaf.id);
    // Quote in Rust (single source, table-tested): a dropped path is data, and a hostile filename must
    // not break out of its quotes into command execution. It's inserted as an argument, not run, so no
    // trailing newline — just a space so the next arg is separated.
    const quoted = await quotePath(raw, shellKind(leaf));
    writeToPane(leaf.id, quoted + " ");
  };

  return (
    <div
      className={"tile" + (active ? " active" : "")}
      // `--tint` resolves the palette index once, here, so the CSS never has to enumerate eight cases.
      data-tint={leaf.tint ? String(leaf.tint) : undefined}
      data-tint-fill={leaf.tintFill ? "1" : undefined}
      style={leaf.tint ? ({ ["--tint"]: `var(--tint-${leaf.tint})` } as React.CSSProperties) : undefined}
      onMouseDown={() => setActivePane(leaf.id)}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div
        className="tile-head"
        // Draggable on the header only. On `.tile` it would swallow xterm's text selection, which is
        // how you copy out of a terminal.
        draggable
        onDragStart={(e) => {
          // The buttons live inside the header; starting a drag from one is never what was meant.
          if ((e.target as HTMLElement).closest("button")) {
            e.preventDefault();
            return;
          }
          // Only the MIME goes on the transfer. Payload rides in the store because `getData` returns ""
          // during dragover — and a pane id in `text/plain` would get typed into a shell by `dropPath`.
          e.dataTransfer.setData(PANE_MIME, leaf.id);
          e.dataTransfer.effectAllowed = "move";
          useDrag.getState().begin({ kind: "pane", paneId: leaf.id });
        }}
      >
        <span className="tile-title">{leaf.title}</span>
        <span className="tile-actions">
          <TintPicker paneId={leaf.id} tint={leaf.tint} />
          <button draggable={false} title="좌우 분할" onClick={() => splitPane(leaf.id, "row")}>
            <Icon name="split-h" size={13} />
          </button>
          <button draggable={false} title="상하 분할" onClick={() => splitPane(leaf.id, "column")}>
            <Icon name="split-v" size={13} />
          </button>
          <button draggable={false} title="닫기" onClick={() => closePane(leaf.id)}>
            <Icon name="close" size={13} />
          </button>
        </span>
      </div>
      {dragging && zone && <span className={"drop-zone drop-" + zone} />}
      <div
        className="tile-body"
        // Terminals only: the viewers deliberately suppress their own context menu, and a menu-less
        // right-click that pastes into a document would be a surprise.
        onContextMenu={
          leaf.content === "terminal"
            ? (e) => {
                e.preventDefault();
                void copyOrPaste(leaf.id);
              }
            : undefined
        }
      >
        {leaf.content === "terminal" ? (
          <TerminalView leafId={leaf.id} cwd={leaf.cwd} />
        ) : leaf.content === "md" && leaf.path ? (
          <MdViewer path={leaf.path} />
        ) : leaf.content === "html" && leaf.path ? (
          <HtmlViewer path={leaf.path} />
        ) : (
          <div className="placeholder">?</div>
        )}
      </div>
    </div>
  );
}

/** Default shell is Git Bash today; PS quoting kicks in once M7 lets a pane use PowerShell. */
function shellKind(_leaf: Leaf): ShellKind {
  return "bash";
}

/** Pull a filesystem path out of a drop: the explorer sets text/plain, the OS uses files. */
function dropPath(e: React.DragEvent): string | null {
  const text = e.dataTransfer.getData("text/plain");
  if (text) return text;
  const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
  return file?.path ?? null;
}
