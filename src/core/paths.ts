import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { SaError } from "./errors.js";

export const STATE_FILE = "state.json";
export const LOCK_FILE = "state.lock";
export const EVENTS_FILE = "events.jsonl";
export const BOARD_FILE = join("tickets", "board.md");

/**
 * The .superagent/ folder of the MAIN checkout, even when called from inside a
 * linked worktree. Workers run sa from their worktree, but state lives in one place.
 */
export function findSuperagentDir(cwd: string = process.cwd()): string {
  let commonDir: string;
  try {
    commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new SaError("NOT_IN_REPO", `Not inside a git repository: ${cwd}`);
  }
  // The common dir is <main checkout>/.git for a normal (non-bare) repo.
  return join(dirname(commonDir), ".superagent");
}
