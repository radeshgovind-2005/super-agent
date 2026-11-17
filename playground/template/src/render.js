/** One note as an <li>. Uses textContent only, so note text is never parsed as HTML. */
export function renderNote(doc, note) {
  const li = doc.createElement("li");
  li.className = "note";
  const title = doc.createElement("h2");
  title.textContent = note.title;
  const body = doc.createElement("p");
  body.textContent = note.body;
  li.append(title, body);
  return li;
}
