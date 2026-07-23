import { defineConfig } from "vitest/config";

// Vitest runs the pure workspace-model logic (the pane tree: split / move / close / detach). These
// functions are immutable and DOM-free, so a plain node environment is enough — no jsdom, no React. Kept
// separate from `vite.config.ts` (which is tuned for the Tauri dev server) so the test setup can't drift
// into the app build.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
