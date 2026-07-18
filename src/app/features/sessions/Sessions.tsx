import { useEffect, useState } from "react";
import {
  onSessionsUpdate,
  sessionsSnapshot,
  type SessionsSnapshot,
  type SessionView,
} from "../../lib/sessions";

const STATUS_LABEL: Record<string, string> = {
  awaiting_permission: "승인 대기",
  awaiting_input: "내 차례",
  working: "동작 중",
  idle: "유휴",
  dead: "종료됨",
};

/**
 * Right rail: every live Claude Code session the beacon spool knows about, ranked so the ones that
 * need the user (permission / my-turn) sit on top. Read-only — the state lives in Rust; this renders
 * the pushed snapshot and ticks the elapsed clocks locally.
 */
export default function Sessions() {
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

  const sessions = snap?.sessions ?? [];
  const waiting = snap?.waitingCount ?? 0;

  return (
    <aside className="pane sessions">
      <div className="pane-title">
        세션
        {waiting > 0 && <span className="waiting-badge">{waiting}</span>}
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="placeholder">세션 없음</div>
        ) : (
          sessions.map((s) => <SessionRow key={s.sessionId} s={s} now={now} />)
        )}
      </div>

      {snap && <UsageFooter usage={snap.usage} />}
    </aside>
  );
}

function SessionRow({ s, now }: { s: SessionView; now: number }) {
  return (
    <div className={"session " + s.status}>
      <div className="session-head">
        <span className={"badge " + s.status} />
        <span className="session-project">{s.project}</span>
        <span className="session-elapsed">{elapsed(s.statusSince, now)}</span>
      </div>
      <div className="session-meta">
        <span className="session-status">{STATUS_LABEL[s.status] ?? s.status}</span>
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

function UsageFooter({ usage }: { usage: SessionsSnapshot["usage"] }) {
  const has = usage.fiveHourPct != null || usage.sevenDayPct != null;
  if (!has) return null;
  return (
    <div className="usage-footer">
      {usage.fiveHourPct != null && <UsageBar label="5시간" pct={usage.fiveHourPct} />}
      {usage.sevenDayPct != null && <UsageBar label="7일" pct={usage.sevenDayPct} />}
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
