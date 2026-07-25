import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { killProcess, listPorts, type PortRow } from "../../../lib/ports";

/**
 * Listening TCP ports with their owning process, and a kill button per row. On-demand (fetch on mount,
 * on window focus, and on manual refresh) rather than a push poller — port churn isn't permission-
 * prompt urgent, and on-demand keeps this to two Rust commands and zero threads. Fully fail-soft: an
 * empty/failed read shows "수신 포트 없음", a kill that doesn't take shows "실패" on the row.
 */
export default function PortsPanel() {
  const [rows, setRows] = useState<PortRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  const refresh = useCallback(() => {
    listPorts()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const kill = async (pid: number) => {
    setBusy(pid);
    setFailed(null);
    try {
      await killProcess(pid);
      // Give the OS a beat to drop the socket, then re-read. If the pid survives, the kill didn't take.
      const after = await listPorts().catch(() => [] as PortRow[]);
      setRows(after);
      if (after.some((r) => r.pid === pid)) setFailed(pid);
    } catch {
      setFailed(pid);
    } finally {
      setBusy(null);
    }
  };

  const all = rows ?? [];
  const shown = showSystem ? all : all.filter((r) => !r.system);
  const sysCount = all.filter((r) => r.system).length;

  return (
    <div className="ports-list">
      <div className="ports-head">
        <span>수신 포트</span>
        <div className="ports-head-actions">
          <button
            className={"ports-sys" + (showSystem ? " on" : "")}
            onClick={() => setShowSystem((v) => !v)}
            title={showSystem ? "시스템 포트 숨기기" : `시스템 포트 표시${sysCount ? ` (${sysCount})` : ""}`}
          >
            시스템{!showSystem && sysCount ? ` ${sysCount}` : ""}
          </button>
          <button className="ports-refresh" onClick={refresh} title="새로고침">
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>
      {rows === null ? (
        <div className="placeholder">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="placeholder">{all.length === 0 ? "수신 포트 없음" : "사용자 포트 없음"}</div>
      ) : (
        <div className="ports-rows">
          {shown.map((r) => (
            <div
              className={"port-row" + (failed === r.pid ? " failed" : "")}
              key={`${r.addr}:${r.port}:${r.pid}`}
            >
              <span className="port-num">:{r.port}</span>
              <span className="port-proc" title={`${r.process || "?"} · PID ${r.pid} · ${r.addr}`}>
                {r.process || `PID ${r.pid}`}
              </span>
              <button
                className="port-kill"
                onClick={() => kill(r.pid)}
                disabled={busy === r.pid}
                title={`PID ${r.pid} 종료`}
              >
                {busy === r.pid ? "…" : failed === r.pid ? "실패" : "종료"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
