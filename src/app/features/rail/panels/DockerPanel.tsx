import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { dockerContainers, dockerStart, dockerStop, type DockerContainer } from "../../../lib/docker";
import { useT } from "../../../lib/i18n";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useWorkspace } from "../../workspace/store";

/**
 * Docker containers: start/stop, and — for a running one — shell in or tail logs, each in its own pane
 * (the shared rail verb, via `openCommandTab`). Fail-soft: no daemon → an empty-state line. Registered
 * only when docker is usable, so a machine without docker never sees the panel.
 */
export default function DockerPanel() {
  const t = useT();
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
  }, [refresh]);
  useFocusRefresh(refresh);

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
        <span>{t("docker.containers")}</span>
        <button className="dk-refresh" onClick={refresh} title={t("common.refresh")}>
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {rows === null ? (
        <div className="placeholder">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="placeholder">{t("docker.none")}</div>
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
                  title={c.running ? t("docker.stop") : t("docker.start")}
                >
                  {busy === c.id ? "…" : c.running ? t("docker.stop") : t("docker.start")}
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
