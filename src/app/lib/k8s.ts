import { invoke } from "@tauri-apps/api/core";

/** Kubeconfig contexts + the current one. Mirrors Rust `k8s::KubeContexts`. */
export type KubeContexts = { contexts: string[]; current: string | null };
/** Cluster namespaces + the current context's namespace. Mirrors Rust `k8s::KubeNamespaces`. */
export type KubeNamespaces = { namespaces: string[]; current: string | null };
/** One pod row. Mirrors Rust `k8s::KubePod`. */
export type KubePod = { name: string; ready: string; status: string };

/** Contexts from the kubeconfig. Fail-soft in Rust — `[]` if kubectl/config is absent. */
export const kubectlContexts = () => invoke<KubeContexts>("kubectl_contexts");
/** Switch the current context. Rejects with kubectl's stderr on failure. */
export const kubectlUseContext = (name: string) => invoke<void>("kubectl_use_context", { name });
/** Pods in the current context/namespace. Bounded + fail-soft — `[]` if the cluster is unreachable. */
export const kubectlPods = () => invoke<KubePod[]>("kubectl_pods");
/** Namespaces in the current cluster + the current one. Bounded + fail-soft. */
export const kubectlNamespaces = () => invoke<KubeNamespaces>("kubectl_namespaces");
/** Set the current context's namespace. Rejects with kubectl's stderr on failure. */
export const kubectlUseNamespace = (name: string) => invoke<void>("kubectl_use_namespace", { name });
