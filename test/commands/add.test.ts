import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { loadState } from "../../src/core/state.js";
import { captureIo, tempRepo } from "../helpers.js";
import { NOW } from "./fixtures.js";

async function sa(cwd: string, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: {} });
  return { code, out: io.out(), err: io.err() };
}

async function initialised() {
  const repo = await tempRepo();
  await sa(repo, "init");
  return { repo, saDir: join(repo, ".superagent") };
}

describe("sa add", () => {
  it("adds a draft ticket and scaffolds spec.md and eval.md", async () => {
    const { repo, saDir } = await initialised();
    const r = await sa(repo, "add", "001", "--title", "Add tags field");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Added 001 (draft): .superagent/tickets/001-add-tags-field\n");

    expect((await loadState(saDir)).tickets["001"]).toEqual({
      title: "Add tags field",
      status: "draft",
      mode: "solo",
      dependsOn: [],
      branch: null,
      worktree: null,
      owner: null,
      attempts: 0,
      lastEval: null,
      pr: null,
    });
    const dir = join(saDir, "tickets", "001-add-tags-field");
    const spec = await readFile(join(dir, "spec.md"), "utf8");
    expect(spec).toMatch(/^# 001: Add tags field/);
    for (const h of ["## Goal", "## What to change", "## What not to touch", "## Decisions", "## Depends on"]) {
      expect(spec).toContain(h);
    }
    const evalText = await readFile(join(dir, "eval.md"), "utf8");
    expect(evalText).toContain("## Checks");
    expect(evalText).toContain("## Done means");
    expect(await readFile(join(saDir, "tickets", "board.md"), "utf8")).toContain("| 001 | Add tags field | draft |");
  });

  it("records mode and dependencies", async () => {
    const { repo, saDir } = await initialised();
    await sa(repo, "add", "001", "--title", "Tags");
    await sa(repo, "add", "002", "--title", "Search");
    expect((await sa(repo, "add", "003", "--title", "Filter", "--mode", "team", "--after", "001,002")).code).toBe(0);
    expect((await loadState(saDir)).tickets["003"]).toMatchObject({ mode: "team", dependsOn: ["001", "002"] });
    expect(await readFile(join(saDir, "tickets", "003-filter", "spec.md"), "utf8")).toMatch(/## Depends on\n\n- 001: Tags\n- 002: Search/);
  });

  it("keeps a ticket folder that already exists", async () => {
    const { repo, saDir } = await initialised();
    const dir = join(saDir, "tickets", "001-from-the-router");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spec.md"), "router's spec");
    const r = await sa(repo, "add", "001", "--title", "Something else");
    expect(r.code).toBe(0);
    expect(r.out).toContain(".superagent/tickets/001-from-the-router");
    expect(await readFile(join(dir, "spec.md"), "utf8")).toBe("router's spec");
    expect(await readFile(join(dir, "eval.md"), "utf8")).toContain("## Checks"); // missing file filled in
  });

  it.each([
    ["a duplicate id", ["add", "001", "--title", "Again"], /Ticket 001 already exists/],
    ["an unknown dependency", ["add", "002", "--title", "X", "--after", "009"], /Unknown ticket 009/],
  ])("exits 1 for %s and changes nothing", async (_label, argv, pattern) => {
    const { repo, saDir } = await initialised();
    await sa(repo, "add", "001", "--title", "First");
    const before = await readFile(join(saDir, "state.json"), "utf8");
    const r = await sa(repo, ...argv);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(pattern);
    expect(await readFile(join(saDir, "state.json"), "utf8")).toBe(before);
  });

  it.each([
    ["no title", ["add", "001"], /--title/],
    ["a bad id", ["add", "1", "--title", "X"], /ticket id must be 3\+ digits/],
    ["a bad mode", ["add", "001", "--title", "X", "--mode", "pair"], /--mode must be solo or team/],
    ["no id", ["add", "--title", "X"], /Usage: sa add/],
  ])("exits 2 for %s", async (_label, argv, pattern) => {
    const { repo } = await initialised();
    const r = await sa(repo, ...argv);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(pattern);
  });

  it("exits 1 before init", async () => {
    const r = await sa(await tempRepo(), "add", "001", "--title", "X");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Run \/superagent init first/);
  });
});
