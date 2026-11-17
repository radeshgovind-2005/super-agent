import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { allowRules, hasSaHooks, mergeSettings, saCommandFrom } from "../../src/core/claudeSettings.js";
import { ROUTER_MD, WORKER_MD, skillMd, workerPrompt } from "../../src/runner/claude/templates.js";
import { captureIo, git, tempRepo } from "../helpers.js";
import { NOW } from "../commands/fixtures.js";

const frontmatter = (md: string) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  return Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

describe("agent and skill templates", () => {
  it("router: Opus, talks to the user, never writes code, drives sa", () => {
    expect(frontmatter(ROUTER_MD)).toMatchObject({ name: "router", model: "opus" });
    for (const s of ["sa next", "sa claim", "sa worker start", "sa status", "sa block", "never write"]) {
      expect(ROUTER_MD.toLowerCase()).toContain(s.toLowerCase());
    }
  });

  it("worker: Sonnet, one ticket, eval then submit, never edits evals", () => {
    expect(frontmatter(WORKER_MD)).toMatchObject({ name: "worker", model: "sonnet" });
    for (const s of ["sa eval", "sa submit", "Conventional Commits", "eval.md", "sa event", "question"]) {
      expect(WORKER_MD).toContain(s);
    }
  });

  it("skill: one superagent skill with every V0 subcommand", () => {
    const md = skillMd("sa");
    expect(frontmatter(md)).toMatchObject({ name: "superagent" });
    expect(md).toContain("$ARGUMENTS");
    for (const sub of ["init", "plan", "ready", "run", "status", "review"]) expect(md).toContain(`### ${sub}`);
    for (const cmd of ["sa init", "sa add", "sa ready", "sa next", "sa claim", "sa worker start", "sa status"]) {
      expect(md).toContain(cmd);
    }
  });

  it("skill uses the configured sa command", () => {
    expect(skillMd("node /opt/sa/cli.js")).toContain("node /opt/sa/cli.js status");
  });

  it("worker prompt names the ticket, its files and the finish steps", () => {
    const p = workerPrompt({
      id: "002",
      title: "Search",
      ticketDir: ".superagent/tickets/002-search",
      spec: "# 002: Search\n\n## Goal\n\nFind notes.",
      eval: "## Checks\n\n```yaml\n- {id: C1, type: command, run: npm test}\n```",
    });
    expect(p).toContain("ticket 002: Search");
    expect(p).toContain("Find notes."); // spec inlined: the worktree may not contain it
    expect(p).toContain("run: npm test");
    expect(p).toContain(".superagent/tickets/002-search/spec.md");
    expect(p).toContain(".superagent/tickets/002-search/eval.md");
    expect(p).toContain("sa eval 002");
    expect(p).toContain("sa submit 002");
  });
});

describe("worker prompt with a custom sa command", () => {
  it("tells the worker how to run sa", () => {
    const p = workerPrompt({ id: "001", title: "T", ticketDir: "d", spec: "", eval: "", saCommand: "node /opt/cli.js" });
    expect(p).toContain("Run sa as `node /opt/cli.js`");
    expect(p).toContain("node /opt/cli.js eval 001");
    expect(p).toContain("node /opt/cli.js submit 001");
  });

  it("reads the sa command back from the Stop hook", () => {
    expect(saCommandFrom(mergeSettings({}, "node /opt/cli.js").settings)).toBe("node /opt/cli.js");
    expect(saCommandFrom({})).toBeNull();
  });
});

describe("settings: worker allowlist and hook detection", () => {
  it("allows the Bash commands headless workers need", () => {
    const rules = allowRules("sa");
    for (const r of ["Bash(sa *)", "Bash(git add *)", "Bash(git commit *)", "Bash(git status *)", "Bash(npm test *)", "Bash(npm run *)"]) {
      expect(rules).toContain(r);
    }
    expect(allowRules("node /opt/cli.js")).toContain("Bash(node /opt/cli.js *)");
    expect(rules.some((r) => /push/.test(r))).toBe(false);
  });

  it("merges the allowlist without dropping the user's rules", () => {
    const s = mergeSettings({ permissions: { allow: ["Bash(make *)"] } }, "sa").settings as Record<string, any>;
    expect(s.permissions.allow[0]).toBe("Bash(make *)");
    expect(s.permissions.allow).toContain("Bash(sa *)");
  });

  it("detects whether settings contain sa's hooks", () => {
    expect(hasSaHooks({})).toBe(false);
    expect(hasSaHooks(mergeSettings({}, "sa").settings)).toBe(true);
  });
});

describe("sa init writes the Claude runner files", () => {
  async function init(repo: string) {
    const io = captureIo();
    const code = await run(["init"], io, { cwd: repo, now: () => NOW, env: {} });
    return { code, out: io.out() };
  }

  it("creates router.md, worker.md and the skill, and ignores run logs", async () => {
    const repo = await tempRepo();
    const r = await init(repo);
    expect(r.code).toBe(0);
    expect(r.out).toContain(".claude/agents/router.md: created");
    expect(r.out).toContain(".claude/agents/worker.md: created");
    expect(r.out).toContain(".claude/skills/superagent/SKILL.md: created");
    expect(await readFile(join(repo, ".claude/agents/router.md"), "utf8")).toBe(ROUTER_MD);
    expect(await readFile(join(repo, ".claude/skills/superagent/SKILL.md"), "utf8")).toBe(skillMd("sa"));
    expect(r.out).toMatch(/Next: commit \.claude\/ and \.gitignore/);
    expect(git(repo, "check-ignore", "-q", ".superagent/runs/2026-11-16-a/001-attempt1.log")).toBe("");
  });

  it("keeps agent and skill files the user has edited", async () => {
    const repo = await tempRepo();
    await mkdir(join(repo, ".claude/agents"), { recursive: true });
    await writeFile(join(repo, ".claude/agents/worker.md"), "my worker");
    const r = await init(repo);
    expect(r.out).toContain(".claude/agents/worker.md: kept (already exists)");
    expect(await readFile(join(repo, ".claude/agents/worker.md"), "utf8")).toBe("my worker");
  });
});
