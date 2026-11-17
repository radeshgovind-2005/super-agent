# Eval 002: Search notes

## How to run

Checks run in the ticket's worktree. Each command check installs packages first
(`npm ci`) if `node_modules` is missing.

## Checks

```yaml
- id: C1
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run test:acceptance -- 002'
  files: [test/acceptance/002-search.test.js, test/helpers.js, vitest.acceptance.config.js]
- id: C2
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm test'
  files: [test/unit/notes.test.js, vitest.config.js]
- id: C3
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run build'
- id: C4
  type: browser
  run: 'npm run dev:api and npm run dev:web, open http://localhost:5173, add notes "Milk" and "Flights", type "mil" in the search box'
  expect: 'only "Milk" is listed; clearing the box shows both again'
  evidence: screenshot
```

## Unusual cases

- `%` and `_` in the query match only themselves (a classic SQL `LIKE` leak).
- A blank query ("   ") returns everything, not nothing.
- Case: "SEARCH" finds "Search".

## Done means

`GET /api/notes?q=` returns just the matching notes, newest first, and the page has a
working search box.
