import { useCallback, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { listTasks, type Task } from "../../../lib/tasks";
import { useFocusRefresh } from "../../../lib/useFocusRefresh";
import { useActiveTerminalCwd, useWorkspace } from "../../workspace/store";

/**
 * Runnable tasks in the active terminal pane's folder — npm scripts, Makefile targets, justfile
 * recipes. Clicking one runs it in a new pane (the shared rail verb, via `openCommandTab`, cwd-scoped).
 * Bound to `leaf.cwd`, which now tracks `cd` (OSC 7), so the list follows the pane's current folder.
 */
export default function TaskPanel() {
  const cwd = useActiveTerminalCwd();
  const openCommandTab = useWorkspace((s) => s.openCommandTab);
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const refresh = useCallback(() => {
    if (!cwd) {
      setTasks(null);
      return;
    }
    listTasks(cwd)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [cwd]);

  // Two effects: `refresh` closes over `cwd` and must re-run on `cd`, but the listener shouldn't churn.
  useEffect(() => {
    refresh();
  }, [refresh]);
  useFocusRefresh(refresh);

  if (!cwd) return <div className="placeholder">활성 터미널 없음</div>;
  if (!tasks) return <div className="placeholder">읽는 중…</div>;
  if (tasks.length === 0) return <div className="placeholder">작업 없음</div>;

  return (
    <div className="task-list">
      {tasks.map((t, i) => (
        <button
          className="task-row"
          key={`${t.source}-${t.name}-${i}`}
          onClick={() => openCommandTab(t.command, t.name, cwd)}
          title={t.command}
        >
          <Icon name="play" size={12} className="task-icon" />
          <span className="task-name">{t.name}</span>
          <span className="task-src">{t.source}</span>
        </button>
      ))}
    </div>
  );
}
