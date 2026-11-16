import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => join(e.parentPath, e.name));
}

describe("architecture", () => {
  it("only src/core/ names the .superagent state files", async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles(src)) {
      const rel = relative(src, file);
      if (rel.startsWith("core/")) continue;
      const text = await readFile(file, "utf8");
      if (/state\.json|events\.jsonl|state\.lock|board\.md/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
