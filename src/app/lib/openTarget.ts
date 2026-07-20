import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useExplorer } from "../features/explorer/store";
import { basename, makeViewerLeaf, viewerKindFor } from "../features/workspace/model";
import { useWorkspace } from "../features/workspace/store";
import { resolveLinkTarget } from "./tauri";

/**
 * Where a clicked piece of terminal text goes.
 *
 * One dispatcher for every source of links — the URL matcher, the path matcher, and OSC 8 hyperlinks
 * the program emitted itself — so all three land in the same places. Before this, none of them had a
 * destination at all: the two matchers didn't exist, and OSC 8 fell through to xterm's built-in
 * handler, which calls `window.open`. Inside a webview that hands the target to the OS, which is why
 * clicking a file path launched whatever was registered for `.md` — VS Code, for most people.
 *
 * The rules:
 * - **URL** → the default browser. Leaving the app is the whole point of a URL.
 * - **md / html / txt** → our own viewer, **beside the pane you clicked in** when there is one, so the
 *   output you were reading stays on screen; otherwise a tab of its own. This is the case that
 *   prompted the work.
 * - **directory** → the explorer navigates there, staying in the app.
 * - **any other file** → revealed in File Explorer, *not* launched. Opening a path should never be
 *   the same as running whatever program claims that extension; that is the behaviour being fixed,
 *   and reproducing it one layer down would be no better.
 */
export async function openTarget(raw: string, cwd?: string): Promise<void> {
  const text = raw.trim();
  if (!text) return;

  if (/^(https?|mailto):/i.test(text)) {
    await openUrl(text);
    return;
  }

  // `file://` URLs carry a percent-encoded path; decode it and hand it to the same resolver as
  // everything else rather than growing a second path pipeline.
  const candidate = /^file:\/\//i.test(text)
    ? decodeURIComponent(text.replace(/^file:\/\/\/?/i, ""))
    : text;

  const target = await resolveLinkTarget(cwd, candidate);
  if (!target) return;

  if (target.isDir) {
    useExplorer.getState().reveal(target.path);
    return;
  }
  const kind = viewerKindFor(basename(target.path));
  if (kind) {
    const ws = useWorkspace.getState();
    // Split beside the pane that produced the link — a document opened from terminal output is almost
    // always read *against* that output. Falls back to a tab when we don't know which pane asked.
    if (ws.activePaneId) ws.splitPaneWith(ws.activePaneId, "row", makeViewerLeaf(target.path, kind));
    else ws.openViewerTab(target.path, kind);
    return;
  }
  await revealItemInDir(target.path);
}
