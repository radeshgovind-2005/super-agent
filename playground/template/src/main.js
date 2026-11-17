import { renderNote } from "./render.js";

const list = document.querySelector("#notes");
const form = document.querySelector("#new-note");

async function refresh() {
  const notes = await (await fetch("/api/notes")).json();
  list.replaceChildren(...notes.map((n) => renderNote(document, n)));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: data.title, body: data.body }),
  });
  if (res.ok) {
    form.reset();
    await refresh();
  }
});

refresh();
