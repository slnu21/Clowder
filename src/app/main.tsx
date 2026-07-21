import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { useSettings } from "./features/settings/store";

// With `dragDropEnabled: false` (required for in-app HTML5 drag & drop to work at all — Tauri's OS-level
// handler otherwise swallows every drag event), the webview handles OS file drops natively. A file
// dropped on any surface *without* its own handler would make WebView2 navigate to that file and replace
// the whole app. This blocks that default everywhere; panes that want a drop still call their own
// handler first during bubbling, and only the browser's navigate-away default is cancelled here.
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (e) => e.preventDefault());
}

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Load settings before the first render so the initial terminal already uses the configured font,
// size, and scrollback (not the defaults). A load failure is non-fatal — render either way.
useSettings.getState().load().finally(render);
