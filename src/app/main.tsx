import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { useSettings } from "./features/settings/store";

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
