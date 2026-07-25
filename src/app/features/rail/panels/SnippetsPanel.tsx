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
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCmd, setDraftCmd] = useState("");
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
    const command = draftCmd.trim();
    if (!command) return;
    persist([...snips, { id: crypto.randomUUID(), label: draftLabel.trim(), command }]);
    setDraftLabel("");
    setDraftCmd("");
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
              <button className="snip-run" onClick={() => run(s.command)} title={`실행: ${s.command}`}>
                <Icon name="play" size={12} className="snip-icon" />
                <span className="snip-text">
                  <span className="snip-label">{s.label || s.command}</span>
                  {s.label && <span className="snip-sub">{s.command}</span>}
                </span>
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
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          placeholder="라벨 (선택)"
          spellCheck={false}
        />
        <div className="snip-add-row">
          <input
            className="snip-input"
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            placeholder="명령…"
            spellCheck={false}
          />
          <button className="snip-addbtn" type="submit" title="추가">
            <Icon name="plus" size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
