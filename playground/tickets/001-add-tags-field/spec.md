# 001: Add a tags field

## Goal

Let people label a note with a few short tags, so related notes are easy to group.
Tags are saved with the note, returned by the API, entered in the add form, and
shown as chips under each note.

## What to change

- **Database** (`server/db.js`): store each note's tags. Your choice: a `tags` JSON
  column on `notes`, or a `note_tags` table. A database file made before this change
  must keep working: create the column or table if it is missing.
- **API** (`server/app.js`): `POST /api/notes` accepts an optional `tags` field, a
  list of strings. Every note returned by `GET /api/notes` and `POST /api/notes`
  has `tags: string[]`.
- **UI**:
  - `index.html` and `src/main.js`: add a "Tags" text input to the form; the user
    types tags separated by commas; send them as the `tags` list.
  - `src/render.js`: `renderNote` shows each tag as a chip: one element with class
    `tag` per tag, whose `textContent` is the tag. Use only `createElement`,
    `textContent`, `className` or `classList.add`, and `append` / `appendChild`.
  - `src/style.css`: style `.tag` as a small rounded chip.

## What not to touch

- Anything under `test/`, and the vitest config files. They are the eval.
- `package.json` dependencies: add no packages.
- Other response fields: only add `tags`.
- Search and tag filtering: those are tickets 002 and 003.

## Decisions

- Clean each tag: trim it and make it lowercase. Drop tags that are empty after trimming.
- Remove duplicates after cleaning, keeping the first one. Keep the order given.
- At most 10 tags per note, counted after cleaning. More: answer 400.
- A tag may be at most 20 characters after trimming. Longer: answer 400.
- `tags` that is not a list of strings (a string, numbers, null, an object): answer
  400 with `{ "error": "<message>" }`, and save nothing.
- A note sent without `tags` gets `tags: []`.
- Emoji and accented letters are allowed in tags.

## Depends on

- none
