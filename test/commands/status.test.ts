import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { buildStatus, formatAge, renderStatus } from "../../src/commands/status.js";
import { appendEvent } from "../../src/core/events.js";
import type { SaEvent } from "../../src/core/types.js";
import { captureIo, state, tempDir, tempProject, tempRepo, ticket, ticketIn } from "../helpers.js";
import { snapshotFiles } from "./readonly.js";

const NOW = new Date("2026-11-16T20:00:00.000Z");
const now = () => NOW;

const sample = () =>
  state({
    "002": ticketIn("ready", { title: "Search notes", dependsOn: ["001"] }),
    "001": ticketIn("in_progress", { title: "Add tags field", owner: "worker-1" }),
    "003": ticket({ title: "Dark | mode" }),
  });

const ev = (ticket: string, type: SaEvent["type"], t: string, agent = "worker-1"): SaEvent => ({
  t,
  agent,
  ticket,
  type,
});

const events = [
  ev("001", "claim", "2026-11-16T19:40:00.000Z", "router"),
  ev("001", "eval", "2026-11-16T19:57:00.000Z"),
  ev("002", "question", "2026-11-16T17:59:30.000Z", "router"),
];

describe("formatAge", () => {
  it.each([
    [0, "0s"],
    [59, "59s"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h"],
    [86_399, "23h"],
    [86_400, "1d"],
  ])("%i seconds → %s", (s, out) => {
    expect(formatAge(s)).toBe(out);
  });
});

describe("buildStatus", () => {
  it("joins state with each ticket's latest event and idle time", () => {
    const report = buildStatus(sample(), events, NOW);
    expect(report.run).toEqual({ id: "2026-11-16-a", budgetTokens: 2_000_000, maxWorkers: 2, busyWorkers: 1 });
    expect(report.tickets.map((t) => t.id)).toEqual(["001", "002", "003"]);
    expect(report.tickets[0]).toMatchObject({
      id: "001",
      status: "in_progress",
      owner: "worker-1",
      lastEvent: { type: "eval", t: "2026-11-16T19:57:00.000Z", agent: "worker-1" },
      idleSeconds: 180,
    });
    expect(report.tickets[1]).toMatchObject({ idleSeconds: 7230, lastEvent: { type: "question" } });
    expect(report.tickets[2]).toMatchObject({ lastEvent: null, idleSeconds: null });
  });

  it("never reports negative idle time for events stamped in the future", () => {
    const report = buildStatus(sample(), [ev("001", "heartbeat", "2026-11-16T20:05:00.000Z")], NOW);
    expect(report.tickets[0]?.idleSeconds).toBe(0);
  });
});

describe("renderStatus", () => {
  it("renders an aligned table", () => {
    expect(renderStatus(buildStatus(sample(), events, NOW))).toBe(
      [
        "Run 2026-11-16-a · 1 of 2 workers busy · budget 2,000,000 tokens",
        "",
        "ID   STATUS       MODE  OWNER     LAST EVENT         TITLE",
        "001  in_progress  solo  worker-1  3m ago (eval)      Add tags field",
        "002  ready        solo  –         2h ago (question)  Search notes",
        "003  draft        solo  –         –                  Dark | mode",
        "",
      ].join("\n"),
    );
  });

  it("says so when there are no tickets", () => {
    expect(renderStatus(buildStatus(state(), [], NOW))).toContain("No tickets yet.");
  });
});

describe("sa status", () => {
  async function project() {
    const p = await tempProject(sample());
    for (const e of events) await appendEvent(p.saDir, e);
    return p;
  }

  it("prints the table", async () => {
    const { repo } = await project();
    const io = captureIo();
    expect(await run(["status"], io, { cwd: repo, now })).toBe(0);
    expect(io.out()).toBe(renderStatus(buildStatus(sample(), events, NOW)));
  });

  it("prints the full report as JSON with --json", async () => {
    const { repo } = await project();
    const io = captureIo();
    expect(await run(["status", "--json"], io, { cwd: repo, now })).toBe(0);
    const json = JSON.parse(io.out());
    expect(json).toEqual(buildStatus(sample(), events, NOW));
    expect(Object.keys(json.tickets[0]).sort()).toEqual(
      [
        "attempts",
        "branch",
        "dependsOn",
        "id",
        "idleSeconds",
        "lastEval",
        "lastEvent",
        "mode",
        "owner",
        "pr",
        "status",
        "title",
        "worktree",
      ].sort(),
    );
  });

  it("writes nothing", async () => {
    const { repo, saDir } = await project();
    const before = await snapshotFiles(saDir);
    await run(["status"], captureIo(), { cwd: repo, now });
    await run(["status", "--json"], captureIo(), { cwd: repo, now });
    expect(await snapshotFiles(saDir)).toEqual(before);
  });

  it("exits 1 when .superagent is not initialised", async () => {
    const io = captureIo();
    expect(await run(["status"], io, { cwd: await tempRepo() })).toBe(1);
    expect(io.err()).toMatch(/Run \/superagent init first/);
  });

  it("exits 2 on an unknown option", async () => {
    const io = captureIo();
    expect(await run(["status", "--all"], io, { cwd: await tempDir() })).toBe(2);
    expect(io.err()).toMatch(/Usage: sa status/);
  });
});
