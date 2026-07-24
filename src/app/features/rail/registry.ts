import type { ComponentType } from "react";
import type { IconName } from "../../components/Icon";
import type { RightPanelId } from "../../lib/settings";
import { SessionsBadge, SessionsBody } from "./panels/SessionsPanel";

export type { RightPanelId };

/**
 * A right-rail panel. Every panel renders **content only** — the host (`RightRail`) supplies the
 * `<aside>` shell and the header/switcher. The product thesis is that a panel's primary action spawns
 * a terminal pane or acts on the active one (ssh → `ssh host`, ports → kill, git → open terminal here);
 * the panel type itself only needs to say how to render and when it's worth showing.
 */
export type RightPanelDef = {
  id: RightPanelId;
  /** Korean label; also the plain header text when the switcher is hidden (a single available panel). */
  label: string;
  /** Switcher-tab glyph. Must exist in `Icon.tsx`'s closed `IconName` enum. */
  icon: IconName;
  /** Full-rail body: content only, no `<aside>`/`.pane-title`. */
  Body: ComponentType;
  /** Optional header adornment (e.g. sessions' "N waiting" pill). A component, not a hook, so switching
   *  panels mounts/unmounts it cleanly instead of reordering the host's hooks. */
  Badge?: ComponentType;
  /** Optional availability probe — omit for "always shown". A panel whose tool/config is absent returns
   *  false and simply drops out of the switcher (lean default: never show an unused panel). */
  available?: () => boolean | Promise<boolean>;
};

/** Sessions has no `available`: it's always shown when the rail is open — its body carries the
 *  install prompt for the "tracking off" state, so hiding it would hide the way to turn it on. */
export const SESSIONS: RightPanelDef = {
  id: "sessions",
  label: "세션",
  icon: "session-link",
  Body: SessionsBody,
  Badge: SessionsBadge,
};

/** The registry, in switcher order. New panels append here (ports, ssh, git, …). */
export const RIGHT_PANELS: RightPanelDef[] = [SESSIONS];
