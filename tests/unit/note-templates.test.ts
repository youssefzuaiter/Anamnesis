import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_TEMPLATES,
  dateLabel,
  getTemplate,
  renderTemplate,
} from "@/lib/note-templates";

const NOW = new Date(2026, 9, 28, 12); // Wed 28 Oct 2026, local time

test("the templates are Blank first, then the four named in the roadmap", () => {
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.id), ["blank", "lecture", "cornell", "paper", "meeting"]);
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.name), ["Blank", "Lecture", "Cornell", "Paper summary", "Meeting"]);
});

test("every template is well formed and fits what a note may hold", () => {
  assert.equal(new Set(NOTE_TEMPLATES.map((t) => t.id)).size, NOTE_TEMPLATES.length);
  for (const t of NOTE_TEMPLATES) {
    assert.ok(t.name && t.description, t.id);
    const r = renderTemplate(t, NOW);
    assert.ok(!r.title.includes("{date}") && !r.title.includes("{"), t.id);
    assert.ok(r.title.length <= 200 && r.content.length <= 100_000, t.id);
    for (const tag of t.tags) assert.match(tag, /^[a-z0-9-]+$/, t.id); // lowercase, no commas or spaces
  }
});

test("Blank is empty; every other template has a title, a body that starts with a heading and ends with a newline, and a tag", () => {
  const blank = renderTemplate(getTemplate("blank"), NOW);
  assert.deepEqual(blank, { title: "", content: "", tags: "" });
  for (const t of NOTE_TEMPLATES.slice(1)) {
    const r = renderTemplate(t, NOW);
    assert.ok(r.title.length > 0 && r.tags.length > 0, t.id);
    assert.ok(r.content.startsWith("## ") && r.content.endsWith("\n"), t.id);
  }
});

test("the date label is short weekday, day, short month", () => {
  assert.equal(dateLabel(NOW), "Wed 28 Oct");
  assert.equal(dateLabel(new Date(2026, 0, 5, 9)), "Mon 5 Jan");
});

test("titles carry the date where the roadmap's templates name a day", () => {
  assert.equal(renderTemplate(getTemplate("lecture"), NOW).title, "Lecture, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("cornell"), NOW).title, "Cornell notes, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("meeting"), NOW).title, "Meeting, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("paper"), NOW).title, "Paper summary");
});

test("the Cornell outline is the one in the design", () => {
  assert.equal(
    renderTemplate(getTemplate("cornell"), NOW).content,
    "## Cues and questions\n- \n\n## Notes\n- \n\n## Summary\nWrite two or three sentences after the lecture, without looking at the notes above.\n",
  );
});

test("an unknown, missing or hostile id is Blank, never a throw", () => {
  for (const id of [undefined, null, "", "nope", "LECTURE", "__proto__", "constructor", "a".repeat(5000)]) {
    assert.equal(getTemplate(id).id, "blank");
  }
  assert.equal(getTemplate("lecture").id, "lecture");
});
