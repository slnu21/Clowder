import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "../../components/Icon";
import { useT, type MsgKey } from "../../lib/i18n";
import { beaconInstall, beaconStatus, beaconUninstall } from "../../lib/beacon";
import type { BeaconStatus, StatuslineMode } from "../../lib/beacon";
import { useFocusRefresh } from "../../lib/useFocusRefresh";
import { leafIdForPty } from "../terminal/terminalPool";
import { useWorkspace } from "../workspace/store";
import {
  onSessionsUpdate,
  sessionDismiss,
  sessionsDismissDead,
  sessionsSnapshot,
  type SessionsSnapshot,
  type SessionView,
} from "../../lib/sessions";

/** Spool status → catalogue key. Resolved at render time so the rail re-labels on a language switch. */
const STATUS_KEY: Record<string, MsgKey> = {
  awaiting_permission: "sessions.statusAwaitingPermission",
  awaiting_input: "sessions.statusAwaitingInput",
  working: "sessions.statusWorking",
  idle: "sessions.statusIdle",
  dead: "sessions.statusDead",
};

/**
 * Right rail: every live Claude Code session the beacon spool knows about, ranked so the ones that
 * need the user (permission / my-turn) sit on top. Read-only — the state lives in Rust; this renders
 * the pushed snapshot and ticks the elapsed clocks locally.
 */
export default function Sessions({ variant = "full" }: { variant?: "full" | "mini" | "body" }) {
  const t = useT();
  const [snap, setSnap] = useState<SessionsSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    sessionsSnapshot().then((s) => !cancelled && setSnap(s));
    onSessionsUpdate((s) => setSnap(s)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Tick once a second so the elapsed clocks advance without a new snapshot.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Tracking state. `null` while loading (don't flash the prompt). Two halves — hooks and statusline —
  // because usage only ever arrives through the second one.
  const [status, setStatus] = useState<BeaconStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const refresh = () => beaconStatus().then(setStatus).catch(() => {});
  // Refetch on focus, not just on mount: settings.json is edited outside this app all the time (by the
  // user, by an uninstall, by another tool) and a stale "installed" is the thing we're fixing. Throttled
  // — a one-second alt-tab can't have changed it, and eight panels doing this at once is what froze
  // typing on window return.
  useEffect(() => {
    refresh();
  }, []);
  useFocusRefresh(refresh);

  const install = async (mode?: StatuslineMode) => {
    setBusy(true);
    setAsking(false);
    try {
      await beaconInstall(mode);
      await refresh();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(false);
    }
  };
  // Only a user with no statusline of their own gets a choice — wrapping an existing one is invisible
  // to them, so asking would be noise.
  const startInstall = () => (status?.userStatusline ? install() : setAsking(true));
  const uninstall = async () => {
    setBusy(true);
    try {
      await beaconUninstall();
      await refresh();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(false);
    }
  };

  const off = status !== null && !status.hooks;
  // Hooks landed but usage can't arrive — the exact state the old single boolean reported as "installed".
  const partial = status !== null && status.hooks && !status.statusline;

  const sessions = snap?.sessions ?? [];
  const waiting = snap?.waitingCount ?? 0;

  // The narrow rail is a glance, not a panel: status colour, a vertical name, and the budgets. Install
  // prompts and prose belong to the full rail — there is no room to say anything honestly in 40px.
  if (variant === "mini") {
    return (
      <aside className="pane sessions sessions-mini" title={t("sessions.railMini")}>
        {waiting > 0 && <span className="mini-waiting">{waiting}</span>}
        <div className="mini-list">
          {sessions.map((s) => (
            <MiniSession key={s.sessionId} s={s} />
          ))}
        </div>
        <MiniUsage usage={snap?.usage} topCtx={sessions[0]?.ctxPercent ?? null} />
      </aside>
    );
  }

  // The inner content, shared by the self-contained `full` rail and the host-embedded `body`. In
  // `body` mode RightRail supplies the <aside> shell and the header (with the waiting badge), so the
  // panel returns only what goes inside.
  const body = (
    <>
      {/* Only when there's something to sweep — otherwise it costs a row of a narrow rail for nothing. */}
      {sessions.some((s) => s.status === "dead") && (
        <button className="session-sweep" onClick={() => void sessionsDismissDead()}>
          {t("sessions.dismissDead")}
        </button>
      )}
      <div className="session-list">
        {asking ? (
          <div className="track-prompt">
            <div className="track-title">{t("sessions.statuslineTitle")}</div>
            <p className="track-desc">
              {t("sessions.statuslineBody")}
            </p>
            <button className="track-btn" onClick={() => install("none")} disabled={busy}>
              {t("sessions.statuslineUsageOnly")}
            </button>
            <button className="track-btn track-btn-alt" onClick={() => install("clowder")} disabled={busy}>
              {t("sessions.statuslineClowder")}
            </button>
          </div>
        ) : off ? (
          <div className="track-prompt">
            <div className="track-title">{t("sessions.offTitle")}</div>
            <p className="track-desc">
              {t("sessions.offBody")}
            </p>
            <button className="track-btn" onClick={startInstall} disabled={busy}>
              {busy ? t("sessions.installing") : t("sessions.install")}
            </button>
          </div>
        ) : partial ? (
          <div className="track-prompt track-warn">
            <div className="track-title">{t("sessions.brokenTitle")}</div>
            <p className="track-desc">
              {t("sessions.brokenBody")}
            </p>
            <button className="track-btn" onClick={startInstall} disabled={busy}>
              {busy ? t("sessions.installing") : t("sessions.reinstall")}
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="placeholder">{t("sessions.none")}</div>
        ) : (
          sessions.map((s) => <SessionRow key={s.sessionId} s={s} now={now} />)
        )}
      </div>

      {snap && <UsageFooter usage={snap.usage} />}

      {/* Where the beacon lives — the thing that was invisible before. `binary` is honest now that the
          home is off virtualized AppData, so a false one is a real "the CLI can't find it" state. */}
      {status?.hooks && status.binDir && (
        <div className={"track-loc" + (status.binary ? "" : " track-loc-warn")}>
          <span className="track-loc-label">{status.binary ? t("sessions.trackLoc") : t("sessions.trackMissing")}</span>
          <span className="track-loc-path" title={status.binDir}>{status.binDir}</span>
          <button
            className="track-loc-open"
            onClick={() => void revealItemInDir(status.binDir!)}
            title={t("sessions.openFolder")}
          >
            {t("common.open")}
          </button>
        </div>
      )}

      {status?.hooks && (
        <button
          className="track-off"
          onClick={uninstall}
          disabled={busy}
          title={t("sessions.uninstallTitle")}
        >
          {t("sessions.uninstall")}
        </button>
      )}
    </>
  );

  if (variant === "body") return body;

  return (
    <aside className="pane sessions">
      <div className="pane-title">
        {t("sessions.header")}
        {waiting > 0 && <span className="waiting-badge">{waiting}</span>}
      </div>
      {body}
    </aside>
  );
}

function SessionRow({ s, now }: { s: SessionView; now: number }) {
  const t = useT();
  const focusLeaf = useWorkspace((w) => w.focusLeaf);
  // A correlated session (paneId set) still resolves to a live tile only if that pane is still open.
  const linkedLeaf = s.paneId != null ? leafIdForPty(s.paneId) : undefined;

  return (
    <div
      className={
        "session " + s.status + (linkedLeaf ? " linked" : "") + (s.ownerUnknown ? " owner-unknown" : "")
      }
      onMouseDown={() => linkedLeaf && focusLeaf(linkedLeaf)}
      title={linkedLeaf ? t("sessions.jumpToPane") : undefined}
    >
      <div className="session-head">
        <span className={"badge " + s.status} />
        <span className="session-project">{s.project}</span>
        {linkedLeaf && (
          <span className="session-link" title={t("sessions.runningHere")}>
            <Icon name="session-link" size={13} />
          </span>
        )}
        {/* Liveness can't judge this one, so it will never clear itself — say so rather than let the
            user wonder why it won't go away. Its dismiss button stays visible for the same reason. */}
        {s.ownerUnknown && (
          <span className="session-unknown" title={t("sessions.ownerUnknown")}>
            ?
          </span>
        )}
        <span className="session-elapsed">{elapsed(s.statusSince, now)}</span>
        <button
          className="session-dismiss"
          title={t("sessions.dismiss")}
          aria-label={t("sessions.dismiss")}
          // The card's own onMouseDown jumps to the pane; without this, removing a card also moves
          // focus somewhere the user didn't ask to go.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void sessionDismiss(s.sessionId).catch(() => {})}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
      <div className="session-meta">
        <span className="session-status">{STATUS_KEY[s.status] ? t(STATUS_KEY[s.status]) : s.status}</span>
        {s.toolName && <span className="session-tool">· {s.toolName}</span>}
        {s.ctxPercent != null && (
          <span className="session-ctx" title={s.ctxTokens ?? undefined}>
            · ctx {Math.round(s.ctxPercent)}%
          </span>
        )}
      </div>
      {s.subagents.length > 0 && (
        <div className="subagents">
          {s.subagents.map((a) => (
            <div className="subagent" key={a.agentId}>
              <span className="subagent-dot" />
              <span className="subagent-name">{a.agentType ?? "agent"}</span>
              {a.description && <span className="subagent-desc">{a.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One session as a vertical chip: status stripe + name written top-to-bottom. */
function MiniSession({ s }: { s: SessionView }) {
  const t = useT();
  const focusLeaf = useWorkspace((w) => w.focusLeaf);
  const linkedLeaf = s.paneId != null ? leafIdForPty(s.paneId) : undefined;
  const label = [
    s.project,
    STATUS_KEY[s.status] ? t(STATUS_KEY[s.status]) : s.status,
    s.ctxPercent != null ? `ctx ${Math.round(s.ctxPercent)}%` : null,
    s.toolName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={"mini-session " + s.status + (linkedLeaf ? " linked" : "")}
      onMouseDown={() => linkedLeaf && focusLeaf(linkedLeaf)}
      title={label}
    >
      {/* `vertical-rl` + `text-orientation: mixed` keeps Hangul upright while Latin rotates — the
          alternative (`upright`) stacks Latin letter by letter and eats the whole rail. */}
      <span className="mini-name">{s.project}</span>
    </div>
  );
}

/** Budgets as vertical meters, filling from the bottom. */
function MiniUsage({ usage, topCtx }: { usage?: SessionsSnapshot["usage"]; topCtx: number | null }) {
  const t = useT();
  const meters: Array<{ key: string; label: string; pct: number; title: string }> = [];
  if (topCtx != null)
    meters.push({ key: "ctx", label: "C", pct: topCtx, title: t("sessions.meterCtx", { pct: Math.round(topCtx) }) });
  if (usage?.fiveHourPct != null)
    meters.push({
      key: "5h",
      label: "5",
      pct: usage.fiveHourPct,
      title: t("sessions.meterFiveHour", { pct: Math.round(usage.fiveHourPct) }),
    });
  if (usage?.sevenDayPct != null)
    meters.push({
      key: "7d",
      label: "7",
      pct: usage.sevenDayPct,
      title: t("sessions.meterSevenDay", { pct: Math.round(usage.sevenDayPct) }),
    });
  if (meters.length === 0) return null;

  return (
    <div className="mini-usage">
      {meters.map((m) => (
        <span className="mini-meter" key={m.key} title={m.title}>
          <span className="mini-meter-track">
            <span className="mini-meter-fill" style={{ height: `${Math.min(100, Math.max(0, m.pct))}%` }} />
          </span>
          <span className="mini-meter-label">{m.label}</span>
        </span>
      ))}
    </div>
  );
}

function UsageFooter({ usage }: { usage: SessionsSnapshot["usage"] }) {
  const t = useT();
  const has = usage.fiveHourPct != null || usage.sevenDayPct != null;
  if (!has) return null;
  return (
    <div className="usage-footer">
      {usage.fiveHourPct != null && <UsageBar label={t("sessions.fiveHour")} pct={usage.fiveHourPct} />}
      {usage.sevenDayPct != null && <UsageBar label={t("sessions.sevenDay")} pct={usage.sevenDayPct} />}
    </div>
  );
}

function UsageBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="usage-row">
      <span className="usage-label">{label}</span>
      <span className="usage-track">
        <span className="usage-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      <span className="usage-pct">{Math.round(pct)}%</span>
    </div>
  );
}

/** "m:ss" under an hour, "h:mm:ss" over. */
function elapsed(sinceIso: string | null | undefined, now: number): string {
  if (!sinceIso) return "";
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return "";
  let s = Math.max(0, Math.floor((now - t) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h >= 1 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
