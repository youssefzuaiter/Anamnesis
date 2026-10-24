/**
 * The retention policy decides which backups get deleted, so it is the one part
 * of the backup tooling where a mistake destroys the thing being protected.
 * It is a pure function for exactly that reason, and these tests pin it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBackupName, selectBackups } from "../../ops/retention.mjs";

const NOW = new Date(Date.UTC(2026, 9, 24, 12, 0, 0)); // Saturday 24 October 2026

function name(year: number, month: number, day: number, hour = 3): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `anamnesis-${year}${p(month)}${p(day)}T${p(hour)}0000Z`;
}

/** One backup at 03:00 UTC every day from 1 July to 24 October 2026. */
function dailySince1July(): string[] {
  const names: string[] = [];
  for (let t = Date.UTC(2026, 6, 1); t <= Date.UTC(2026, 9, 24); t += 86_400_000) {
    const d = new Date(t);
    names.push(name(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return names;
}

test("retention: names are parsed only if they are a real moment in the backup format", () => {
  assert.equal(parseBackupName(name(2026, 10, 24))?.toISOString(), "2026-10-24T03:00:00.000Z");
  assert.equal(parseBackupName("notes"), null);
  assert.equal(parseBackupName("anamnesis-latest"), null);
  assert.equal(parseBackupName("anamnesis-20261024"), null);
  assert.equal(parseBackupName("anamnesis-20261024T030000Z.tar"), null);
  // Date.UTC would roll these over into a different, valid-looking date.
  assert.equal(parseBackupName("anamnesis-20261340T030000Z"), null);
  assert.equal(parseBackupName("anamnesis-20260230T030000Z"), null);
  assert.equal(parseBackupName("anamnesis-20261024T250000Z"), null);
});

test("retention: every backup from the last week is kept", () => {
  const { keep } = selectBackups(dailySince1July(), NOW);
  for (let day = 18; day <= 24; day++) {
    assert.ok(keep.includes(name(2026, 10, day)), `10-${day} should be kept`);
  }
});

test("retention: older backups thin out to the newest of each week, then each month", () => {
  const { keep, remove } = selectBackups(dailySince1July(), NOW);

  // Newest of the weeks that began 5 Oct and 28 Sep, both inside the 4-week window.
  assert.ok(keep.includes(name(2026, 10, 11)));
  assert.ok(keep.includes(name(2026, 10, 4)));
  // The week before that is outside it, and 27 Sep is not the newest of its month.
  assert.ok(remove.includes(name(2026, 9, 27)));
  assert.ok(remove.includes(name(2026, 9, 20)));

  // The newest backup of each earlier month survives; the rest of that month does not.
  assert.ok(keep.includes(name(2026, 9, 30)));
  assert.ok(keep.includes(name(2026, 8, 31)));
  assert.ok(keep.includes(name(2026, 7, 31)));
  assert.ok(remove.includes(name(2026, 8, 15)));
  assert.ok(remove.includes(name(2026, 7, 4)));
});

test("retention: a long history is thinned a great deal, not merely a little", () => {
  const all = dailySince1July();
  const { keep } = selectBackups(all, NOW);
  assert.ok(all.length > 100);
  assert.ok(keep.length <= 7 + 4 + 6, `kept ${keep.length}`);
});

test("retention: a backup is never both kept and removed, and none is lost track of", () => {
  const all = dailySince1July();
  const { keep, remove } = selectBackups(all, NOW);
  assert.equal(keep.filter((n) => remove.includes(n)).length, 0);
  assert.deepEqual([...keep, ...remove].sort(), [...all].sort());
});

test("retention: the newest few are kept even when every backup is ancient", () => {
  const ancient = [
    name(2024, 1, 1),
    name(2024, 1, 2),
    name(2024, 1, 3),
    name(2024, 1, 4),
    name(2024, 1, 5),
  ];
  const { keep, remove } = selectBackups(ancient, NOW);
  // A machine that was off for a long time must not come back and prune itself
  // down to nothing.
  assert.deepEqual(keep, [name(2024, 1, 5), name(2024, 1, 4), name(2024, 1, 3)]);
  assert.deepEqual(remove, [name(2024, 1, 2), name(2024, 1, 1)]);
});

test("retention: anything that is not a backup is in neither list, so it can never be deleted", () => {
  const { keep, remove } = selectBackups(
    ["notes", "anamnesis-latest", "anamnesis-20261340T030000Z", name(2026, 10, 24)],
    NOW,
  );
  assert.deepEqual(keep, [name(2026, 10, 24)]);
  assert.deepEqual(remove, []);
});

test("retention: no backups at all is not an error", () => {
  assert.deepEqual(selectBackups([], NOW), { keep: [], remove: [] });
});
