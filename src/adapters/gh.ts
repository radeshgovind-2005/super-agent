import { execFileSync } from "node:child_process";
import { SaError } from "../core/errors.js";

export interface GhOptions {
  cwd: string;
  /** Merged over process.env; PATH here decides which `gh` runs (tests use a fake). */
  env: Readonly<Record<string, string | undefined>>;
}

function gh(args: string[], opts: GhOptions, what: string): string {
  try {
    return execFileSync("gh", args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const stderr = (e as { stderr?: unknown }).stderr;
    const why = (typeof stderr === "string" && stderr.trim()) || (e as Error).message;
    throw new SaError("GH_FAILED", `${what} failed: ${why}`);
  }
}

/** URL of an open PR whose head is `branch`, or null. */
export function findOpenPr(branch: string, opts: GhOptions): string | null {
  const out = gh(["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", ".[].url"], opts, "gh pr list");
  return out.split("\n").find((l) => l.startsWith("http")) ?? null;
}

export interface NewPr {
  base: string;
  head: string;
  title: string;
  body: string;
}

/** Open a PR and return its URL. */
export function createPr(pr: NewPr, opts: GhOptions): string {
  const out = gh(
    ["pr", "create", "--base", pr.base, "--head", pr.head, "--title", pr.title, "--body", pr.body],
    opts,
    "gh pr create",
  );
  const url = out.split("\n").reverse().find((l) => l.startsWith("http"));
  if (!url) throw new SaError("GH_FAILED", `gh pr create failed: no PR URL in its output: ${out}`);
  return url;
}
