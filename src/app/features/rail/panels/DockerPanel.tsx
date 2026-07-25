import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { dockerContainers, dockerStart, dockerStop, type DockerContainer } from "../../../lib/docker";
import { useWorkspace } from "../../workspace/store";

/**
 * Docker containers: start/stop, and — for a running one — shell in or tail logs, each in its own pane
 * (the shared rail verb, via `openCommandTab`). Fail-soft: no daemon → "컨테이너 없음". Registered only
 * when docker is usable, so a machine without docker never sees the panel.
 */
export default function DockerPanel() {
  const [rows, setRows] = useState<DockerContainer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const openCommandTab = useWorkspace((s) => s.openCommandTab);

  const refresh = useCallback(() => {
    dockerContainers()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = async (c: DockerContainer) => {
    setBusy(c.id);
    try {
      if (c.running) await dockerStop(c.id);
      else await dockerStart(c.id);
      refresh();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dk-panel">
      <div className="dk-head">
        <span>컨테이너</span>
        <button className="dk-refresh" onClick={refresh} title="새로고침">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {rows === null ? (
        <div className="placeholder">읽는 중…</div>
      ) : rows.length === 0 ? (
        <div className="placeholder">컨테이너 없음</div>
      ) : (
        <div className="dk-rows">
          {rows.map((c) => (
            <div className={"dk-row" + (c.running ? " on" : "")} key={c.id}>
              <span className="dk-dot" title={c.status} />
              <div className="dk-info">
                <span className="dk-name" title={`${c.name} · ${c.image} · ${c.status}`}>{c.name}</span>
                <span className="dk-image">{c.image}</span>
              </div>
              <div className="dk-actions">
                <button
                  className="dk-btn"
                  onClick={() => toggle(c)}
                  disabled={busy === c.id}
                  title={c.running ? "정지" : "시작"}
                >
                  {busy === c.id ? "…" : c.running ? "정지" : "시작"}
                </button>
                {c.running && (
                  <>
                    <button
                      className="dk-btn"
                      onClick={() => openCommandTab(`docker exec -it ${c.id} sh`, c.name)}
                      title={`docker exec -it ${c.name}`}
                    >
                      sh
                    </button>
                    <button
                      className="dk-btn"
                      onClick={() => openCommandTab(`docker logs -f ${c.id}`, `${c.name} logs`)}
                      title={`docker logs -f ${c.name}`}
                    >
                      logs
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
