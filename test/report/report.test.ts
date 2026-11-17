import { describe, expect, it } from "vitest";
import { buildReport, type TicketDocs } from "../../src/report/build.js";
import { renderReportHtml } from "../../src/report/html.js";
import { markdownSection } from "../../src/report/markdown.js";
import type { SaEvent } from "../../src/core/types.js";
import { state, ticket, ticketIn } from "../helpers.js";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 10, min)).toISOString();
const ev = (ticket: string, type: SaEvent["type"], min: number, extra: object = {}): SaEvent => ({
  t: at(min),
  agent: "worker",
  ticket,
  type,
  ...extra,
});

const docs = (over: Partial<TicketDocs> = {}): TicketDocs => ({
  ticketDir: ".superagent/tickets/x",
  goal: "",
  decisions: "",
  unusual: "",
  doneMeans: "",
  checks: [],
  ...over,
});

describe("markdownSection", () => {
  const md = `# 001: Tags

## Goal

<!-- template hint -->
Let users tag notes.

## Decisions

- Tags are lowercase.
- Max 10 per note.

### Sub heading stays in

text

## Depends on

- none
`;

  it("returns a section's body without HTML comments", () => {
    expect(markdownSection(md, "Goal")).toBe("Let users tag notes.");
  });

  it("keeps deeper headings and stops at the next ## heading", () => {
    expect(markdownSection(md, "Decisions")).toBe("- Tags are lowercase.\n- Max 10 per note.\n\n### Sub heading stays in\n\ntext");
  });

  it("returns empty for a missing or comment-only section", () => {
    expect(markdownSection(md, "Risks")).toBe("");
    expect(markdownSection("## Goal\n\n<!-- fill me -->\n", "Goal")).toBe("");
  });
});

describe("buildReport", () => {
  const s = state({
    "001": ticketIn("review", { title: "Add tags", pr: "https://github.com/o/r/pull/4", lastEval: { result: "pass", at: at(20), failed: [], commit: "abc" } }),
    "002": ticketIn("review", { title: "Search", pr: "https://github.com/o/r/pull/5", lastEval: { result: "pass", at: at(40), failed: [], commit: "def" } }),
    "003": ticketIn("blocked", { title: "Dark mode" }),
    "004": ticketIn("in_progress", { title: "Login", lastEval: { result: "fail", at: at(50), failed: ["C2"], commit: "123" } }),
    "005": ticket({ title: "Draft only" }),
  });
  const events: SaEvent[] = [
    ev("001", "claim", 0),
    ev("001", "eval", 20, { result: "pass", failed: [], commit: "abc" }),
    ev("001", "pr_opened", 21, { pr: "https://github.com/o/r/pull/4" }),
    ev("001", "tokens", 21, { count: 12000 }),
    ev("002", "claim", 1),
    ev("002", "eval", 25, { result: "fail", failed: ["C1"] }),
    ev("002", "eval", 40, { result: "pass", failed: [], commit: "def" }),
    ev("002", "pr_opened", 41, { pr: "https://github.com/o/r/pull/5" }),
    ev("002", "tokens", 41, { count: 8000 }),
    ev("002", "question", 30, { text: "Which index?" }),
    ev("003", "claim", 2),
    ev("003", "blocked", 30, { reason: "needs a design decision" }),
    ev("004", "claim", 3),
    ev("004", "eval", 50, { result: "fail", failed: ["C2"] }),
  ];
  const ticketDocs = {
    "001": docs({
      ticketDir: ".superagent/tickets/001-add-tags",
      goal: "Let users tag notes.",
      decisions: "- lowercase",
      checks: [
        { id: "C1", type: "command", run: "npm test -- tags" },
        { id: "C2", type: "browser", run: "open /notes" },
      ],
    }),
    "004": docs({ checks: [{ id: "C1", type: "command", run: "a" }, { id: "C2", type: "command", run: "b" }] }),
  };
  const report = buildReport(s, events, ticketDocs, NOW);

  it("summarises the run", () => {
    expect(report.run).toEqual({ id: "2026-11-16-a", generatedAt: NOW.toISOString(), budgetTokens: 2_000_000, maxWorkers: 2 });
    expect(report.summary).toEqual({
      tickets: 5,
      shipped: 2,
      blocked: 1,
      inProgress: 1,
      notStarted: 1,
      firstTryPass: 1,
      evals: 4,
      questions: 1,
      tokens: 20000,
      startedAt: at(0),
      endedAt: at(50),
      durationSeconds: 50 * 60,
    });
  });

  it("lists what went wrong", () => {
    expect(report.wentWrong).toEqual([
      "002 Search: needed 2 evals to pass",
      "003 Dark mode: blocked - needs a design decision",
      "004 Login: still in progress after 1 eval (last failed: C2)",
    ]);
  });

  it("builds a card per ticket, sorted by id, with eval results per check", () => {
    expect(report.tickets.map((t) => t.id)).toEqual(["001", "002", "003", "004", "005"]);
    const t1 = report.tickets[0]!;
    expect(t1).toMatchObject({
      title: "Add tags",
      status: "review",
      pr: "https://github.com/o/r/pull/4",
      goal: "Let users tag notes.",
      decisions: "- lowercase",
      evalCount: 1,
      firstTryPass: true,
      tokens: 12000,
      claimedAt: at(0),
      submittedAt: at(21),
      blockedReason: null,
    });
    expect(t1.checks).toEqual([
      { id: "C1", type: "command", run: "npm test -- tags", status: "pass" },
      { id: "C2", type: "browser", run: "open /notes", status: "skipped" },
    ]);
    expect(report.tickets[3]!.checks.map((c) => c.status)).toEqual(["pass", "fail"]);
    expect(report.tickets[1]).toMatchObject({ firstTryPass: false, evalCount: 2 });
    expect(report.tickets[2]).toMatchObject({ blockedReason: "needs a design decision", firstTryPass: null });
    expect(report.tickets[4]).toMatchObject({ checks: [], claimedAt: null });
  });

  it("gives every ticket a ready-to-paste prompt for digging deeper", () => {
    const ask = report.tickets[0]!.ask;
    expect(ask).toContain("ticket 001 (Add tags)");
    expect(ask).toContain(".superagent/tickets/001-add-tags/spec.md");
    expect(ask).toContain("https://github.com/o/r/pull/4");
    expect(ask).toMatch(/what should I check by hand/i);
  });

  it("checks with no eval yet are 'not run'", () => {
    const r = buildReport(state({ "001": ticketIn("in_progress", { lastEval: null }) }), [], { "001": docs({ checks: [{ id: "C1", type: "command", run: "x" }] }) }, NOW);
    expect(r.tickets[0]!.checks[0]!.status).toBe("not run");
    expect(r.summary).toMatchObject({ startedAt: null, durationSeconds: null });
  });
});

describe("renderReportHtml", () => {
  const s = state({
    "001": ticketIn("review", { title: "Tags <script>alert(1)</script>", pr: "https://github.com/o/r/pull/4" }),
    "002": ticketIn("blocked", { title: "Dark & light" }),
  });
  const events: SaEvent[] = [ev("002", "blocked", 5, { reason: 'needs "colors" <b>' })];
  const html = renderReportHtml(buildReport(s, events, { "001": docs({ goal: "Goal <i>x</i>" }) }, NOW));

  it("is a complete standalone page", () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>Super Agent run 2026-11-16-a</title>");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toMatch(/<script|<link|src=/i);
    expect(html).toContain("Generated 2026-11-17 12:00 UTC");
  });

  it("escapes everything that came from tickets, specs and events", () => {
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Tags &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Goal &lt;i&gt;x&lt;/i&gt;");
    expect(html).toContain("needs &quot;colors&quot; &lt;b&gt;");
    expect(html).toContain("Dark &amp; light");
  });

  it("shows the summary, what went wrong, and one card per ticket with its PR link", () => {
    expect(html).toContain("What went wrong");
    expect(html.match(/<article class="ticket/g)).toHaveLength(2);
    expect(html).toContain('<a href="https://github.com/o/r/pull/4">');
    expect(html).toContain("Ask about this");
  });

  it("only links http(s) PR URLs", () => {
    const bad = renderReportHtml(
      buildReport(state({ "001": ticketIn("review", { pr: "javascript:alert(1)" }) }), [], {}, NOW),
    );
    expect(bad).not.toContain('href="javascript:');
  });
});
