import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isErrno } from "../../core/errors.js";
import { ROUTER_MD, WORKER_MD, skillMd } from "./templates.js";

export interface InstalledFile {
  /** Relative to the repo root. */
  path: string;
  created: boolean;
}

/** Write the agent and skill files that do not exist yet; never overwrite the user's edits. */
export async function installRunnerFiles(repoRoot: string, saCommand: string): Promise<InstalledFile[]> {
  const files: [string, string][] = [
    [".claude/agents/router.md", ROUTER_MD],
    [".claude/agents/worker.md", WORKER_MD],
    [".claude/skills/superagent/SKILL.md", skillMd(saCommand)],
  ];
  const result: InstalledFile[] = [];
  for (const [path, text] of files) {
    const abs = join(repoRoot, path);
    await mkdir(dirname(abs), { recursive: true });
    try {
      await writeFile(abs, text, { flag: "wx" });
      result.push({ path, created: true });
    } catch (e) {
      if (!isErrno(e, "EEXIST")) throw e;
      result.push({ path, created: false });
    }
  }
  return result;
}
