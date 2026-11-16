import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { loadState } from "../../src/core/state.js";
import { captureIo, tempDir, tempRepo } from "../helpers.js";
import { NOW } from "./fixtures.js";

async function sa(cwd: string, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: {} });
  return { code, out: io.out(), err: io.err() };
}

describe("sa init", () => {
  it("creates .superagent with an empty state, board and tickets folder", async () => {
    const repo = await tempRepo();
    const r = await sa(repo, "init");
    expect(r.code).toBe(0);
    expect(r.out).toBe(`Initialised ${join(repo, ".superagent")}\n`);

    const saDir = join(repo, ".superagent");
    expect(await loadState(saDir)).toEqual({
      version: 1,
      run: { id: "2026-11-16-a", budgetTokens: 2_000_000, maxWorkers: 2 },
      tickets: {},
    });
    expect(await readFile(join(saDir, "tickets", "board.md"), "utf8")).toContain("_No tickets yet._");
  });

  it("accepts --max-workers and --budget", async () => {
    const repo = await tempRepo();
    expect((await sa(repo, "init", "--max-workers", "3", "--budget", "500000")).code).toBe(0);
    expect((await loadState(join(repo, ".superagent"))).run).toMatchObject({ maxWorkers: 3, budgetTokens: 500_000 });
  });

  it("initialises the main checkout even from a subdirectory", async () => {
    const repo = await tempRepo();
    const sub = join(repo, "src");
    await mkdir(sub);
    expect((await sa(sub, "init")).code).toBe(0);
    expect(existsSync(join(repo, ".superagent", "state.json"))).toBe(true);
    expect(existsSync(join(sub, ".superagent"))).toBe(false);
  });

  it("refuses to initialise twice and keeps the existing state", async () => {
    const repo = await tempRepo();
    await sa(repo, "init", "--max-workers", "4");
    const r = await sa(repo, "init");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/already initialised/);
    expect((await loadState(join(repo, ".superagent"))).run.maxWorkers).toBe(4);
  });

  it("exits 1 outside a git repo", async () => {
    expect((await sa(await tempDir(), "init")).code).toBe(1);
  });

  it.each([
    ["--max-workers", "0"],
    ["--max-workers", "two"],
    ["--budget", "-5"],
    ["--budget", "1.5"],
  ])("exits 2 for %s %s", async (flag, value) => {
    const r = await sa(await tempRepo(), "init", `${flag}=${value}`);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(new RegExp(`${flag} must be`));
  });
});
