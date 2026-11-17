# 003: Filter by tag

## Goal

Let people show only the notes with one tag. The API filters by a tag, and each
tag chip on the page is clickable to filter by it.

## What to change

- **API** (`server/app.js`, `server/db.js`): `GET /api/notes?tag=<tag>` returns only
  the notes that have that tag. Without `tag`, nothing changes.
- **UI** (`src/main.js`, `src/render.js`): clicking a tag chip reloads the list with
  `?tag=`, and shows a "Showing: <tag> (clear)" line above the list; "clear" shows
  all notes again.

## What not to touch

- Anything under `test/`, and the vitest config files. They are the eval.
- `package.json` dependencies: add no packages.
- How tags are cleaned and stored (ticket 001). Reuse its cleaning function.
- Search (`?q=`, ticket 002): combining `tag` and `q` is out of scope.

## Decisions

- Clean the `tag` parameter exactly like stored tags (trim, lowercase) before matching.
- Match whole tags only: `?tag=plan` does not match a note tagged "planning".
- Unknown tag: answer 200 with `[]`.
- An empty `tag` returns every note.
- Keep the usual order: newest first, with each note's full data (tags included).

## Depends on

- 001: Add a tags field (it needs tags to exist)
