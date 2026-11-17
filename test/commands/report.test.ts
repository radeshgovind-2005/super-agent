import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/app.js";
import { appendEvent } from "../../src/core/events.js";
import { captureIo, state, tempDir, tempProject, tempRepo, ticketIn } from "../helpers.js";
import { NOW, evalMd } from "./fixtures.js";

async function sa(cwd: string, ...argv: string[]) {
  const io = captureIo();
  const code = await run(argv, io, { cwd, now: () => NOW, env: {} });
  return { code, out: io.out(), err: io.err() };
}

async function project() {
  const p = await tempProject(
    state({
      "001": ticketIn("review", { title: "Add tags", pr: "https://github.com/o/r/pull/4" }),
      "002": ticketIn("blocked", { title: "Dark mode" }),
    }),
  );
  const dir = join(p.saDir, "tickets", "001-add-tags");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "spec.md"), "# 001\n\n## Goal\n\nTag notes.\n\n## Decisions\n\n- lowercase\n");
  await writeFile(join(dir, "eval.md"), `${evalMd("- {id: C1, type: command, run: npm test}")}\n## Done means\n\nTags survive a reload.\n`);
  await appendEvent(p.saDir, { t: NOW.toISOString(), agent: "w", ticket: "002", type: "blocked", reason: "stuck" });
  return p;
}

describe("sa report", () => {
  it("writes report.html and run.json for the run and prints where", async () => {
    const p = await project();
    const r = await sa(p.repo, "report");
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const runDir = join(p.saDir, "runs", "2026-11-16-a");
    expect(r.out).toBe(
      `Report: ${join(runDir, "report.html")}\nRun data: ${join(runDir, "run.json")}\n2 tickets: 1 shipped, 1 blocked, 0 in progress, 0 not started\n`,
    );

    const html = await readFile(join(runDir, "report.html"), "utf8");
    expect(html).toContain("Tag notes.");
    expect(html).toContain("Tags survive a reload.");
    expect(html).toContain("stuck");

    const data = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    expect(data.summary).toMatchObject({ tickets: 2, shipped: 1, blocked: 1 });
    expect(data.tickets[0].checks).toEqual([{ id: "C1", type: "command", run: "npm test", status: "pass" }]);
  });

  it("prints the report data with --json", async () => {
    const p = await project();
    const r = await sa(p.repo, "report", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).summary.tickets).toBe(2);
  });

  it("writes the HTML where --out says", async () => {
    const p = await project();
    const out = join(await tempDir(), "review.html");
    const r = await sa(p.repo, "report", "--out", out);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Report: ${out}`);
    expect(existsSync(out)).toBe(true);
  });

  it("tolerates a ticket whose files are missing or broken", async () => {
    const p = await project();
    await writeFile(join(p.saDir, "tickets", "001-add-tags", "eval.md"), "no checks here");
    expect((await sa(p.repo, "report")).code).toBe(0);
  });

  it("works on an empty board", async () => {
    const repo = await tempRepo();
    await sa(repo, "init");
    const r = await sa(repo, "report");
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 tickets");
  });

  it("exits 1 before init and 2 on bad usage", async () => {
    const repo = await tempRepo();
    expect((await sa(repo, "report")).code).toBe(1);
    expect((await sa(repo, "report", "extra")).code).toBe(2);
  });
});
