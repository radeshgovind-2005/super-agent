import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SaError } from "../../src/core/errors.js";
import { findTicketDir, loadEvalChecks, parseEvalMarkdown } from "../../src/core/evalfile.js";
import { tempSaDir } from "../helpers.js";

const md = (yaml: string, before = "") => `# Eval: Add tags

${before}
## How to run

Run the checks below.

## Checks

\`\`\`yaml
${yaml}
\`\`\`

## Done means

Tags survive a reload.
`;

function evalError(text: string): string {
  try {
    parseEvalMarkdown(text);
  } catch (e) {
    if (e instanceof SaError && e.code === "EVAL_FILE") return e.message;
    throw e;
  }
  throw new Error("expected EVAL_FILE");
}

describe("parseEvalMarkdown", () => {
  it("reads the yaml block under ## Checks", () => {
    const checks = parseEvalMarkdown(
      md(`- id: C1
  type: command
  run: npm test -- tags
  expect: exit 0
- id: C2
  type: browser
  run: open /notes, add tag "work", reload
  expect: tag "work" still visible
  evidence: screenshot
- id: C3
  type: command
  run: ./bench.sh
  expect: exit 3
  timeout: 0.5`),
    );
    expect(checks).toEqual([
      { id: "C1", type: "command", run: "npm test -- tags", expectExit: 0, timeoutSec: 300 },
      {
        id: "C2",
        type: "browser",
        run: 'open /notes, add tag "work", reload',
        expect: 'tag "work" still visible',
        evidence: "screenshot",
      },
      { id: "C3", type: "command", run: "./bench.sh", expectExit: 3, timeoutSec: 0.5 },
    ]);
  });

  it("reads the files a command check protects", () => {
    const [c] = parseEvalMarkdown(md("- {id: C1, type: command, run: npm test, files: [test/a.test.ts, test/b.ts]}"));
    expect(c).toMatchObject({ files: ["test/a.test.ts", "test/b.ts"] });
  });

  it("rejects files that are not a list of paths", () => {
    expect(evalError(md("- {id: C1, type: command, run: a, files: test/a.ts}"))).toMatch(
      /check C1: files: expected a list of paths/,
    );
  });

  it("defaults a command check to expect exit 0", () => {
    expect(parseEvalMarkdown(md("- id: C1\n  type: command\n  run: 'true'"))[0]).toMatchObject({ expectExit: 0 });
  });

  it("ignores yaml blocks before the Checks heading", () => {
    const before = "```yaml\n- id: X\n  type: command\n  run: rm -rf /\n```\n";
    expect(parseEvalMarkdown(md("- id: C1\n  type: rubric\n  run: Reads well", before)).map((c) => c.id)).toEqual([
      "C1",
    ]);
  });

  it("accepts a ```yml fence and a '## Checks' heading with trailing text", () => {
    const text = "## Checks (machine)\n\n```yml\n- id: C1\n  type: command\n  run: 'true'\n```\n";
    expect(parseEvalMarkdown(text)).toHaveLength(1);
  });

  it.each([
    ["no Checks heading", "# Eval\n\nNothing here.\n", /no "## Checks" section/],
    ["no yaml block", "## Checks\n\n- C1: run tests\n", /no ```yaml block under "## Checks"/],
    ["an unclosed block", "## Checks\n\n```yaml\n- id: C1\n", /no ```yaml block under "## Checks"/],
    ["invalid yaml", md("- id: [C1"), /checks block is not valid YAML/],
    ["a non-list", md("id: C1"), /checks block must be a list/],
    ["an empty list", md("[]"), /checks block must be a list with at least one check/],
    ["a missing id", md("- type: command\n  run: 'true'"), /check 1: id: expected a non-empty string/],
    ["a duplicate id", md("- {id: C1, type: rubric, run: a}\n- {id: C1, type: rubric, run: b}"), /duplicate check id C1/],
    ["an unknown type", md("- {id: C1, type: unit, run: a}"), /check C1: type: expected one of command, browser, rubric/],
    ["a missing run", md("- {id: C1, type: command}"), /check C1: run: expected a non-empty string/],
    ["a bad command expect", md("- {id: C1, type: command, run: a, expect: no errors}"), /check C1: expect: a command check expects "exit <code>"/],
    ["a bad timeout", md("- {id: C1, type: command, run: a, timeout: 0}"), /check C1: timeout: expected seconds > 0/],
  ])("rejects %s", (_label, text, pattern) => {
    expect(evalError(text)).toMatch(pattern);
  });
});

describe("findTicketDir / loadEvalChecks", () => {
  async function withTickets(...names: string[]) {
    const saDir = await tempSaDir();
    for (const n of names) await mkdir(join(saDir, "tickets", n), { recursive: true });
    return saDir;
  }

  it("finds <id>-<slug>", async () => {
    const saDir = await withTickets("001-add-tags", "0010-other", "002-search");
    expect(await findTicketDir(saDir, "001")).toBe(join(saDir, "tickets", "001-add-tags"));
  });

  it("finds a folder named just <id>", async () => {
    const saDir = await withTickets("001");
    expect(await findTicketDir(saDir, "001")).toBe(join(saDir, "tickets", "001"));
  });

  it("fails when there is no folder", async () => {
    const saDir = await withTickets("002-x");
    await expect(findTicketDir(saDir, "001")).rejects.toThrow(/No ticket folder for 001/);
  });

  it("fails when two folders match", async () => {
    const saDir = await withTickets("001-a", "001-b");
    await expect(findTicketDir(saDir, "001")).rejects.toThrow(/2 folders match ticket 001/);
  });

  it("fails when eval.md is missing", async () => {
    const saDir = await withTickets("001-a");
    await expect(loadEvalChecks(saDir, "001")).rejects.toThrow(/No eval\.md for ticket 001/);
  });

  it("names the file in parse errors", async () => {
    const saDir = await withTickets("001-a");
    await writeFile(join(saDir, "tickets", "001-a", "eval.md"), "# nothing");
    await expect(loadEvalChecks(saDir, "001")).rejects.toThrow(/tickets\/001-a\/eval\.md: no "## Checks" section/);
  });
});
