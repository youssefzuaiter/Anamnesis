import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * The focus timer on every page (ROADMAP item 40): the header chip, pausing from it, the break flow and a phone.
 * The timer lives on the server, so "time passing" is the stored end moved with SQL, and the page catches up by itself.
 */

const main = (page: Page) => page.locator("main");
const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local')`;

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows;
  } finally {
    await client.end();
  }
}

const tasks: string[] = [];
test.afterEach(async () => {
  await sql(`DELETE FROM "ActiveTimer" WHERE "userId" IN ${ME}`);
  if (tasks.length) await sql(`DELETE FROM "Task" WHERE id = ANY($1)`, [tasks]);
  tasks.length = 0;
});

async function openTask(page: Page, title: string) {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await main(page).getByRole("link", { name: title }).first().click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  tasks.push(page.url().split("/").pop()!);
}

/** Lets the stored timer run out in two seconds, and makes the open page look again (it polls every half minute, and when the tab returns). */
async function endsSoon(page: Page) {
  await sql(`UPDATE "ActiveTimer" SET "endsAt" = now() + interval '2 seconds' WHERE "userId" IN ${ME}`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

const card = (page: Page) => main(page).getByRole("region", { name: "Study timer" });
const chip = (page: Page) => page.getByRole("group", { name: "Timer in progress" });

test("the chip follows the timer to other pages, and pausing from it pauses the task page too", async ({ page }) => {
  const title = `Chip ${Date.now()}`;
  await openTask(page, title);
  await expect(chip(page)).toHaveCount(0);
  await card(page).getByRole("button", { name: "Start" }).click();
  await expect(chip(page)).toContainText(title);

  await page.goto("/notes");
  await expect(chip(page)).toContainText(`Focus · ${title}`);
  await page.waitForTimeout(1200); // a pause in the very first second is still "ready", not "paused"
  await chip(page).getByRole("button", { name: "Pause" }).click();
  await expect(chip(page).getByRole("button", { name: "Resume" })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await page.waitForURL(/\/tasks\//);
  await expect(card(page).getByRole("button", { name: "Resume" })).toBeVisible();
});

test("a finished session offers the break, nothing starts by itself, and a break is never study time", async ({ page }) => {
  await openTask(page, `Break ${Date.now()}`);
  await card(page).getByRole("button", { name: "Start" }).click();
  await expect(card(page).getByRole("button", { name: "Pause" })).toBeVisible();
  await endsSoon(page);

  await expect(card(page).getByRole("button", { name: "Start the 5 min break" })).toBeVisible({ timeout: 20_000 });
  await expect(card(page).getByText("Session 1 of 4 done")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(card(page).getByRole("button", { name: "Start the 5 min break" })).toBeVisible();

  await card(page).getByRole("button", { name: "Start the 5 min break" }).click();
  await expect(card(page).getByText("A break is not recorded as study time.")).toBeVisible();
  await endsSoon(page);
  await expect(card(page).getByRole("button", { name: "Start the next focus session" })).toBeVisible({ timeout: 20_000 });
  expect(await sql(`SELECT 1 FROM "StudySession" WHERE "userId" IN ${ME} AND "recordedAt" > now() - interval '1 hour'`)).toHaveLength(0);

  await card(page).getByRole("button", { name: "Stop the round" }).click();
  await expect(chip(page)).toHaveCount(0);
});

test("on a phone the chip fits and its button is touch sized", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTask(page, `Phone ${Date.now()}`);
  await card(page).getByRole("button", { name: "Start" }).click();
  await page.goto("/notes");
  const pause = chip(page).getByRole("button", { name: "Pause" });
  await expect(pause).toBeVisible();
  const box = (await pause.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(36);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("looking at the timer is a GET: a page with no timer sends no POST, and the route refuses a signed-out caller", async ({ page, browser, baseURL }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.goto("/notes");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1000);
  expect(posts).toEqual([]);

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await stranger.request.get(`${baseURL}/api/focus-timer`);
  expect(response.status()).toBe(401);
  await stranger.close();
});
