/**
 * The icon set — Lucide line icons, inlined as SVG so nothing loads off the network (deck is offline)
 * and every glyph inherits `currentColor`. This replaces the emoji (📁 📄 ⚙ ▸ ⤷ …) that rendered at
 * inconsistent sizes and colours across fonts. Lucide is ISC-licensed; these paths are hand-carried.
 *
 * One shape per name; the wrapper fixes stroke width, alignment and sizing. Add a name here and it's
 * available everywhere — there is no other icon source in the app.
 */

export type IconName =
  | "folder"
  | "file"
  | "chevron-right"
  | "chevron-down"
  | "level-up"
  | "terminal"
  | "settings"
  | "split-h"
  | "split-v"
  | "close"
  | "session-link"
  | "plus"
  | "minimize"
  | "maximize"
  | "panel-left"
  | "panel-right";

const SHAPES: Record<IconName, React.ReactNode> = {
  folder: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </>
  ),
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "level-up": (
    <>
      <path d="m14 9-5-5-5 5" />
      <path d="M20 20h-7a4 4 0 0 1-4-4V4" />
    </>
  ),
  terminal: (
    <>
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </>
  ),
  settings: (
    <>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  "split-h": (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </>
  ),
  "split-v": (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 12h18" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  "session-link": (
    <>
      <polyline points="15 10 20 15 15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  minimize: <path d="M5 12h14" />,
  maximize: <rect width="14" height="14" x="5" y="5" rx="1.5" />,
  "panel-left": (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  "panel-right": (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </>
  ),
};

export default function Icon({
  name,
  size = 15,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={"icon" + (className ? " " + className : "")}
      // The `width`/`height` attributes stay as the unscaled fallback; CSS wins over SVG presentation
      // attributes, so `.icon`'s `calc(var(--icon-size) * var(--ui-scale))` scales all 25-odd call sites
      // without any of them changing.
      style={{ "--icon-size": size } as React.CSSProperties}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  );
}
