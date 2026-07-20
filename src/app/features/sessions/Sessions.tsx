import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { beaconInstall, beaconStatus, beaconUninstall } from "../../lib/beacon";
import type { BeaconStatus, StatuslineMode } from "../../lib/beacon";
import { leafIdForPty } from "../terminal/terminalPool";
import { useWorkspace } from "../workspace/store";
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

  // Tracking state. `null` while loading (don't flash the prompt). Two halves — hooks and statusline —
  // because usage only ever arrives through the second one.
  const [status, setStatus] = useState<BeaconStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const refresh = () => beaconStatus().then(setStatus).catch(() => {});
  // Refetch on focus, not just on mount: settings.json is edited outside this app all the time (by the
  // user, by an uninstall, by another tool) and a stale "installed" is the thing we're fixing.
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

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

  return (
    <aside className="pane sessions">
      <div className="pane-title">
        세션
        {waiting > 0 && <span className="waiting-badge">{waiting}</span>}
      </div>

      <div className="session-list">
        {asking ? (
          <div className="track-prompt">
            <div className="track-title">상태줄을 쓸까요?</div>
            <p className="track-desc">
              사용량(컨텍스트·5시간·7일)은 Claude Code 상태줄로 들어옵니다. 지금 쓰는 상태줄이 없어서,
              Clowder가 상태줄에 무엇을 그릴지 고를 수 있어요. 나중에 끄면 상태줄 설정은 원래대로
              (없던 상태로) 돌아갑니다.
            </p>
            <button className="track-btn" onClick={() => install("none")} disabled={busy}>
              사용량만 수집 (상태줄 비움)
            </button>
            <button className="track-btn track-btn-alt" onClick={() => install("clowder")} disabled={busy}>
              Clowder 상태줄 쓰기 (폴더·모델·ctx·5h)
            </button>
          </div>
        ) : off ? (
          <div className="track-prompt">
            <div className="track-title">세션 추적이 꺼져 있어요</div>
            <p className="track-desc">
              설치하면 실행 중인 Claude Code 세션·상태와 사용량(컨텍스트·5시간·7일)이 여기 표시됩니다.
              Claude Code 훅을 추가하고 상태줄(statusline)로 사용량을 읽습니다. 기존 상태줄과 설정은
              백업·보존해, 끄면 원래대로 되돌립니다.
            </p>
            <button className="track-btn" onClick={startInstall} disabled={busy}>
              {busy ? "설치 중…" : "세션 추적 설치"}
            </button>
          </div>
        ) : partial ? (
          <div className="track-prompt track-warn">
            <div className="track-title">사용량 수집이 끊겨 있어요</div>
            <p className="track-desc">
              세션 훅은 설치돼 있지만 상태줄이 Clowder에 연결돼 있지 않습니다 — 세션 목록은 뜨고
              사용량(컨텍스트·5시간·7일)만 비어 있는 상태예요. 다시 설치하면 상태줄만 연결합니다.
            </p>
            <button className="track-btn" onClick={startInstall} disabled={busy}>
              {busy ? "설치 중…" : "다시 설치"}
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="placeholder">세션 없음</div>
        ) : (
          sessions.map((s) => <SessionRow key={s.sessionId} s={s} now={now} />)
        )}
      </div>

      {snap && <UsageFooter usage={snap.usage} />}

      {status?.hooks && (
        <button
          className="track-off"
          onClick={uninstall}
          disabled={busy}
          title="Clowder 훅·상태줄 래퍼만 제거 — 기존 statusline·다른 설정은 원복/보존"
        >
          세션 추적 끄기
        </button>
      )}
    </aside>
  );
}

function SessionRow({ s, now }: { s: SessionView; now: number }) {
  const focusLeaf = useWorkspace((w) => w.focusLeaf);
  // A correlated session (paneId set) still resolves to a live tile only if that pane is still open.
  const linkedLeaf = s.paneId != null ? leafIdForPty(s.paneId) : undefined;

  return (
    <div
      className={"session " + s.status + (linkedLeaf ? " linked" : "")}
      onMouseDown={() => linkedLeaf && focusLeaf(linkedLeaf)}
      title={linkedLeaf ? "이 세션의 페인으로 이동" : undefined}
    >
      <div className="session-head">
        <span className={"badge " + s.status} />
        <span className="session-project">{s.project}</span>
        {linkedLeaf && (
          <span className="session-link" title="이 페인에서 실행 중">
            <Icon name="session-link" size={13} />
          </span>
        )}
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
