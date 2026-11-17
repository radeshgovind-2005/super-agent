import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasSaHooks } from "../../src/core/claudeSettings.js";
import { parseEvalMarkdown } from "../../src/core/evalfile.js";
import { loadState } from "../../src/core/state.js";
import { markdownSection } from "../../src/report/markdown.js";
import { git, tempDir } from "../helpers.js";

const PLAYGROUND = fileURLToPath(new URL("../../playground", import.meta.url));
const TEMPLATE = join(PLAYGROUND, "template");
const TICKETS = join(PLAYGROUND, "tickets");
const ticketDirs = readdirSync(TICKETS).sort();

describe("playground tickets", () => {
  it("has the three V0 test tickets", () => {
    expect(ticketDirs).toEqual(["001-add-tags-field", "002-search-notes", "003-filter-by-tag"]);
  });

  describe.each(ticketDirs)("%s", (dir) => {
    const spec = readFileSync(join(TICKETS, dir, "spec.md"), "utf8");
    const evalText = readFileSync(join(TICKETS, dir, "eval.md"), "utf8");

    it("has a spec titled '# <id>: <title>' with every section filled in", () => {
      expect(spec).toMatch(new RegExp(`^# ${dir.slice(0, 3)}: \\S`));
      for (const section of ["Goal", "What to change", "What not to touch", "Decisions", "Depends on"]) {
        expect(markdownSection(spec, section), section).not.toBe("");
      }
    });

    it("has an eval that sa can parse, with command checks a machine can run", () => {
      const checks = parseEvalMarkdown(evalText, `${dir}/eval.md`);
      expect(checks.filter((c) => c.type === "command").length).toBeGreaterThan(0);
      expect(markdownSection(evalText, "Done means")).not.toBe("");
    });

    it("runs its own acceptance test, and protects it from the worker", () => {
      const checks = parseEvalMarkdown(evalText);
      const acceptance = `test/acceptance/${dir.slice(0, 3)}-`;
      const c1 = checks.find((c) => c.type === "command" && c.run.includes(`test:acceptance -- ${dir.slice(0, 3)}`));
      expect(c1).toBeDefined();
      const files = checks.flatMap((c) => (c.type === "command" ? (c.files ?? []) : []));
      expect(files.some((f) => f.startsWith(acceptance))).toBe(true);
    });

    it("lists only protected files that exist in the template", () => {
      for (const c of parseEvalMarkdown(evalText)) {
        if (c.type !== "command") continue;
        for (const f of c.files ?? []) expect(existsSync(join(TEMPLATE, f)), f).toBe(true);
      }
    });
  });

  it("003 depends on 001", () => {
    const spec = readFileSync(join(TICKETS, "003-filter-by-tag", "spec.md"), "utf8");
    expect(markdownSection(spec, "Depends on")).toMatch(/^- 001:/);
  });
});

describe("playground/new.sh", () => {
  const script = join(PLAYGROUND, "new.sh");
  const runScript = (...args: string[]) => spawnSync("sh", [script, ...args], { encoding: "utf8" });

  it("creates a baseline repo with sa set up and the three tickets ready", async () => {
    const dest = join(await tempDir(), "play");
    const r = runScript(dest, "--no-install");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Playground ready");
    expect(r.stdout).toContain("gh repo create superagent-playground --private");

    expect(git(dest, "tag")).toBe("baseline");
    expect(git(dest, "log", "--format=%s")).toBe("chore: set up super agent with 3 test tickets\nchore: baseline notes app");
    expect(git(dest, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dest, "node_modules"))).toBe(false);

    const state = await loadState(join(dest, ".superagent"));
    expect(Object.fromEntries(Object.entries(state.tickets).map(([id, t]) => [id, [t.title, t.status, t.dependsOn]]))).toEqual({
      "001": ["Add a tags field", "ready", []],
      "002": ["Search notes", "ready", []],
      "003": ["Filter by tag", "ready", ["001"]],
    });

    const settings = JSON.parse(readFileSync(join(dest, ".claude", "settings.json"), "utf8"));
    expect(hasSaHooks(settings)).toBe(true);
    expect(settings.permissions.allow).toContain("Bash(npm ci *)"); // the template's rule survives sa init
    // The ticket files are committed, so worktrees and the report have them.
    expect(git(dest, "ls-files", ".superagent/tickets")).toContain("001-add-tags-field/eval.md");
    // The baseline commit is the app alone: no sa files yet.
    expect(git(dest, "ls-tree", "-r", "--name-only", "baseline")).not.toContain(".superagent");
  });

  it("refuses a destination that is not empty", async () => {
    const dest = await tempDir();
    await mkdir(join(dest, "x"));
    await writeFile(join(dest, "x", "f"), "");
    const r = runScript(dest, "--no-install");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not empty/);
  });

  it("needs a destination", () => {
    expect(runScript().status).toBe(2);
    expect(runScript("--bogus", "x").status).toBe(2);
  });

  it("is valid POSIX sh", () => {
    expect(() => execFileSync("sh", ["-n", script])).not.toThrow();
  });
});
