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
