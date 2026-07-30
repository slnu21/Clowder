import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { gitStatus, type GitStatus } from "../../../lib/git";
import { useT } from "../../../lib/i18n";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useActiveTerminalCwd, useWorkspace } from "../../workspace/store";

/**
 * Git status of the **active terminal pane's folder** (`leaf.cwd`, which tracks `cd` via OSC 7, so the
 * panel follows the pane with no work of its own). Degrades honestly: no active terminal, git absent,
 * and "not a repository" are three different empty states, not one.
 */
export default function GitPanel() {
  const t = useT();
  const cwd = useActiveTerminalCwd();
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);
  const [status, setStatus] = useState<GitStatus | null>(null);

  const refresh = useCallback(() => {
    if (!cwd) {
      setStatus(null);
      return;
    }
    gitStatus(cwd)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [cwd]);

  // Two effects, not one: the fetch has to re-run when the pane `cd`s (`refresh` closes over `cwd`),
  // but the focus listener must not be torn down and rebuilt every time it does.
  useEffect(() => {
    refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  if (!cwd) return <div className="placeholder">{t("common.noActiveTerminal")}</div>;
  if (status?.gitMissing) return <div className="placeholder">{t("git.missing")}</div>;
  if (!status || !status.isRepo) return <div className="placeholder">{t("git.notRepo")}</div>;

  const dirty = status.staged + status.unstaged + status.untracked + status.conflicts;
  return (
    <div className="git-panel">
      <div className="git-head">
        <div className="git-branch">
          <Icon name="git-branch" size={14} className="git-branch-icon" />
          <span className="git-branch-name" title={status.root ?? undefined}>
            {status.branch ?? "?"}
          </span>
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="git-ab">
              {status.ahead > 0 && <span title="ahead">↑{status.ahead}</span>}
              {status.behind > 0 && <span title="behind">↓{status.behind}</span>}
            </span>
          )}
        </div>
        <button className="git-refresh" onClick={refresh} title={t("common.refresh")}>
          <Icon name="refresh" size={13} />
        </button>
      </div>

      <div className="git-body">
        {dirty === 0 ? (
          <div className="git-clean">{t("git.clean")}</div>
        ) : (
          <div className="git-counts">
            {status.staged > 0 && <GitCount kind="staged" label={t("git.staged")} n={status.staged} />}
            {status.unstaged > 0 && <GitCount kind="unstaged" label={t("git.unstaged")} n={status.unstaged} />}
            {status.untracked > 0 && <GitCount kind="untracked" label={t("git.untracked")} n={status.untracked} />}
            {status.conflicts > 0 && <GitCount kind="conflict" label={t("git.conflicts")} n={status.conflicts} />}
          </div>
        )}
      </div>

      {status.root && (
        <button className="git-open" onClick={() => openTerminalTab(status.root!)}>
          {t("explorer.openTerminalHere")}
        </button>
      )}
    </div>
  );
}

function GitCount({ kind, label, n }: { kind: string; label: string; n: number }) {
  return (
    <div className={"git-count " + kind}>
      <span className="git-count-n">{n}</span>
      <span className="git-count-label">{label}</span>
    </div>
  );
}
