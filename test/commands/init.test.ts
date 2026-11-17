import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { DENY_RULES } from "../../src/core/claudeSettings.js";
import { loadState } from "../../src/core/state.js";
import { captureIo, git, tempDir, tempRepo } from "../helpers.js";
import { NOW } from "./fixtures.js";

async function sa(cwd: string, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: {} });
  return { code, out: io.out(), err: io.err() };
}

const readJson = async (p: string) => JSON.parse(await readFile(p, "utf8"));

describe("sa init", () => {
  it("creates state, Claude settings and .gitignore entries, and says what to commit", async () => {
    const repo = await tempRepo();
    const r = await sa(repo, "init");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        ".superagent/: created (2 workers, 2,000,000 tokens)",
        ".claude/settings.json: updated (sa hooks, deny and allow rules)",
        ".claude/agents/router.md: created",
        ".claude/agents/worker.md: created",
        ".claude/skills/superagent/SKILL.md: created",
        ".gitignore: updated",
        "Next: commit .claude/ and .gitignore before claiming tickets, so worker worktrees get the hooks and agents.",
        "",
      ].join("\n"),
    );

    const saDir = join(repo, ".superagent");
    expect(await loadState(saDir)).toEqual({
      version: 1,
      run: { id: "2026-11-16-a", budgetTokens: 2_000_000, maxWorkers: 2 },
      tickets: {},
    });
    expect(await readFile(join(saDir, "tickets", "board.md"), "utf8")).toContain("_No tickets yet._");

    const settings = await readJson(join(repo, ".claude", "settings.json"));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("sa hook stop");
    expect(settings.permissions.deny).toEqual(DENY_RULES);

    const ignore = await readFile(join(repo, ".gitignore"), "utf8");
    expect(ignore).toContain(".superagent/state.json");
    // the generated files are ignored, the ticket folder is not
    expect(git(repo, "check-ignore", "-q", ".superagent/state.json")).toBe("");
    expect(() => git(repo, "check-ignore", "-q", ".superagent/tickets/001-x/spec.md")).toThrow();
  });

  it("accepts --max-workers, --budget and --sa-command", async () => {
    const repo = await tempRepo();
    const r = await sa(repo, "init", "--max-workers", "3", "--budget", "500000", "--sa-command", "node /opt/sa/cli.js");
    expect(r.code).toBe(0);
    expect((await loadState(join(repo, ".superagent"))).run).toMatchObject({ maxWorkers: 3, budgetTokens: 500_000 });
    const settings = await readJson(join(repo, ".claude", "settings.json"));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("node /opt/sa/cli.js hook pre-tool-use");
  });

  it("initialises the main checkout even from a subdirectory", async () => {
    const repo = await tempRepo();
    const sub = join(repo, "src");
    await mkdir(sub);
    expect((await sa(sub, "init")).code).toBe(0);
    expect(existsSync(join(repo, ".superagent", "state.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(sub, ".superagent"))).toBe(false);
  });

  it("keeps the user's existing settings and .gitignore content", async () => {
    const repo = await tempRepo();
    await mkdir(join(repo, ".claude"));
    await writeFile(join(repo, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["Bash(npm *)"] } }));
    await writeFile(join(repo, ".gitignore"), "node_modules/\n");
    expect((await sa(repo, "init")).code).toBe(0);
    const settings = await readJson(join(repo, ".claude", "settings.json"));
    expect(settings.model).toBe("opus");
    expect(settings.permissions.allow[0]).toBe("Bash(npm *)");
    expect(await readFile(join(repo, ".gitignore"), "utf8")).toMatch(/^node_modules\/\n/);
  });

  it("is safe to run again: keeps state, reports everything up to date", async () => {
    const repo = await tempRepo();
    await sa(repo, "init", "--max-workers", "4");
    const settingsBefore = await readFile(join(repo, ".claude", "settings.json"), "utf8");
    const r = await sa(repo, "init");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        ".superagent/: already initialised (state kept)",
        ".claude/settings.json: up to date",
        ".claude/agents/router.md: kept (already exists)",
        ".claude/agents/worker.md: kept (already exists)",
        ".claude/skills/superagent/SKILL.md: kept (already exists)",
        ".gitignore: up to date",
        "",
      ].join("\n"),
    );
    expect((await loadState(join(repo, ".superagent"))).run.maxWorkers).toBe(4);
    expect(await readFile(join(repo, ".claude", "settings.json"), "utf8")).toBe(settingsBefore);
  });

  it("exits 1 and writes nothing when .claude/settings.json is not valid JSON", async () => {
    const repo = await tempRepo();
    await mkdir(join(repo, ".claude"));
    await writeFile(join(repo, ".claude", "settings.json"), "{ nope");
    const r = await sa(repo, "init");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/\.claude\/settings\.json is not valid JSON/);
    expect(existsSync(join(repo, ".superagent"))).toBe(false);
    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
  });

  it("exits 1 outside a git repo", async () => {
    expect((await sa(await tempDir(), "init")).code).toBe(1);
  });

  it.each([
    ["--max-workers", "0"],
    ["--max-workers", "two"],
    ["--budget", "-5"],
    ["--budget", "1.5"],
    ["--sa-command", " "],
  ])("exits 2 for %s %j", async (flag, value) => {
    const r = await sa(await tempRepo(), "init", `${flag}=${value}`);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(new RegExp(`${flag} must`));
  });
});
