import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * Editing this and the later occurrences of a repeating event or task, driven through the browser. No model is
 * involved. The suite shares one account, so each test works in dates of its own in 2031 and gives its rows a title
 * with the time in it: nothing another test or spec made can be in the series.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const choice = (page: Page) => main(page).getByRole("group", { name: "Apply changes to", exact: true });
const onlyThis = (page: Page) => choice(page).getByRole("radio", { name: "Only this occurrence" });
const andLater = (page: Page, later: number) =>
  choice(page).getByRole("radio", { name: `This and ${later} later occurrence${later === 1 ? "" : "s"}`, exact: true });
const saveButton = (page: Page) => main(page).getByRole("button", { name: "Save changes" });
// The task page has another status region (the checklist count), so this is the saved message only.
const status = (page: Page) => main(page).getByRole("status").filter({ hasText: "Saved." });

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
/** How the app stores a due date entered as a day: local end of day. The edit form does the same on save. */
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}
const me = async () => (await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id;

/** A weekly series of events, 09:00 to 10:30, from `first`; returns the ids in order. Times go in as UTC ISO strings, as Prisma writes them. */
async function eventSeries(title: string, first: Date, count = 4): Promise<string[]> {
  const recurrenceId = randomUUID();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addDays(first, 7 * i);
    const rows = await sql<{ id: string }>(
      `INSERT INTO "Event" ("id", "userId", "title", "description", "location", "startTime", "endTime", "recurrenceId", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'Bring the notes', 'Hall C', $3, $4, $5, now()) RETURNING "id"`,
      [await me(), title, at(day, 9).toISOString(), at(day, 10, 30).toISOString(), recurrenceId],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

/** A weekly series of tasks due at the end of the day from `first`, medium priority, tagged study, 60 minutes. */
async function taskSeries(title: string, first: Date, count = 4): Promise<string[]> {
  const recurrenceId = randomUUID();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addDays(first, 7 * i);
    const rows = await sql<{ id: string }>(
      `INSERT INTO "Task" ("id", "userId", "title", "status", "priority", "tags", "estimatedMinutes", "dueDate", "recurrenceId", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'todo', 'medium', ARRAY['study']::text[], 60, $3, $4, now()) RETURNING "id"`,
      [await me(), title, endOfDay(day).toISOString(), recurrenceId],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

type EventRow = { title: string; location: string | null; start: number; end: number };
async function eventRow(id: string): Promise<EventRow> {
  const [row] = await sql<{ title: string; location: string | null; start: string; end: string }>(
    `SELECT "title", "location", (extract(epoch from "startTime") * 1000)::bigint::text AS start, (extract(epoch from "endTime") * 1000)::bigint::text AS end FROM "Event" WHERE "id" = $1`,
    [id],
  );
  return { title: row.title, location: row.location, start: Number(row.start), end: Number(row.end) };
}

type TaskRow = { title: string; priority: string; tags: string[]; estimatedMinutes: number; status: string; due: number };
async function taskRow(id: string): Promise<TaskRow> {
  const [row] = await sql<{ title: string; priority: string; tags: string[]; estimatedMinutes: number; status: string; due: string }>(
    `SELECT "title", "priority", "tags", "estimatedMinutes", "status", (extract(epoch from "dueDate") * 1000)::bigint::text AS due FROM "Task" WHERE "id" = $1`,
    [id],
  );
  return { ...row, due: Number(row.due) };
}

/** The first Tuesday of a private run of weeks in 2031: no clocks change in these months in most zones. */
const first = (n: number) => addDays(new Date(2031, 1, 11), 28 * n);

test("a location and a time of day reach the later occurrences on their own dates, and the earlier one is history", async ({ page }) => {
  const title = `Lecture ${Date.now()}`;
  const day = first(0);
  const ids = await eventSeries(title, day);
  const second = addDays(day, 7);
  await page.goto(`/calendar/${ids[1]}`);

  await expect(andLater(page, 2)).toBeVisible();
  await expect(onlyThis(page)).toBeChecked();
  await expect(choice(page)).toContainText("title, description, location, project, time of day and length");
  await expect(choice(page)).toContainText("Each occurrence keeps its own date");
  await page.getByLabel("Location").fill("Hall D");
  await page.getByLabel("Start time").fill(`${iso(second)}T10:30`);
  await page.getByLabel("End time").fill(`${iso(second)}T12:00`);
  await andLater(page, 2).check();
  await saveButton(page).click();

  await expect(status(page)).toHaveText("Saved. The same change was made to 2 later occurrences.");
  const rows = await Promise.all(ids.map(eventRow));
  expect(rows[0]).toEqual({ title, location: "Hall C", start: at(day, 9).getTime(), end: at(day, 10, 30).getTime() });
  for (const [i, row] of rows.slice(1).entries()) {
    const d = addDays(day, 7 * (i + 1));
    expect(row, `occurrence ${i + 2}`).toEqual({ title, location: "Hall D", start: at(d, 10, 30).getTime(), end: at(d, 12).getTime() });
  }
});

test("only this occurrence is the choice you get, and saving without choosing changes one row", async ({ page }) => {
  const title = `Default ${Date.now()}`;
  const ids = await eventSeries(title, first(1));
  await page.goto(`/calendar/${ids[1]}`);
  await expect(onlyThis(page)).toBeChecked();
  await page.getByLabel("Location").fill("Hall D");
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved.");
  expect((await Promise.all(ids.map(eventRow))).map((r) => r.location)).toEqual(["Hall C", "Hall D", "Hall C", "Hall C"]);
});

test("an occurrence edited on its own keeps its own location when the title is changed for all", async ({ page }) => {
  const title = `Own room ${Date.now()}`;
  const ids = await eventSeries(title, first(2));
  await sql(`UPDATE "Event" SET "location" = 'Lab' WHERE "id" = $1`, [ids[2]]);
  await page.goto(`/calendar/${ids[1]}`);
  await page.getByLabel("Event title").fill(`${title} (seminar)`);
  await andLater(page, 2).check();
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved. The same change was made to 2 later occurrences.");
  const rows = await Promise.all(ids.map(eventRow));
  expect(rows.map((r) => r.title)).toEqual([title, `${title} (seminar)`, `${title} (seminar)`, `${title} (seminar)`]);
  expect(rows.map((r) => r.location)).toEqual(["Hall C", "Hall C", "Lab", "Hall C"]);
});

test("the last occurrence and a one-off event offer no choice", async ({ page }) => {
  const title = `Last ${Date.now()}`;
  const ids = await eventSeries(title, first(3), 3);
  await page.goto(`/calendar/${ids[2]}`);
  await expect(page.getByLabel("Event title")).toHaveValue(title);
  await expect(choice(page)).toHaveCount(0);

  const [{ id: oneOff }] = await sql<{ id: string }>(
    `INSERT INTO "Event" ("id", "userId", "title", "startTime", "endTime", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now()) RETURNING "id"`,
    [await me(), `One-off ${Date.now()}`, at(first(3), 14).toISOString(), at(first(3), 15).toISOString()],
  );
  await page.goto(`/calendar/${oneOff}`);
  await expect(page.getByLabel("Event title")).toBeVisible();
  await expect(choice(page)).toHaveCount(0);
});

test("a change of day alone, for this and later, says so: dates are not copied", async ({ page }) => {
  const title = `Day only ${Date.now()}`;
  const day = first(4);
  const ids = await eventSeries(title, day);
  const second = addDays(day, 7);
  const moved = addDays(second, 1);
  const before = await Promise.all(ids.map(eventRow));
  await page.goto(`/calendar/${ids[1]}`);
  await page.getByLabel("Start time").fill(`${iso(moved)}T09:00`);
  await page.getByLabel("End time").fill(`${iso(moved)}T10:30`);
  await andLater(page, 2).check();
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved. No later occurrence needed changing (dates are not copied).");
  const after = await Promise.all(ids.map(eventRow));
  expect(after[1].start).toBe(at(moved, 9).getTime());
  expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
});

test("a series made with Repeat weekly can be edited for this and later; one later occurrence reads in the singular", async ({ page }) => {
  const title = `Made here ${Date.now()}`;
  const day = first(5);
  const monday = addDays(day, -1);
  await page.goto(`/calendar?view=week&week=${iso(monday)}`);
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="startTime"]', `${iso(day)}T09:00`);
  await page.fill('input[name="endTime"]', `${iso(day)}T10:30`);
  await page.selectOption('select[name="recurrenceFrequency"]', "weekly");
  await page.fill('input[name="recurrenceCount"]', "3");
  await main(page).getByRole("button", { name: "Add event" }).click();
  await expect.poll(async () => (await sql(`SELECT "id" FROM "Event" WHERE "title" = $1`, [title])).length).toBe(3);
  const rows = await sql<{ id: string }>(`SELECT "id" FROM "Event" WHERE "title" = $1 ORDER BY "startTime"`, [title]);

  await page.goto(`/calendar/${rows[1].id}`);
  await expect(andLater(page, 1)).toBeVisible();
  await page.getByLabel("Location").fill("Room 12");
  await andLater(page, 1).check();
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved. The same change was made to 1 later occurrence.");
  expect((await Promise.all(rows.map((r) => eventRow(r.id)))).map((r) => r.location)).toEqual([null, "Room 12", "Room 12"]);
});

test("an end before the start shows the usual alert and changes nothing, for this and later", async ({ page }) => {
  const title = `Bad range ${Date.now()}`;
  const day = first(6);
  const ids = await eventSeries(title, day);
  const second = addDays(day, 7);
  const before = await Promise.all(ids.map(eventRow));
  await page.goto(`/calendar/${ids[1]}`);
  await page.getByLabel("Event title").fill("Changed");
  await page.getByLabel("End time").fill(`${iso(second)}T08:00`);
  await andLater(page, 2).check();
  await saveButton(page).click();
  await expect(main(page).getByRole("alert")).toContainText("The event must end after it starts.");
  expect(await Promise.all(ids.map(eventRow))).toEqual(before);
});

test("a task series: the fields reach the later tasks; due dates, done marks and the trash are left alone", async ({ page }) => {
  const title = `Review ${Date.now()}`;
  const day = first(7);
  const ids = await taskSeries(title, day);
  await sql(`UPDATE "Task" SET "status" = 'done', "completedAt" = now() WHERE "id" = $1`, [ids[2]]);
  await sql(`UPDATE "Task" SET "deletedAt" = now() WHERE "id" = $1`, [ids[3]]);
  const before = await Promise.all(ids.map(taskRow));
  await page.goto(`/tasks/${ids[1]}`);

  await expect(andLater(page, 1)).toBeVisible();
  await expect(choice(page)).toContainText("title, description, priority, tags, estimate, project, course and goal");
  await expect(choice(page)).toContainText("Due dates, time blocks and done marks stay");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByLabel("Estimated minutes").fill("90");
  await page.getByLabel("Tags").fill("study, ml");
  await andLater(page, 1).check();
  await saveButton(page).click();
  await expect(status(page)).toHaveText("Saved. The same change was made to 1 later occurrence.");

  const after = await Promise.all(ids.map(taskRow));
  expect(after[0]).toEqual(before[0]);
  for (const i of [1, 2]) {
    expect(after[i].priority).toBe("high");
    expect(after[i].estimatedMinutes).toBe(90);
    expect(after[i].tags).toEqual(["study", "ml"]);
    expect(after[i].due, `occurrence ${i + 1} keeps its own due date`).toBe(before[i].due);
  }
  expect(after[2].status, "a done task stays done").toBe("done");
  expect(after[3], "the one in the trash is untouched").toEqual(before[3]);
});

test("the last task of a series offers no choice", async ({ page }) => {
  const ids = await taskSeries(`Last task ${Date.now()}`, first(8), 2);
  await page.goto(`/tasks/${ids[1]}`);
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(choice(page)).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`on a phone in ${scheme} mode the choice fits and each option is at least 44px tall`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const ids = await eventSeries(`Phone ${scheme} ${Date.now()}`, first(9));
    await page.goto(`/calendar/${ids[1]}`);
    await expect(andLater(page, 2)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `wider than the screen by ${overflow}px`).toBeLessThanOrEqual(0);
    for (const radio of [onlyThis(page), andLater(page, 2)]) {
      const box = await radio.locator("xpath=ancestor::label[1]").boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  });
}
