import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSuperagentDir } from "../../src/core/paths.js";
import { git, tempDir, tempRepo } from "../helpers.js";

describe("findSuperagentDir", () => {
  it("finds .superagent at the repo root", async () => {
    const repo = await tempRepo();
    expect(findSuperagentDir(repo)).toBe(join(repo, ".superagent"));
  });

  it("finds it from a subdirectory", async () => {
    const repo = await tempRepo();
    const sub = join(repo, "a", "b");
    await mkdir(sub, { recursive: true });
    expect(findSuperagentDir(sub)).toBe(join(repo, ".superagent"));
  });

  it("finds the MAIN checkout's .superagent from inside a linked worktree", async () => {
    const repo = await tempRepo();
    const wt = join(await tempDir(), "wt-001");
    git(repo, "worktree", "add", "-q", "-b", "sa/001-x", wt);
    expect(findSuperagentDir(wt)).toBe(join(repo, ".superagent"));
  });

  it("fails with NOT_IN_REPO outside a git repo", async () => {
    const dir = await tempDir();
    expect(() => findSuperagentDir(dir)).toThrow(expect.objectContaining({ code: "NOT_IN_REPO" }));
  });
});
