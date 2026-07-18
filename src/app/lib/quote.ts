import { invoke } from "@tauri-apps/api/core";

/** Which shell a pane runs — decides how an embedded single quote is escaped. */
export type ShellKind = "bash" | "power";

/**
 * Quote a path for insertion into a running shell. The logic lives in Rust (single source, table-
 * tested) because a dropped filename is untrusted data that must not become shell syntax.
 */
export const quotePath = (path: string, shell: ShellKind) =>
  invoke<string>("quote_path_cmd", { path, shell });
