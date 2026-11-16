export const TICKET_STATUSES = ["draft", "ready", "in_progress", "review", "done", "blocked"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_MODES = ["solo", "team"] as const;
export type TicketMode = (typeof TICKET_MODES)[number];

export const EVENT_TYPES = [
  "claim",
  "heartbeat",
  "commit",
  "eval",
  "question",
  "blocked",
  "pr_opened",
  "done",
  "tokens",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Ticket ids are 3+ digits, e.g. "001". */
export const TICKET_ID = /^\d{3,}$/;

export interface EvalResult {
  result: "pass" | "fail";
  /** ISO timestamp of the run. */
  at: string;
  /** Ids of the checks that failed. */
  failed: string[];
  /** HEAD commit the eval ran on; submit refuses if HEAD has moved since. */
  commit?: string;
}

export interface Ticket {
  title: string;
  status: TicketStatus;
  mode: TicketMode;
  dependsOn: string[];
  branch: string | null;
  worktree: string | null;
  owner: string | null;
  attempts: number;
  lastEval: EvalResult | null;
  pr: string | null;
}

export interface RunInfo {
  id: string;
  budgetTokens: number;
  maxWorkers: number;
}

export interface State {
  version: 1;
  run: RunInfo;
  tickets: Record<string, Ticket>;
}

/** One line of events.jsonl. Extra fields depend on the type. */
export interface SaEvent {
  t: string;
  agent: string;
  ticket: string;
  type: EventType;
  [key: string]: unknown;
}
