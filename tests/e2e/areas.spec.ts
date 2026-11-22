import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Areas (School, Work, both), driven through the browser. Rows are made by SQL for the run's account and removed after each test. */
const main = (page: Page) => page.locator("main");
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" }).first();

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as Record<string, string>[];
  } finally {
    await client.end();
  }
}

const stamp = `${Date.now()}`;
const lab = `Lab ${stamp}`;
const pr = `PR ${stamp}`;
let userId = "";

test.beforeEach(async () => {
  userId = (await sql(`SELECT "id" FROM "User" WHERE "email" LIKE 'e2e-%' ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
  const course = (await sql(`INSERT INTO "Course" ("id","userId","code","title","term","updatedAt") VALUES (gen_random_uuid(), $1, $2, 'Areas course', 'Fall 2026', now()) RETURNING "id"`, [userId, `AR${stamp.slice(-4)}`]))[0].id;
  const project = (await sql(`INSERT INTO "Project" ("id","userId","title","category","updatedAt") VALUES (gen_random_uuid(), $1, $2, 'Work', now()) RETURNING "id"`, [userId, `Work ${stamp}`]))[0].id;
  // Prisma stores UTC in a timestamp column, so the instant goes in as an ISO string (a Date would be written in local time).
  const dueDate = new Date();
  dueDate.setHours(23, 0, 0, 0);
  const due = dueDate.toISOString();
  await sql(`INSERT INTO "Task" ("id","userId","title","courseId","dueDate","updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`, [userId, lab, course, due]);
  await sql(`INSERT INTO "Task" ("id","userId","title","projectId","dueDate","updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`, [userId, pr, project, due]);
});

test.afterEach(async () => {
  await sql(`DELETE FROM "Task" WHERE "userId" = $1 AND "title" IN ($2, $3)`, [userId, lab, pr]);
  await sql(`DELETE FROM "Project" WHERE "userId" = $1 AND "title" = $2`, [userId, `Work ${stamp}`]);
  await sql(`DELETE FROM "Course" WHERE "userId" = $1 AND "title" = 'Areas course'`, [userId]);
  await sql(`UPDATE "UserProfile" SET "areas" = NULL WHERE "userId" = $1`, [userId]);
});

async function choose(page: Page, label: string) {
  await page.goto("/settings");
  await page.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

test("by default School is on: the Study pages are in the menu and Today has no filter", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page).getByRole("link", { name: "Courses" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Show" })).toHaveCount(0);
  await expect(main(page)).toContainText(lab);
  await expect(main(page)).toContainText(pr);
});

test("Work only hides the Study pages from the menu, and the data is still there", async ({ page }) => {
  await choose(page, "Work");
  await page.goto("/");
  await expect(nav(page).getByRole("link", { name: "Courses" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Projects" })).toBeVisible();
  await page.goto("/courses");
  await expect(main(page)).toContainText("Areas course");
});

test("Both: rows say School or Work, and the filter shows one area at a time", async ({ page }) => {
  await choose(page, "Both");
  await page.goto("/");
  const filter = page.getByRole("navigation", { name: "Show" });
  await expect(filter).toBeVisible();
  await expect(main(page).getByText(lab).first()).toBeVisible();
  await expect(main(page).getByText(pr).first()).toBeVisible();
  await expect(main(page).getByText("School", { exact: true }).first()).toBeVisible();
  await expect(main(page).getByText("Work", { exact: true }).first()).toBeVisible();
  await filter.getByRole("link", { name: "Work" }).click();
  await expect(page).toHaveURL(/area=work/);
  // "Due now" at the top is a reminder, not a list: it is never narrowed by the view, so a deadline in the other area is not hidden. The lists are.
  const due = main(page).locator("section", { has: page.getByRole("heading", { name: "Due today" }) });
  await expect(due.getByText(pr)).toBeVisible();
  await expect(due.getByText(lab)).toHaveCount(0);
  await page.goto("/?area=school");
  await expect(due.getByText(lab)).toBeVisible();
  await expect(due.getByText(pr)).toHaveCount(0);
  // A filter in the address does nothing when both areas are not on.
  await choose(page, "School");
  await page.goto("/?area=work");
  await expect(main(page).getByText(lab).first()).toBeVisible();
});

test("on a phone the settings card and Today fit the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await choose(page, "Both");
  for (const path of ["/settings", "/"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
