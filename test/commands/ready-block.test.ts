import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { loadState, updateState } from "../../src/core/state.js";
import { captureIo, tempRepo, ticketIn } from "../helpers.js";
import { NOW, evalMd } from "./fixtures.js";

async function sa(cwd: string, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: {} });
  return { code, out: io.out(), err: io.err() };
}

const evalPath = (saDir: string) => join(saDir, "tickets", "001-add-tags", "eval.md");

/** An initialised repo with draft ticket 001 "Add tags" (template eval.md). */
async function withDraft() {
  const repo = await tempRepo();
  await sa(repo, "init");
  await sa(repo, "add", "001", "--title", "Add tags");
  return { repo, saDir: join(repo, ".superagent") };
}

describe("sa ready", () => {
  it("moves a draft to ready when eval.md has a command check", async () => {
    const { repo, saDir } = await withDraft();
    await writeFile(evalPath(saDir), evalMd("- {id: C1, type: command, run: npm test}\n- {id: C2, type: rubric, run: Reads well}"));
    const r = await sa(repo, "ready", "001");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Ready 001 (1 command check, 1 other)\n");
    expect((await loadState(saDir)).tickets["001"]?.status).toBe("ready");
  });

  it("refuses the untouched template eval.md", async () => {
    const { repo, saDir } = await withDraft();
    const r = await sa(repo, "ready", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot mark 001 ready: .*eval\.md: checks block must be a list with at least one check/);
    expect((await loadState(saDir)).tickets["001"]?.status).toBe("draft");
  });

  it("refuses an eval with no check a machine can run", async () => {
    const { repo, saDir } = await withDraft();
    await writeFile(evalPath(saDir), evalMd("- {id: C1, type: browser, run: open /}"));
    const r = await sa(repo, "ready", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot mark 001 ready: its eval has no command check/);
  });

  it("refuses when eval.md is missing", async () => {
    const { repo, saDir } = await withDraft();
    await rm(evalPath(saDir));
    expect((await sa(repo, "ready", "001")).err).toMatch(/No eval\.md for ticket 001/);
  });

  it("moves a blocked ticket back to ready", async () => {
    const { repo, saDir } = await withDraft();
    await writeFile(evalPath(saDir), evalMd("- {id: C1, type: command, run: 'true'}"));
    await sa(repo, "ready", "001");
    await sa(repo, "block", "001", "--reason", "needs a decision", "--agent", "router");
    expect((await sa(repo, "ready", "001")).code).toBe(0);
    expect((await loadState(saDir)).tickets["001"]?.status).toBe("ready");
  });

  it("refuses a ticket that is already ready, without re-checking", async () => {
    const { repo, saDir } = await withDraft();
    await writeFile(evalPath(saDir), evalMd("- {id: C1, type: command, run: 'true'}"));
    await sa(repo, "ready", "001");
    const r = await sa(repo, "ready", "001");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot mark ready ticket 001: it is ready/);
  });

  it("exits 1 for an unknown ticket and 2 without an id", async () => {
    const { repo } = await withDraft();
    expect((await sa(repo, "ready", "009")).err).toMatch(/Unknown ticket 009/);
    expect((await sa(repo, "ready")).code).toBe(2);
  });
});

describe("sa block", () => {
  it("blocks an in-progress ticket, frees its owner, and logs the reason", async () => {
    const { repo, saDir } = await withDraft();
    await updateState(saDir, (s) => ({ ...s, tickets: { "001": ticketIn("in_progress", { title: "Add tags" }) } }));
    const r = await sa(repo, "block", "001", "--reason", "stale for 15 min", "--agent", "watchdog");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Blocked 001: stale for 15 min\n");
    expect((await loadState(saDir)).tickets["001"]).toMatchObject({ status: "blocked", owner: null });
    expect(await readEvents(saDir)).toEqual([
      { t: NOW.toISOString(), agent: "watchdog", ticket: "001", type: "blocked", reason: "stale for 15 min" },
    ]);
  });

  it("blocks a ready ticket", async () => {
    const { repo, saDir } = await withDraft();
    await writeFile(evalPath(saDir), evalMd("- {id: C1, type: command, run: 'true'}"));
    await sa(repo, "ready", "001");
    expect((await sa(repo, "block", "001", "--reason", "wait", "--agent", "router")).code).toBe(0);
  });

  it("exits 1 for a draft ticket and logs nothing", async () => {
    const { repo, saDir } = await withDraft();
    const before = await readFile(join(saDir, "state.json"), "utf8");
    const r = await sa(repo, "block", "001", "--reason", "x", "--agent", "router");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Cannot block ticket 001: it is draft/);
    expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
    expect(await readEvents(saDir)).toEqual([]);
  });

  it.each([
    ["no reason", ["block", "001", "--agent", "router"], /--reason/],
    ["an empty reason", ["block", "001", "--reason", " ", "--agent", "router"], /--reason/],
    ["no agent", ["block", "001", "--reason", "x"], /--agent/],
  ])("exits 2 for %s", async (_label, argv, pattern) => {
    const { repo } = await withDraft();
    const r = await sa(repo, ...argv);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(pattern);
  });
});
