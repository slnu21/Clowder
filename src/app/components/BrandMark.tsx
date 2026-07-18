/**
 * The Clowder brand mark — the pixel-art tabby cat face from the app icon, in miniature (mirrored from
 * an 8-column left half). Fixed brand colours, not theme tokens, so it reads the same as the taskbar
 * icon in both themes. Used in the title bar.
 */
const LEFT = [
  "........",
  "..oo....",
  ".oooo...",
  ".ooppo..",
  ".ooooooo",
  ".oossooo",
  "oooooooo",
  "oooeeooo",
  "oooeeooo",
  "oooooooo",
  "ossoommm",
  "ooooommn",
  "ooooommm",
  ".ooooooo",
  "..oooooo",
  "....oooo",
];

const COLORS: Record<string, string> = {
  o: "#d99f56",
  p: "#5a3a22",
  s: "#b0702f",
  e: "#1c150e",
  m: "#f4e8d2",
  n: "#c9736a",
};

export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="brandmark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect width="16" height="16" rx="3.5" fill="#201d17" />
      {LEFT.flatMap((row, r) => {
        const full = [...row].concat([...row].reverse());
        return full.map((ch, x) => {
          const col = COLORS[ch];
          return col ? <rect key={`${r}-${x}`} x={x} y={r} width="1.02" height="1.02" fill={col} /> : null;
        });
      })}
    </svg>
  );
}
