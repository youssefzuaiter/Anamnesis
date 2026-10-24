#!/usr/bin/env node
/**
 * Which backups to keep. The policy lives here, as a pure function, so that it
 * can be unit-tested: the one thing a backup script must never do is delete the
 * wrong thing, and shell date arithmetic is a poor place to be sure of that.
 *
 *   node ops/retention.mjs --dir ~/anamnesis-backups [--apply]
 *                          [--days 7] [--weeks 4] [--months 6] [--min 3]
 *
 * Without --apply it only prints what it would remove.
 *
 * Kept: every backup from the last `days` days, the newest of each of the last
 * `weeks` weeks, the newest of each of the last `months` months, and always the
 * newest `min` regardless of age (so a machine that was switched off for a
 * month cannot come back and prune itself down to nothing).
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// anamnesis-20261024T031500Z
const NAME = /^anamnesis-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const DAY_MS = 86_400_000;

/** @returns {Date | null} null for anything that is not a backup this tool made. */
export function parseBackupName(name) {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls impossible values over (month 13 becomes January of the next
  // year) instead of rejecting them, so a name like ...20261340T250000Z would
  // parse as a real, different moment. Insisting that the date reads back as
  // written keeps such a name out of the "backup" category, and so out of reach
  // of the delete.
  const readsBack =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s;
  return readsBack ? date : null;
}

// Monday-based week number counted from the epoch; 1 January 1970 was a Thursday.
const weekOf = (date) => Math.floor((Math.floor(date.getTime() / DAY_MS) + 3) / 7);
const monthOf = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

/**
 * @param {string[]} names directory names found in the backup folder
 * @param {Date} now
 * @param {{ days?: number, weeks?: number, months?: number, min?: number }} [policy]
 * @returns {{ keep: string[], remove: string[] }} names that are not backups are in neither list
 */
export function selectBackups(names, now, policy = {}) {
  const { days = 7, weeks = 4, months = 6, min = 3 } = policy;

  const backups = names
    .map((name) => ({ name, date: parseBackupName(name) }))
    .filter((entry) => entry.date !== null)
    .sort((a, b) => b.date - a.date); // newest first

  const keep = new Set();

  backups.slice(0, min).forEach((entry) => keep.add(entry.name));

  for (const entry of backups) {
    if (now - entry.date < days * DAY_MS) keep.add(entry.name);
  }

  const newestPerWeek = new Map();
  const newestPerMonth = new Map();
  for (const entry of backups) {
    const week = weekOf(entry.date);
    const month = monthOf(entry.date);
    if (!newestPerWeek.has(week)) newestPerWeek.set(week, entry.name);
    if (!newestPerMonth.has(month)) newestPerMonth.set(month, entry.name);
  }
  for (const [week, name] of newestPerWeek) {
    if (weekOf(now) - week < weeks) keep.add(name);
  }
  for (const [month, name] of newestPerMonth) {
    if (monthOf(now) - month < months) keep.add(name);
  }

  return {
    keep: backups.filter((entry) => keep.has(entry.name)).map((entry) => entry.name),
    remove: backups.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name),
  };
}

function main() {
  const option = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
  };
  const dir = option("dir");
  if (!dir || !existsSync(dir)) {
    console.error(`retention: --dir must be an existing directory (got ${dir ?? "nothing"})`);
    process.exit(2);
  }

  const names = readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
  const { keep, remove } = selectBackups(names, new Date(), {
    days: Number(option("days", 7)),
    weeks: Number(option("weeks", 4)),
    months: Number(option("months", 6)),
    min: Number(option("min", 3)),
  });

  console.log(`retention: keeping ${keep.length}, ${process.argv.includes("--apply") ? "removing" : "would remove"} ${remove.length}`);
  for (const name of remove) {
    console.log(`  ${process.argv.includes("--apply") ? "rm" : "would rm"} ${name}`);
    // Only direct children whose names matched the backup pattern reach here.
    if (process.argv.includes("--apply")) rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
