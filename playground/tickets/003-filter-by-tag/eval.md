# Eval 003: Filter by tag

## How to run

Checks run in the ticket's worktree. Each command check installs packages first
(`npm ci`) if `node_modules` is missing. This ticket starts after 001 is merged.

## Checks

```yaml
- id: C1
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run test:acceptance -- 003'
  files: [test/acceptance/003-filter.test.js, test/helpers.js, vitest.acceptance.config.js]
- id: C2
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run test:acceptance -- 001'
  files: [test/acceptance/001-tags.test.js, test/fake-dom.js]
- id: C3
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm test && npm run build'
  files: [test/unit/notes.test.js, vitest.config.js]
- id: C4
  type: browser
  run: 'npm run dev:api and npm run dev:web, open http://localhost:5173, add notes tagged "work" and "home", click the "work" chip'
  expect: 'only the "work" note is listed, with a "Showing: work (clear)" line; clear shows both'
  evidence: screenshot
```

## Unusual cases

- `?tag=  WORK ` matches notes tagged "work".
- `?tag=plan` must not match "planning" (whole tags only).
- Ticket 001's tag behaviour must keep passing (check C2).

## Done means

`GET /api/notes?tag=` returns exactly the notes with that tag, and clicking a chip on
the page filters the list.
