import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { gitStatus, type GitStatus } from "../../../lib/git";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useActiveTerminalCwd, useWorkspace } from "../../workspace/store";

/**
 * Git status of the **active terminal pane's folder**. Today that's the pane's spawn cwd (`leaf.cwd`);
 * when the live-cwd milestone (OSC 7) lands and makes `leaf.cwd` track `cd`, this panel follows with no
 * change — it already reads `leaf.cwd`. Degrades honestly: no active terminal → "활성 터미널 없음", a
 * folder that isn't a repo (or git absent) → "저장소 아님".
 */
export default function GitPanel() {
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

  if (!cwd) return <div className="placeholder">활성 터미널 없음</div>;
  if (status?.gitMissing) return <div className="placeholder">git 미설치</div>;
  if (!status || !status.isRepo) return <div className="placeholder">저장소 아님</div>;

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
        <button className="git-refresh" onClick={refresh} title="새로고침">
          <Icon name="refresh" size={13} />
        </button>
      </div>

      <div className="git-body">
        {dirty === 0 ? (
          <div className="git-clean">깨끗함</div>
        ) : (
          <div className="git-counts">
            {status.staged > 0 && <GitCount kind="staged" label="스테이지" n={status.staged} />}
            {status.unstaged > 0 && <GitCount kind="unstaged" label="변경" n={status.unstaged} />}
            {status.untracked > 0 && <GitCount kind="untracked" label="추적 안 됨" n={status.untracked} />}
            {status.conflicts > 0 && <GitCount kind="conflict" label="충돌" n={status.conflicts} />}
          </div>
        )}
      </div>

      {status.root && (
        <button className="git-open" onClick={() => openTerminalTab(status.root!)}>
          여기서 터미널 열기
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
