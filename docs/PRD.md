# Super Agent PRD

Nov 16, 2026 · @Radesh · Status: draft 1

## Summary

1. **You talk to one agent only: the router.** The router hands tickets to workers. The workers build in parallel, each in its own git worktree. Each ticket ends as a pull request (PR).
2. **Machines enforce quality, not line-by-line human review.** Each ticket has a spec and an eval. A hook blocks a worker from finishing while its checks fail.
3. **You are in the loop at two points:** the planning interview at the start, and the review report at the end.

Scope: Claude Code first. **V0** is for learning. **v0.1.0** is the first public release (the MVP). **V1** is the vision we work toward.

Technical design: System design

## Problem and goals

**Problem.** Working with many AI sessions at once is hard. You switch between them and forget which one does what. When one session does everything, each new message interrupts the work, and the details of different tasks get mixed up.

**Goals**

- **G1:** One planning conversation in, many parallel tickets out.
- **G2:** A ticket is done when its eval passes, not when the agent says it is done.
- **G3:** A person with no context can review a full run in about 10 minutes.
- **G4:** The user practises a good habit: plan → spec → eval → build → review.

**Non-goals (for now)**

- Running in the cloud while the laptop sleeps (V1).
- Support for Codex and OpenCode (V1).
- Auto-merge to `main`. A human always merges.

## Glossary

| Term | Plain meaning | In this project |
| --- | --- | --- |
| Agent | An AI session with a role, a model and tools | router, worker, watchdog… |
| Sub-agent | An agent that another agent starts. It has its own memory (context) | Workers on solo tickets |
| Agent team | Agents that can message each other. Experimental in Claude Code | Workers on team tickets |
| Skill | A folder of instructions (SKILL.md) that teaches one job | The `superagent` skill |
| Command | A word you type after `/` to start a skill or prompt | `/superagent plan` |
| Hook | A script that runs by itself at a set moment | Blocks "done" while tests fail |
| Permission rule | Allow or deny list for tools and files | No push to `main`, no `.env` |
| Worktree | A second copy of the repo on its own branch | One per worker |
| Eval | Test tasks + a grader that gives a score | `eval.md` per ticket |
| Spec | What to build, in full detail | `spec.md` per ticket |
| Hill-climbing | Change one thing, measure, keep it only if the score goes up | Tune the agents' prompts later |
| Semantic release | The version number comes from the commit messages | CI makes releases |

## Commands

There is one skill, `superagent`. The word after the name selects the subcommand. In Claude Code, the text after a skill name reaches the skill as an argument. *(Unsure: check the exact argument syntax when we build.)*

| Command | What it does | Release |
| --- | --- | --- |
| `/superagent init` | Once per repo: creates `.superagent/`, agent files, hooks and permission rules | V0 |
| `/superagent plan` | The interview. Turns your idea into tickets (`spec.md` + `eval.md`) and `board.md` | V0 |
| `/superagent ready <id>` | Moves a ticket from draft to ready | V0 |
| `/superagent run [ids]` | The router starts workers on ready tickets, then you leave | V0 |
| `/superagent status` | Shows the board and what each worker does now | V0 |
| `/superagent review` | Builds the review report for the run | V0 (simple), v0.1.0 (full) |
| `/superagent stop` | Stops all workers safely and saves their state | v0.1.0 |
| `/superagent doctor` | Checks the setup: git, hooks, settings, tools | v0.1.0 |

## Architecture and agents

The system has two layers. This split is what makes V1 support for other tools possible.

- **File layer (works with any tool):** tickets, board, run logs and reports are plain Markdown and JSON in `.superagent/`.
- **Runner layer (one per tool):** agent files, hooks and settings. V0 has a Claude Code runner only. V1 adds runners for Codex and OpenCode.

| Agent | Job | Model in Claude Code | Release |
| --- | --- | --- | --- |
| router | Talks to you. Hands out tickets. Checks each result against its eval. Never writes code. | Opus, high effort | V0 |
| worker | Builds one ticket in its own worktree. Opens a PR. | Sonnet | V0 |
| reporter | Turns run results into the review report | Sonnet | V0 (simple) |
| tester | Runs tests and browser checks for a worker | Sonnet | v0.1.0 |
| watchdog | Every 10 minutes, finds stuck or looping agents and tells the router | Sonnet, medium effort | v0.1.0 |
| merger | Combines the work from several worktrees and fixes conflicts | Sonnet | v0.1.0 |
| checker | Tests the merged result in a real browser | Sonnet | v0.1.0 |
| reproducer | Reproduces a bug. Makes a small fix on its own branch, or writes a report | Sonnet | v0.2+ |

The router is held back by its instructions, not by removing its tools. The video says teammates get the same tools as the session that starts them. *(Unsure: check this in the docs.)*

```
.superagent/
  config.yaml          # models, max parallel workers, budget
  tickets/
    board.md
    001-login-page/
      spec.md
      eval.md
      notes/           # contract, decisions, results
      evidence/        # screenshots, logs, benchmarks
  runs/<run-id>/
    run.json           # who did what, time, tokens
    report.html
.claude/
  agents/              # router.md, worker.md, ...
  skills/superagent/SKILL.md
  settings.json        # hooks + permission rules
```

## Tickets and board

A ticket is one feature, written so fully that a worker never needs to ask you anything.

**spec.md** contains: the goal, what to change, what not to touch, every decision made in the interview, and the tickets it depends on.

**eval.md** contains: how to run the checks, the checks (each one a command or a short rubric), the unusual cases, and a clear "done means…" line.

**board.md** columns:

| ID | Title | Status | Mode | Runs | PR |
| --- | --- | --- | --- | --- | --- |
| 001 | Login page | ready | team | alone | – |
| 002 | Profile page | draft | solo | after 001: needs auth | – |

Status values: draft → ready → in-progress → review → done (or blocked).

**Rule:** a ticket can move to ready only if its eval has at least one check that a machine can run.

## Quality gates

Three layers. Each layer catches what the one before it misses.

**1. Hooks (scripts that run by themselves)**

- A `Stop` / `SubagentStop` hook runs the ticket's eval. If a check fails, the hook exits with code 2, and the worker must keep working.
- Exit code 1 does **not** block. Only exit code 2 blocks.
- Claude Code stops honouring a Stop hook after 8 blocks in a row. This protects against endless loops.
- A `PreToolUse` hook blocks reading secrets (`.env`) and pushing to `main`.
- Workers must not edit `eval.md` or the tests that the eval uses. A hook blocks those edits, so the worker cannot "pass" by changing the test.

**2. Permission rules (`settings.json`)**

- Deny: push to `main`, read `.env*` and key files, `rm -rf`.
- Workers work only inside their own worktree.

**3. Evals**

- Per ticket: `eval.md` (a capability eval: did we build the new thing?).
- Per project: a regression suite that must stay near 100% (did we break old things?).
- Later: an eval for the super agent itself, tuned with `/claude-api build-eval` and `/claude-api hillclimb`.

A human merges every PR. No auto-merge.

## Review report

One HTML page per run, written for a person with no context. Short first, details on demand.

**Top of page:** what you asked for, what shipped, what failed, time and token cost.

**One card per ticket:**

- One-paragraph summary in plain words
- Eval result: each check, pass or fail
- Evidence (see table)
- Trade-offs and decisions the agents made for you
- Risks and what to check by hand
- Links: PR, diff, notes
- "Ask about this": a ready prompt you paste into Claude to dig deeper

| Ticket type | Evidence |
| --- | --- |
| UI | Before/after screenshots or a short GIF |
| API | One example request and response |
| Performance | A small benchmark table, before vs after |
| Refactor | Test count before/after, diff size |
| Bug fix | Steps to reproduce, then proof it no longer happens |

The report also feeds learning: a "What went wrong" list per run, so you can tune the agents.

## Release plan

**V1 vision (the north star).** You describe what you want once. Super Agent interviews you, plans the work, and builds it in parallel on the coding agent you choose. It proves each ticket works and gives you a report you can read in 10 minutes. It gets better over time because it measures itself.

**How we get there.** V0 is what we build now. V1 is the target. Between them, each release adds **one** main thing, so when something breaks you know what caused it. This list is a direction, not a fixed contract.

| Release | Theme | Adds | Done when |
| --- | --- | --- | --- |
| v0.0.x (V0, private) | Learn the loop | init, plan, ready, run (solo tickets only), status, simple review. Router + worker. Stop hook. Deny rules. Worktrees. | 3 tickets of the test app built in parallel, 3 PRs open, report is readable |
| **v0.1.0 (first public release, MVP)** | Solid and safe | watchdog, merger, tester + checker with browser, team mode, full HTML report, stop, doctor, docs, one-command install, CI releases | Runs on 2 different test repos with no manual fixes |
| v0.2.0 | Bugs | reproducer agent | A planted bug is found and fixed on its own branch |
| v0.3.0 | Cost control | token budget per run, cost in report | A run stops cleanly when the budget is used |
| v0.4.0 | Recovery | resume after crash or laptop sleep | A killed run continues from the last ticket |
| v0.5.0 | Self-eval | an eval suite for Super Agent itself + hill-climbing the agent prompts | Score goes up on held-out test tickets |
| v0.6.0 | Second tool | Codex or OpenCode runner | Same test app builds on the second tool |
| **V1.0.0** | Vision | All runners stable, model choice per role in config, remote control and phone alerts | You plan, leave, and review from your phone |

## CI/CD and semantic release

**How the version number is decided.** Each commit message follows *Conventional Commits*:

| Commit starts with | Effect | Example |
| --- | --- | --- |
| `fix:` | patch (0.1.0 → 0.1.1) | `fix: watchdog misses idle workers` |
| `feat:` | minor (0.1.1 → 0.2.0) | `feat: add reproducer agent` |
| `feat!:` or `BREAKING CHANGE:` | major | `feat!: new ticket format` |
| `docs:`, `chore:`, `test:` | no release | `docs: explain hooks` |

**Pipeline (GitHub Actions)**

1. On every PR: lint (Markdown, shell scripts, ticket JSON schema), unit tests for the hook scripts, commit-message check (commitlint).
2. On merge to `main`: the release tool reads the commits, sets the version, writes `CHANGELOG.md`, makes a git tag and a GitHub release.
3. Nightly or by hand only: an end-to-end run on the test app. It costs tokens, so it does not run on every PR.

Worker agents must also write Conventional Commits. A commit-msg hook enforces this.

**Choice to make: semantic-release or release-please**

- *semantic-release* (what you asked for): releases on every merge, with no human step. **Watch out:** by default its first release is 1.0.0, not 0.1.0. You need extra setup to stay below 1.0. *(Unsure about the exact setup. Test it with a dry run first.)*
- *release-please* (my recommendation for now): it opens a "release PR" that you merge when you want a release. It has a setting that keeps versions below 1.0 for breaking changes. It also gives you one more human checkpoint, which matches the project's idea.

## How to test it

**Recommendation:** build a small playground app on purpose: `superagent-playground`. A real app you already know would be better, but you do not have one yet. A playground is also repeatable, which makes it an eval.

- A simple notes web app (for example, Vite + a small API + SQLite). Small enough to understand fully.
- Tag a clean starting point as `baseline`. Every test run starts from this tag, so runs are comparable.
- Write about 8 tickets that each test one part of Super Agent:

| Ticket | What it tests |
| --- | --- |
| Add a tags field | A simple solo ticket |
| Search notes | Runs in parallel with the one above |
| Filter by tag | Waits on "tags" (dependency) |
| Login (frontend + backend) | Team mode |
| Dark mode | UI evidence: screenshots |
| Speed up note list | Benchmark evidence |
| Planted bug: notes with emoji fail to save | Reproducer (v0.2) |
| A vague ticket on purpose | Does the router ask you instead of guessing? |

**Measure each run** (in `run.json`): tickets that pass their eval on the first try, total time, tokens, how many times the router asked you, and your minutes to review. These numbers become Super Agent's own eval later.

## Risks and how to undo

| Risk | Guard | Undo |
| --- | --- | --- |
| Token cost: parallel agents use several times more tokens | Sonnet workers, max 2 parallel workers in V0, budget in config | `/superagent stop`; close the sessions |
| Auto permission mode does damage | Deny rules, worktrees only, no access to `main` | `git worktree remove`, delete the branch, close the PR |
| A Stop hook loops forever | Hook checks `stop_hook_active`; Claude Code's block cap | Stop the session; fix the hook |
| A worker "passes" by editing tests | Hook blocks edits to `eval.md` and eval tests; checker re-runs from clean | Close the PR |
| Merge conflicts between workers | Dependencies on the board; merger agent (v0.1.0) | Close one PR, re-run that ticket |
| Agent teams change (experimental) | Solo mode is the default | Switch the ticket to solo |
| Wrong version released | Dry run before the first real release | Delete the tag and the GitHub release |
| You stop understanding the code | Read the report each run, and read one PR fully | – |
| The name "superagent" is already used (a popular npm package) | Pick a public name before v0.1.0 | Rename the repo |

## Skills and tools map

What exists, where you use it, and why. "Here" means this chat. "Claude Code" means on your computer.

**Stage 1: Plan and design (here)**

| Skill / tool | What it does | Why it fits |
| --- | --- | --- |
| `engineering:system-design` | Designs services, boundaries, data | The router/worker architecture |
| `engineering:architecture` | Writes decision records (ADRs) | Record choices like "hooks, not instructions, for quality" |
| `engineering:testing-strategy` | Builds a test plan | Tests for hook scripts and the playground |
| `anthropic-skills:study-anything` | Builds a learning plan for a topic | Learn hooks, worktrees, evals in the right order |
| `design:ux-copy` | Writes clear interface text | The words in the review report |
| `dataviz` | Rules for clear charts | Charts in the report (cost, pass rate) |
| `anthropic-skills:frontend-design` | Visual design for a page | The report page |
| Docs, Whiteboard | Living documents and boards | This PRD and the flow diagram |

**Stage 2: Build (Claude Code)**

| Skill / tool | What it does | Why it fits |
| --- | --- | --- |
| `anthropic-skills:skill-creator` | Creates skills and tests them with evals | Build the `superagent` skill itself |
| Sub-agents (`.claude/agents/*.md`) | Defines agents with their own model and tools | router, worker, watchdog… |
| Agent teams (experimental) | Agents that message each other | Team-mode tickets |
| Hooks (`settings.json`) | Scripts at set moments; exit 2 blocks | Quality gate, secret guard |
| Permission rules | Allow/deny tools and paths | Keep agents away from `main` and secrets |
| `claude --worktree` | Starts a session in its own worktree | Isolate each worker |
| `/claude-api build-eval` | Interviews you and builds an eval | Evals for tickets, and for Super Agent itself |
| `/claude-api hillclimb` | Improves a prompt or skill one change at a time, with a held-out test set | Tune the agents' prompts (v0.5) |
| Plugins (`/plugin`) | Packages skills, agents and hooks for install | One-command install (v0.1.0) |

**Stage 3: Review and release**

| Skill / tool | What it does | Why it fits |
| --- | --- | --- |
| `engineering:code-review` | Reviews a diff for bugs and security | Second opinion on worker PRs |
| `qodo:qodo-review`, `qodo:qodo-review-notes` | Pre-PR review and reasoning notes | Same, plus keeps the "why" for each PR |
| `engineering:debug` | Structured debugging | When a run fails |
| `engineering:documentation` | README, guides, runbooks | Docs for v0.1.0 |
| `engineering:deploy-checklist` | Checklist before a release | Before each release |

**Outside tools**

| Tool | Why |
| --- | --- |
| git worktrees, GitHub CLI (`gh`) | Isolation and PRs |
| GitHub Actions | CI/CD |
| release-please or semantic-release, commitlint | Versioning from commits |
| agent-browser (Vercel) or Playwright | Browser tests and screenshots |
| `jq` | Hook scripts read JSON input |
| tmux | Shows team agents side by side |

## Open questions and assumptions

**Open questions**

1. Script language for hooks and tools: Bash + `jq`, Python, or Node/TypeScript? (I lean to Node: release tools and plugins live in that world.)
2. Release tool: release-please (recommended) or semantic-release?
3. Public name, since "superagent" is already taken on npm.
4. Router model: Opus (the video's choice) or a lighter model (the original team's finding)? Test both on the playground.
5. Browser tool: agent-browser or Playwright?
6. Default for max parallel workers: 2?

**Assumptions (guessed)**

- You have a paid Claude plan, Git, GitHub and macOS or Linux.
- One human per run. No multi-user support.

**Not verified yet**

- The exact way a skill receives subcommand words (`/superagent plan`).
- Whether team agents always inherit the starting session's tools.
- semantic-release behaviour below 1.0.
- The first video names "DeepSeek" as the source of the method. This could be a transcription error.

## Sources

- Video transcript: "Super agent" router/worker setup in Claude Code (AI Labs)
- Video transcript: build-eval and hill-climb (ProAI clips)
- [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- [Automating eval design and hillclimbing with Claude (Anthropic, Sep 28 2026)](https://claude.dev/blog/automating-eval-design-and-hillclimbing/)
- [Claude Code hooks: exit codes and events (morphllm)](https://www.morphllm.com/claude-code-hooks)
- [Stop hooks explained (Amit Kothari)](https://amitkoth.com/claude-code-stop-hooks)
- [Hooks in practice: Stop hook block cap (Steve Kinney)](https://stevekinney.com/courses/ai-development-setup/hooks-in-practice/llms.txt)
