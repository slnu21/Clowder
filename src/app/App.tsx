/**
 * M1 shell: the three regions, laid out and nothing more.
 *
 * Left = full filesystem explorer (M3), centre = tiles + tabs (M2/M4), right = session tree (M5).
 * The grid here is a placeholder — M4 replaces it with Allotment so the splits become draggable.
 * Kept as static divs on purpose: the point of M1 is that the window opens and the layout reads
 * correctly, not that anything works.
 */
export default function App() {
  return (
    <div className="deck">
      <aside className="pane explorer">
        <div className="pane-title">탐색기</div>
        <div className="placeholder">M3</div>
      </aside>

      <main className="pane workspace">
        <div className="pane-title">터미널</div>
        <div className="placeholder">M2 · M4</div>
      </main>

      <aside className="pane sessions">
        <div className="pane-title">세션</div>
        <div className="placeholder">M5</div>
      </aside>
    </div>
  );
}
