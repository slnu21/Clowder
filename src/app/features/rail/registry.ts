import type { ComponentType } from "react";
import type { IconName } from "../../components/Icon";
import type { MsgKey } from "../../lib/i18n";
import type { RightPanelId } from "../../lib/settings";
import { dockerOk } from "../../lib/docker";
import { kubectlContexts } from "../../lib/k8s";
import { sshHosts } from "../../lib/ssh";
import DockerPanel from "./panels/DockerPanel";
import GitPanel from "./panels/GitPanel";
import KubernetesPanel from "./panels/KubernetesPanel";
import PortsPanel from "./panels/PortsPanel";
import { SessionsBadge, SessionsBody } from "./panels/SessionsPanel";
import SnippetsPanel from "./panels/SnippetsPanel";
import SshPanel from "./panels/SshPanel";
import TaskPanel from "./panels/TaskPanel";

export type { RightPanelId };

/**
 * A right-rail panel. Every panel renders **content only** — the host (`RightRail`) supplies the
 * `<aside>` shell and the header/switcher. The product thesis is that a panel's primary action spawns
 * a terminal pane or acts on the active one (ssh → `ssh host`, ports → kill, git → open terminal here);
 * the panel type itself only needs to say how to render and when it's worth showing.
 */
export type RightPanelDef = {
  id: RightPanelId;
  /** Catalogue key for the label — resolved at render time, not here, so switching language re-labels
   *  the switcher without rebuilding the registry. Also the plain header text when the switcher is
   *  hidden (a single available panel). */
  labelKey: MsgKey;
  /** Switcher-tab glyph. Must exist in `Icon.tsx`'s closed `IconName` enum. */
  icon: IconName;
  /** Full-rail body: content only, no `<aside>`/`.pane-title`. */
  Body: ComponentType;
  /** Optional header adornment (e.g. sessions' "N waiting" pill). A component, not a hook, so switching
   *  panels mounts/unmounts it cleanly instead of reordering the host's hooks. */
  Badge?: ComponentType;
  /** Optional availability probe — omit for "always shown". A panel whose tool/config is absent returns
   *  false and simply drops out of the switcher (lean default: never show an unused panel). */
  available?: () => boolean | Promise<boolean>;
};

/** Sessions has no `available`: it's always shown when the rail is open — its body carries the
 *  install prompt for the "tracking off" state, so hiding it would hide the way to turn it on. */
export const SESSIONS: RightPanelDef = {
  id: "sessions",
  labelKey: "rail.sessions",
  icon: "session-link",
  Body: SessionsBody,
  Badge: SessionsBadge,
};

/** Listening ports — always available on Windows (there's always a TCP table to read). Its verb is
 *  "kill the process on this port", the classic "port 3000 already in use" fix, inline. */
export const PORTS: RightPanelDef = {
  id: "ports",
  labelKey: "rail.ports",
  icon: "ports",
  Body: PortsPanel,
  available: () => true,
};

/** SSH hosts from `~/.ssh/config`. Available only when the config has at least one concrete host, so a
 *  machine that doesn't use ssh never sees the panel. Its verb is "connect" — spawn `ssh <host>`. */
export const SSH: RightPanelDef = {
  id: "ssh",
  labelKey: "rail.ssh",
  icon: "ssh",
  Body: SshPanel,
  available: async () => (await sshHosts()).length > 0,
};

/** Git status of the active terminal pane's folder. Always shown (it degrades to a "not a repository"
 *  line when the active pane isn't a repo). Bound to `leaf.cwd`, which follows `cd` via OSC 7. */
export const GIT: RightPanelDef = {
  id: "git",
  labelKey: "rail.git",
  icon: "git-branch",
  Body: GitPanel,
};

/** Kubernetes context switch + pod exec. Available only when kubectl has contexts (no kubectl → hidden).
 *  Verb: switch context, or `kubectl exec` into a pod in its own pane. */
export const K8S: RightPanelDef = {
  id: "k8s",
  labelKey: "rail.k8s",
  icon: "k8s",
  Body: KubernetesPanel,
  available: async () => (await kubectlContexts()).contexts.length > 0,
};

/** Docker containers: start/stop, exec-shell, logs. Available only when docker is usable (installed +
 *  daemon up), so a machine without docker never sees it. */
export const DOCKER: RightPanelDef = {
  id: "docker",
  labelKey: "rail.docker",
  icon: "docker",
  Body: DockerPanel,
  available: () => dockerOk(),
};

/** Runnable tasks (npm/make/just) in the active pane's folder. Always shown — degrades to a "no tasks"
 *  line when the folder has no manifest. Its verb is "run this task in a new pane". */
export const TASK: RightPanelDef = {
  id: "task",
  labelKey: "rail.task",
  icon: "play",
  Body: TaskPanel,
};

/** Saved command snippets, run in the active pane. Always shown (persisted locally, starts empty). */
export const SNIPPETS: RightPanelDef = {
  id: "snippets",
  labelKey: "rail.snippets",
  icon: "bookmark",
  Body: SnippetsPanel,
};

/** The registry, in switcher order. */
export const RIGHT_PANELS: RightPanelDef[] = [SESSIONS, PORTS, SSH, GIT, K8S, DOCKER, TASK, SNIPPETS];
