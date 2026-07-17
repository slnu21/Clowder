import { useState } from "react";
import Explorer from "./features/explorer/Explorer";
import Terminal from "./features/terminal/Terminal";

/**
 * The three regions. Left = full filesystem explorer, centre = terminal, right = session tree (M5).
 *
 * The centre still holds exactly one terminal; "open terminal here" replaces it. M4 turns the grid
 * into Allotment splits so a tab can hold a tree of panes and this becomes an addition, not a swap.
 */
export default function App() {
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  /** Remounts Terminal so a new cwd means a fresh shell rather than a `cd` typed into the old one. */
  const [gen, setGen] = useState(0);

  return (
    <div className="deck">
      <Explorer
        onOpenTerminal={(path) => {
          setCwd(path);
          setGen((g) => g + 1);
        }}
      />

      <main className="pane workspace">
        <Terminal key={gen} cwd={cwd} />
      </main>

      <aside className="pane sessions">
        <div className="pane-title">세션</div>
        <div className="placeholder">M5</div>
      </aside>
    </div>
  );
}
