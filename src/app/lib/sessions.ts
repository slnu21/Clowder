import { invoke } from "./invoke";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Where a session's name came from — the user (`custom`), Claude (`ai`), or the last prompt. */
export type TitleSource = "custom" | "ai" | "prompt";

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
  /** The session's name: `/rename`, else Claude's generated title, else the last prompt. */
  title?: string | null;
  titleSource?: TitleSource | null;
  message?: string | null;
  toolName?: string | null;
  ctxPercent?: number | null;
  ctxTokens?: string | null;
  /** Correlated PTY id, or null for a foreign/uncorrelated session (Phase B). */
  paneId?: number | null;
  /** No owning process was recorded, so liveness can't judge this card — it won't clear itself. */
  ownerUnknown: boolean;
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

/**
 * Remove one card and the spool files behind it. Safe on a live session: the next hook rewrites the
 * spool and the card returns, which is why there's no confirmation step.
 */
export const sessionDismiss = (id: string) => invoke<void>("session_dismiss", { id });

/** Clear every card currently marked ended. Resolves to how many were cleared. */
export const sessionsDismissDead = () => invoke<number>("sessions_dismiss_dead");

/** Mirrors Rust `transcripts::RecentSession` — one resumable session from Claude Code's own history. */
export type RecentSession = {
  sessionId: string;
  /** Which agent wrote it, and so which command resumes it (see `lib/resume.ts`). */
  agent: string;
  title: string;
  titleSource: TitleSource;
  cwd: string;
  project: string;
  /** False when the folder is gone — the row is shown but can't be resumed. */
  cwdExists: boolean;
  gitBranch?: string | null;
  /** Unix ms of the last write to the transcript. */
  lastActive: number;
};

/** Newest resumable sessions, read from `~/.claude/projects`. Empty when Claude Code isn't used. */
export const recentSessions = () => invoke<RecentSession[]>("recent_sessions");
