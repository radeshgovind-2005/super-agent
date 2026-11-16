import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { SaError } from "../core/errors.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function stderrOf(e: unknown): string {
  const err = (e as { stderr?: unknown }).stderr;
  return (typeof err === "string" && err.trim()) || (e as Error).message;
}

export function headCommit(path: string): string {
  try {
    return git(path, ["rev-parse", "HEAD"]);
  } catch (e) {
    throw new SaError("GIT_FAILED", `git rev-parse HEAD failed in ${path}: ${stderrOf(e)}`);
  }
}

/** No staged, unstaged or untracked changes (ignored files do not count). */
export function isClean(path: string): boolean {
  try {
    return git(path, ["status", "--porcelain"]) === "";
  } catch (e) {
    throw new SaError("GIT_FAILED", `git status failed in ${path}: ${stderrOf(e)}`);
  }
}

export function branchExists(repo: string, branch: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** True when `path` is the top folder of a git checkout (main or linked worktree). */
export function isWorktreeRoot(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return realpathSync(git(path, ["rev-parse", "--show-toplevel"])) === realpathSync(path);
  } catch {
    return false;
  }
}

export interface CreatedWorktree {
  path: string;
  branch: string;
  /** True if this call created the branch (so a rollback should delete it). */
  newBranch: boolean;
}

/**
 * Create a worktree at `path` on `branch`. Uses the existing branch if there is one,
 * else creates it from the main checkout's HEAD. Cleans up a half-made branch on failure.
 */
export function addWorktree(repo: string, path: string, branch: string): CreatedWorktree {
  const newBranch = !branchExists(repo, branch);
  try {
    git(repo, newBranch ? ["worktree", "add", "-b", branch, path, "HEAD"] : ["worktree", "add", path, branch]);
  } catch (e) {
    if (newBranch && branchExists(repo, branch)) deleteBranch(repo, branch);
    throw new SaError("GIT_FAILED", `git worktree add failed: ${stderrOf(e)}`);
  }
  return { path, branch, newBranch };
}

/** Best-effort undo of addWorktree. */
export function removeWorktree(repo: string, created: CreatedWorktree): void {
  try {
    git(repo, ["worktree", "remove", "--force", created.path]);
  } catch {
    // already gone
  }
  if (created.newBranch) deleteBranch(repo, created.branch);
}

function deleteBranch(repo: string, branch: string): void {
  try {
    git(repo, ["branch", "-D", branch]);
  } catch {
    // already gone
  }
}
