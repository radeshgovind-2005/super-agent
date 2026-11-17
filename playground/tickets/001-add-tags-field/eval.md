# Eval 001: Add a tags field

## How to run

Checks run in the ticket's worktree. Each command check installs packages first
(`npm ci`) if `node_modules` is missing.

## Checks

```yaml
- id: C1
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run test:acceptance -- 001'
  files: [test/acceptance/001-tags.test.js, test/helpers.js, test/fake-dom.js, vitest.acceptance.config.js]
- id: C2
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm test'
  files: [test/unit/notes.test.js, vitest.config.js]
- id: C3
  type: command
  run: '(test -d node_modules || npm ci --silent) && npm run build'
- id: C4
  type: browser
  run: 'npm run dev:api and npm run dev:web, open http://localhost:5173, add a note with tags "Work, ideas", reload the page'
  expect: 'the note shows two chips, "work" and "ideas"'
  evidence: screenshot
```

## Unusual cases

- Duplicates that differ only in case or spaces (" Work", "work") become one tag.
- Exactly 10 tags is fine; 11 is refused. Duplicates do not count towards the limit.
- A database file created before this change still opens and lists its notes.
- Emoji and accents ("🎉 Party", "Café") are kept, lowercased.

## Done means

A note can be saved with tags, the tags come back cleaned from the API and survive a
restart, and the list shows them as chips.
