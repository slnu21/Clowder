import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import {
  kubectlContexts,
  kubectlPods,
  kubectlUseContext,
  type KubeContexts,
  type KubePod,
} from "../../../lib/k8s";
import { useWorkspace } from "../../workspace/store";

/**
 * Kubernetes: switch the current context, and exec into a pod. Contexts come from the kubeconfig
 * (cheap); pods are loaded on demand (a cluster query, bounded in Rust). Exec is the terminal-spawn
 * verb — `kubectl exec -it <pod> -- sh` in its own pane. Fail-soft throughout.
 */
export default function KubernetesPanel() {
  const [ctx, setCtx] = useState<KubeContexts | null>(null);
  const [pods, setPods] = useState<KubePod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [podsBusy, setPodsBusy] = useState(false);
  const openCommandTab = useWorkspace((s) => s.openCommandTab);

  const refresh = useCallback(() => {
    kubectlContexts()
      .then(setCtx)
      .catch(() => setCtx({ contexts: [], current: null }));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const switchTo = async (name: string) => {
    if (name === ctx?.current) return;
    setBusy(true);
    try {
      await kubectlUseContext(name);
      setPods(null); // pods belong to the old context
      refresh();
    } catch {
      /* fail-soft */
    } finally {
      setBusy(false);
    }
  };

  const loadPods = async () => {
    setPodsBusy(true);
    try {
      setPods(await kubectlPods());
    } catch {
      setPods([]);
    } finally {
      setPodsBusy(false);
    }
  };

  return (
    <div className="k8s-panel">
      <div className="k8s-head">
        <span>컨텍스트</span>
        <button className="k8s-refresh" onClick={refresh} title="새로고침">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className="k8s-ctxs">
        {(ctx?.contexts ?? []).map((c) => (
          <button
            key={c}
            className={"k8s-ctx" + (c === ctx?.current ? " on" : "")}
            disabled={busy}
            onClick={() => switchTo(c)}
            title={c}
          >
            <span className="k8s-ctx-dot" />
            <span className="k8s-ctx-name">{c}</span>
          </button>
        ))}
      </div>

      <div className="k8s-pods-head">
        <span>파드</span>
        <button className="k8s-load" onClick={loadPods} disabled={podsBusy}>
          {podsBusy ? "…" : "불러오기"}
        </button>
      </div>
      <div className="k8s-pods">
        {pods === null ? (
          <div className="k8s-hint">현재 컨텍스트의 파드를 불러옵니다</div>
        ) : pods.length === 0 ? (
          <div className="k8s-hint">파드 없음</div>
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
