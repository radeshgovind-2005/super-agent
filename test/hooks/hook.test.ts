import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { loadState, updateState } from "../../src/core/state.js";
import { unsubmittableStreak } from "../../src/hooks/stop.js";
import type { SaEvent } from "../../src/core/types.js";
import { captureIo, git, tempDir, tempProject, state, ticketIn } from "../helpers.js";
import { NOW, claimedProject, evalMd } from "../commands/fixtures.js";

interface HookRun {
  cwd: string;
  input: unknown;
  env?: Record<string, string>;
  args?: string[];
}

async function hook(kind: string, r: HookRun) {
  const io = captureIo();
  const stdin = typeof r.input === "string" ? r.input : JSON.stringify(r.input);
  const code = await run(["hook", kind, ...(r.args ?? [])], io, {
    cwd: r.cwd,
    now: () => NOW,
    env: r.env ?? {},
    readStdin: async () => stdin,
  });
  return { code, out: io.out(), err: io.err() };
}

const stopInput = (cwd: string, extra: object = {}) => ({
  session_id: "s1",
  cwd,
  hook_event_name: "Stop",
  stop_hook_active: false,
  ...extra,
});

const FAILING = "- {id: C1, type: command, run: 'echo \"tags test failed\"; exit 1'}";

describe("unsubmittableStreak", () => {
  const e = (type: SaEvent["type"], extra: object = {}, ticket = "001"): SaEvent => ({
    t: NOW.toISOString(),
    agent: "w",
    ticket,
    type,
    ...extra,
  });
  const fail = e("eval", { result: "fail" });
  const passNoCommit = e("eval", { result: "pass" });
  const pass = e("eval", { result: "pass", commit: "abc" });

  it("counts trailing evals that cannot be submitted, since the last claim", () => {
    expect(unsubmittableStreak([], "001")).toBe(0);
    expect(unsubmittableStreak([fail, fail], "001")).toBe(2);
    expect(unsubmittableStreak([fail, passNoCommit, fail], "001")).toBe(3);
    expect(unsubmittableStreak([fail, pass, fail], "001")).toBe(1);
    expect(unsubmittableStreak([fail, fail, e("claim"), fail], "001")).toBe(1);
    expect(unsubmittableStreak([fail, e("heartbeat"), fail], "001")).toBe(2);
    expect(unsubmittableStreak([fail, e("eval", { result: "fail" }, "002")], "001")).toBe(1);
  });
});

describe("sa hook stop", () => {
  it("lets a session stop when it is not working on a ticket", async () => {
    const { repo, saDir } = await claimedProject();
    const r = await hook("stop", { cwd: repo, input: stopInput(repo) });
    expect(r).toEqual({ code: 0, out: "", err: "" });
    expect((await readEvents(saDir)).filter((x) => x.type === "eval")).toEqual([]);
  });

  it("lets a session outside any sa project stop", async () => {
    const dir = await tempDir();
    expect((await hook("stop", { cwd: dir, input: stopInput(dir) })).code).toBe(0);
  });

  it("lets the worker stop when its eval passes on a commit", async () => {
    const { wt, saDir } = await claimedProject();
    const r = await hook("stop", { cwd: wt, input: stopInput(wt) });
    expect(r.code).toBe(0);
    expect((await loadState(saDir)).tickets["001"]?.lastEval).toMatchObject({ result: "pass" });
  });

  it("uses the cwd from the hook input, not the process cwd", async () => {
    const { wt } = await claimedProject(FAILING);
    expect((await hook("stop", { cwd: await tempDir(), input: stopInput(wt) })).code).toBe(2);
  });

  it("blocks with exit 2 and the failing output while the eval fails", async () => {
    const { wt, saDir } = await claimedProject(FAILING);
    const r = await hook("stop", { cwd: wt, input: stopInput(wt) });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/FAIL\s+C1/);
    expect(r.err).toContain("tags test failed");
    expect(r.err).toMatch(/eval for ticket 001 failed \(attempt 1 of 5\)/);
    expect(r.err).toMatch(/Do not edit eval\.md/);
    expect((await loadState(saDir)).tickets["001"]?.status).toBe("in_progress");
  });

  it("handles SubagentStop the same way", async () => {
    const { wt } = await claimedProject(FAILING);
    const r = await hook("stop", { cwd: wt, input: stopInput(wt, { hook_event_name: "SubagentStop", agent_id: "a1" }) });
    expect(r.code).toBe(2);
  });

  it("blocks when the checks pass but the work is not committed", async () => {
    const { wt } = await claimedProject(undefined, { commitFeature: false });
    await writeFile(join(wt, "feature.txt"), "x");
    const r = await hook("stop", { cwd: wt, input: stopInput(wt) });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not committed/);
  });

  it("blocks the ticket and lets the worker stop after max fails in a row", async () => {
    const { wt, saDir } = await claimedProject(FAILING);
    expect((await hook("stop", { cwd: wt, input: stopInput(wt), args: ["--max-fails", "2"] })).code).toBe(2);
    const r = await hook("stop", { cwd: wt, input: stopInput(wt, { stop_hook_active: true }), args: ["--max-fails", "2"] });
    expect(r.code).toBe(0);
    expect((await loadState(saDir)).tickets["001"]).toMatchObject({ status: "blocked", owner: null });
    expect(await readEvents(saDir)).toContainEqual({
      t: NOW.toISOString(),
      agent: "sa",
      ticket: "001",
      type: "blocked",
      reason: "eval failed 2 times in a row",
    });
  });

  it("finds the ticket from SA_TICKET when the cwd is not a worktree", async () => {
    const { repo } = await claimedProject(FAILING);
    expect((await hook("stop", { cwd: repo, input: stopInput(repo), env: { SA_TICKET: "001" } })).code).toBe(2);
  });

  it("does nothing for a ticket that is no longer in progress", async () => {
    const { wt, saDir } = await claimedProject(FAILING);
    await updateState(saDir, (s) => ({
      ...s,
      tickets: { ...s.tickets, "001": { ...s.tickets["001"]!, status: "review", owner: null, pr: "https://x/1" } },
    }));
    expect((await hook("stop", { cwd: wt, input: stopInput(wt) })).code).toBe(0);
  });

  it("exits 1 (non-blocking) when the eval cannot run", async () => {
    const { wt, saDir } = await claimedProject();
    await writeFile(join(saDir, "tickets", "001-add-tags", "eval.md"), evalMd("- {id: C1, type: rubric, run: x}"));
    const r = await hook("stop", { cwd: wt, input: stopInput(wt) });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no command check/);
  });

  it("exits 1 (non-blocking) on unreadable input", async () => {
    const r = await hook("stop", { cwd: await tempDir(), input: "not json" });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/hook input/);
  });
});

describe("sa hook pre-tool-use", () => {
  const toolInput = (cwd: string, tool_name: string, tool_input: object) => ({
    session_id: "s1",
    cwd,
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    tool_use_id: "t1",
  });

  it("allows a normal tool call silently", async () => {
    const { wt } = await claimedProject();
    const r = await hook("pre-tool-use", { cwd: wt, input: toolInput(wt, "Edit", { file_path: join(wt, "src/a.ts") }) });
    expect(r).toEqual({ code: 0, out: "", err: "" });
  });

  it("blocks reading .env with exit 2 and a reason on stderr", async () => {
    const { repo } = await claimedProject();
    const r = await hook("pre-tool-use", { cwd: repo, input: toolInput(repo, "Read", { file_path: join(repo, ".env") }) });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^sa: blocked: .*secret/);
  });

  it("knows the worker's protected test files from its eval.md", async () => {
    const yaml = "- {id: C1, type: command, run: npm test, files: [test/tags.test.ts]}";
    const { wt } = await claimedProject(yaml);
    const edit = (p: string) => toolInput(wt, "Edit", { file_path: join(wt, p) });
    expect((await hook("pre-tool-use", { cwd: wt, input: edit("test/tags.test.ts") })).code).toBe(2);
    expect((await hook("pre-tool-use", { cwd: wt, input: edit("src/tags.ts") })).code).toBe(0);
  });

  it("blocks a bare git push from the main checkout on main", async () => {
    const { repo } = await claimedProject();
    expect(git(repo, "branch", "--show-current")).toBe("main");
    const r = await hook("pre-tool-use", { cwd: repo, input: toolInput(repo, "Bash", { command: "git push" }) });
    expect(r.code).toBe(2);
  });

  it("still guards secrets outside an sa project", async () => {
    const dir = await tempDir();
    expect((await hook("pre-tool-use", { cwd: dir, input: toolInput(dir, "Read", { file_path: ".env" }) })).code).toBe(2);
  });

  it("fails closed (exit 2) on unreadable input", async () => {
    const r = await hook("pre-tool-use", { cwd: await tempDir(), input: "{" });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/hook input/);
  });

  it("exits 2 for an unknown hook kind", async () => {
    const { repo } = await tempProject(state({ "001": ticketIn("ready") }));
    const io = captureIo();
    expect(await run(["hook", "post-tool-use"], io, { cwd: repo, env: {}, readStdin: async () => "{}" })).toBe(2);
    expect(io.err()).toMatch(/Usage: sa hook/);
  });
});
