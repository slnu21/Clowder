import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import {
  kubectlContexts,
  kubectlNamespaces,
  kubectlPods,
  kubectlUseContext,
  kubectlUseNamespace,
  type KubeContexts,
  type KubeNamespaces,
  type KubePod,
} from "../../../lib/k8s";
import { useT } from "../../../lib/i18n";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useWorkspace } from "../../workspace/store";

/**
 * Kubernetes: switch context / namespace, and exec into or tail a pod. Contexts come from the kubeconfig
 * (cheap); namespaces + pods are a cluster query, loaded on demand and bounded in Rust. exec/logs are the
 * terminal-spawn verb — `kubectl exec -it … -- sh` / `kubectl logs -f …` each in their own pane.
 */
export default function KubernetesPanel() {
  const t = useT();
  const [ctx, setCtx] = useState<KubeContexts | null>(null);
  const [ns, setNs] = useState<KubeNamespaces | null>(null);
  const [pods, setPods] = useState<KubePod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const openCommandTab = useWorkspace((s) => s.openCommandTab);

  const refresh = useCallback(() => {
    kubectlContexts()
      .then(setCtx)
      .catch(() => setCtx({ contexts: [], current: null }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  const loadCluster = async () => {
    setLoading(true);
    try {
      const [p, n] = await Promise.all([
        kubectlPods().catch(() => [] as KubePod[]),
        kubectlNamespaces().catch(() => ({ namespaces: [], current: null }) as KubeNamespaces),
      ]);
      setPods(p);
      setNs(n);
    } finally {
      setLoading(false);
    }
  };

  const switchCtx = async (name: string) => {
    if (name === ctx?.current) return;
    setBusy(true);
    try {
      await kubectlUseContext(name);
      setPods(null); // pods/namespaces belong to the old context
      setNs(null);
      refresh();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(false);
    }
  };

  const switchNs = async (name: string) => {
    if (name === ns?.current) return;
    setBusy(true);
    try {
      await kubectlUseNamespace(name);
      await loadCluster();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k8s-panel">
      <div className="k8s-head">
        <span>{t("k8s.context")}</span>
        <button className="k8s-refresh" onClick={refresh} title={t("common.refresh")}>
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className="k8s-ctxs">
        {(ctx?.contexts ?? []).map((c) => (
          <button
            key={c}
            className={"k8s-ctx" + (c === ctx?.current ? " on" : "")}
            disabled={busy}
            onClick={() => switchCtx(c)}
            title={c}
          >
            <span className="k8s-ctx-dot" />
            <span className="k8s-ctx-name">{c}</span>
          </button>
        ))}
      </div>

      <div className="k8s-pods-head">
        <span>
          {t("k8s.cluster")}
          {ns?.current ? ` · ${ns.current}` : ""}
        </span>
        <button className="k8s-load" onClick={loadCluster} disabled={loading}>
          {loading ? "…" : t("k8s.load")}
        </button>
      </div>

      {ns && ns.namespaces.length > 0 && (
        <div className="k8s-ns">
          {ns.namespaces.map((n) => (
            <button
              key={n}
              className={"k8s-nschip" + (n === ns.current ? " on" : "")}
              disabled={busy}
              onClick={() => switchNs(n)}
              title={t("k8s.namespace", { n })}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <div className="k8s-pods">
        {pods === null ? (
          <div className="k8s-hint">{t("k8s.hint")}</div>
        ) : pods.length === 0 ? (
          <div className="k8s-hint">{t("k8s.noPods")}</div>
        ) : (
          pods.map((p) => (
            <div key={p.name} className="k8s-pod">
              <span className="k8s-pod-name" title={`${p.name} · ${p.ready} · ${p.status}`}>
                {p.name}
              </span>
              <span className="k8s-pod-status">{p.status}</span>
              <button
                className="k8s-exec"
                onClick={() => openCommandTab(`kubectl exec -it ${p.name} -- sh`, p.name)}
                title={`kubectl exec -it ${p.name}`}
              >
                exec
              </button>
              <button
                className="k8s-exec"
                onClick={() => openCommandTab(`kubectl logs -f ${p.name}`, `${p.name} logs`)}
                title={`kubectl logs -f ${p.name}`}
              >
                logs
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
