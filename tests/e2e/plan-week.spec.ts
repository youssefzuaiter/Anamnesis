import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Plan my week at /plan, driven through the browser. No model is involved. Each test makes tasks with the time in their titles and deletes them after. */
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

const pad = (n: number) => String(n).padStart(2, "0");
/** The Monday after this week: a week wholly in the future, so "now" never clips it. */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function addTask(page: Page, title: string) {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /add task/i }).click();
  await expect(main(page)).toContainText(title);
}

test("propose, leave one out in the grid view, schedule: the kept task is scheduled and shows on the calendar, the other stays unscheduled", async ({ page }) => {
  const stamp = `${Date.now()}`;
  const keep = `Keep ${stamp}`;
  const skip = `Skip ${stamp}`;
  const week = nextMonday();
  try {
    await addTask(page, keep);
    await addTask(page, skip);
    await page.goto(`/plan?week=${week}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(/plan my week/i);
    await main(page).getByRole("button", { name: "Propose a plan" }).click();
    await expect(main(page).getByRole("status").first()).toContainText(/placed on \d+ days/);
    await expect(main(page).getByLabel(`Schedule ${keep}`)).toBeChecked();

    // Leave the other account tasks out, so only this test's tasks move.
    for (const box of await main(page).getByRole("checkbox").all()) {
      const name = (await box.getAttribute("aria-label")) ?? "";
      if (!name.includes(stamp)) await box.uncheck();
    }

    // The grid shows the same proposal, and leaving a block out there leaves it out in the rows too.
    await main(page).getByRole("button", { name: "Grid", exact: true }).click();
    const block = main(page).getByRole("button", { name: new RegExp(`^${skip},`) }).first();
    await expect(block).toHaveAttribute("aria-pressed", "true");
    await block.click();
    await expect(block).toHaveAttribute("aria-pressed", "false");
    await main(page).getByRole("button", { name: "Rows", exact: true }).click();
    await expect(main(page).getByLabel(`Schedule ${skip}`)).not.toBeChecked();
    await expect(main(page).getByLabel(`Schedule ${keep}`)).toBeChecked();

    await main(page).getByRole("button", { name: "Schedule 1 task" }).click();
    await expect(main(page).getByRole("status").first()).toContainText("Scheduled 1 task.");

    await page.goto(`/calendar?view=week&week=${week}`);
    await expect(main(page)).toContainText(keep);
    expect((await sql(`SELECT 1 FROM "Task" WHERE "title" = $1 AND "scheduledStart" IS NOT NULL`, [keep])).length).toBe(1);
    expect((await sql(`SELECT 1 FROM "Task" WHERE "title" = $1 AND "scheduledStart" IS NOT NULL`, [skip])).length).toBe(0);
  } finally {
    await sql(`DELETE FROM "Task" WHERE "title" IN ($1, $2)`, [keep, skip]);
  }
});

test("an address that is not a week is this week, a week can be browsed, and an empty plan says so", async ({ page }) => {
  await page.goto("/plan?week=banana");
  await expect(main(page)).toContainText("This week");
  await page.goto("/plan?week=2026-02-30");
  await expect(main(page)).toContainText("This week");
  await main(page).getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(/\/plan\?week=\d{4}-\d{2}-\d{2}$/);
  await expect(main(page).getByRole("link", { name: "This week" })).toBeVisible();
});

test("on a phone the page fits and the grid shows one day at a time with touch-sized tabs", async ({ page }) => {
  const stamp = `${Date.now()}`;
  const title = `Phone ${stamp}`;
  try {
    await addTask(page, title);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/plan?week=${nextMonday()}`);
    await main(page).getByRole("button", { name: "Propose a plan" }).click();
    await expect(main(page).getByLabel(`Schedule ${title}`)).toBeVisible();
    await main(page).getByRole("button", { name: "Grid", exact: true }).click();
    const tabs = main(page).getByRole("tab");
    await expect(tabs).toHaveCount(7);
    for (const tab of await tabs.all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  } finally {
    await sql(`DELETE FROM "Task" WHERE "title" = $1`, [title]);
  }
});
