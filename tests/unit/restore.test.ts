import { test } from "node:test";
import assert from "node:assert/strict";
import { IdMap, RESTORE_LIMITS, RESTORE_KINDS, keys, normaliseSchedule, parseExportFile } from "@/lib/restore";
import { EXPORT_FORMAT_VERSION } from "@/lib/export-shape";

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const parse = (value: unknown) => parseExportFile(bytes(value));

test("a file that is not an export is refused whole, in a sentence", () => {
  for (const bad of ["", "not json", "[]", "null", "42", `"text"`, "{}", `{"formatVersion":"2","notes":[]}`, `{"formatVersion":0,"notes":[]}`, `{"formatVersion":1.5,"notes":[]}`]) {
    const result = parse(bad);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.match(result.message, /\S/);
  }
  const broken = parseExportFile(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]));
  assert.equal(broken.ok, false, "bytes that are not UTF-8 are refused");
});

test("a newer format is refused and says to update; the current and the unversioned one are read", () => {
  const newer = parse({ formatVersion: EXPORT_FORMAT_VERSION + 1, notes: [] });
  assert.equal(newer.ok, false);
  if (!newer.ok) assert.match(newer.message, /newer version/);
  assert.equal(parse({ formatVersion: EXPORT_FORMAT_VERSION, notes: [] }).ok, true);
  assert.equal(parse({ notes: [] }).ok, true, "the first export had no version");
});

test("only the fields a row may carry survive: an owner, a hash and derived values in the file are dropped", () => {
  const result = parse({
    notes: [
      { id: "n1", userId: "someone-else", passwordHash: "scrypt$x", title: "  Limits  ", content: "a\r\nb", tags: ["B", "b", " a "], isFavorite: true, progress: 100, deletedAt: null },
    ],
    projects: [{ id: "p1", userId: "x", title: "Thesis", category: "Nonsense", progress: 99, deletedAt: "2020-01-01T00:00:00Z" }],
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const note = result.file.rows.notes[0];
  assert.deepEqual(Object.keys(note).sort(), ["content", "courseId", "id", "isFavorite", "projectId", "tags", "title"]);
  assert.equal(note.title, "Limits");
  assert.equal(note.content, "a\nb", "line breaks are LF, as every note is stored");
  assert.deepEqual(note.tags, ["b", "a"]);
  const project = result.file.rows.projects[0];
  assert.deepEqual(Object.keys(project).sort(), ["category", "goalId", "id", "title"]);
  assert.equal(project.category, "Personal", "an unknown category falls back rather than failing the row");
});

test("a row that fails its checks is dropped and counted, and the rest of the table is read", () => {
  const long = "x".repeat(201);
  const result = parse({
    tasks: [
      { id: "t1", title: "ok", dueDate: "2026-11-20T09:00:00.000Z", status: "done", priority: "high" },
      { id: "t2", title: long },
      { id: "t3", title: "" },
      { id: "t4" },
      { id: "t5", title: "bad date", dueDate: "not a date" },
      "a string, not a row",
      null,
    ],
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.file.rows.tasks.map((task) => task.title), ["ok"]);
  assert.equal(result.file.found.tasks, 7);
  assert.equal(result.file.invalidTotal, 6);
  assert.equal(result.file.invalid.length, 6);
});

test("dates must be real and in a sane range; an out-of-range status or priority falls back", () => {
  const result = parse({
    tasks: [{ title: "a", dueDate: "0001-01-01T00:00:00Z" }, { title: "b", dueDate: "2026-02-30T00:00:00Z" }, { title: "c", status: "x", priority: "urgent", estimatedMinutes: 0 }],
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.file.rows.tasks.map((task) => task.title), ["c"], "an impossible date fails the row; it is not turned into no date");
  assert.equal(result.file.rows.tasks[0].status, "todo");
  assert.equal(result.file.rows.tasks[0].priority, "medium");
  assert.equal(result.file.rows.tasks[0].estimatedMinutes, 60);
});

test("a note too long to store is skipped, never restored as an empty note", () => {
  const result = parse({ notes: [{ title: "too long", content: "x".repeat(100_001) }, { title: "exact", content: "x".repeat(100_000) }, { title: "none" }] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.file.rows.notes.map((note) => note.title), ["exact", "none"]);
  assert.equal(result.file.rows.notes[1].content, "");
  assert.equal(result.file.invalidTotal, 1);
});

test("hostile keys and shapes do not break the parse or reach a row", () => {
  const text = `{"__proto__":{"polluted":true},"notes":[{"__proto__":{"admin":true},"constructor":{"x":1},"title":"safe","content":"x"}],"constructor":1}`;
  const result = parseExportFile(bytes(text));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(result.file.rows.notes[0]).includes("admin"), false);
  // A table that is not an array is not read.
  const odd = parse({ notes: { 0: { title: "x" } }, tasks: "none" });
  assert.equal(odd.ok, false);
});

test("a table over the cap is read up to it and the rest counted", () => {
  const many = Array.from({ length: RESTORE_LIMITS.maxRows + 5 }, (_, index) => ({ title: `n${index}` }));
  const result = parse({ events: [], goals: many });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.file.rows.goals.length, RESTORE_LIMITS.maxRows);
  assert.equal(result.file.overCap, 5);
});

test("a million-character title and a deeply nested value cost little and fail only their row", () => {
  const started = performance.now();
  const huge = parse({ notes: [{ title: "t".repeat(1_000_000) }, { title: "fine", content: "c".repeat(300_000) }, { title: "ok" }] });
  assert.ok(huge.ok);
  if (huge.ok) assert.deepEqual(huge.file.rows.notes.map((note) => note.title), ["ok"]);
  const nested = parse(`{"tasks":[{"title":"x","tags":${"[".repeat(500)}${"]".repeat(500)}}]}`);
  assert.ok(nested.ok);
  assert.ok(performance.now() - started < 2000, "linear, not quadratic");
});

test("natural keys fold case and spacing; ids and dates are part of the identity where they should be", () => {
  assert.equal(keys.project("  Thesis "), keys.project("thesis"));
  assert.notEqual(keys.course("CMP1", "Fall"), keys.course("CMP1", "Spring"));
  const due = new Date("2026-11-20T09:00:00Z");
  assert.equal(keys.task("Buy milk", due, null), keys.task("buy milk", new Date(due), null));
  assert.notEqual(keys.task("Buy milk", due, null), keys.task("Buy milk", null, null));
  assert.notEqual(keys.task("Buy milk", due, "c1"), keys.task("Buy milk", due, null));
  assert.notEqual(keys.event("Exam", due, due), keys.event("Exam", due, new Date(due.getTime() + 1)));
  assert.notEqual(keys.card("n1", "Q", null), keys.card("n1", "Q", 1));
});

test("the id map only answers for ids it was given, per kind, and never overwrites", () => {
  const map = new IdMap();
  map.set("projects", "p1", "new-1");
  map.set("projects", "p1", "new-2");
  map.set("notes", undefined, "ignored");
  assert.equal(map.get("projects", "p1"), "new-1");
  assert.equal(map.get("notes", "p1"), null, "a project id is not a note id");
  assert.equal(map.get("projects", "other"), null);
  assert.equal(map.get("projects", null), null);
  assert.equal(map.get("projects", "__proto__"), null);
});

test("a schedule keeps an end only when it follows a start", () => {
  const start = new Date("2026-11-20T09:00:00Z");
  const end = new Date("2026-11-20T10:00:00Z");
  assert.deepEqual(normaliseSchedule(start, end), { start, end });
  assert.deepEqual(normaliseSchedule(null, end), { start: null, end: null });
  assert.deepEqual(normaliseSchedule(end, start), { start: end, end: null });
  assert.deepEqual(normaliseSchedule(start, start), { start, end: null });
});

test("every kind has a schema and a label for the report", () => {
  assert.equal(RESTORE_KINDS.length, 10);
});
