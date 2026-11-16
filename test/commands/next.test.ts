import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { nextTickets } from "../../src/commands/next.js";
import { captureIo, git, state, tempDir, tempProject, tempRepo, ticket, ticketIn } from "../helpers.js";
import { snapshotFiles } from "./readonly.js";

const board = () =>
  state({
    "004": ticketIn("ready", { title: "Dark mode" }),
    "001": ticketIn("ready", { title: "Add tags field" }),
    "002": ticketIn("ready", { title: "Filter by tag", dependsOn: ["005"] }),
    "003": ticket({ title: "Draft only" }),
    "005": ticketIn("in_progress", { title: "Search notes" }),
    "006": ticketIn("ready", { title: "After review", dependsOn: ["007"], mode: "team" }),
    "007": ticketIn("review", { title: "Login" }),
    "008": ticketIn("blocked", { title: "Stuck" }),
  });

describe("nextTickets", () => {
  it("lists ready tickets with met dependencies, sorted by id", () => {
    expect(nextTickets(board())).toEqual([
      { id: "001", title: "Add tags field", mode: "solo" },
      { id: "004", title: "Dark mode", mode: "solo" },
      { id: "006", title: "After review", mode: "team" },
    ]);
  });
});

describe("sa next", () => {
  it("prints one ticket per line as id<TAB>title", async () => {
    const { repo } = await tempProject(board());
    const io = captureIo();
    expect(await run(["next"], io, { cwd: repo })).toBe(0);
    expect(io.out()).toBe("001\tAdd tags field\n004\tDark mode\n006\tAfter review\n");
    expect(io.err()).toBe("");
  });

  it("prints JSON with --json", async () => {
    const { repo } = await tempProject(board());
    const io = captureIo();
    expect(await run(["next", "--json"], io, { cwd: repo })).toBe(0);
    expect(JSON.parse(io.out())).toEqual(nextTickets(board()));
  });

  it("prints nothing and exits 0 when no ticket is ready", async () => {
    const { repo } = await tempProject(state({ "001": ticket() }));
    const io = captureIo();
    expect(await run(["next"], io, { cwd: repo })).toBe(0);
    expect(io.out()).toBe("");
  });

  it("works from inside a linked worktree", async () => {
    const { repo } = await tempProject(board());
    const wt = join(await tempDir(), "wt");
    git(repo, "worktree", "add", "-q", "-b", "sa/001-x", wt);
    const io = captureIo();
    expect(await run(["next"], io, { cwd: wt })).toBe(0);
    expect(io.out()).toContain("001\tAdd tags field");
  });

  it("writes nothing", async () => {
    const { repo, saDir } = await tempProject(board());
    const before = await snapshotFiles(saDir);
    await run(["next"], captureIo(), { cwd: repo });
    await run(["next", "--json"], captureIo(), { cwd: repo });
    expect(await snapshotFiles(saDir)).toEqual(before);
  });

  it("exits 1 with a clear message when .superagent is not initialised", async () => {
    const repo = await tempRepo();
    const io = captureIo();
    expect(await run(["next"], io, { cwd: repo })).toBe(1);
    expect(io.err()).toMatch(/^sa: No state at .*Run \/superagent init first\.\n$/);
    expect(io.out()).toBe("");
  });

  it("exits 1 outside a git repository", async () => {
    const io = captureIo();
    expect(await run(["next"], io, { cwd: await tempDir() })).toBe(1);
    expect(io.err()).toMatch(/^sa: Not inside a git repository/);
  });

  it("exits 2 on an unknown option", async () => {
    const io = captureIo();
    expect(await run(["next", "--nope"], io, { cwd: await tempDir() })).toBe(2);
    expect(io.err()).toMatch(/--nope/);
    expect(io.err()).toMatch(/Usage: sa next/);
  });

  it("exits 2 on an unexpected argument", async () => {
    const io = captureIo();
    expect(await run(["next", "001"], io, { cwd: await tempDir() })).toBe(2);
  });
});
