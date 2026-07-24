import { useEffect, useState } from "react";
import Sessions from "../../sessions/Sessions";
import { onSessionsUpdate, sessionsSnapshot } from "../../../lib/sessions";

/**
 * The Claude-session panel as a registry entry. The body is the existing `Sessions` rail rendered in
 * its content-only `"body"` mode — RightRail owns the `<aside>` and the header, so the panel supplies
 * only what goes inside. Internally `Sessions` is unchanged.
 */
export function SessionsBody() {
  return <Sessions variant="body" />;
}

/**
 * The "N waiting" pill that used to live in the rail's own `.pane-title`. It's a header adornment now
 * (RightRail renders the header), so it subscribes to the same pushed snapshot on its own — one extra
 * cheap listener, kept separate so `Sessions` doesn't have to hand its state up to the host.
 */
export function SessionsBadge() {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    sessionsSnapshot().then((s) => !cancelled && setWaiting(s.waitingCount ?? 0));
    onSessionsUpdate((s) => setWaiting(s.waitingCount ?? 0)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return waiting > 0 ? <span className="waiting-badge">{waiting}</span> : null;
}
