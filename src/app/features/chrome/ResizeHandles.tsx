import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/**
 * Edge/corner grips that restore window resizing after `decorations: false` removed the native frame.
 * Each grip forwards a left-button press to the OS resize loop, so resizing feels native (including the
 * cursor and aero snap). Dragging the title bar keeps native move + snap; this covers the borders.
 */
const GRIPS = [
  ["n", "North"],
  ["s", "South"],
  ["e", "East"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
] as const;

export default function ResizeHandles() {
  return (
    <>
      {GRIPS.map(([cls, dir]) => (
        <div
          key={cls}
          className={"rz rz-" + cls}
          onMouseDown={(e) => {
            if (e.button === 0) void appWindow.startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
