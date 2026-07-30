import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { useT } from "../../../lib/i18n";
import { killProcess, listPorts, type PortRow } from "../../../lib/ports";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";

/**
 * Listening TCP ports with their owning process, and a kill button per row. On-demand (fetch on mount,
 * on window focus, and on manual refresh) rather than a push poller — port churn isn't permission-
 * prompt urgent, and on-demand keeps this to two Rust commands and zero threads. Fully fail-soft: an
 * empty/failed read shows an empty-state line, a kill that doesn't take marks the row failed.
 */
export default function PortsPanel() {
  const t = useT();
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
  }, [refresh]);
  useFocusRefresh(refresh);

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
        <span>{t("ports.title")}</span>
        <div className="ports-head-actions">
          <button
            className={"ports-sys" + (showSystem ? " on" : "")}
            onClick={() => setShowSystem((v) => !v)}
            title={
              showSystem
                ? t("ports.hideSystem")
                : sysCount
                  ? t("ports.showSystemN", { n: sysCount })
                  : t("ports.showSystem")
            }
          >
            {t("ports.system")}
            {!showSystem && sysCount ? ` ${sysCount}` : ""}
          </button>
          <button className="ports-refresh" onClick={refresh} title={t("common.refresh")}>
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>
      {rows === null ? (
        <div className="placeholder">{t("common.loading")}</div>
      ) : shown.length === 0 ? (
        <div className="placeholder">{all.length === 0 ? t("ports.none") : t("ports.noneUser")}</div>
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
                title={t("ports.killTitle", { pid: r.pid })}
              >
                {busy === r.pid ? "…" : failed === r.pid ? t("ports.failed") : t("ports.kill")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
