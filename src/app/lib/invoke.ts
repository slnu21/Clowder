import { invoke as rawInvoke } from "@tauri-apps/api/core";

/**
 * `invoke`, with a dev-only stopwatch on it. **Every command in the app goes through here.**
 *
 * A slow command used to be invisible. It throws nothing and prints nothing — it just quietly holds a
 * thread — which is how a `docker ps` fired on window focus went unnoticed until it was blocking
 * keystrokes (the reason those commands moved to `#[tauri::command(async)]`; see `lib.rs`). One
 * `console.warn` over a threshold makes the cost legible, and legible on the machine that actually has
 * docker and kubectl installed, which is not necessarily the machine the code was written on.
 *
 * The per-domain modules (`docker.ts`, `k8s.ts`, `git.ts`, …) each used to import `invoke` straight from
 * `@tauri-apps/api/core`, so `tauri.ts`'s "single window onto the Rust side" was only ever true of the
 * PTY and filesystem commands. Importing from here instead makes that claim actually hold — and means
 * the stopwatch covers the expensive commands rather than the cheap ones.
 *
 * In a release build this is `rawInvoke` with nothing wrapped around it.
 */
const SLOW_INVOKE_MS = 50;

export const invoke: typeof rawInvoke = import.meta.env.DEV
  ? (((cmd: string, ...rest: unknown[]) => {
      const t0 = performance.now();
      const done = (): void => {
        const ms = Math.round(performance.now() - t0);
        if (ms >= SLOW_INVOKE_MS) console.warn(`[slow invoke] ${cmd} ${ms}ms`);
      };
      return (rawInvoke as (...a: unknown[]) => Promise<unknown>)(cmd, ...rest).then(
        (v) => {
          done();
          return v;
        },
        (e) => {
          done();
          throw e;
        },
      );
    }) as typeof rawInvoke)
  : rawInvoke;
