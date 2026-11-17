import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Weekly goals on Stats and Today (ROADMAP item 44): add, change, remove, how far this week is, the recorder note, and a phone. No model. */

const main = (page: Page) => page.locator("main");
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

// The account is shared by every spec in a run, and a task finished (even one deleted since) counts for the week, so a count cannot be assumed to start
// at zero. Cards reviewed come from a log these tests can clear, so they are the measure whose count is known.
test.beforeEach(async () => {
  await sql(`DELETE FROM "CardReview" WHERE "userId" IN ${ME}`);
});

test.afterEach(async () => {
  await sql(`DELETE FROM "WeeklyGoal" WHERE "userId" IN ${ME}`);
  await sql(`DELETE FROM "Task" WHERE "userId" IN ${ME} AND title LIKE 'WG %'`);
  await sql(`DELETE FROM "CardReview" WHERE "userId" IN ${ME}`);
});

const section = (page: Page) => main(page).getByRole("region", { name: "Weekly goals" });
const seedReviews = async (n: number) => {
  for (let i = 0; i < n; i++) await sql(`INSERT INTO "CardReview" (id, "userId", grade, "reviewedAt") VALUES (gen_random_uuid()::text, ${ME}, 'good', now())`);
};

test("with no goals the section says so, and a goal is added from the form with its sentence", async ({ page }) => {
  await page.goto("/stats");
  await expect(section(page)).toContainText("No weekly goals yet");
  await section(page).getByRole("button", { name: "Add a goal" }).click();
  await section(page).getByLabel("What to count").selectOption("cards_reviewed");
  await expect(section(page).getByLabel("Each week")).toHaveValue("50");
  await section(page).getByLabel("Each week").fill("2");
  await expect(section(page)).toContainText("2 cards reviewed every week, Monday to Sunday.");
  await section(page).getByRole("button", { name: "Add goal" }).click();

  const bar = section(page).getByRole("img", { name: "0 of 2, 2 to go" });
  await expect(bar).toBeVisible();
  await expect(section(page)).toContainText("2 cards reviewed");
  await expect(section(page).getByLabel("What to count")).toHaveCount(0);
  expect((await sql(`SELECT measure, target FROM "WeeklyGoal" WHERE "userId" IN ${ME}`))).toEqual([{ measure: "cards_reviewed", target: 2 }]);

  await section(page).getByRole("button", { name: "Add a goal" }).click();
  await expect(section(page).getByLabel("What to count").locator("option")).toHaveText(["Study sessions", "Minutes studied", "Tasks finished", "Notes written"]);
});

test("this week's count follows what the app records, and reaching the target says so in words", async ({ page }) => {
  await sql(`INSERT INTO "WeeklyGoal" (id, "userId", measure, target, "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, 'cards_reviewed', 2, now())`);
  await seedReviews(1);
  await page.goto("/stats");
  await expect(section(page).getByRole("img", { name: "1 of 2, 1 to go" })).toBeVisible();
  await seedReviews(2);
  await page.reload();
  await expect(section(page).getByRole("img", { name: "3 of 2, reached" })).toBeVisible();
  await expect(section(page)).toContainText("Reached");
  await expect(section(page)).toContainText("Last 8 weeks");
  await expect(section(page)).toContainText("reached 0 of 8");
});

test("a target can be changed, an invalid one cannot be saved, and a goal can be removed", async ({ page }) => {
  await sql(`INSERT INTO "WeeklyGoal" (id, "userId", measure, target, "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, 'cards_reviewed', 50, now())`);
  await page.goto("/stats");
  await section(page).getByRole("button", { name: "Change target" }).click();
  const input = section(page).getByLabel("Target", { exact: true });
  for (const bad of ["0", "1000", "2.5", "abc", ""]) {
    await input.fill(bad);
    await expect(section(page).getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(section(page)).toContainText("A whole number from 1 to 999.");
  }
  await input.fill("80");
  await section(page).getByRole("button", { name: "Save" }).click();
  await expect(section(page)).toContainText("80 cards reviewed");
  expect((await sql(`SELECT target FROM "WeeklyGoal" WHERE "userId" IN ${ME}`))[0]).toEqual({ target: 80 });

  await section(page).getByRole("button", { name: "Remove the goal 80 cards reviewed" }).click();
  await expect(section(page)).toContainText("No weekly goals yet");
  expect((await sql(`SELECT 1 FROM "WeeklyGoal" WHERE "userId" IN ${ME}`)).length).toBe(0);
});

test("a study goal says when timer sessions are not being remembered", async ({ page }) => {
  await page.goto("/stats");
  await section(page).getByRole("button", { name: "Add a goal" }).click();
  await expect(section(page).getByLabel("What to count")).toHaveValue("study_sessions");
  await expect(section(page)).toContainText("Timer sessions are not being remembered");
  await expect(section(page).getByRole("link", { name: "Turn it on in Focus" })).toHaveAttribute("href", "/focus");
  await section(page).getByLabel("What to count").selectOption("cards_reviewed");
  await expect(section(page)).not.toContainText("Timer sessions are not being remembered");
});

test("Today shows this week's goals only once there is one, and links to them", async ({ page }) => {
  // Today keeps its onboarding message while the workspace is empty, so give it one open task.
  await sql(`INSERT INTO "Task" (id, "userId", title, status, priority, tags, "estimatedMinutes", "dueDate", "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, 'WG open', 'todo', 'low', '{}', 30, now(), now())`);
  await page.goto("/");
  await expect(main(page).getByRole("region", { name: "This week" })).toHaveCount(0);
  await sql(`INSERT INTO "WeeklyGoal" (id, "userId", measure, target, "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, 'notes_written', 3, now())`);
  await page.goto("/");
  const card = main(page).getByRole("region", { name: "This week" });
  await expect(card).toContainText("3 notes written");
  await expect(card.getByRole("link", { name: "All goals" })).toHaveAttribute("href", "/stats#weekly-goals");
});

test("on a phone the section fits and its controls are touch sized", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await sql(`INSERT INTO "WeeklyGoal" (id, "userId", measure, target, "updatedAt") VALUES (gen_random_uuid()::text, ${ME}, 'cards_reviewed', 50, now())`);
  await page.goto("/stats");
  for (const name of ["Add a goal", "Change target", "Remove the goal 50 cards reviewed"]) {
    expect((await section(page).getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await section(page).getByRole("button", { name: "Add a goal" }).click();
  for (const label of ["What to count", "Each week"]) expect((await section(page).getByLabel(label).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
