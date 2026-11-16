import { describe, expect, it } from "vitest";
import { SaError } from "../../src/core/errors.js";
import {
  addTicket,
  block,
  claim,
  markDone,
  markReady,
  recordEval,
  retry,
  submit,
  unmetDeps,
} from "../../src/core/transitions.js";
import { TICKET_STATUSES, type State, type TicketStatus } from "../../src/core/types.js";
import { deepFreeze, state, ticket, ticketIn } from "../helpers.js";

const claimInput = { agent: "worker-2", branch: "sa/001-x", worktree: "../.sa-worktrees/001" };
const passEval = { result: "pass" as const, at: "2026-11-16T20:00:00.000Z", failed: [], commit: "abc123" };

type Action = (s: State) => State;
const actions: Record<string, { run: Action; allowedFrom: TicketStatus[] }> = {
  markReady: { run: (s) => markReady(s, "001"), allowedFrom: ["draft", "blocked"] },
  claim: { run: (s) => claim(s, "001", claimInput), allowedFrom: ["ready"] },
  recordEval: { run: (s) => recordEval(s, "001", passEval), allowedFrom: ["in_progress"] },
  submit: {
    run: (s) => submit(s, "001", { pr: "https://github.com/o/r/pull/9", headCommit: "abc123" }),
    allowedFrom: ["in_progress"],
  },
  retry: { run: (s) => retry(s, "001"), allowedFrom: ["in_progress"] },
  block: { run: (s) => block(s, "001"), allowedFrom: ["ready", "in_progress"] },
  markDone: { run: (s) => markDone(s, "001"), allowedFrom: ["review"] },
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    if (e instanceof SaError) return e.code;
    throw e;
  }
}

describe("transition table", () => {
  const cases = Object.entries(actions).flatMap(([name, a]) =>
    TICKET_STATUSES.map((from) => ({ name, from, allowed: a.allowedFrom.includes(from), run: a.run })),
  );

  it.each(cases)("$name from $from → allowed: $allowed", ({ from, allowed, run }) => {
    const s = deepFreeze(state({ "001": ticketIn(from) }));
    const code = codeOf(() => run(s));
    expect(code).toBe(allowed ? undefined : "ILLEGAL_TRANSITION");
  });
});

describe("unknown ticket", () => {
  it.each(Object.entries(actions))("%s refuses an unknown id", (_name, a) => {
    expect(codeOf(() => a.run(state({})))).toBe("UNKNOWN_TICKET");
  });
});

describe("markReady", () => {
  it("moves draft to ready without touching other tickets", () => {
    const s = deepFreeze(state({ "001": ticket(), "002": ticket({ title: "Other" }) }));
    const next = markReady(s, "001");
    expect(next.tickets["001"]?.status).toBe("ready");
    expect(next.tickets["002"]).toBe(s.tickets["002"]);
  });
});

describe("claim", () => {
  it("sets owner, branch, worktree and bumps attempts", () => {
    const s = deepFreeze(state({ "001": ticketIn("ready", { attempts: 1 }) }));
    const t = claim(s, "001", claimInput).tickets["001"];
    expect(t).toMatchObject({
      status: "in_progress",
      owner: "worker-2",
      branch: "sa/001-x",
      worktree: "../.sa-worktrees/001",
      attempts: 2,
    });
  });

  it.each(["draft", "ready", "in_progress", "blocked"] as const)(
    "refuses when a dependency is %s",
    (depStatus) => {
      const s = state({ "001": ticketIn("ready", { dependsOn: ["002"] }), "002": ticketIn(depStatus) });
      expect(codeOf(() => claim(s, "001", claimInput))).toBe("DEPS_UNMET");
    },
  );

  it.each(["review", "done"] as const)("allows a dependency in %s", (depStatus) => {
    const s = state({ "001": ticketIn("ready", { dependsOn: ["002"] }), "002": ticketIn(depStatus) });
    expect(claim(s, "001", claimInput).tickets["001"]?.status).toBe("in_progress");
  });

  it("names the unmet dependencies", () => {
    const s = state({
      "001": ticketIn("ready", { dependsOn: ["002", "003", "004"] }),
      "002": ticketIn("done"),
      "003": ticketIn("draft"),
      "004": ticketIn("in_progress"),
    });
    expect(unmetDeps(s, "001")).toEqual(["003", "004"]);
    expect(() => claim(s, "001", claimInput)).toThrow(/003, 004/);
  });

  it("refuses when maxWorkers tickets are already in progress", () => {
    const s = state(
      { "001": ticketIn("ready"), "002": ticketIn("in_progress") },
      { maxWorkers: 1 },
    );
    expect(codeOf(() => claim(s, "001", claimInput))).toBe("MAX_WORKERS");
  });
});

describe("recordEval", () => {
  it("stores the eval result on the ticket", () => {
    const failEval = { result: "fail" as const, at: "2026-11-16T20:01:00.000Z", failed: ["C2"], commit: "def456" };
    const s = deepFreeze(state({ "001": ticketIn("in_progress") }));
    expect(recordEval(s, "001", failEval).tickets["001"]?.lastEval).toEqual(failEval);
  });
});

describe("submit", () => {
  const pr = "https://github.com/o/r/pull/9";

  it("moves to review, records the PR and clears the owner", () => {
    const s = deepFreeze(state({ "001": ticketIn("in_progress") }));
    const t = submit(s, "001", { pr, headCommit: "abc123" }).tickets["001"];
    expect(t).toMatchObject({ status: "review", pr, owner: null });
  });

  it("refuses with no eval", () => {
    const s = state({ "001": ticketIn("in_progress", { lastEval: null }) });
    expect(codeOf(() => submit(s, "001", { pr, headCommit: "abc123" }))).toBe("EVAL_NOT_PASSED");
  });

  it("refuses when the last eval failed", () => {
    const s = state({ "001": ticketIn("in_progress", { lastEval: { ...passEval, result: "fail", failed: ["C1"] } }) });
    expect(codeOf(() => submit(s, "001", { pr, headCommit: "abc123" }))).toBe("EVAL_NOT_PASSED");
  });

  it("refuses when HEAD moved after the passing eval", () => {
    const s = state({ "001": ticketIn("in_progress") });
    expect(codeOf(() => submit(s, "001", { pr, headCommit: "999999" }))).toBe("STALE_EVAL");
  });

  it("refuses when the passing eval recorded no commit", () => {
    const { commit: _drop, ...noCommit } = passEval;
    const s = state({ "001": ticketIn("in_progress", { lastEval: noCommit }) });
    expect(codeOf(() => submit(s, "001", { pr, headCommit: "abc123" }))).toBe("STALE_EVAL");
  });
});

describe("addTicket", () => {
  it("adds a draft ticket with empty run fields", () => {
    const s = deepFreeze(state({ "001": ticket() }));
    const next = addTicket(s, "002", { title: "Search", mode: "team", dependsOn: ["001"] });
    expect(next.tickets["002"]).toEqual(ticket({ title: "Search", mode: "team", dependsOn: ["001"] }));
    expect(next.tickets["001"]).toBe(s.tickets["001"]);
  });

  it("refuses a duplicate id", () => {
    expect(codeOf(() => addTicket(state({ "001": ticket() }), "001", { title: "X", mode: "solo", dependsOn: [] }))).toBe(
      "DUPLICATE_TICKET",
    );
  });

  it("refuses an unknown dependency", () => {
    expect(codeOf(() => addTicket(state(), "001", { title: "X", mode: "solo", dependsOn: ["009"] }))).toBe(
      "UNKNOWN_TICKET",
    );
  });
});

describe("retry and block", () => {
  it("retry returns the ticket to ready and frees the owner", () => {
    const t = retry(state({ "001": ticketIn("in_progress") }), "001").tickets["001"];
    expect(t).toMatchObject({ status: "ready", owner: null });
  });

  it("block frees the owner", () => {
    const t = block(state({ "001": ticketIn("in_progress") }), "001").tickets["001"];
    expect(t).toMatchObject({ status: "blocked", owner: null });
  });
});
