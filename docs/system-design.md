# System design

Draft 1 · Covers V0 and v0.1.0, with notes for V1.

## Key design decisions

1. **The router is an LLM, but the state is code.** Agents never edit `board.md` by hand. They call a small CLI, `sa`, that checks each change and writes it. `board.md` is generated from the state. This one rule prevents most "the board says done but it is not" bugs.
2. **Everything is a file in the repo, and every action is an event.** One append-only log (`events.jsonl`) feeds `status`, the watchdog and the review report. No database and no server in V0.
3. **Gates run in hooks, not in prompts.** A prompt asks the agent to behave. A hook makes sure it does.

## 1. Requirements

**Functional**

| ID | Requirement |
| --- | --- |
| F1 | Interview the user and produce tickets with a spec and an eval |
| F2 | Run ready tickets in parallel, each in its own worktree and branch |
| F3 | Respect dependencies between tickets |
| F4 | Block a ticket from "done" until its eval passes |
| F5 | Open one PR per ticket; never push to `main` |
| F6 | Show live status of all tickets and agents |
| F7 | Produce a review report with evidence per ticket |
| F8 | Stop safely and resume later |

**Non-functional**

| Quality | Target for v0.1.0 |
| --- | --- |
| Safety | No agent can push to `main`, read secrets or edit eval files |
| Reliability | A crash loses at most the ticket in progress; state survives restarts |
| Cost | A run has a token budget; max parallel workers is configurable (default 2) |
| Observability | Every agent action is in the event log with a timestamp |
| Reviewability | A run can be reviewed in about 10 minutes |
| Portability | Tickets, state and reports are plain files any tool can read |

**Constraints**

- One developer, new to agent tooling. Simple beats clever.
- Runs on a laptop with Claude Code. Rate limits of the user's plan apply.
- GitHub and the `gh` CLI for PRs.
- Script language: **Node + TypeScript (assumed)**. It is still an open question in the PRD.

## 2. High-level design

```
                 you
                  |  /superagent plan | run | status | review
                  v
+------------------------------------------------------------+
|  SKILL LAYER  (.claude/skills/superagent/SKILL.md)          |
|  turns each subcommand into steps for the router            |
+------------------------------------------------------------+
                  |
                  v
+-------------+   sa ticket claim/done    +--------------------+
|   ROUTER    | ------------------------> |  sa CLI (Node/TS)  |
|  (Opus)     | <------------------------ |  the only writer   |
+-------------+   sa status / sa next     |  of state          |
   |  starts                              +--------------------+
   v                                             |  writes
+-------------+  +-------------+                  v
|  WORKER 1   |  |  WORKER 2   |    .superagent/
|  worktree A |  |  worktree B |      state.json   (truth)
+-------------+  +-------------+      events.jsonl (log)
   |  Stop hook runs eval                 tickets/*/ (spec, eval, evidence)
   v                                      board.md     (generated)
+-------------+                           runs/<id>/report.html
| GATE HOOKS  |  exit 2 = keep working
+-------------+
   |  pass
   v
 git push branch -> gh pr create -> PR

WATCHDOG (v0.1.0): reads events.jsonl every 10 min, reports stale agents to router
MERGER + CHECKER (v0.1.0): integration branch, browser tests
```

**Components**

| Component | Job | Talks to |
| --- | --- | --- |
| Skill | Entry point for the user's commands | Router |
| Router agent | Plans, picks tickets, starts workers, checks results | `sa`, workers, you |
| Worker agent | Builds one ticket in one worktree | `sa`, git, its hooks |
| `sa` CLI | Validates and writes all state changes; renders `board.md` | Files only |
| Gate hooks | Run evals, block secrets, block `main` | `sa`, test commands |
| Reporter | Builds `report.html` from state, events and evidence | Files only |
| Watchdog | Finds stale or looping agents | `events.jsonl`, router |

## 3. Deep dive

### Ticket state machine

```
draft --ready--> ready --claim--> in_progress --eval pass--> review --PR merged--> done
                   ^                  |   |
                   |      eval fails  |   | stale / gave up
                   +---- retry -------+   v
                                       blocked --(you decide)--> ready
```

Only `sa` changes state, and it refuses illegal moves. Examples: `claim` fails if a dependency is not `done` or `review`; `done` fails if the last eval result is not "pass".

### Data model

`state.json` (the truth):

```json
{
  "version": 1,
  "run": { "id": "2026-11-16-a", "budgetTokens": 2000000, "maxWorkers": 2 },
  "tickets": {
    "001": {
      "title": "Add tags field",
      "status": "in_progress",
      "mode": "solo",
      "dependsOn": [],
      "branch": "sa/001-add-tags",
      "worktree": "../.sa-worktrees/001",
      "owner": "worker-1",
      "attempts": 1,
      "lastEval": { "result": "fail", "at": "2026-11-16T19:40:00Z", "failed": ["C2"] },
      "pr": null
    }
  }
}
```

`eval.md` keeps prose for people and a machine block for the hook:

````md
## Checks
```yaml
- id: C1
  type: command        # command | browser | rubric
  run: npm test -- tags
  expect: exit 0
- id: C2
  type: browser
  run: open /notes, add tag "work", reload
  expect: tag "work" still visible
  evidence: screenshot
```
````

`events.jsonl` (one line per event, never edited):

```json
{"t":"2026-11-16T19:40:00Z","agent":"worker-1","ticket":"001","type":"eval","result":"fail","failed":["C2"]}
```

Event types: `claim`, `heartbeat`, `commit`, `eval`, `question`, `blocked`, `pr_opened`, `done`, `tokens`.

### The `sa` CLI contract

This is the system's API. Agents call it with Bash.

| Command | Who calls it | Effect |
| --- | --- | --- |
| `sa next` | router | Lists ready tickets whose dependencies are met |
| `sa claim <id> --agent <name>` | router | ready → in\_progress; creates branch + worktree |
| `sa event <id> <type> [json]` | any agent | Appends one event |
| `sa eval <id>` | Stop hook | Runs the eval's command checks; records pass/fail |
| `sa submit <id>` | worker | Needs a passing eval; pushes branch, opens PR, → review |
| `sa block <id> --reason` | router, watchdog | → blocked |
| `sa status [--json]` | you, router | Board + agents + time since last event |
| `sa report <run>` | reporter | Builds `report.html` |
| `sa resume` | you | Finds in\_progress tickets with no live agent and offers them again |

### Concurrency

- Workers never share files: each has its own worktree and its own ticket folder.
- `state.json` has one writer at a time: `sa` takes a file lock, writes a temp file, then renames it (an atomic write).
- `events.jsonl` gets small appends only, so parallel writes do not mix lines.

### Errors and retries

| Failure | Response |
| --- | --- |
| Eval fails | Stop hook exits 2 with the failed checks; the worker keeps working |
| Eval fails many times | After 5 fails (configurable), the hook lets the worker stop and `sa` marks the ticket blocked. This stays below Claude Code's own cap of 8 blocks in a row. |
| Worker asks a question | `question` event; the router answers from the spec or asks you |
| No event for 15 min | Watchdog marks the ticket stale; the router checks and restarts once, then blocks |
| Two workers conflict | Prevented by dependencies; else the merger (v0.1.0) handles it, or you re-run one ticket |
| Token budget used | `sa` refuses new claims; running tickets finish; the report says so |
| Laptop sleeps or crashes | State is on disk; `sa resume` picks up |

## 4. Scale and reliability

**Load.** This is not a web service. The limit is tokens and rate limits, not servers. A rough model: run cost ≈ router tokens + (tickets × tokens per ticket × retries). Reports say agent teams use several times the tokens of a single session, so V0 starts with solo tickets and 2 workers. *(We need real numbers from the playground before setting defaults.)*

**Scaling.** More parallel workers means more speed but more cost, more merge conflicts and faster rate limits. Scale up slowly: 2 → 3 → 4, and measure each time.

**Monitoring.** `sa status` for now; the report for after. In v0.3.0, add cost per ticket. In V1, add phone notifications.

## 5. Trade-offs

| Decision | Chosen | Alternative | Why | Revisit when |
| --- | --- | --- | --- | --- |
| Where state lives | JSON files + event log | SQLite | Readable, diffable, any tool can read it | Many runs per day, or queries get slow |
| Who changes state | `sa` CLI only | Agents edit `board.md` | LLMs make silent mistakes in shared files | Never, probably |
| Scheduler | Router (LLM) + `sa next` | A pure script | The LLM handles questions and judgment; `sa next` keeps it honest | If the router makes poor picks, let a script schedule and the LLM only talk |
| Router model | Opus | Sonnet or Haiku | Safer while we learn | Measure on the playground; the original team found a lighter model was enough |
| Gates | Hooks | Instructions | Hooks always run | – |
| Parallel mode | Solo (sub-agents) first | Agent teams | Stable and cheaper | Team mode in v0.1.0 |
| Isolation | One worktree per ticket | One per agent | Matches "one ticket = one PR" | – |
| Language | Node + TS (assumed) | Bash, Python | Typed, good for CLIs and releases | If you prefer Python, change now, not later |
| Packaging | Claude Code plugin + npm CLI | Copy files by hand | One-command install | V1: one core, one adapter per tool |

## 6. What to revisit as it grows

- **V1 multi-tool:** keep `sa` and the file formats tool-neutral now. Only the skill, agent files and hooks are Claude-specific. A Codex or OpenCode adapter then replaces only that layer.
- **Cloud runs:** the event log and `sa resume` are the base for running on a server later.
- **Self-eval:** `events.jsonl` + `run.json` already hold the numbers for Super Agent's own eval (v0.5.0).
- **Security:** if other people use it, add a sandbox for workers, not only deny rules.
