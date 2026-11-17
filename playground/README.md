# Super Agent playground

A small notes app used to test Super Agent end to end (milestone 7, the V0 exit test):
3 tickets built in parallel by headless Claude workers, 3 PRs open, one readable report.

- `template/`: the app at its baseline. Vite page + Node API (`node:http`) + SQLite
  (`node:sqlite`, built into Node 22.13+). `npm test` runs its own tests;
  `npm run test:acceptance -- <id>` runs a ticket's acceptance tests, which fail at
  baseline on purpose.
- `tickets/`: the 3 test tickets, each with `spec.md` and `eval.md`.

| Ticket | What it tests |
| --- | --- |
| 001 Add a tags field | A simple solo ticket (API + UI) |
| 002 Search notes | Runs in parallel with 001 |
| 003 Filter by tag | Waits for 001 (dependency) |

## Start a run

```sh
npm run build                      # in super-agent: builds dist/cli.js
playground/new.sh ../superagent-playground
```

The script copies the template, commits and tags `baseline`, runs `sa init`, adds the
3 tickets and marks them ready. It then prints the next steps: give the repo a GitHub
remote (PRs are opened there), start `claude` in it, and run `/superagent run`.

Workers install packages themselves: each eval check runs `npm ci` first when
`node_modules` is missing, and the playground allows `npm ci` for workers.

Start every run from a fresh copy so runs stay comparable.
