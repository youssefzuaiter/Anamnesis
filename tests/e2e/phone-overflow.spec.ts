import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Pages whose layout holds the user's own text must fit a phone whatever the text is. Found with a demo account on 2026-11-17: the calendar's
 * "Add event" and "Unscheduled" section is a grid with no column track on a phone (`grid gap-4 sm:grid-cols-3`), so its one column sized itself
 * to the widest content and the page was 17px wider than the screen. The project page has the same pattern.
 */

const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local')`;
async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const LONG = "A very long task title that goes on and on without a break so that it cannot possibly fit a phone screen unless it is cut off";
test.afterEach(async () => {
  await sql(`DELETE FROM "Task" WHERE "userId" IN ${ME} AND title LIKE 'A very long task title%'`);
  await sql(`DELETE FROM "Project" WHERE "userId" IN ${ME} AND title LIKE 'A very long project%'`);
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("the calendar fits a phone when an unscheduled task has a long title, in month, week and day", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await sql(`INSERT INTO "Task" (id, "userId", title, status, priority, tags, "estimatedMinutes", "dueDate", "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, $1, 'todo', 'high', '{}', 30, now() + interval '3 days', now())`, [LONG]);
  for (const view of ["month", "week", "day"]) {
    await page.goto(`/calendar?view=${view}`);
    await expect(page.locator("main")).toContainText("A very long task title");
    expect(await overflow(page), `${view} overflows`).toBeLessThanOrEqual(0);
  }
});

test("the project page fits a phone when a task and the project have long titles", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const [project] = await sql<{ id: string }>(`INSERT INTO "Project" (id, "userId", title, category, progress, "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, $1, 'University', 0, now()) RETURNING id`, [`A very long project name that keeps going ${LONG}`]);
  await sql(`INSERT INTO "Task" (id, "userId", title, status, priority, tags, "estimatedMinutes", "projectId", "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, $1, 'todo', 'high', '{}', 30, $2, now())`, [LONG, project.id]);
  await page.goto(`/projects/${project.id}`);
  await expect(page.locator("main")).toContainText("A very long task title");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
