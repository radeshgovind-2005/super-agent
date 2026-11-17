import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { loadState } from "../../src/core/state.js";
import { captureIo, state, tempProject, ticket, ticketIn } from "../helpers.js";
import { NOW, fakeGh, type FakeGh } from "./fixtures.js";

const pr = (n: number) => `https://github.com/o/r/pull/${n}`;

async function sa(cwd: string, gh: FakeGh, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: gh.env });
  return { code, out: io.out(), err: io.err() };
}

/** 001 merged, 002 still open, 003 closed without merging, 004 done already, 005 in progress. */
async function project(states = `${pr(1)} MERGED\n${pr(3)} CLOSED`, extraEnv: Record<string, string> = {}) {
  const p = await tempProject(
    state({
      "001": ticketIn("review", { title: "Add tags", pr: pr(1) }),
      "002": ticketIn("review", { title: "Search", pr: pr(2) }),
      "003": ticketIn("review", { title: "Filter", pr: pr(3) }),
      "004": ticketIn("done", { title: "Old", pr: pr(4) }),
      "005": ticketIn("in_progress", { title: "Busy" }),
      "006": ticket({ title: "Draft" }),
    }),
  );
  const gh = await fakeGh({ FAKE_GH_STATES: states, ...extraEnv });
  return { ...p, gh };
}

describe("sa sync", () => {
  it("marks tickets whose PR merged as done, and logs a done event for each", async () => {
    const p = await project();
    const r = await sa(p.repo, p.gh, "sync");

    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        `001  done    ${pr(1)} merged`,
        `002  review  ${pr(2)} still open`,
        `003  review  ${pr(3)} closed without merging: reopen it, or re-run the ticket`,
        "",
        "1 ticket marked done.",
        "",
      ].join("\n"),
    );

    const s = await loadState(p.saDir);
    expect(Object.fromEntries(Object.entries(s.tickets).map(([id, t]) => [id, t.status]))).toEqual({
      "001": "done",
      "002": "review",
      "003": "review",
      "004": "done",
      "005": "in_progress",
      "006": "draft",
    });
    expect(s.tickets["001"]!.pr).toBe(pr(1));

    expect((await readEvents(p.saDir)).filter((e) => e.type === "done")).toEqual([
      { t: NOW.toISOString(), agent: "sa", ticket: "001", type: "done", pr: pr(1) },
    ]);
  });

  it("asks gh only about tickets in review", async () => {
    const p = await project();
    await sa(p.repo, p.gh, "sync");
    const views = (await p.gh.calls()).filter((c) => c[1] === "view").map((c) => c[2]);
    expect(views.sort()).toEqual([pr(1), pr(2), pr(3)]);
  });

  it("is safe to run again: nothing changes the second time", async () => {
    const p = await project();
    await sa(p.repo, p.gh, "sync");
    const r = await sa(p.repo, p.gh, "sync");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("001");
    expect(r.out).toContain("0 tickets marked done.");
    expect((await readEvents(p.saDir)).filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("supports --json", async () => {
    const p = await project();
    const r = await sa(p.repo, p.gh, "sync", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      tickets: [
        { id: "001", pr: pr(1), prState: "MERGED", status: "done" },
        { id: "002", pr: pr(2), prState: "OPEN", status: "review" },
        { id: "003", pr: pr(3), prState: "CLOSED", status: "review" },
      ],
      done: ["001"],
    });
  });

  it("says so when nothing is in review, without calling gh", async () => {
    const p = await tempProject(state({ "001": ticketIn("ready") }));
    const gh = await fakeGh();
    const r = await sa(p.repo, gh, "sync");
    expect(r.code).toBe(0);
    expect(r.out).toBe("No tickets in review.\n");
    expect(await gh.calls()).toEqual([]);
  });

  it("fails without changing anything when gh fails", async () => {
    const p = await project(undefined, { FAKE_GH_FAIL_VIEW: "HTTP 401: Bad credentials" });
    const r = await sa(p.repo, p.gh, "sync");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/gh pr view failed: HTTP 401: Bad credentials/);
    expect((await loadState(p.saDir)).tickets["001"]!.status).toBe("review");
    expect(await readEvents(p.saDir)).toEqual([]);
  });

  it("refuses a gh answer it does not know", async () => {
    const p = await project(`${pr(1)} WEIRD`);
    const r = await sa(p.repo, p.gh, "sync");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/unexpected PR state "WEIRD"/);
    expect((await loadState(p.saDir)).tickets["001"]!.status).toBe("review");
  });

  it("rejects arguments it does not take", async () => {
    const p = await project();
    expect((await sa(p.repo, p.gh, "sync", "001")).code).toBe(2);
    expect((await sa(p.repo, p.gh, "sync", "--bogus")).code).toBe(2);
  });

  it("refuses before sa init", async () => {
    const { tempRepo } = await import("../helpers.js");
    const r = await sa(await tempRepo(), await fakeGh(), "sync");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/superagent init/);
  });
});
