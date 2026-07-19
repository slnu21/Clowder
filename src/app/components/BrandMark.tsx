/**
 * The Clowder brand mark — the tiled-panes app icon (Clowder's identity: organized parallel sessions)
 * in miniature: two diagonal amber cells, two muted, on a warm-dark rounded square. Fixed brand colours
 * (not theme tokens) so it reads the same as the taskbar icon in both themes. Used in the title bar.
 */
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect width="1024" height="1024" rx="224" fill="#201d17" />
      <rect x="268" y="268" width="216" height="216" rx="44" fill="#d0a45f" />
      <rect x="540" y="268" width="216" height="216" rx="44" fill="#37342d" />
      <rect x="268" y="540" width="216" height="216" rx="44" fill="#37342d" />
      <rect x="540" y="540" width="216" height="216" rx="44" fill="#d0a45f" />
    </svg>
  );
}
