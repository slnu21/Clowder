import { invoke } from "@tauri-apps/api/core";

/** One runnable task from a folder's manifest. Mirrors Rust `tasks::Task`. */
export type Task = { name: string; command: string; source: string };

/** Tasks found in `cwd`'s package.json / Makefile / justfile. Fail-soft — `[]` when none. */
export const listTasks = (cwd: string) => invoke<Task[]>("list_tasks", { cwd });
