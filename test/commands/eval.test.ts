import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { readEvents } from "../../src/core/events.js";
import { loadState } from "../../src/core/state.js";
import { captureIo, git, state, tempProject, ticket, ticketIn } from "../helpers.js";

const NOW = new Date("2026-11-16T20:00:00.000Z");
const ctx = (cwd: string) => ({ cwd, now: () => NOW, env: {} });

const evalMd = (yaml: string) => `# Eval\n\n## Checks\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;

const PASSING = `- id: C1
  type: command
  run: test -f feature.txt
- id: C2
  type: browser
  run: open /notes
  expect: notes visible`;

/** A project with ticket 001 claimed by worker-1, its eval.md written, and its worktree path. */
async function claimed(yaml: string, opts: { commitFeature?: boolean } = { commitFeature: true }) {
  const p = await tempProject(
    state({ "001": ticketIn("ready", { title: "Add tags" }), "002": ticketIn("ready", { title: "Other" }), "003": ticket() }),
  );
  const dir = join(p.saDir, "tickets", "001-add-tags");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "eval.md"), evalMd(yaml));

  const io = captureIo();
  if ((await run(["claim", "001", "--agent", "worker-1", "--json"], io, ctx(p.repo))) !== 0) throw new Error(io.err());
  const wt = (JSON.parse(io.out()) as { worktree: string }).worktree;

  if (opts.commitFeature) {
    await writeFile(join(wt, "feature.txt"), "done");
    git(wt, "add", "feature.txt");
    git(wt, "commit", "-q", "-m", "feat: add feature");
  }
  return { ...p, wt };
}

async function evalRun(cwd: string, ...args: string[]) {
  const io = captureIo();
  const code = await run(["eval", "001", ...args], io, ctx(cwd));
  return { code, out: io.out(), err: io.err() };
}

describe("sa eval", () => {
  it("passes when every command check passes, and records it", async () => {
    const { repo, saDir, wt } = await claimed(PASSING);
    const r = await evalRun(repo);

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Eval 001: PASS/);
    expect(r.out).toMatch(/PASS\s+C1/);
    expect(r.out).toMatch(/SKIP\s+C2\s+browser check/);

    const head = git(wt, "rev-parse", "HEAD");
    expect((await loadState(saDir)).tickets["001"]?.lastEval).toEqual({
      result: "pass",
      at: NOW.toISOString(),
      failed: [],
      commit: head,
    });
    expect(await readEvents(saDir)).toContainEqual({
      t: NOW.toISOString(),
      agent: "worker-1",
      ticket: "001",
      type: "eval",
      result: "pass",
      failed: [],
      skipped: ["C2"],
      commit: head,
    });
  });

  it("runs checks inside the ticket's worktree, even when called from the main checkout", async () => {
    const { repo } = await claimed(`- {id: C1, type: command, run: 'test -f feature.txt'}`);
    expect(existsSync(join(repo, "feature.txt"))).toBe(false); // committed only on the ticket branch
    expect((await evalRun(repo)).code).toBe(0);
  });

  it("works when called from inside the worktree (as the Stop hook will)", async () => {
    const { wt } = await claimed(PASSING);
    expect((await evalRun(wt)).code).toBe(0);
  });

  it("fails, names the failed checks, and shows their output", async () => {
    const { repo, saDir } = await claimed(`- {id: C1, type: command, run: 'true'}
- {id: C2, type: command, run: 'echo "2 tests failed" >&2; exit 1'}
- {id: C3, type: command, run: 'exit 4', expect: exit 4}`);
    const r = await evalRun(repo);

    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^Eval 001: FAIL \(1 of 3 command checks failed\)/);
    expect(r.out).toMatch(/FAIL\s+C2\s+exit 1, expected exit 0/);
    expect(r.out).toContain("2 tests failed");
    expect(r.out).toMatch(/PASS\s+C3/);
    expect((await loadState(saDir)).tickets["001"]?.lastEval).toMatchObject({ result: "fail", failed: ["C2"] });
  });

  it("fails a check that times out", async () => {
    const { repo, saDir } = await claimed(`- {id: C1, type: command, run: 'sleep 10', timeout: 0.2}`);
    const r = await evalRun(repo);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+C1\s+timed out after 0\.2s/);
    expect((await loadState(saDir)).tickets["001"]?.lastEval?.failed).toEqual(["C1"]);
  });

  it("records no commit when the worktree has uncommitted changes, and says why", async () => {
    const { repo, saDir, wt } = await claimed(PASSING, { commitFeature: false });
    await writeFile(join(wt, "feature.txt"), "x"); // untracked, so the tree is dirty
    const r = await evalRun(repo);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/uncommitted changes/);
    const lastEval = (await loadState(saDir)).tickets["001"]?.lastEval;
    expect(lastEval?.result).toBe("pass");
    expect(lastEval).not.toHaveProperty("commit");
  });

  it("reads eval.md from the MAIN checkout, never from the worktree", async () => {
    const { repo, wt } = await claimed(`- {id: C1, type: command, run: 'exit 1'}`);
    const fake = join(wt, ".superagent", "tickets", "001-add-tags");
    await mkdir(fake, { recursive: true });
    await writeFile(join(fake, "eval.md"), evalMd(`- {id: C1, type: command, run: 'true'}`));
    expect((await evalRun(wt)).code).toBe(1);
  });

  it("prints a JSON report with --json", async () => {
    const { repo, wt } = await claimed(PASSING);
    const r = await evalRun(repo, "--json");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report).toMatchObject({
      id: "001",
      result: "pass",
      failed: [],
      skipped: ["C2"],
      commit: git(wt, "rev-parse", "HEAD"),
      warnings: [],
    });
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "C1", type: "command", status: "pass", exitCode: 0, timedOut: false }),
      { id: "C2", type: "browser", status: "skipped" },
    ]);
  });

  it("exits 1 when the eval has no command check", async () => {
    const { repo, saDir } = await claimed(`- {id: C1, type: rubric, run: Code reads well}`);
    const r = await evalRun(repo);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/eval for ticket 001 has no command check/);
    expect((await loadState(saDir)).tickets["001"]?.lastEval).toBeNull();
  });

  it("exits 1 and runs nothing when the ticket is not in progress", async () => {
    const { repo, saDir } = await claimed(PASSING);
    const dir = join(saDir, "tickets", "002-other");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "eval.md"), evalMd(`- {id: C1, type: command, run: 'touch ran.txt'}`));
    const io = captureIo();
    expect(await run(["eval", "002"], io, ctx(repo))).toBe(1);
    expect(io.err()).toMatch(/Cannot record an eval for ticket 002: it is ready/);
    expect((await readEvents(saDir)).filter((e) => e.type === "eval")).toEqual([]);
  });

  it("exits 1 when eval.md is missing", async () => {
    const { repo, saDir } = await claimed(PASSING);
    await rm(join(saDir, "tickets", "001-add-tags", "eval.md"));
    const r = await evalRun(repo);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No eval\.md for ticket 001/);
  });

  it("exits 1 for an unknown ticket and 2 without an id", async () => {
    const { repo } = await claimed(PASSING);
    const io = captureIo();
    expect(await run(["eval", "009"], io, ctx(repo))).toBe(1);
    expect(io.err()).toMatch(/Unknown ticket 009/);
    expect(await run(["eval"], captureIo(), ctx(repo))).toBe(2);
  });
});

