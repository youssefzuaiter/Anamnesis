import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRADE_SCALE as SCALE } from "@/lib/gpa-scale";
import {
  compareTerms,
  courseBadges,
  courseEffect,
  defaultExpectedLetter,
  formatGpa,
  neededAverage,
  projectCgpa,
  summariseGpa,
  type GpaCourse,
} from "@/lib/gpa";

const near = (actual: number | null | undefined, wanted: number) =>
  actual != null && Math.abs(actual - wanted) < 1e-9;

const course = (
  id: string,
  term: string,
  credits: number | null,
  finalGrade: string | null,
): GpaCourse => ({ id, code: id.toUpperCase(), title: `Course ${id}`, term, credits, finalGrade });

// The sample in the approved design: 28 credits and 95 quality points.
const GRADED = [
  course("c1", "Fall 2025", 4, "AA"),
  course("c2", "Fall 2025", 4, "BA"),
  course("c3", "Fall 2025", 3, "BB"),
  course("c4", "Fall 2025", 3, "CB"),
  course("c5", "Spring 2026", 4, "BA"),
  course("c6", "Spring 2026", 4, "BB"),
  course("c7", "Spring 2026", 3, "AA"),
  course("c8", "Spring 2026", 3, "BA"),
];
const OPEN = [
  course("o1", "Fall 2026", 4, null),
  course("o2", "Fall 2026", 4, null),
  course("o3", "Fall 2026", 3, null),
];

test("graded courses add up to credits, quality points and a cumulative GPA", () => {
  const summary = summariseGpa(GRADED, SCALE);
  assert.equal(summary.credits, 28);
  assert.equal(summary.qualityPoints, 95);
  assert.ok(near(summary.cgpa, 95 / 28));
  assert.deepEqual(summary.open, []);
  assert.deepEqual(summary.notCounted, []);
});

test("each term has its own GPA, oldest first, whatever order the courses come in", () => {
  const summary = summariseGpa([...GRADED].reverse(), SCALE);
  assert.deepEqual(
    summary.terms.map((t) => [t.term, t.credits]),
    [
      ["Fall 2025", 14],
      ["Spring 2026", 14],
    ],
  );
  assert.ok(near(summary.terms[0].gpa, 46.5 / 14));
  assert.ok(near(summary.terms[1].gpa, 48.5 / 14));
});

test("a letter that is not in the scale is left out, with its reason", () => {
  const passFail = course("c9", "Spring 2026", 2, "S");
  const summary = summariseGpa([...GRADED, passFail], SCALE);
  assert.equal(summary.credits, 28);
  assert.deepEqual(summary.notCounted, [{ course: passFail, reason: "letter-not-in-scale" }]);
  assert.deepEqual(summary.open, []);
});

test("a course without credits is left out whether or not it has a letter, and is never open", () => {
  const none = course("x1", "Fall 2026", null, null);
  const zero = course("x2", "Fall 2026", 0, null);
  const gradedNone = course("x3", "Fall 2026", null, "AA");
  const summary = summariseGpa([...GRADED, none, zero, gradedNone], SCALE);
  assert.equal(summary.credits, 28);
  assert.deepEqual(
    summary.notCounted.map((n) => [n.course.id, n.reason]),
    [
      ["x1", "credits-missing"],
      ["x2", "credits-missing"],
      ["x3", "credits-missing"],
    ],
  );
  assert.deepEqual(summary.open, []);
  assert.equal(summary.openCredits, 0);
});

test("a course with credits and no letter is open, and a blank letter is no letter", () => {
  const summary = summariseGpa(
    [...GRADED, course("a", "Fall 2026", 4, null), course("b", "Fall 2026", 4, ""), course("c", "Fall 2026", 3, "  ")],
    SCALE,
  );
  assert.deepEqual(summary.open.map((c) => c.id), ["a", "b", "c"]);
  assert.equal(summary.openCredits, 11);
  assert.equal(summary.credits, 28);
});

test("a letter is matched whatever its case", () => {
  const summary = summariseGpa([course("l", "Fall 2025", 4, "ba")], SCALE);
  assert.equal(summary.credits, 4);
  assert.equal(summary.qualityPoints, 14);
});

test("half credits add exactly", () => {
  const summary = summariseGpa(
    [course("h1", "Fall 2025", 2.5, "BA"), course("h2", "Fall 2025", 3, "BB")],
    SCALE,
  );
  assert.equal(summary.credits, 5.5);
  assert.equal(summary.qualityPoints, 17.75);
});

test("nothing counted gives no GPA, not NaN", () => {
  const summary = summariseGpa([], SCALE);
  assert.equal(summary.cgpa, null);
  assert.deepEqual(summary.terms, []);
  assert.equal(summariseGpa([course("o", "Fall 2026", 4, null)], SCALE).cgpa, null);
});

test("terms sort by year and season, then unknown labels alphabetically", () => {
  const terms = ["Fall 2026", "Year 1", "Spring 2026", "Fall 2025", "Summer 2026", "Alpha", "fall 2024"];
  assert.deepEqual([...terms].sort(compareTerms), [
    "fall 2024",
    "Fall 2025",
    "Spring 2026",
    "Summer 2026",
    "Fall 2026",
    "Alpha",
    "Year 1",
  ]);
});

test("projecting the open courses with expected letters", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);
  const projected = projectCgpa(summary, { o1: "BA", o2: "BA", o3: "BB" }, SCALE);
  assert.ok(near(projected.cgpa, 132 / 39));
  assert.ok(near(projected.expectedAverage, 37 / 11));
  assert.equal(projected.credits, 39);
});

test("an open course with no valid expected letter is left out of the projection", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);
  const missing = projectCgpa(summary, { o1: "BA", o2: "BA" }, SCALE);
  assert.ok(near(missing.cgpa, 123 / 36));
  assert.equal(missing.credits, 36);
  const unknown = projectCgpa(summary, { o1: "BA", o2: "BA", o3: "XX" }, SCALE);
  assert.equal(unknown.credits, 36);
});

test("projecting with nothing to project", () => {
  const empty = projectCgpa(summariseGpa([], SCALE), {}, SCALE);
  assert.deepEqual(empty, { cgpa: null, expectedAverage: null, credits: 0 });
  const onlyGraded = projectCgpa(summariseGpa(GRADED, SCALE), {}, SCALE);
  assert.ok(near(onlyGraded.cgpa, 95 / 28));
  assert.equal(onlyGraded.expectedAverage, null);
});

test("what average the open credits need to reach a target", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);

  const reach = neededAverage(summary, 3.5, SCALE);
  assert.equal(reach.kind, "needed");
  if (reach.kind === "needed") {
    assert.ok(near(reach.points, 41.5 / 11));
    assert.equal(reach.lower, "BA");
    assert.equal(reach.upper, "AA");
    assert.equal(reach.exact, false);
  }

  const exact = neededAverage(summary, 3.0, SCALE);
  assert.equal(exact.kind, "needed");
  if (exact.kind === "needed") {
    assert.ok(near(exact.points, 2));
    assert.equal(exact.upper, "CC");
    assert.equal(exact.lower, "DC");
    assert.equal(exact.exact, true);
  }
});

test("a target already safe, and a target out of reach", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);

  const safe = neededAverage(summary, 2.0, SCALE);
  assert.equal(safe.kind, "achieved");
  if (safe.kind === "achieved") assert.ok(near(safe.worst, 95 / 39));

  const far = neededAverage(summary, 4.0, SCALE);
  assert.equal(far.kind, "impossible");
  if (far.kind === "impossible") {
    assert.ok(near(far.best, 139 / 39));
    assert.ok(near(far.short, 4 - 139 / 39));
  }
});

test("a target exactly at the worst or the best case", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);
  assert.equal(neededAverage(summary, 95 / 39, SCALE).kind, "achieved");

  const best = neededAverage(summary, 139 / 39, SCALE);
  assert.equal(best.kind, "needed");
  if (best.kind === "needed") {
    assert.ok(near(best.points, 4));
    assert.equal(best.upper, "AA");
    assert.equal(best.exact, true);
  }
});

test("a target a hair above the worst case, from rounding, still counts as already safe", () => {
  const summary = summariseGpa([...GRADED, ...OPEN], SCALE);
  assert.equal(neededAverage(summary, 95 / 39 + 1e-12, SCALE).kind, "achieved");
  assert.equal(neededAverage(summary, 95 / 39 + 1e-6, SCALE).kind, "needed");
});

test("with no open credits the answer is about the GPA already held", () => {
  const summary = summariseGpa(GRADED, SCALE);
  assert.equal(neededAverage(summary, 3.0, SCALE).kind, "achieved");
  const short = neededAverage(summary, 3.5, SCALE);
  assert.equal(short.kind, "impossible");
  if (short.kind === "impossible") assert.ok(near(short.short, 3.5 - 95 / 28));
});

test("nothing counted and nothing open has no answer; nothing counted but credits open does", () => {
  assert.deepEqual(neededAverage(summariseGpa([], SCALE), 3.5, SCALE), { kind: "no-credits" });

  const fresh = neededAverage(summariseGpa(OPEN, SCALE), 3.5, SCALE);
  assert.equal(fresh.kind, "needed");
  if (fresh.kind === "needed") {
    assert.ok(near(fresh.points, 3.5));
    assert.equal(fresh.upper, "BA");
    assert.equal(fresh.lower, "BB");
    assert.equal(fresh.exact, true);
  }
});

test("the expected letter starts at the one closest to the GPA so far, ties going up", () => {
  assert.equal(defaultExpectedLetter(SCALE, 3.39), "BA");
  assert.equal(defaultExpectedLetter(SCALE, 3.75), "AA");
  assert.equal(defaultExpectedLetter(SCALE, 0.1), "FF");
  assert.equal(defaultExpectedLetter(SCALE, 0.3), "FD");
  assert.equal(defaultExpectedLetter(SCALE, null), "BB");
});

test("what setting a course's credits and letter does to the GPA", () => {
  const base = { credits: 28, qualityPoints: 95 };

  const counted = courseEffect(base, 4, "BA", SCALE);
  assert.equal(counted.kind, "counted");
  if (counted.kind === "counted") {
    assert.equal(counted.qualityPoints, 14);
    assert.ok(near(counted.before, 95 / 28));
    assert.ok(near(counted.after, 109 / 32));
  }

  const first = courseEffect({ credits: 0, qualityPoints: 0 }, 3, "aa", SCALE);
  assert.equal(first.kind, "counted");
  if (first.kind === "counted") {
    assert.equal(first.before, null);
    assert.equal(first.after, 4);
  }

  assert.deepEqual(courseEffect(base, 4, null, SCALE), { kind: "no-letter" });
  assert.deepEqual(courseEffect(base, 4, "", SCALE), { kind: "no-letter" });
  assert.deepEqual(courseEffect(base, null, "BA", SCALE), { kind: "no-credits" });
  assert.deepEqual(courseEffect(base, 0, "BA", SCALE), { kind: "no-credits" });
  assert.deepEqual(courseEffect(base, 3, "s", SCALE), { kind: "not-in-scale", letter: "S" });
});

test("the badges on a course card", () => {
  assert.deepEqual(courseBadges(course("a", "Fall 2026", null, null), SCALE), [
    { text: "Credits not set", tone: "warn" },
  ]);
  assert.deepEqual(courseBadges(course("a", "Fall 2026", 0, "AA"), SCALE), [
    { text: "Credits not set", tone: "warn" },
  ]);
  assert.deepEqual(courseBadges(course("a", "Fall 2026", 4, null), SCALE), [
    { text: "4 credits", tone: "neutral" },
    { text: "In progress", tone: "accent" },
  ]);
  assert.deepEqual(courseBadges(course("a", "Fall 2026", 1, null), SCALE), [
    { text: "1 credit", tone: "neutral" },
    { text: "In progress", tone: "accent" },
  ]);
  assert.deepEqual(courseBadges(course("a", "Fall 2026", 2.5, "BA"), SCALE), [
    { text: "2.5 credits", tone: "neutral" },
    { text: "BA · 3.5", tone: "ok" },
  ]);
  assert.deepEqual(courseBadges(course("a", "Fall 2026", 2, "S"), SCALE), [
    { text: "2 credits", tone: "neutral" },
    { text: "S is not in your scale", tone: "warn" },
  ]);
});

test("a GPA is shown to two places, and nothing is a dash", () => {
  assert.equal(formatGpa(null), "—");
  assert.equal(formatGpa(3.3929), "3.39");
  assert.equal(formatGpa(4), "4.00");
  assert.equal(formatGpa(0), "0.00");
});
