import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Clipboard access, with the Tauri plugin first and the web APIs as fallbacks.
 *
 * Order matters. `navigator.clipboard` inside WebView2 needs a secure context *and* live user
 * activation, and it drops that activation across an `await` — so a copy triggered from a handler
 * that does any async work first throws `NotAllowedError`. That is the "sometimes it copies,
 * sometimes it doesn't" people hit. The Rust plugin has neither constraint, so it leads; the web
 * paths stay behind it purely as a net.
 *
 * Both functions report success rather than throwing: a failed copy has to be recoverable at the
 * call site (and loud in the console), not an exception that unwinds a key handler.
 */

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await writeText(text);
    return true;
  } catch (e) {
    console.warn("[clipboard] plugin write failed, trying navigator", e);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[clipboard] navigator write failed, trying execCommand", e);
  }
  return legacyCopy(text);
}

export async function pasteText(): Promise<string | null> {
  try {
    return (await readText()) ?? null;
  } catch (e) {
    console.warn("[clipboard] plugin read failed, trying navigator", e);
  }
  try {
    return await navigator.clipboard.readText();
  } catch (e) {
    console.warn("[clipboard] navigator read failed", e);
  }
  // No legacy fallback for reads: `execCommand("paste")` is refused by every current engine.
  return null;
}

/**
 * Last resort: a detached textarea plus `execCommand("copy")`. Deprecated, still universally
 * implemented, and unlike the Async Clipboard API it works from a plain synchronous handler.
 */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  // Off-screen rather than `display: none` — a hidden element can't hold a selection.
  ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy");
  } catch (e) {
    console.warn("[clipboard] execCommand write failed", e);
    return false;
  } finally {
    ta.remove();
  }
}
