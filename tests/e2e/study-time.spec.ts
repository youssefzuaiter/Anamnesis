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
