import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GRADE_SCALE,
  MAX_POINTS,
  MAX_SCALE_ENTRIES,
  maxPoints,
  normaliseLetter,
  sameScale,
  scaleOrDefault,
  validateScale,
} from "@/lib/gpa-scale";

test("the preset is the nine letters, highest first", () => {
  assert.deepEqual(
    DEFAULT_GRADE_SCALE.map((entry) => [entry.letter, entry.points]),
    [
      ["AA", 4],
      ["BA", 3.5],
      ["BB", 3],
      ["CB", 2.5],
      ["CC", 2],
      ["DC", 1.5],
      ["DD", 1],
      ["FD", 0.5],
      ["FF", 0],
    ],
  );
  assert.equal(MAX_SCALE_ENTRIES, 20);
  assert.equal(MAX_POINTS, 10);
});

test("a letter is trimmed and upper-cased, and anything else is refused", () => {
  assert.equal(normaliseLetter(" ba "), "BA");
  assert.equal(normaliseLetter("b+"), "B+");
  assert.equal(normaliseLetter("A-"), "A-");
  assert.equal(normaliseLetter("s"), "S");
  assert.equal(normaliseLetter(""), null);
  assert.equal(normaliseLetter("   "), null);
  assert.equal(normaliseLetter("ABCDE"), null);
  assert.equal(normaliseLetter("A B"), null);
  assert.equal(normaliseLetter("é"), null);
  assert.equal(normaliseLetter("A/B"), null);
});

test("the preset and a one-letter scale are valid", () => {
  const preset = validateScale(DEFAULT_GRADE_SCALE);
  assert.equal(preset.ok, true);
  assert.deepEqual(preset.ok && preset.scale, DEFAULT_GRADE_SCALE);

  const single = validateScale([{ letter: "P", points: 1 }]);
  assert.deepEqual(single.ok && single.scale, [{ letter: "P", points: 1 }]);
});

test("a scale is sorted by points, highest first, with ties by letter", () => {
  const result = validateScale([
    { letter: "B", points: 3 },
    { letter: "A", points: 3 },
    { letter: "C", points: 4 },
  ]);
  assert.deepEqual(
    result.ok && result.scale.map((entry) => entry.letter),
    ["C", "A", "B"],
  );
});

test("letters are normalised, points are rounded to two places, and unknown keys are dropped", () => {
  const result = validateScale([{ letter: "aa", points: 3.456, extra: "x" }]);
  assert.deepEqual(result.ok && result.scale, [{ letter: "AA", points: 3.46 }]);
});

test("a scale that cannot be used is refused with a message", () => {
  const bad: unknown[] = [
    "garbage",
    null,
    {},
    [],
    Array.from({ length: MAX_SCALE_ENTRIES + 1 }, (_, i) => ({ letter: `L${i}`, points: 1 })),
    [{ letter: "AA", points: 4 }, { letter: "aa", points: 3 }],
    [{ letter: "AA", points: -1 }],
    [{ letter: "AA", points: MAX_POINTS + 1 }],
    [{ letter: "AA", points: Number.NaN }],
    [{ letter: "AA", points: Number.POSITIVE_INFINITY }],
    [{ letter: "AA", points: "4" }],
    [{ letter: "", points: 4 }],
    [{ letter: "TOOLONG", points: 4 }],
    [{ letter: 4, points: 4 }],
    [null],
    ["AA"],
  ];
  for (const input of bad) {
    const result = validateScale(input);
    assert.equal(result.ok, false, JSON.stringify(input)?.slice(0, 60));
    assert.ok(!result.ok && result.message.length > 0);
  }
});

test("a stored scale that is unusable falls back to the preset, and a valid one is used", () => {
  assert.deepEqual(scaleOrDefault(null), DEFAULT_GRADE_SCALE);
  assert.deepEqual(scaleOrDefault("garbage"), DEFAULT_GRADE_SCALE);
  assert.deepEqual(scaleOrDefault([{ letter: "AA", points: 4 }, { letter: "AA", points: 3 }]), DEFAULT_GRADE_SCALE);
  assert.deepEqual(scaleOrDefault([{ letter: "A", points: 4 }, { letter: "B", points: 3 }]), [
    { letter: "A", points: 4 },
    { letter: "B", points: 3 },
  ]);
});

test("the preset handed out is a copy, so changing it cannot change the preset", () => {
  const copy = scaleOrDefault(null);
  copy[0].points = 99;
  assert.equal(DEFAULT_GRADE_SCALE[0].points, 4);
  assert.equal(scaleOrDefault(null)[0].points, 4);
});

test("the highest points in a scale", () => {
  assert.equal(maxPoints(DEFAULT_GRADE_SCALE), 4);
  assert.equal(maxPoints([{ letter: "A", points: 10 }, { letter: "B", points: 7 }]), 10);
});

test("two scales are the same when they hold the same letters and points, in any order", () => {
  const reversed = [...DEFAULT_GRADE_SCALE].reverse();
  assert.equal(sameScale(DEFAULT_GRADE_SCALE, DEFAULT_GRADE_SCALE.map((entry) => ({ ...entry }))), true);
  assert.equal(sameScale(DEFAULT_GRADE_SCALE, reversed), true);
});

test("a changed point, a missing letter or a different letter makes scales differ", () => {
  const changed = DEFAULT_GRADE_SCALE.map((entry) => (entry.letter === "BB" ? { ...entry, points: 3.1 } : entry));
  assert.equal(sameScale(DEFAULT_GRADE_SCALE, changed), false);
  assert.equal(sameScale(DEFAULT_GRADE_SCALE, DEFAULT_GRADE_SCALE.slice(1)), false);
  assert.equal(sameScale([{ letter: "A", points: 4 }], [{ letter: "B", points: 4 }]), false);
  assert.equal(sameScale([], []), true);
});
