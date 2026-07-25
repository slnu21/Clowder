import { invoke } from "@tauri-apps/api/core";

/** A saved command snippet. Mirrors Rust `snippets::Snippet`. */
export type Snippet = { id: string; command: string };

/** The saved snippets. Fail-soft in Rust — `[]` on a missing/corrupt file. */
export const getSnippets = () => invoke<Snippet[]>("get_snippets");
/** Persist the whole list (the frontend owns it and re-sends it on every change). */
export const setSnippets = (snippets: Snippet[]) => invoke<void>("set_snippets", { snippets });
