import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Study time per course, driven through the browser: the three switches on the Focus page, the course a
 * note is written under, the timer that remembers or does not, and what the Focus and course pages show.
 * The shared e2e account is put back the way it was after every test, so the other specs never see a
 * switch left on or a session left behind.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

/** Runs one statement against the database the app uses (for what the page cannot be asked to do). */
async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(statement, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local')`;

test.afterEach(async () => {
  await sql(
    `UPDATE "UserProfile" SET "focusTrackingEnabled" = false, "focusIncludeCourse" = false, "timerSessionsEnabled" = false WHERE "userId" IN ${ME}`,
  );
  await sql(`DELETE FROM "FocusTelemetry" WHERE "userId" IN ${ME}`);
  await sql(`DELETE FROM "StudySession" WHERE "userId" IN ${ME}`);
});

const tracking = (page: Page) => main(page).getByLabel("Record focus sessions", { exact: true });
const includeCourse = (page: Page) => main(page).getByLabel("Include the course", { exact: true });
const timer = (page: Page) => main(page).getByLabel("Remember timer sessions", { exact: true });

test("the course switch waits for tracking, each switch sticks, and turning tracking off ends the course", async ({ page }) => {
  await page.goto("/focus");
  await expect(tracking(page)).not.toBeChecked();
  await expect(includeCourse(page)).not.toBeChecked();
  await expect(includeCourse(page)).toBeDisabled();
  await expect(timer(page)).not.toBeChecked();
  await expect(main(page)).toContainText("Available once “Record focus sessions” is on.");

  await tracking(page).check();
  await expect(includeCourse(page)).toBeEnabled();
  await includeCourse(page).check();
  await expect(includeCourse(page)).toBeChecked();
  await page.reload();
  await expect(tracking(page)).toBeChecked();
  await expect(includeCourse(page)).toBeChecked();

  // The timer is its own consent: it moves without the others.
  await timer(page).check();
  await page.reload();
  await expect(timer(page)).toBeChecked();

  await tracking(page).uncheck();
  await expect(includeCourse(page)).toBeDisabled();
  await page.reload();
  await expect(tracking(page)).not.toBeChecked();
  await expect(includeCourse(page)).not.toBeChecked();
  await expect(timer(page)).toBeChecked();

  await tracking(page).check();
  await expect(includeCourse(page)).not.toBeChecked();
});

/** Makes a course through the form and returns its id (read from the address of its page). */
async function makeCourse(page: Page, code: string): Promise<string> {
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', `Title of ${code}`);
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link").filter({ hasText: code }).first().click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

const seedFlags = (tracking: boolean, course: boolean, timerOn: boolean) =>
  sql(
    `INSERT INTO "UserProfile" (id, "userId", "focusTrackingEnabled", "focusIncludeCourse", "timerSessionsEnabled")
     VALUES (gen_random_uuid()::text, ${ME}, $1, $2, $3)
     ON CONFLICT ("userId") DO UPDATE SET "focusTrackingEnabled" = $1, "focusIncludeCourse" = $2, "timerSessionsEnabled" = $3`,
    [tracking, course, timerOn],
  );

const seedWriting = (courseId: string | null, seconds: number) =>
  sql(
    `INSERT INTO "FocusTelemetry" (id, "userId", "courseId", "sessionDuration", "typingSpeedWpm", "cognitiveLoad", "recordedAt")
     VALUES (gen_random_uuid()::text, ${ME}, $1, $2, 30, 'light', now() - interval '1 day')`,
    [courseId, seconds],
  );

const seedTimer = (courseId: string | null, seconds: number) =>
  sql(
    `INSERT INTO "StudySession" (id, "userId", "courseId", seconds, "recordedAt")
     VALUES (gen_random_uuid()::text, ${ME}, $1, $2, now() - interval '1 day')`,
    [courseId, seconds],
  );

test("Focus lists recorded time by course, with the two measures side by side and a range that survives garbage", async ({ page }) => {
  const code = `STD ${Date.now() % 100000}`;
  const courseId = await makeCourse(page, code);
  await seedFlags(true, true, true);
  await seedWriting(courseId, 1500);
  await seedWriting(courseId, 600);
  await seedWriting(null, 120);
  await seedTimer(courseId, 3000);

  await page.goto("/focus");
  const byCourse = main(page).getByRole("region", { name: /By course/ });
  await expect(byCourse).toContainText("last 28 days");
  const row = byCourse.getByRole("listitem").filter({ hasText: code });
  await expect(row).toContainText("Writing");
  await expect(row).toContainText("35 m");
  await expect(row).toContainText("2 sessions");
  await expect(row).toContainText("Timer");
  await expect(row).toContainText("50 m");
  await expect(row).toContainText("1 session");
  await expect(row.getByRole("link", { name: new RegExp(code) })).toHaveAttribute("href", `/courses/${courseId}`);
  await expect(byCourse.getByRole("listitem").filter({ hasText: "No course" })).toContainText("2 m");
  await expect(byCourse).toContainText("They measure different things, so they are not added together.");
  await expect(byCourse.getByRole("link", { name: "28 days" })).toHaveAttribute("aria-current", "true");

  await byCourse.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/range=7$/);
  await expect(main(page).getByRole("region", { name: /By course/ })).toContainText("last 7 days");

  await page.goto("/focus?range=abc");
  await expect(main(page).getByRole("region", { name: /By course/ })).toContainText("last 28 days");
  await page.goto("/focus?range=7&range=all");
  await expect(main(page).getByRole("region", { name: /By course/ })).toContainText("last 28 days");
});

test("the course page shows the same time, and no card at all when nothing is recorded or being recorded", async ({ page }) => {
  const code = `STC ${Date.now() % 100000}`;
  const courseId = await makeCourse(page, code);
  const card = () => main(page).getByRole("region", { name: "Time on this course" });

  await page.goto(`/courses/${courseId}`);
  await expect(card()).toHaveCount(0);

  await seedFlags(true, true, true);
  await page.reload();
  await expect(card()).toContainText("Nothing recorded for this course in the last 28 days.");

  await seedWriting(courseId, 1500);
  await seedTimer(courseId, 3000);
  await page.reload();
  await expect(card()).toContainText("Last 28 days");
  await expect(card()).toContainText("25 m");
  await expect(card()).toContainText("50 m");
  await expect(card().getByRole("link", { name: "Every course, side by side" })).toHaveAttribute("href", "/focus#by-course");

  // Switched off, the history stays and so does the card.
  await seedFlags(false, false, false);
  await page.reload();
  await expect(card()).toContainText("25 m");
});

// --- The writing and timer paths, end to end ----------------------------------------------------------

const rows = <T,>(table: string, columns: string) =>
  sql<T>(`SELECT ${columns} FROM "${table}" WHERE "userId" IN ${ME} ORDER BY "recordedAt"`);

/** Writes in a new note under `courseId`: a key, forty seconds of the clock, another key, then saves (which leaves the page). */
async function writeForFortySeconds(page: Page, courseId: string, title: string) {
  await page.clock.install({ time: new Date() });
  await page.goto("/notes/new");
  await main(page).getByLabel("Course", { exact: true }).selectOption(courseId);
  await page.fill('input[name="title"]', title);
  const body = page.locator('textarea[name="content"]');
  await body.click();
  await page.keyboard.type("a");
  await page.clock.fastForward(40_000);
  await page.keyboard.type("b");
  await main(page).getByRole("button", { name: "Create note" }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
}

test("a note written with the course switch on is recorded under its course", async ({ page }) => {
  const courseId = await makeCourse(page, `STW ${Date.now() % 100000}`);
  await seedFlags(true, true, false);
  await writeForFortySeconds(page, courseId, `Written ${Date.now()}`);

  await expect
    .poll(async () => (await rows<{ courseId: string | null; sessionDuration: number }>("FocusTelemetry", `"courseId", "sessionDuration"`)).length)
    .toBe(1);
  const [row] = await rows<{ courseId: string | null; sessionDuration: number }>("FocusTelemetry", `"courseId", "sessionDuration"`);
  expect(row.courseId).toBe(courseId);
  expect(row.sessionDuration).toBeGreaterThanOrEqual(40);
  expect(row.sessionDuration).toBeLessThan(50);
});

test("with the course switch off the same note is recorded without its course", async ({ page }) => {
  const courseId = await makeCourse(page, `STN ${Date.now() % 100000}`);
  await seedFlags(true, false, false);
  await writeForFortySeconds(page, courseId, `Written ${Date.now()}`);

  await expect
    .poll(async () => (await rows("FocusTelemetry", `"courseId"`)).length)
    .toBe(1);
  const [row] = await rows<{ courseId: string | null }>("FocusTelemetry", `"courseId"`);
  expect(row.courseId).toBeNull();
});

/** Makes a task in a course through the form and opens it. */
async function makeTaskIn(page: Page, courseId: string, title: string) {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await page.locator('select[name="courseId"]').first().selectOption(courseId);
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await main(page).getByRole("link", { name: title }).first().click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
}

const clock = (page: Page) => main(page).getByRole("region", { name: "Study timer" });
const timerSessions = () => rows<{ courseId: string | null; seconds: number }>("StudySession", `"courseId", seconds`);

test("a remembered timer saves once when it finishes, and a reset afterwards adds nothing", async ({ page }) => {
  const code = `STT ${Date.now() % 100000}`;
  const courseId = await makeCourse(page, code);
  await seedFlags(false, false, true);
  await makeTaskIn(page, courseId, `Timed ${Date.now()}`);

  await page.clock.install({ time: new Date() });
  await page.reload();
  await expect(clock(page)).toContainText(`Remembered under ${code}`);
  await clock(page).getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward("26:00");

  await expect(clock(page).getByRole("status").filter({ hasText: "Done" })).toContainText(`Saved 25 min under ${code}.`);
  await expect.poll(async () => (await timerSessions()).length).toBe(1);
  expect((await timerSessions())[0]).toEqual({ courseId, seconds: 1500 });

  await clock(page).getByRole("button", { name: "Reset" }).click();
  await clock(page).getByRole("button", { name: "Start" }).click();
  await clock(page).getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(500);
  expect(await timerSessions()).toHaveLength(1);
});

test("a timer reset part way saves what ran, once", async ({ page }) => {
  const code = `STP ${Date.now() % 100000}`;
  const courseId = await makeCourse(page, code);
  await seedFlags(false, false, true);
  await makeTaskIn(page, courseId, `Part ${Date.now()}`);

  await page.clock.install({ time: new Date() });
  await page.reload();
  await clock(page).getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward("10:00");
  await clock(page).getByRole("button", { name: "Pause" }).click();
  await clock(page).getByRole("button", { name: "50m" }).click();

  await expect(clock(page).getByRole("status")).toContainText(`Saved 10 min under ${code}.`);
  await expect.poll(async () => (await timerSessions()).length).toBe(1);
  const [row] = await timerSessions();
  expect(row.courseId).toBe(courseId);
  expect(row.seconds).toBeGreaterThanOrEqual(599);
  expect(row.seconds).toBeLessThanOrEqual(601);
});

test("with remembering off the timer says so and stores nothing", async ({ page }) => {
  const courseId = await makeCourse(page, `STO ${Date.now() % 100000}`);
  await makeTaskIn(page, courseId, `Off ${Date.now()}`);

  await page.clock.install({ time: new Date() });
  await page.reload();
  await expect(clock(page)).toContainText("Not remembered. This is just a clock.");
  await expect(clock(page).getByRole("link", { name: "Focus page" })).toHaveAttribute("href", "/focus");
  await clock(page).getByRole("button", { name: "Start" }).click();
  await page.clock.fastForward("26:00");
  await expect(clock(page).getByRole("status").filter({ hasText: "Done" })).not.toContainText("Saved");
  await page.waitForTimeout(500);
  expect(await timerSessions()).toHaveLength(0);
});
