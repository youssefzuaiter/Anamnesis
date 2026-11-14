/** Choosing the one note that comes back (ROADMAP item 32). Pure. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRevisit, REVISIT_AFTER_DAYS } from "@/lib/note-revisit";

const NOW = new Date(2026, 10, 14, 9, 0); // 14 November 2026, local time
const note = (id: string, when: Date) => ({ id, title: `Note ${id}`, updatedAt: when });

test("a note from this day in an earlier year is preferred to one that is merely old", () => {
  const picked = pickRevisit(
    [note("old", new Date(2024, 0, 3)), note("anniversary", new Date(2024, 10, 14, 17, 0))],
    NOW,
  );
  assert.equal(picked?.note.id, "anniversary");
  assert.equal(picked?.reason, "onThisDay");
  assert.equal(picked?.yearsAgo, 2);
});

test("a note changed this year on this day is not 'on this day'", () => {
  const picked = pickRevisit([note("same-year", new Date(2026, 10, 14, 8, 0))], NOW);
  assert.equal(picked, null);
});

test("with no anniversary, a note not changed for thirty days comes back, and a recent one never does", () => {
  const recent = note("recent", new Date(NOW.getTime() - 3 * 86_400_000));
  const stale = note("stale", new Date(NOW.getTime() - (REVISIT_AFTER_DAYS + 5) * 86_400_000));
  const picked = pickRevisit([recent, stale], NOW);
  assert.equal(picked?.note.id, "stale");
  assert.equal(picked?.reason, "untouched");
});

test("only a note not changed for thirty days or more is offered as untouched", () => {
  const justInside = note("inside", new Date(NOW.getTime() - (REVISIT_AFTER_DAYS - 1) * 86_400_000));
  assert.equal(pickRevisit([justInside], NOW), null);
  assert.equal(REVISIT_AFTER_DAYS, 30);
});

test("the choice is stable through the day: the same notes and day give the same note", () => {
  const notes = Array.from({ length: 7 }, (_, i) => note(`n${i}`, new Date(2025, i, 10)));
  const first = pickRevisit(notes, NOW);
  const later = pickRevisit(notes, new Date(2026, 10, 14, 23, 30));
  assert.equal(first?.note.id, later?.note.id);
  assert.notEqual(first?.note.id, pickRevisit(notes, new Date(2026, 10, 15, 9, 0))?.note.id ?? null, "a different day may pick another");
});

test("29 February is not 'on this day' for 28 February in a year without it", () => {
  const leapDay = note("leap", new Date(2024, 1, 29, 10, 0));
  // Not an anniversary on 28 February 2025, though it is old enough to come back as an untouched note.
  assert.notEqual(pickRevisit([leapDay], new Date(2025, 1, 28, 9, 0))?.reason, "onThisDay");
  assert.equal(pickRevisit([leapDay], new Date(2028, 1, 29, 9, 0))?.reason, "onThisDay");
});

test("no candidates means no card", () => {
  assert.equal(pickRevisit([], NOW), null);
});

test("the same day of the month in another month is not 'on this day'", () => {
  const march = note("march", new Date(2024, 2, 14, 9, 0));
  assert.notEqual(pickRevisit([march], NOW)?.reason, "onThisDay");
});

test("with two anniversaries, the newer one is offered", () => {
  const picked = pickRevisit(
    [note("older", new Date(2023, 10, 14, 9, 0)), note("newer", new Date(2025, 10, 14, 9, 0))],
    NOW,
  );
  assert.equal(picked?.note.id, "newer");
  assert.ok(picked?.reason === "onThisDay" && picked.yearsAgo === 1);
});
