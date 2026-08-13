/**
 * What "the same favourite folder" means.
 *
 * Favourites are plain paths in `Settings.favorites` — deliberately still `string[]`, because
 * `settings.rs` parses the whole settings file with a struct-level `#[serde(default)]` and falls back
 * to `Settings::default()` on any type mismatch. Promoting this one field to a struct would silently
 * reset a user's fonts, theme, language and shell path along with it, and nothing here needs more
 * than a path.
 *
 * A **leaf module**: it imports nothing from `features/`, so the node-only vitest run doesn't drag
 * zustand and xterm in behind it.
 */

/** Trailing separators are noise — except on a drive root, where `C:\` *is* the path. */
export function normalizeFavPath(p: string): string {
  const trimmed = p.trim();
  if (/^[A-Za-z]:[\\/]*$/.test(trimmed)) return trimmed.slice(0, 2) + "\\";
  return trimmed.replace(/[\\/]+$/, "");
}

/**
 * Windows paths are case-insensitive and either separator works, so comparison folds both. Without
 * this, adding `C:\Users\me\deck` and then hitting the star while the terminal reports
 * `c:/users/me/deck` (OSC 7 casing is whatever the shell printed) silently makes a second entry.
 */
function foldPath(p: string): string {
  return normalizeFavPath(p).replace(/\//g, "\\").toLowerCase();
}

export function isFavorite(favs: readonly string[], p: string): boolean {
  const key = foldPath(p);
  return key !== "" && favs.some((f) => foldPath(f) === key);
}

export function removeFavorite(favs: readonly string[], p: string): string[] {
  const key = foldPath(p);
  return favs.filter((f) => foldPath(f) !== key);
}

/** Add if missing, remove if present. Stores the user's own casing; compares folded. */
export function toggleFavorite(favs: readonly string[], p: string): string[] {
  const norm = normalizeFavPath(p);
  if (!norm) return [...favs];
  return isFavorite(favs, norm) ? removeFavorite(favs, norm) : [...favs, norm];
}

/** Row label. A drive root has no basename, so show the root itself rather than an empty row. */
export function favLabel(p: string): string {
  const norm = normalizeFavPath(p);
  if (/^[A-Za-z]:\\$/.test(norm)) return norm;
  return norm.split(/[\\/]/).filter(Boolean).pop() ?? norm;
}
