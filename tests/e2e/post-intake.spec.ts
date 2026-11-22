import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Assignments from a pasted post, driven through the browser. The dev server runs with POST_INTAKE_ENGINE=code (playwright.config.ts), so rules read the post and no model is involved. */
const main = (page: Page) => page.locator("main");

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
const title = `Assignment ${stamp}`;
const POST = `Hello everyone. ${title} is due on Friday 4 December at 23:59 on the course page. Have a good week!`;

test.afterEach(async () => {
  await sql(`DELETE FROM "Task" WHERE "title" = $1`, [title]);
});

async function open(page: Page) {
  await page.goto("/tasks");
  await page.getByText("Add from a teacher’s post").click();
}

test("paste a post, check the row, add it: the task exists with its date and the post's sentence", async ({ page }) => {
  await open(page);
  await page.getByLabel("Paste the post").fill(POST);
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(page.getByLabel("Name, row 1")).toHaveValue(title);
  await expect(page.getByLabel("Due date, row 1")).toHaveValue(/-12-04$/);
  await expect(main(page)).toContainText("is due on Friday 4 December");
  await page.getByRole("button", { name: "Add 1 task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1 task" })).toBeVisible();
  const rows = await sql(`SELECT "tags", "description" FROM "Task" WHERE "title" = $1`, [title]);
  expect(rows).toHaveLength(1);
  expect(rows[0].tags).toEqual(["post"]);
  expect(rows[0].description).toContain("From a pasted post");
});

test("nothing is saved before Add, and an unticked row is not added", async ({ page }) => {
  await open(page);
  await page.getByLabel("Paste the post").fill(POST);
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(page.getByLabel("Name, row 1")).toHaveValue(title);
  expect(await sql(`SELECT 1 FROM "Task" WHERE "title" = $1`, [title])).toHaveLength(0);
  await page.getByLabel("Add row 1").uncheck();
  await expect(page.getByRole("button", { name: "Add 0 tasks" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await sql(`SELECT 1 FROM "Task" WHERE "title" = $1`, [title])).toHaveLength(0);
});

test("a post with no work in it says so and adds nothing", async ({ page }) => {
  await open(page);
  await page.getByLabel("Paste the post").fill("Good morning everyone, see you in class on Monday.");
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No work with a date found" })).toBeVisible();
});

test("on a phone the card fits the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  await page.getByLabel("Paste the post").fill(POST);
  await page.getByRole("button", { name: "Find tasks" }).click();
  await expect(page.getByLabel("Name, row 1")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
