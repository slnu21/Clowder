import Terminal from "./features/terminal/Terminal";

/**
 * The three regions. Left = full filesystem explorer (M3), centre = terminal, right = session tree
 * (M5). The centre holds exactly one terminal for now; M4 turns the grid into Allotment splits and
 * lets a tab hold a tree of panes.
 */
export default function App() {
  return (
    <div className="deck">
      <aside className="pane explorer">
        <div className="pane-title">탐색기</div>
        <div className="placeholder">M3</div>
      </aside>

      <main className="pane workspace">
        <Terminal />
      </main>

      <aside className="pane sessions">
        <div className="pane-title">세션</div>
        <div className="placeholder">M5</div>
      </aside>
    </div>
  );
}
