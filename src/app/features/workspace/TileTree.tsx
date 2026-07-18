import { Allotment } from "allotment";
import "allotment/dist/style.css";
import TerminalView from "../terminal/TerminalView";
import { writeToPane } from "../terminal/terminalPool";
import HtmlViewer from "../viewer/HtmlViewer";
import MdViewer from "../viewer/MdViewer";
import { Leaf, Node } from "./model";
import { useWorkspace } from "./store";
import { quotePath, ShellKind } from "../../lib/quote";

/** Recursively render one tab's pane tree: leaves become panes, splits become Allotment rows/columns. */
export default function TileTree({ node }: { node: Node }) {
  if (node.kind === "leaf") return <PaneFrame leaf={node} />;

  return (
    <Allotment
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

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
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
      onMouseDown={() => setActivePane(leaf.id)}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="tile-head">
        <span className="tile-title">{leaf.title}</span>
        <span className="tile-actions">
          <button title="좌우 분할" onClick={() => splitPane(leaf.id, "row")}>
            ⇔
          </button>
          <button title="상하 분할" onClick={() => splitPane(leaf.id, "column")}>
            ⇕
          </button>
          <button title="닫기" onClick={() => closePane(leaf.id)}>
            ×
          </button>
        </span>
      </div>
      <div className="tile-body">
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
