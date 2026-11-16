/**
 * PreToolUse guard: pure rules deciding whether a tool call is blocked.
 * Returns the reason to block, or null to allow.
 *
 * - Everyone: no reading or writing secrets (.env*, private keys); no pushing to
 *   main/master; no `gh pr merge` (a human merges); no writing sa's state files.
 * - Workers only: no editing eval.md or the test files their eval lists.
 *
 * Shell parsing is deliberately simple: it catches the plain cases an agent would
 * use, not a determined adversary. Permission deny rules (M4) are the second layer.
 */
import { basename, resolve } from "node:path";

export interface GuardContext {
  cwd: string;
  /** Branch checked out in cwd, or null. */
  branch: string | null;
  /** Set when the session is a worker on an in-progress ticket. */
  worker: { id: string; worktree: string; protectedFiles: string[] } | null;
}

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
}

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const SECRET_EXAMPLES = /^\.env\.(example|sample|template)$/;
const STATE_FILE = /\/\.superagent\/(state\.json|state\.lock|events\.jsonl|tickets\/board\.md)$/;
const EVAL_FILE = /\/\.superagent\/tickets\/[^/]+\/eval\.md$/;
const READ_ONLY = new Set(["cat", "head", "tail", "less", "more", "grep", "rg", "wc", "diff", "ls", "stat", "file"]);
const GIT_READ_ONLY = new Set(["diff", "log", "show", "status", "blame"]);

const MSG = {
  secret: "reading or writing secret files (.env, private keys) is not allowed",
  push: "pushing to main or master is not allowed; push the ticket branch and open a PR",
  merge: "merging PRs is not allowed; a human reviews and merges every PR",
  state: "only sa writes .superagent state files; use the sa CLI",
  eval: "a worker may not edit its eval.md or the test files its eval uses; fix the code instead",
};

export function isSecret(path: string): boolean {
  const b = basename(path);
  if (SECRET_EXAMPLES.test(b)) return false;
  return /^\.env(\..+)?$/.test(b) || /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/.test(b) || /\.(pem|key|p12|pfx)$/.test(b);
}

function writeReason(abs: string, ctx: GuardContext): string | null {
  if (STATE_FILE.test(abs)) return MSG.state;
  if (ctx.worker && (EVAL_FILE.test(abs) || ctx.worker.protectedFiles.includes(abs))) return MSG.eval;
  return null;
}

function fileAccess(path: string, write: boolean, ctx: GuardContext): string | null {
  if (isSecret(path)) return MSG.secret;
  return write ? writeReason(resolve(ctx.cwd, path), ctx) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

export function decide(call: ToolCall, ctx: GuardContext): string | null {
  const input = call.toolInput;
  switch (call.toolName) {
    case "Read": {
      const p = str(input.file_path);
      return p ? fileAccess(p, false, ctx) : null;
    }
    case "Write":
    case "Edit":
    case "MultiEdit": {
      const p = str(input.file_path);
      return p ? fileAccess(p, true, ctx) : null;
    }
    case "NotebookEdit": {
      const p = str(input.notebook_path);
      return p ? fileAccess(p, true, ctx) : null;
    }
    case "Grep": {
      const p = str(input.path);
      const glob = str(input.glob);
      if ((p && isSecret(p)) || (glob && isSecret(glob.replace(/\*/g, "")))) return MSG.secret;
      return null;
    }
    case "Bash": {
      const command = str(input.command);
      return command ? decideBash(command, ctx) : null;
    }
    default:
      return null;
  }
}

interface Segment {
  words: string[];
  /** Redirection targets written by > or >>. */
  writes: string[];
}

function parseSegments(command: string): Segment[] {
  return command.split(/&&|\|\||[;|&\n]/).map((seg) => {
    const tokens = seg
      .replace(/(\d*>>?|<)/g, " $1 ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/^['"]|['"]$/g, ""));
    const words: string[] = [];
    const writes: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (/^\d*>>?$/.test(t)) {
        if (tokens[i + 1]) writes.push(tokens[++i]!);
      } else if (t === "<") {
        if (tokens[i + 1]) words.push(tokens[++i]!);
      } else {
        words.push(t);
      }
    }
    // Drop leading VAR=value assignments.
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
    return { words, writes };
  });
}

function pushTargetsProtected(words: string[], branch: string | null): boolean {
  const git = words.indexOf("git");
  const push = words.indexOf("push", git + 1);
  if (git === -1 || push === -1) return false;
  const args = words.slice(push + 1).filter((w) => !w.startsWith("-"));
  const refspecs = args.slice(1); // first non-flag arg is the remote
  if (refspecs.length === 0) return branch !== null && PROTECTED_BRANCHES.has(branch);
  return refspecs.some((spec) => {
    const dst = (spec.includes(":") ? spec.slice(spec.lastIndexOf(":") + 1) : spec)
      .replace(/^\+/, "")
      .replace(/^refs\/heads\//, "");
    return PROTECTED_BRANCHES.has(dst);
  });
}

function isReadOnly(words: string[]): boolean {
  const [first, second] = words;
  if (!first) return true;
  if (READ_ONLY.has(first)) return true;
  return first === "git" && second !== undefined && GIT_READ_ONLY.has(second);
}

function decideBash(command: string, ctx: GuardContext): string | null {
  for (const seg of parseSegments(command)) {
    const all = [...seg.words, ...seg.writes];
    if (all.some(isSecret)) return MSG.secret;
    if (pushTargetsProtected(seg.words, ctx.branch)) return MSG.push;
    const gh = seg.words.indexOf("gh");
    if (gh !== -1 && seg.words[gh + 1] === "pr" && seg.words[gh + 2] === "merge") return MSG.merge;

    const written = isReadOnly(seg.words) ? seg.writes : all;
    for (const target of written) {
      const reason = writeReason(resolve(ctx.cwd, target), ctx);
      if (reason) return reason;
    }
  }
  return null;
}
