import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { sshHosts, type SshHost } from "../../../lib/ssh";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useWorkspace } from "../../workspace/store";

/**
 * SSH hosts from `~/.ssh/config`. Clicking one **connects** — it opens a terminal tab running
 * `ssh <host>` (the config supplies HostName/User/Port). That's the shared rail verb: the panel is a
 * launcher, the terminal does the work, and after `ssh` exits you land back at a live shell. Fail-soft:
 * no config → "~/.ssh/config 없음", a missing `ssh` prints "command not found" in the pane, never here.
 */
export default function SshPanel() {
  const [hosts, setHosts] = useState<SshHost[] | null>(null);
  const openCommandTab = useWorkspace((s) => s.openCommandTab);

  const refresh = useCallback(() => {
    sshHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  return (
    <div className="ssh-list">
      <div className="ssh-head">
        <span>SSH 호스트</span>
        <button className="ssh-refresh" onClick={refresh} title="새로고침">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {hosts === null ? (
        <div className="placeholder">읽는 중…</div>
      ) : hosts.length === 0 ? (
        <div className="placeholder">~/.ssh/config 없음</div>
      ) : (
        <div className="ssh-rows">
          {hosts.map((h, i) => (
            <button
              className="ssh-row"
              key={`${h.host}-${i}`}
              onClick={() => openCommandTab(`ssh ${h.host}`, h.host)}
              title={`ssh ${h.host}${targetLabel(h) ? ` (${targetLabel(h)})` : ""}`}
            >
              <Icon name="ssh" size={14} className="ssh-row-icon" />
              <span className="ssh-host">{h.host}</span>
              {targetLabel(h) && <span className="ssh-target">{targetLabel(h)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** `user@hostname:port`, omitting the parts the config didn't set. Empty when there's nothing extra. */
function targetLabel(h: SshHost): string {
  if (!h.hostName) return "";
  const at = h.user ? `${h.user}@` : "";
  const port = h.port ? `:${h.port}` : "";
  return `${at}${h.hostName}${port}`;
}
