import { PATH_MIME, useDrag } from "../workspace/dragStore";

/**
 * Makes an explorer row a drag source. Spread onto the row element in both `FolderNav` and
 * `WorkspaceTree` — they render different trees but the drag contract is identical, and duplicating it
 * is how the two quietly drift apart.
 *
 * `isDir` travels in the payload because it cannot be recovered from the path: a *folder* called
 * `notes.md` would otherwise be opened in the markdown viewer.
 */
export function entryDragProps(path: string, isDir: boolean) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // The MIME is the signal for in-app targets; the payload lives in the store because `getData`
      // is unreadable during `dragover`, which is exactly when the drop zone has to be decided.
      e.dataTransfer.setData(PATH_MIME, JSON.stringify({ path, isDir }));
      // Also as text: dragging a path out to another app (or an OS shell) should still paste sensibly.
      e.dataTransfer.setData("text/plain", path);
      e.dataTransfer.effectAllowed = "copy";
      useDrag.getState().begin({ kind: "path", path, isDir });
    },
  };
}
