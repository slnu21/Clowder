import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors the Rust `sessions::*View` snapshot (camelCase). */
export type SubagentView = {
  agentId: string;
  agentType?: string | null;
  description?: string | null;
  status?: string | null;
  startedAt?: string | null;
};

export type SessionView = {
  sessionId: string;
  status: string; // awaiting_permission | awaiting_input | working | idle | dead
  rank: number;
  statusSince?: string | null;
  cwd?: string | null;
  project: string;
  message?: string | null;
  toolName?: string | null;
  ctxPercent?: number | null;
  ctxTokens?: string | null;
  /** Correlated PTY id, or null for a foreign/uncorrelated session (Phase B). */
  paneId?: number | null;
  subagents: SubagentView[];
};

export type UsageView = {
  fiveHourPct?: number | null;
  fiveHourResetsAt?: string | null;
  sevenDayPct?: number | null;
  sevenDayResetsAt?: string | null;
};

export type SessionsSnapshot = {
  sessions: SessionView[];
  usage: UsageView;
  waitingCount: number;
};

/** Read the current board once (initial load). Live changes arrive via {@link onSessionsUpdate}. */
export const sessionsSnapshot = () => invoke<SessionsSnapshot>("sessions_snapshot");

/** Subscribe to board updates pushed from the Rust watcher thread. */
export const onSessionsUpdate = (cb: (s: SessionsSnapshot) => void): Promise<UnlistenFn> =>
  listen<SessionsSnapshot>("sessions:update", (e) => cb(e.payload));
