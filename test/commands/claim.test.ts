import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { branchName } from "../../src/commands/claim.js";
import { readEvents } from "../../src/core/events.js";
import { loadState, updateState } from "../../src/core/state.js";
import { retry } from "../../src/core/transitions.js";
import type { State } from "../../src/core/types.js";
import { captureIo, git, state, tempProject, ticket, ticketIn } from "../helpers.js";

const NOW = new Date("2026-11-16T20:00:00.000Z");
const ctx = (repo: string, env: Record<string, string> = {}) => ({ cwd: repo, now: () => NOW, env });

const board = (run: Partial<State["run"]> = {}) =>
  state(
    {
      "001": ticketIn("ready", { title: "Add tags field" }),
      "002": ticketIn("ready", { title: "Filter by tag", dependsOn: ["001"] }),
      "003": ticket({ title: "Draft" }),
    },
    run,
  );

/** Absolute path of the default worktree for a ticket in the test repo (named "repo"). */
const wtPath = (repo: string, id: string) => join(dirname(repo), ".sa-worktrees", "repo", id);

describe("branchName", () => {
  it.each([
    ["001", "Add tags field", "sa/001-add-tags-field"],
    ["002", "  Login (frontend + backend)!  ", "sa/002-login-frontend-backend"],
    ["003", "Café crème", "sa/003-cafe-creme"],
    ["004", "🔥🔥", "sa/004-ticket"],
    ["005", "a".repeat(80), `sa/005-${"a".repeat(40)}`],
  ])("%s %j → %s", (id, title, out) => {
    expect(branchName(id, title)).toBe(out);
  });
});

describe("sa claim", () => {
  it("claims the ticket, creates branch + worktree, and logs a claim event", async () => {
    const { repo, saDir } = await tempProject(board());
    const io = captureIo();
    expect(await run(["claim", "001", "--agent", "worker-1"], io, ctx(repo))).toBe(0);

    const t = (await loadState(saDir)).tickets["001"];
    expect(t).toMatchObject({
      status: "in_progress",
      owner: "worker-1",
      branch: "sa/001-add-tags-field",
      worktree: "../.sa-worktrees/repo/001",
      attempts: 1,
    });

    const wt = wtPath(repo, "001");
    expect(git(wt, "branch", "--show-current")).toBe("sa/001-add-tags-field");
    expect(git(wt, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "HEAD"));

    expect(await readEvents(saDir)).toEqual([
      {
        t: "2026-11-16T20:00:00.000Z",
        agent: "worker-1",
        ticket: "001",
        type: "claim",
        branch: "sa/001-add-tags-field",
        worktree: wt,
        attempt: 1,
      },
    ]);
    expect(io.out()).toBe(`Claimed 001 for worker-1 on sa/001-add-tags-field\n${wt}\n`);
  });

  it("prints the claim as JSON with --json", async () => {
    const { repo } = await tempProject(board());
    const io = captureIo();
    expect(await run(["claim", "001", "--agent", "worker-1", "--json"], io, ctx(repo))).toBe(0);
    expect(JSON.parse(io.out())).toEqual({
      id: "001",
      agent: "worker-1",
      branch: "sa/001-add-tags-field",
      worktree: wtPath(repo, "001"),
      attempt: 1,
    });
  });

  it("takes the agent from SA_AGENT", async () => {
    const { repo, saDir } = await tempProject(board());
    expect(await run(["claim", "001"], captureIo(), ctx(repo, { SA_AGENT: "worker-9" }))).toBe(0);
    expect((await loadState(saDir)).tickets["001"]?.owner).toBe("worker-9");
  });

  it("reuses the branch and worktree when a retried ticket is claimed again", async () => {
    const { repo, saDir } = await tempProject(board());
    await run(["claim", "001", "--agent", "worker-1"], captureIo(), ctx(repo));
    const wt = wtPath(repo, "001");
    await writeFile(join(wt, "work.txt"), "in progress");
    await updateState(saDir, (s) => retry(s, "001"));

    expect(await run(["claim", "001", "--agent", "worker-2"], captureIo(), ctx(repo))).toBe(0);
    expect((await loadState(saDir)).tickets["001"]).toMatchObject({ owner: "worker-2", attempts: 2 });
    expect(await readFile(join(wt, "work.txt"), "utf8")).toBe("in progress");
  });

  it("re-creates the worktree from the existing branch if the folder was removed", async () => {
    const { repo, saDir } = await tempProject(board());
    await run(["claim", "001", "--agent", "worker-1"], captureIo(), ctx(repo));
    git(repo, "worktree", "remove", "--force", wtPath(repo, "001"));
    await updateState(saDir, (s) => retry(s, "001"));

    expect(await run(["claim", "001", "--agent", "worker-2"], captureIo(), ctx(repo))).toBe(0);
    expect(git(wtPath(repo, "001"), "branch", "--show-current")).toBe("sa/001-add-tags-field");
  });

  describe("refusals leave state, git and the event log untouched", () => {
    async function expectRefused(s: State, argv: string[], pattern: RegExp) {
      const { repo, saDir } = await tempProject(s);
      const before = await readFile(join(saDir, "state.json"), "utf8");
      const branchesBefore = git(repo, "branch", "--list");
      const io = captureIo();

      expect(await run(argv, io, ctx(repo))).toBe(1);
      expect(io.err()).toMatch(pattern);
      expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
      expect(git(repo, "branch", "--list")).toBe(branchesBefore);
      expect(existsSync(join(dirname(repo), ".sa-worktrees"))).toBe(false);
      expect(await readEvents(saDir)).toEqual([]);
    }

    it("when the ticket is not ready", () =>
      expectRefused(board(), ["claim", "003", "--agent", "w"], /Cannot claim ticket 003: it is draft/));

    it("when a dependency is unmet", () =>
      expectRefused(board(), ["claim", "002", "--agent", "w"], /waiting on 001/));

    it("when the ticket is unknown", () =>
      expectRefused(board(), ["claim", "009", "--agent", "w"], /Unknown ticket 009/));

    it("when all workers are busy", () =>
      expectRefused(
        state({ "001": ticketIn("ready"), "002": ticketIn("in_progress") }, { maxWorkers: 1 }),
        ["claim", "001", "--agent", "w"],
        /1 of 1 workers are busy/,
      ));
  });

  it("leaves state and events untouched when git cannot create the worktree", async () => {
    const { repo, saDir } = await tempProject(board());
    const blocker = wtPath(repo, "001");
    await mkdir(blocker, { recursive: true });
    await writeFile(join(blocker, "in-the-way.txt"), "x");
    const before = await readFile(join(saDir, "state.json"), "utf8");

    const io = captureIo();
    expect(await run(["claim", "001", "--agent", "worker-1"], io, ctx(repo))).toBe(1);
    expect(io.err()).toMatch(/^sa: git worktree add failed/);
    expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
    expect(await readEvents(saDir)).toEqual([]);
  });

  it("removes the new worktree and branch when saving state fails", async () => {
    const { repo, saDir } = await tempProject(board());
    await rm(join(saDir, "tickets", "board.md"));
    await mkdir(join(saDir, "tickets", "board.md")); // makes saveState fail after git ran
    const before = await readFile(join(saDir, "state.json"), "utf8");

    await expect(run(["claim", "001", "--agent", "worker-1"], captureIo(), ctx(repo))).rejects.toThrow();
    expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
    expect(existsSync(wtPath(repo, "001"))).toBe(false);
    expect(git(repo, "branch", "--list", "sa/*")).toBe("");
    expect(await readEvents(saDir)).toEqual([]);
  });

  it.each([
    ["no id", ["claim", "--agent", "w"], /Usage: sa claim/],
    ["no agent", ["claim", "001"], /--agent/],
    ["a bad agent name", ["claim", "001", "--agent", "../evil"], /agent name/],
  ])("exits 2 for %s", async (_label, argv, pattern) => {
    const { repo } = await tempProject(board());
    const io = captureIo();
    expect(await run(argv, io, ctx(repo))).toBe(2);
    expect(io.err()).toMatch(pattern);
  });
});
