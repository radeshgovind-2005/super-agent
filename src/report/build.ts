/**
 * The review report's data, built from state, the event log and the ticket files.
 * Pure: no I/O. It is also saved as run.json, the numbers for Super Agent's own eval.
 */
import type { SaEvent, State, TicketMode, TicketStatus } from "../core/types.js";

export interface TicketDocs {
  /** Ticket folder relative to the repo root, or null if there is none. */
  ticketDir: string | null;
  goal: string;
  decisions: string;
  unusual: string;
  doneMeans: string;
  checks: { id: string; type: string; run: string }[];
}

export type CheckStatus = "pass" | "fail" | "skipped" | "not run";

export interface TicketReport {
  id: string;
  title: string;
  status: TicketStatus;
  mode: TicketMode;
  branch: string | null;
  pr: string | null;
  attempts: number;
  ticketDir: string;
  goal: string;
  decisions: string;
  unusual: string;
  doneMeans: string;
  checks: { id: string; type: string; run: string; status: CheckStatus }[];
  evalCount: number;
  /** true/false once it has an eval; null if it never ran one. */
  firstTryPass: boolean | null;
  blockedReason: string | null;
  tokens: number;
  claimedAt: string | null;
  submittedAt: string | null;
  /** A ready-made prompt to paste into Claude to dig into this ticket. */
  ask: string;
}

export interface Report {
  run: { id: string; generatedAt: string; budgetTokens: number; maxWorkers: number };
  summary: {
    tickets: number;
    shipped: number;
    blocked: number;
    inProgress: number;
    notStarted: number;
    firstTryPass: number;
    evals: number;
    questions: number;
    tokens: number;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
  };
  wentWrong: string[];
  tickets: TicketReport[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isShipped = (s: TicketStatus) => s === "review" || s === "done";

function askPrompt(id: string, title: string, dir: string, pr: string | null): string {
  return (
    `Help me review ticket ${id} (${title}) in this repo. Read ${dir}/spec.md and ${dir}/eval.md` +
    `${pr ? `, then look at the PR: ${pr}` : ""}. ` +
    "Summarise what changed and the risks, and tell me: what should I check by hand?"
  );
}

export function buildReport(state: State, events: readonly SaEvent[], docs: Record<string, TicketDocs>, now: Date): Report {
  const ids = Object.keys(state.tickets).sort();
  const of = (id: string) => events.filter((e) => e.ticket === id);

  const tickets = ids.map((id): TicketReport => {
    const t = state.tickets[id]!;
    const d = docs[id];
    const mine = of(id);
    const evals = mine.filter((e) => e.type === "eval");
    const first = evals[0];
    const blocked = mine.filter((e) => e.type === "blocked").at(-1);
    const ticketDir = d?.ticketDir ?? `.superagent/tickets/${id}`;

    const checks = (d?.checks ?? []).map((c) => {
      let status: CheckStatus = "not run";
      if (t.lastEval) {
        if (c.type !== "command") status = "skipped";
        else status = t.lastEval.failed.includes(c.id) ? "fail" : "pass";
      }
      return { ...c, status };
    });

    return {
      id,
      title: t.title,
      status: t.status,
      mode: t.mode,
      branch: t.branch,
      pr: t.pr,
      attempts: t.attempts,
      ticketDir,
      goal: d?.goal ?? "",
      decisions: d?.decisions ?? "",
      unusual: d?.unusual ?? "",
      doneMeans: d?.doneMeans ?? "",
      checks,
      evalCount: evals.length,
      firstTryPass: first ? first.result === "pass" && typeof first.commit === "string" : null,
      blockedReason: typeof blocked?.reason === "string" ? blocked.reason : null,
      tokens: mine.filter((e) => e.type === "tokens").reduce((n, e) => n + (typeof e.count === "number" ? e.count : 0), 0),
      claimedAt: mine.find((e) => e.type === "claim")?.t ?? null,
      submittedAt: mine.filter((e) => e.type === "pr_opened").at(-1)?.t ?? null,
      ask: askPrompt(id, t.title, ticketDir, t.pr),
    };
  });

  const wentWrong: string[] = [];
  for (const t of tickets) {
    const name = `${t.id} ${t.title}`;
    if (t.status === "blocked") {
      wentWrong.push(`${name}: blocked - ${t.blockedReason ?? "no reason given"}`);
    } else if (isShipped(t.status) && t.firstTryPass === false) {
      wentWrong.push(`${name}: needed ${plural(t.evalCount, "eval")} to pass`);
    } else if (t.status === "in_progress") {
      const lastFailed = state.tickets[t.id]!.lastEval?.failed ?? [];
      wentWrong.push(
        t.evalCount === 0
          ? `${name}: in progress, no eval yet`
          : `${name}: still in progress after ${plural(t.evalCount, "eval")}${lastFailed.length ? ` (last failed: ${lastFailed.join(", ")})` : ""}`,
      );
    }
  }

  const times = events.map((e) => Date.parse(e.t)).filter((n) => !Number.isNaN(n));
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  const count = (pred: (t: TicketReport) => boolean) => tickets.filter(pred).length;

  return {
    run: { id: state.run.id, generatedAt: now.toISOString(), budgetTokens: state.run.budgetTokens, maxWorkers: state.run.maxWorkers },
    summary: {
      tickets: tickets.length,
      shipped: count((t) => isShipped(t.status)),
      blocked: count((t) => t.status === "blocked"),
      inProgress: count((t) => t.status === "in_progress"),
      notStarted: count((t) => t.status === "draft" || t.status === "ready"),
      firstTryPass: count((t) => t.firstTryPass === true),
      evals: tickets.reduce((n, t) => n + t.evalCount, 0),
      questions: events.filter((e) => e.type === "question").length,
      tokens: tickets.reduce((n, t) => n + t.tokens, 0),
      startedAt: start === null ? null : new Date(start).toISOString(),
      endedAt: end === null ? null : new Date(end).toISOString(),
      durationSeconds: start === null || end === null ? null : Math.round((end - start) / 1000),
    },
    wentWrong,
    tickets,
  };
}
