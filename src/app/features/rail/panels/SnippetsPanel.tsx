import { type FormEvent, useEffect, useState } from "react";
import Icon from "../../../components/Icon";
import { getSnippets, setSnippets, type Snippet } from "../../../lib/snippets";
import { writeToPane } from "../../terminal/terminalPool";
import { findLeaf } from "../../workspace/model";
import { useWorkspace } from "../../workspace/store";

/**
 * Command snippets: a small saved list you run often. Clicking one runs it **in the active terminal
 * pane** (the "act on the active pane" verb); if the active pane isn't a terminal, it opens a fresh
 * pane for it. Persisted to a JSON file via Rust. The frontend owns the list and re-sends it on change.
 */
export default function SnippetsPanel() {
  const [snips, setSnips] = useState<Snippet[]>([]);
  const [draft, setDraft] = useState("");
  const openCommandTab = useWorkspace((s) => s.openCommandTab);

  useEffect(() => {
    getSnippets()
      .then(setSnips)
      .catch(() => {});
  }, []);

  const persist = (next: Snippet[]) => {
    setSnips(next);
    void setSnippets(next);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const command = draft.trim();
    if (!command) return;
    persist([...snips, { id: crypto.randomUUID(), command }]);
    setDraft("");
  };

  const del = (id: string) => persist(snips.filter((s) => s.id !== id));

  const run = (command: string) => {
    const s = useWorkspace.getState();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    const leaf = tab && s.activePaneId ? findLeaf(tab.root, s.activePaneId) : undefined;
    if (leaf?.content === "terminal" && s.activePaneId) {
      writeToPane(s.activePaneId, command + "\r"); // run in the active terminal
    } else {
      openCommandTab(command, command.length > 24 ? command.slice(0, 24) + "…" : command);
    }
  };

  return (
    <div className="snip-panel">
      <div className="snip-rows">
        {snips.length === 0 ? (
          <div className="placeholder">스니펫 없음</div>
        ) : (
          snips.map((s) => (
            <div className="snip-row" key={s.id}>
              <button className="snip-run" onClick={() => run(s.command)} title="활성 페인에서 실행">
                <Icon name="play" size={12} className="snip-icon" />
                <span className="snip-cmd">{s.command}</span>
              </button>
              <button className="snip-del" onClick={() => del(s.id)} title="삭제">
                <Icon name="close" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
      <form className="snip-add" onSubmit={add}>
        <input
          className="snip-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="명령 추가…"
          spellCheck={false}
        />
        <button className="snip-addbtn" type="submit" title="추가">
          <Icon name="plus" size={14} />
        </button>
      </form>
    </div>
  );
}
