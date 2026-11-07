import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * The calendar's hourly week and day grid, driven through the browser. No model is involved. The suite shares one
 * account, so every test works in a week of its own in 2031 (and gives its items a title with the time in it):
 * nothing another test or another spec made can show up in it.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const grid = (page: Page) => main(page).getByRole("region", { name: "Calendar grid" });
const bar = (page: Page) => main(page).getByRole("region", { name: "Selected block" });
const status = (page: Page) => bar(page).getByRole("status");
const alertIn = (page: Page) => main(page).getByRole("alert");
const column = (page: Page, label: string) => grid(page).getByRole("group", { name: label, exact: true });
const allDay = (page: Page) => grid(page).getByRole("group", { name: "All day", exact: true });
const item = (page: Page, title: string) => grid(page).getByRole("button", { name: new RegExp(`^${title},`) });
const barButton = (page: Page, name: string | RegExp) => bar(page).getByRole("button", { name });

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** "Wed 7 Jan": how the grid names a day. */
const label = (d: Date) => `${DOW[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
const clock = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;

/** The Monday of the n-th private week (6 January 2031 is a Monday, and no clocks change before late March). */
const monday = (n: number) => addDays(new Date(2031, 0, 6), 7 * n);
/** Day i of the n-th week, Monday being 0. */
const day = (n: number, i: number) => addDays(monday(n), i);
const weekUrl = (n: number) => `/calendar?view=week&week=${iso(monday(n))}`;
const dayUrl = (d: Date) => `/calendar?view=day&date=${iso(d)}`;

/** Runs one statement against the database the app uses and returns its rows: for what a second tab or a bulk seed would do. */
async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function me(): Promise<string> {
  const email = readFileSync("tests/e2e/.auth/email.txt", "utf8").trim();
  return (await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [email]))[0].id;
}

// Times go in as ISO strings: the columns are `timestamp` without a zone and hold UTC, as Prisma writes them.
async function addEvent(title: string, start: Date, end: Date, subscriptionId: string | null = null, location: string | null = null): Promise<string> {
  const rows = await sql<{ id: string }>(
    `INSERT INTO "Event" ("id", "userId", "title", "startTime", "endTime", "subscriptionId", "externalUid", "location", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now()) RETURNING "id"`,
    [await me(), title, start.toISOString(), end.toISOString(), subscriptionId, subscriptionId ? `uid-${title}` : null, location],
  );
  return rows[0].id;
}

async function addBlock(title: string, start: Date, end: Date): Promise<string> {
  const rows = await sql<{ id: string }>(
    `INSERT INTO "Task" ("id", "userId", "title", "status", "tags", "scheduledStart", "scheduledEnd", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'todo', ARRAY[]::text[], $3, $4, now()) RETURNING "id"`,
    [await me(), title, start.toISOString(), end.toISOString()],
  );
  return rows[0].id;
}

async function addUnscheduled(title: string, estimate: number): Promise<string> {
  const rows = await sql<{ id: string }>(
    `INSERT INTO "Task" ("id", "userId", "title", "status", "tags", "estimatedMinutes", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'todo', ARRAY[]::text[], $3, now()) RETURNING "id"`,
    [await me(), title, estimate],
  );
  return rows[0].id;
}

async function addSubscription(): Promise<string> {
  const rows = await sql<{ id: string }>(
    `INSERT INTO "CalendarSubscription" ("id", "userId", "name", "url") VALUES (gen_random_uuid()::text, $1, 'Timetable', $2) RETURNING "id"`,
    [await me(), `https://example.com/${Date.now()}.ics`],
  );
  return rows[0].id;
}

/** A block's or an event's stored times as epoch milliseconds. */
async function stored(kind: "task" | "event", id: string): Promise<[number, number]> {
  const [from, to] = kind === "task" ? ["scheduledStart", "scheduledEnd"] : ["startTime", "endTime"];
  const table = kind === "task" ? "Task" : "Event";
  const [row] = await sql<{ a: string; b: string }>(
    `SELECT (extract(epoch from "${from}") * 1000)::bigint::text AS a, (extract(epoch from "${to}") * 1000)::bigint::text AS b FROM "${table}" WHERE "id" = $1`,
    [id],
  );
  return [Number(row.a), Number(row.b)];
}

/** Waits until React has taken over the grid: a raw mouse press before that reaches markup with no handlers. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const column = document.querySelector("[data-day-col]");
    return !!column && Object.keys(column).some((key) => key.startsWith("__reactProps$"));
  });
}

/** Where on screen a time sits in a day's column, measured against the hour labels (a label is centred on its line). */
async function lineOf(page: Page, hour: string): Promise<number> {
  const box = await grid(page).getByText(hour, { exact: true }).boundingBox();
  if (!box) throw new Error(`no label ${hour}`);
  return box.y + box.height / 2;
}

async function must(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
}

test("an event made in the form is drawn in its column, at its time and its height, in a grid that opens at 07:00", async ({ page }) => {
  const tue = day(0, 1);
  const title = `Form ${Date.now()}`;
  await page.goto(weekUrl(0));
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="startTime"]', `${iso(tue)}T09:00`);
  await page.fill('input[name="endTime"]', `${iso(tue)}T10:30`);
  await main(page).getByRole("button", { name: "Add event" }).click();

  const block = column(page, label(tue)).getByRole("button", { name: `${title}, ${label(tue)} 09:00 to 10:30, event` });
  await expect(block).toBeVisible();

  // Every hour has a label, the first one is 00:00, and the view opens at 07:00.
  await expect(grid(page).getByText(/^\d\d:00$/)).toHaveCount(24);
  const scrolled = await grid(page).evaluate((el) => el.scrollTop);
  expect(Math.abs(scrolled - 7 * 56)).toBeLessThanOrEqual(2);

  const top = await lineOf(page, "09:00");
  const box = await must(block);
  expect(Math.abs(box.y - top), "its top is on the 09:00 line").toBeLessThanOrEqual(3);
  expect(Math.abs(box.height - (84 - 2)), "an hour and a half is 84px less the gap").toBeLessThanOrEqual(2);
  const col = await must(column(page, label(tue)));
  expect(box.x).toBeGreaterThanOrEqual(col.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(col.x + col.width + 1);
  await expect(grid(page).getByRole("group", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/ })).toHaveCount(7);
});

test("day view is one column", async ({ page }) => {
  const d = day(1, 2);
  const title = `Solo ${Date.now()}`;
  await addEvent(title, at(d, 11), at(d, 12));
  await page.goto(dayUrl(d));
  await expect(grid(page).getByRole("group", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/ })).toHaveCount(1);
  await expect(column(page, label(d)).getByRole("button", { name: `${title}, ${label(d)} 11:00 to 12:00, event` })).toBeVisible();
  // Two days next to it are not drawn.
  await expect(column(page, label(addDays(d, 1)))).toHaveCount(0);
});

test("the day view shows an event's location and says so when the day is empty; the week does not draw the location", async ({ page }) => {
  const d = day(60, 2);
  const title = `Hall ${Date.now()}`;
  await addEvent(title, at(d, 10), at(d, 12), null, "Hall C");
  await page.goto(dayUrl(d));
  await expect(item(page, title)).toContainText("Hall C");
  await expect(main(page)).not.toContainText("Nothing scheduled for this day");
  await page.goto(weekUrl(60));
  await expect(item(page, title)).not.toContainText("Hall C");

  await page.goto(dayUrl(day(61, 2)));
  await expect(main(page)).toContainText("Nothing scheduled for this day. Drag an unscheduled task onto the grid to block time for it.");
});

test("an alert from a failed move is not carried into the next week", async ({ page }) => {
  const d = day(62, 2);
  const title = `Carry ${Date.now()}`;
  await addBlock(title, at(d, 14), at(d, 15));
  await page.goto(weekUrl(62));
  await item(page, title).click();
  await page.route("**/calendar**", async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  await barButton(page, `Move "${title}" 15 minutes later`).click();
  await expect(alertIn(page)).toContainText("Could not reach the server");

  await main(page).getByRole("link", { name: "Next week" }).click();
  await page.waitForURL(new RegExp(`week=${iso(monday(63))}`));
  await expect(alertIn(page)).toHaveCount(0);
  await expect(status(page)).toHaveText("Select a block to move it.");
});

test("the now line follows the clock", async ({ page }) => {
  const soon = new Date();
  test.skip(soon.getHours() === 23 && soon.getMinutes() >= 45, "ten minutes from now is tomorrow");
  await page.clock.install({ time: soon });
  await page.goto("/calendar?view=week");
  await hydrated(page);
  const line = grid(page).locator("[data-now-line]");
  const topOf = () => line.evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const before = await topOf();
  await page.clock.fastForward("10:00");
  await expect.poll(topOf).toBeCloseTo(before + (10 * 56) / 60, 0);
});

test("overlapping events sit side by side and a lone one has the whole column", async ({ page }) => {
  const d = day(2, 2);
  const stamp = Date.now();
  await addEvent(`First ${stamp}`, at(d, 10), at(d, 11));
  await addEvent(`Second ${stamp}`, at(d, 10, 30), at(d, 11, 30));
  await addEvent(`Alone ${stamp}`, at(d, 13), at(d, 14));
  await page.goto(weekUrl(2));

  const first = await must(item(page, `First ${stamp}`));
  const second = await must(item(page, `Second ${stamp}`));
  const alone = await must(item(page, `Alone ${stamp}`));
  const col = await must(column(page, label(d)));
  expect(first.x + first.width, "the first ends where the second starts").toBeLessThanOrEqual(second.x + 2);
  expect(first.width).toBeLessThan(col.width * 0.6);
  expect(second.width).toBeLessThan(col.width * 0.6);
  expect(alone.width).toBeGreaterThan(col.width * 0.9);
});

test("an event that spans days is in the All day strip once, and not in a column", async ({ page }) => {
  const friday = day(3, 4);
  const title = `Hackathon ${Date.now()}`;
  const id = await addEvent(title, at(friday, 18), at(addDays(friday, 1), 12));
  await page.goto(weekUrl(3));

  const link = allDay(page).getByRole("link", { name: new RegExp(title) });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", `/calendar/${id}`);
  await expect(grid(page).getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
  await expect(grid(page).getByText(title)).toHaveCount(1);
  // It reaches over its two days.
  const fri = await must(column(page, label(friday)));
  const sat = await must(column(page, label(addDays(friday, 1))));
  const strip = await must(link);
  expect(strip.width).toBeGreaterThan(fri.width * 1.5);
  expect(strip.x).toBeLessThan(sat.x);
});

test("selecting a block shows its time and where to edit it, and another one replaces it", async ({ page }) => {
  const d = day(4, 2);
  const stamp = Date.now();
  const blockTitle = `Block ${stamp}`;
  const eventTitle = `Meeting ${stamp}`;
  const blockId = await addBlock(blockTitle, at(d, 14), at(d, 15, 30));
  const eventId = await addEvent(eventTitle, at(d, 9), at(d, 10));
  await page.goto(weekUrl(4));

  await expect(status(page)).toHaveText("Select a block to move it.");
  await expect(bar(page).getByRole("link", { name: "Edit details" })).toHaveCount(0);

  await item(page, blockTitle).click();
  await expect(item(page, blockTitle)).toHaveAttribute("aria-pressed", "true");
  await expect(status(page)).toHaveText(`${blockTitle} · ${label(d)} · 14:00–15:30 · time block`);
  await expect(bar(page).getByRole("link", { name: "Edit details" })).toHaveAttribute("href", `/tasks/${blockId}`);

  await item(page, eventTitle).click();
  await expect(item(page, blockTitle)).toHaveAttribute("aria-pressed", "false");
  await expect(item(page, eventTitle)).toHaveAttribute("aria-pressed", "true");
  await expect(status(page)).toHaveText(`${eventTitle} · ${label(d)} · 09:00–10:00 · event`);
  await expect(bar(page).getByRole("link", { name: "Edit details" })).toHaveAttribute("href", `/calendar/${eventId}`);
});

const OPS: { name: string; button: (t: string) => string; start: [number, number]; end: [number, number]; dayDelta: number }[] = [
  { name: "Earlier", button: (t) => `Move "${t}" 15 minutes earlier`, start: [13, 45], end: [14, 45], dayDelta: 0 },
  { name: "Later", button: (t) => `Move "${t}" 15 minutes later`, start: [14, 15], end: [15, 15], dayDelta: 0 },
  { name: "Shorter", button: (t) => `Make "${t}" 15 minutes shorter`, start: [14, 0], end: [14, 45], dayDelta: 0 },
  { name: "Longer", button: (t) => `Make "${t}" 15 minutes longer`, start: [14, 0], end: [15, 15], dayDelta: 0 },
  { name: "Previous day", button: (t) => `Move "${t}" to the previous day`, start: [14, 0], end: [15, 0], dayDelta: -1 },
  { name: "Next day", button: (t) => `Move "${t}" to the next day`, start: [14, 0], end: [15, 0], dayDelta: 1 },
];

for (const [index, op] of OPS.entries()) {
  test(`${op.name} changes the block's time and the change is still there after a reload`, async ({ page }) => {
    const week = 10 + index;
    const wed = day(week, 2);
    const title = `Op ${op.name} ${Date.now()}`;
    const id = await addBlock(title, at(wed, 14), at(wed, 15));
    await page.goto(weekUrl(week));

    await item(page, title).click();
    await barButton(page, op.button(title)).click();

    const target = addDays(wed, op.dayDelta);
    const expected = `${title} · ${label(target)} · ${clock(...op.start)}–${clock(...op.end)} · time block`;
    await expect(status(page)).toHaveText(expected);
    await expect(alertIn(page)).toHaveCount(0);

    // The server holds it: the stored times, and the page after a reload.
    await expect.poll(async () => stored("task", id)).toEqual([at(target, ...op.start).getTime(), at(target, ...op.end).getTime()]);
    await page.reload();
    await expect(
      column(page, label(target)).getByRole("button", {
        name: `${title}, ${label(target)} ${clock(...op.start)} to ${clock(...op.end)}, time block`,
      }),
    ).toBeVisible();
  });
}

test("the same buttons move an event, and only its two times change", async ({ page }) => {
  const d = day(16, 1);
  const title = `Seminar ${Date.now()}`;
  const id = await addEvent(title, at(d, 9), at(d, 10, 30));
  await sql(`UPDATE "Event" SET "location" = 'Hall C', "description" = 'Bring notes' WHERE "id" = $1`, [id]);
  await page.goto(weekUrl(16));

  await item(page, title).click();
  await barButton(page, `Move "${title}" 15 minutes later`).click();
  await expect(status(page)).toHaveText(`${title} · ${label(d)} · 09:15–10:45 · event`);
  await expect.poll(async () => stored("event", id)).toEqual([at(d, 9, 15).getTime(), at(d, 10, 45).getTime()]);
  const [row] = await sql<{ location: string; description: string; title: string }>(`SELECT "location", "description", "title" FROM "Event" WHERE "id" = $1`, [id]);
  expect(row).toEqual({ location: "Hall C", description: "Bring notes", title });
});

test("at the edge of the week the day buttons say no, and there are none in the day view", async ({ page }) => {
  const mon = day(17, 0);
  const title = `Edge ${Date.now()}`;
  const id = await addBlock(title, at(mon, 9), at(mon, 10));
  await page.goto(weekUrl(17));
  await item(page, title).click();
  await expect(barButton(page, `Move "${title}" to the previous day`)).toHaveAttribute("aria-disabled", "true");
  // Playwright will not click an aria-disabled button; a person can, and it must do nothing.
  await barButton(page, `Move "${title}" to the previous day`).click({ force: true });
  await page.waitForTimeout(500);
  await expect.poll(async () => stored("task", id)).toEqual([at(mon, 9).getTime(), at(mon, 10).getTime()]);
  await expect(barButton(page, `Move "${title}" to the next day`)).not.toHaveAttribute("aria-disabled", "true");

  await page.goto(dayUrl(mon));
  await item(page, title).click();
  await expect(barButton(page, `Move "${title}" 15 minutes later`)).toBeVisible();
  await expect(barButton(page, /previous day|next day/)).toHaveCount(0);
});

test("an imported event is locked: the buttons say no, the reason is in the status, and nothing changes", async ({ page }) => {
  const d = day(18, 2);
  const title = `Lecture ${Date.now()}`;
  const subscription = await addSubscription();
  const id = await addEvent(title, at(d, 10), at(d, 11, 30), subscription);
  await page.goto(weekUrl(18));

  await expect(item(page, title)).toHaveAccessibleName(`${title}, ${label(d)} 10:00 to 11:30, imported, read-only`);
  await item(page, title).click();
  await expect(status(page)).toContainText("read-only");
  await expect(status(page)).toContainText("Change it in the calendar it came from");
  const buttons = bar(page).getByRole("button");
  await expect(buttons).toHaveCount(6);
  for (const button of await buttons.all()) await expect(button).toHaveAttribute("aria-disabled", "true");

  await barButton(page, `Move "${title}" 15 minutes later`).click({ force: true });
  await page.waitForTimeout(600);
  await expect(item(page, title)).toHaveAccessibleName(`${title}, ${label(d)} 10:00 to 11:30, imported, read-only`);
  expect(await stored("event", id)).toEqual([at(d, 10).getTime(), at(d, 11, 30).getTime()]);
});

test("a move the server cannot take puts the block back and says so", async ({ page }) => {
  const d = day(19, 2);
  const title = `Offline ${Date.now()}`;
  const id = await addBlock(title, at(d, 14), at(d, 15));
  await page.goto(weekUrl(19));
  await item(page, title).click();

  // Slow, then refuse: the new time is seen first, then the old one comes back.
  await page.route("**/calendar**", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.abort();
      return;
    }
    await route.continue();
  });
  await barButton(page, `Move "${title}" 15 minutes later`).click();
  await expect(status(page)).toContainText("14:15–15:15");
  await expect(alertIn(page)).toContainText("Could not reach the server");
  await expect(status(page)).toHaveText(`${title} · ${label(d)} · 14:00–15:00 · time block`);
  await expect(item(page, title)).toHaveAccessibleName(`${title}, ${label(d)} 14:00 to 15:00, time block`);
  expect(await stored("task", id)).toEqual([at(d, 14).getTime(), at(d, 15).getTime()]);
});

test("a task removed behind the page's back: the move says so and the block leaves", async ({ page }) => {
  const d = day(20, 2);
  const stamp = Date.now();
  const gone = `Gone ${stamp}`;
  const stays = `Stays ${stamp}`;
  await addBlock(gone, at(d, 14), at(d, 15));
  await addBlock(stays, at(d, 16), at(d, 17));
  await page.goto(weekUrl(20));
  await item(page, gone).click();
  await sql(`UPDATE "Task" SET "deletedAt" = now() WHERE "title" = $1`, [gone]);

  await barButton(page, `Move "${gone}" 15 minutes later`).click();
  await expect(alertIn(page)).toContainText("no longer exists");
  await expect(item(page, gone)).toHaveCount(0);
  await expect(item(page, stays)).toBeVisible();
  await expect(status(page)).toHaveText("Select a block to move it.");
});

test("while one move is being saved another is ignored, so a double click moves a block once", async ({ page }) => {
  const d = day(21, 2);
  const title = `Busy ${Date.now()}`;
  const id = await addBlock(title, at(d, 14), at(d, 15));
  await page.goto(weekUrl(21));
  await item(page, title).click();
  await page.route("**/calendar**", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await barButton(page, `Move "${title}" 15 minutes later`).click();
  await expect(status(page)).toContainText("14:15–15:15");
  await expect(barButton(page, `Move "${title}" 15 minutes later`)).toHaveAttribute("aria-disabled", "true");
  await barButton(page, `Move "${title}" 15 minutes later`).click({ force: true });
  await page.waitForTimeout(1500);
  await expect(status(page)).toContainText("14:15–15:15");
  expect(await stored("task", id), "one step, not two").toEqual([at(d, 14, 15).getTime(), at(d, 15, 15).getTime()]);
});

test("by keyboard a block is selected with Enter, a bar button works, and focus stays on the button", async ({ page }) => {
  const d = day(22, 2);
  const title = `Keys ${Date.now()}`;
  await addBlock(title, at(d, 14), at(d, 15));
  await page.goto(weekUrl(22));

  await item(page, title).focus();
  await page.keyboard.press("Enter");
  await expect(item(page, title)).toHaveAttribute("aria-pressed", "true");
  const later = barButton(page, `Move "${title}" 15 minutes later`);
  await later.focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("14:15–15:15");
  await expect(later).toBeFocused();
  await expect(later).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Space");
  await expect(status(page)).toContainText("14:30–15:30");
  await expect(later).toBeFocused();
});

test("a task dropped from the tray lands where it is let go, as long as its estimate, and the month view still lands at 09:00", async ({ page }) => {
  const d = day(23, 2);
  const title = `Dropped ${Date.now()}`;
  const id = await addUnscheduled(title, 45);
  await page.goto(weekUrl(23));
  await hydrated(page);

  const tray = main(page).getByRole("listitem").filter({ hasText: title });
  await expect(tray).toBeVisible();
  const col = await must(column(page, label(d)));
  const from = await must(tray);
  const targetY = col.y + (9.25 * 56);
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(col.x + 30, targetY, { steps: 8 });
  await expect(grid(page)).toContainText("Drops at 09:15–10:00");
  await page.mouse.up();

  const block = column(page, label(d)).getByRole("button", { name: `${title}, ${label(d)} 09:15 to 10:00, time block` });
  await expect(block).toBeVisible();
  await expect(main(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
  expect(await stored("task", id)).toEqual([at(d, 9, 15).getTime(), at(d, 10).getTime()]);

  // The month grid has no hours to drop on, so it keeps landing a task at 09:00.
  const other = `Month ${Date.now()}`;
  const otherId = await addUnscheduled(other, 30);
  // The month's cells and the tray are both on screen, so the drag does not have to scroll while it is held.
  await page.setViewportSize({ width: 1280, height: 1700 });
  await page.goto("/calendar?view=month&month=2031-01");
  const cell = main(page).locator("div.rounded-xl.grid-cols-7 > div").filter({ has: page.locator("span", { hasText: /^15$/ }) });
  await main(page).getByRole("listitem").filter({ hasText: other }).dragTo(cell);
  const jan15 = new Date(2031, 0, 15);
  await expect.poll(async () => (await stored("task", otherId))[0]).toBe(at(jan15, 9).getTime());
});

test("the month view has no hourly grid and still shows an event in its day", async ({ page }) => {
  const title = `Cell ${Date.now()}`;
  await addEvent(title, new Date(2031, 0, 20, 9), new Date(2031, 0, 20, 10));
  await page.goto("/calendar?view=month&month=2031-01");
  await expect(main(page).getByRole("link", { name: new RegExp(`09:00 ${title}`) })).toBeVisible();
  await expect(grid(page)).toHaveCount(0);
  await expect(main(page).getByRole("region", { name: "Selected block" })).toHaveCount(0);
});

test("today's column has a line at the time it is now", async ({ page }) => {
  await page.goto("/calendar?view=week");
  await expect(grid(page).locator("[data-now-line]")).toHaveCount(1);
  await page.goto(weekUrl(30));
  await expect(grid(page).locator("[data-now-line]")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`on a phone in ${scheme} mode the week and the day fit, and every control is at least 44px tall`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const d = day(24, 2);
    const title = `Phone ${Date.now()}`;
    await addBlock(title, at(d, 9), at(d, 10));

    for (const url of [weekUrl(24), dayUrl(d)]) {
      await page.goto(url);
      await item(page, title).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} is wider than the screen by ${overflow}px`).toBeLessThanOrEqual(0);
      const gridBox = await must(grid(page));
      expect(gridBox.x + gridBox.width).toBeLessThanOrEqual(376);
      // Found by looking at it: the status line had a 14rem flex-basis, which in the phone's column made it 224px tall.
      expect((await must(status(page))).height, "the status line is only as tall as its text").toBeLessThan(90);
      const controls = bar(page).locator("button, a");
      expect(await controls.count()).toBeGreaterThanOrEqual(5);
      for (const control of await controls.all()) {
        const box = await must(control);
        expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(43.5);
      }
      // The view switcher, and in the day view the strip of this week's days, are big enough to hit too.
      const tabs = main(page).getByRole("navigation", { name: "Calendar view" }).getByRole("link");
      await expect(tabs).toHaveCount(3);
      for (const tab of await tabs.all()) expect((await must(tab)).height).toBeGreaterThanOrEqual(43.5);
      const days = main(page).getByRole("navigation", { name: "Days of this week" }).getByRole("link");
      if (url === weekUrl(24)) {
        await expect(days).toHaveCount(0);
      } else {
        await expect(days).toHaveCount(7);
        await expect(days.nth(2)).toHaveAttribute("aria-current", "page");
        for (const link of await days.all()) expect((await must(link)).height).toBeGreaterThanOrEqual(43.5);
      }
    }
  });
}

// ---- Dragging: real mouse events, a tall window so the grid and the whole range of a drag stay on screen ----

test.describe("dragging", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  const ghost = (page: Page) => grid(page).locator("[data-drag-ghost]");
  const centre = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const posts = (page: Page) => {
    const seen: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") seen.push(request.url());
    });
    return seen;
  };

  /** A block on day `i` of private week `n`, opened in Week view. */
  async function block(page: Page, n: number, i: number, from: [number, number], to: [number, number], word = "Drag") {
    const d = day(n, i);
    const title = `${word} ${Date.now()}`;
    const id = await addBlock(title, at(d, ...from), at(d, ...to));
    await page.goto(weekUrl(n));
    await hydrated(page);
    return { d, title, id };
  }

  test("dragging a block down two hours moves it, the label and the saved time agree, and a reload shows it", async ({ page }) => {
    const { d, title, id } = await block(page, 40, 2, [9, 0], [10, 0]);
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 112, { steps: 8 });
    await expect(ghost(page)).toHaveText(new RegExp(`${title}\\s*11:00–12:00`));
    await page.mouse.up();

    await expect(status(page)).toHaveText(`${title} · ${label(d)} · 11:00–12:00 · time block`);
    await expect(ghost(page)).toHaveCount(0);
    await expect.poll(async () => stored("task", id)).toEqual([at(d, 11).getTime(), at(d, 12).getTime()]);
    await page.reload();
    await expect(column(page, label(d)).getByRole("button", { name: `${title}, ${label(d)} 11:00 to 12:00, time block` })).toBeVisible();
  });

  test("dragging across to another column in the week moves it to that day, at the same time", async ({ page }) => {
    const { d, title, id } = await block(page, 41, 2, [14, 0], [15, 0]);
    const friday = addDays(d, 2);
    const from = centre(await must(item(page, title)));
    const target = centre(await must(column(page, label(friday))));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, from.y, { steps: 10 });
    await expect(column(page, label(friday)).locator("[data-drag-ghost]")).toContainText("14:00–15:00");
    await page.mouse.up();

    await expect.poll(async () => stored("task", id)).toEqual([at(friday, 14).getTime(), at(friday, 15).getTime()]);
    const moved = column(page, label(friday)).getByRole("button", { name: `${title}, ${label(friday)} 14:00 to 15:00, time block` });
    await expect(moved).toBeVisible();
    // It is a new element in a new column; the focus that was on it comes back to it.
    await expect(moved).toBeFocused();
    await expect(column(page, label(d)).getByRole("button", { name: new RegExp(`^${title},`) })).toHaveCount(0);
  });

  test("dragging the bottom edge makes a block longer, and the top edge moves its start", async ({ page }) => {
    const { d, title, id } = await block(page, 42, 2, [10, 0], [11, 0]);
    const box = await must(item(page, title));
    const bottom = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
    await page.mouse.move(bottom.x, bottom.y);
    await page.mouse.down();
    await page.mouse.move(bottom.x, bottom.y + 56, { steps: 6 });
    await expect(ghost(page)).toContainText("10:00–12:00");
    await page.mouse.up();
    await expect.poll(async () => stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 12).getTime()]);
    // The next drag is ignored while a save is in flight, so wait for the bar to say it is done.
    await expect(barButton(page, `Move "${title}" 15 minutes later`)).not.toHaveAttribute("aria-disabled", "true");

    const after = await must(item(page, title));
    const top = { x: after.x + after.width / 2, y: after.y + 2 };
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(top.x, top.y + 28, { steps: 6 });
    await expect(ghost(page)).toContainText("10:30–12:00");
    await page.mouse.up();
    await expect.poll(async () => stored("task", id)).toEqual([at(d, 10, 30).getTime(), at(d, 12).getTime()]);
    await expect(status(page)).toContainText("10:30–12:00");
  });

  test("a block cannot be dragged past midnight", async ({ page }) => {
    const { d, title, id } = await block(page, 43, 2, [21, 0], [22, 0]);
    await grid(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 300, { steps: 8 });
    await expect(ghost(page)).toContainText("23:00–00:00");
    await page.mouse.up();
    await expect.poll(async () => stored("task", id)).toEqual([at(d, 23).getTime(), at(addDays(d, 1), 0).getTime()]);
  });

  test("a block cannot be made shorter than fifteen minutes", async ({ page }) => {
    const { d, title, id } = await block(page, 44, 2, [10, 0], [11, 0]);
    const box = await must(item(page, title));
    const bottom = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
    await page.mouse.move(bottom.x, bottom.y);
    await page.mouse.down();
    await page.mouse.move(bottom.x, bottom.y - 500, { steps: 8 });
    await expect(ghost(page)).toContainText("10:00–10:15");
    await page.mouse.up();
    await expect.poll(async () => stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 10, 15).getTime()]);
  });

  test("a press with no movement selects the block and sends nothing", async ({ page }) => {
    const { d, title, id } = await block(page, 45, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 2, start.y + 2);
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(item(page, title)).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("dragging a block away and back to where it was sends nothing", async ({ page }) => {
    const { d, title, id } = await block(page, 53, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 112, { steps: 6 });
    await expect(ghost(page)).toContainText("12:00–13:00");
    await page.mouse.move(start.x, start.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("a drag whose release was lost ends as soon as the mouse moves with no button held", async ({ page }) => {
    const { d, title, id } = await block(page, 54, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const target = item(page, title);
    const start = centre(await must(target));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 100, { steps: 6 });
    await expect(ghost(page)).toHaveCount(1);
    // A context menu took the release: the next move says no button is held.
    await target.dispatchEvent("pointermove", { pointerType: "mouse", pointerId: 1, isPrimary: true, buttons: 0, button: -1, clientX: start.x, clientY: start.y + 140, bubbles: true });
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("a cancelled pointer takes the drag back and sends nothing", async ({ page }) => {
    const { d, title, id } = await block(page, 56, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const target = item(page, title);
    const start = centre(await must(target));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 100, { steps: 6 });
    await expect(ghost(page)).toHaveCount(1);
    await target.dispatchEvent("pointercancel", { pointerType: "mouse", pointerId: 1, isPrimary: true, bubbles: true });
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("scrolling the grid while a block is held counts as movement", async ({ page }) => {
    const { title } = await block(page, 57, 2, [10, 0], [11, 0]);
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 10, { steps: 2 });
    await expect(ghost(page)).toContainText("10:15–11:15");
    await page.mouse.wheel(0, 112);
    await expect.poll(() => grid(page).evaluate((el) => el.scrollTop)).toBe(7 * 56 + 112);
    await page.mouse.move(start.x, start.y + 11);
    // 11px of mouse and 112px of scroll is two hours and a quarter by the grid's scale (123px = 132 minutes, snapped).
    await expect(ghost(page)).toContainText("12:15–13:15");
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("a second tray drop is ignored while the first is being saved", async ({ page }) => {
    const d = day(58, 2);
    const stamp = Date.now();
    const first = await addUnscheduled(`First tray ${stamp}`, 30);
    const second = await addUnscheduled(`Second tray ${stamp}`, 30);
    await page.goto(weekUrl(58));
    await hydrated(page);
    await page.route("**/calendar**", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const col = await must(column(page, label(d)));
    async function dropFromTray(title: string, minutes: number) {
      const row = main(page).getByRole("listitem").filter({ hasText: title });
      const box = await must(row);
      await page.mouse.move(box.x + 20, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(col.x + 30, col.y + (minutes / 60) * 56, { steps: 8 });
      await page.mouse.move(col.x + 31, col.y + (minutes / 60) * 56 + 1);
      await page.mouse.up();
    }
    await dropFromTray(`First tray ${stamp}`, 9 * 60);
    await dropFromTray(`Second tray ${stamp}`, 13 * 60);
    await page.waitForTimeout(2500);
    expect((await stored("task", first))[0]).toBe(at(d, 9).getTime());
    const [row] = await sql<{ scheduledStart: string | null }>(`SELECT "scheduledStart" FROM "Task" WHERE "id" = $1`, [second]);
    expect(row.scheduledStart, "the second drop was ignored").toBeNull();
  });

  test("Escape during a drag puts the block back and sends nothing", async ({ page }) => {
    const { d, title, id } = await block(page, 46, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const before = await must(item(page, title));
    const start = centre(before);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 100, { steps: 6 });
    await expect(ghost(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.move(start.x, start.y + 150, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
    expect((await must(item(page, title))).y).toBeCloseTo(before.y, 0);
  });

  test("a touch pointer does not start a drag", async ({ page }) => {
    const { d, title, id } = await block(page, 47, 2, [10, 0], [11, 0]);
    const seen = posts(page);
    const target = item(page, title);
    const start = centre(await must(target));
    const touch = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, bubbles: true };
    await target.dispatchEvent("pointerdown", { ...touch, clientX: start.x, clientY: start.y });
    await target.dispatchEvent("pointermove", { ...touch, clientX: start.x, clientY: start.y + 120 });
    await expect(ghost(page)).toHaveCount(0);
    await target.dispatchEvent("pointerup", { ...touch, clientX: start.x, clientY: start.y + 120 });
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("an imported event cannot be dragged and has no edge handles", async ({ page }) => {
    const d = day(48, 2);
    const stamp = Date.now();
    const lockedTitle = `Imported ${stamp}`;
    const movableTitle = `Movable ${stamp}`;
    const subscription = await addSubscription();
    const lockedId = await addEvent(lockedTitle, at(d, 10), at(d, 11), subscription);
    await addBlock(movableTitle, at(d, 13), at(d, 14));
    await page.goto(weekUrl(48));
    await hydrated(page);
    const seen = posts(page);

    await expect(item(page, lockedTitle).locator("[data-edge]")).toHaveCount(0);
    await expect(item(page, movableTitle).locator("[data-edge]")).toHaveCount(2);

    const start = centre(await must(item(page, lockedTitle)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 120, { steps: 6 });
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(seen).toEqual([]);
    expect(await stored("event", lockedId)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("a drag the server cannot take puts the block back and says so", async ({ page }) => {
    const { d, title, id } = await block(page, 49, 2, [10, 0], [11, 0]);
    await page.route("**/calendar**", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.abort();
        return;
      }
      await route.continue();
    });
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 56, { steps: 6 });
    await page.mouse.up();
    await expect(status(page)).toContainText("11:00–12:00");
    await expect(alertIn(page)).toContainText("Could not reach the server");
    await expect(item(page, title)).toHaveAccessibleName(`${title}, ${label(d)} 10:00 to 11:00, time block`);
    expect(await stored("task", id)).toEqual([at(d, 10).getTime(), at(d, 11).getTime()]);
  });

  test("the refreshed grid does not flash the block back into the column it left", async ({ page }) => {
    const { d, title } = await block(page, 50, 2, [14, 0], [15, 0]);
    const friday = addDays(d, 2);
    await page.route("**/calendar**", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.evaluate(
      ({ name, text }) => {
        const origin = document.querySelector(`[role="group"][aria-label="${name}"]`)!;
        const w = window as unknown as { __back: number };
        w.__back = 0;
        new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLButtonElement && node.textContent?.includes(text)) w.__back += 1;
        }).observe(origin, { childList: true, subtree: true });
      },
      { name: label(d), text: title },
    );

    const from = centre(await must(item(page, title)));
    const target = centre(await must(column(page, label(friday))));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, from.y, { steps: 8 });
    await page.mouse.up();
    await expect(column(page, label(friday)).getByRole("button", { name: new RegExp(`^${title},`) })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __back: number }).__back), "the block was drawn in its old column again").toBe(0);
    await expect(column(page, label(friday)).getByRole("button", { name: new RegExp(`^${title},`) })).toBeVisible();
  });

  test("while a save is in flight a second drag is ignored", async ({ page }) => {
    const { d, title, id } = await block(page, 51, 2, [10, 0], [11, 0]);
    await page.route("**/calendar**", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    const start = centre(await must(item(page, title)));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 56, { steps: 6 });
    await page.mouse.up();
    await expect(status(page)).toContainText("11:00–12:00");

    // Still saving: press the block where it now is and try to take it further.
    const now = centre(await must(item(page, title)));
    await page.mouse.move(now.x, now.y);
    await page.mouse.down();
    await page.mouse.move(now.x, now.y + 112, { steps: 6 });
    await expect(ghost(page)).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(2000);
    expect(await stored("task", id), "one move, not two").toEqual([at(d, 11).getTime(), at(d, 12).getTime()]);
  });

  test("a drag that ends outside the grid lands in the nearest column", async ({ page }) => {
    const { d, title, id } = await block(page, 52, 2, [10, 0], [11, 0]);
    const sunday = addDays(d, 4);
    const from = centre(await must(item(page, title)));
    const last = await must(column(page, label(sunday)));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width + 150, from.y, { steps: 10 });
    await expect(column(page, label(sunday)).locator("[data-drag-ghost]")).toContainText("10:00–11:00");
    await page.mouse.up();
    await expect.poll(async () => stored("task", id)).toEqual([at(sunday, 10).getTime(), at(sunday, 11).getTime()]);
  });
});
