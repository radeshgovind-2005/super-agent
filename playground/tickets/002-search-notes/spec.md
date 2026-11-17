# 002: Search notes

## Goal

Let people find a note by typing part of its title or text. The API filters the
list by a search word, and the page has a search box above the list.

## What to change

- **API** (`server/app.js`, `server/db.js`): `GET /api/notes?q=<text>` returns only
  the notes whose title or body contains `<text>`. Without `q`, nothing changes.
- **UI** (`index.html`, `src/main.js`): a search input above the list. Typing
  reloads the list with `?q=`. Clearing it shows all notes again.

## What not to touch

- Anything under `test/`, and the vitest config files. They are the eval.
- `package.json` dependencies: add no packages.
- The response shape: return the same note objects, just fewer of them.
- Tags: those are tickets 001 and 003. If tags already exist in the code, leave them as they are.

## Decisions

- Match anywhere in the title or body ("ship" finds "Ship the Search feature").
- Ignore upper and lower case.
- Trim the query first. An empty or blank query returns every note.
- `%` and `_` are plain characters, not wildcards. If you use SQL `LIKE`, escape
  them (e.g. `ESCAPE '\'`); or filter in JavaScript.
- Keep the usual order: newest first.
- No match: answer 200 with `[]`.

## Depends on

- none
