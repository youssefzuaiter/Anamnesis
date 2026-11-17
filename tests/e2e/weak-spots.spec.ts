import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** The weak-spots deck on the Cards page (ROADMAP item 42): seeded straight into the review log so the days are exact. */

const main = (page: Page) => page.locator("main");
const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local')`;
async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}

test.afterEach(async () => {
  await sql(`DELETE FROM "Flashcard" WHERE "userId" IN ${ME}`);
  await sql(`DELETE FROM "CardReview" WHERE "userId" IN ${ME}`);
});

async function seedCard(question: string, grades: [string, number][]): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "Flashcard" (id, "userId", question, answer, "dueAt") VALUES (gen_random_uuid()::text, ${ME}, $1, 'the answer', now() + interval '10 days') RETURNING id`,
    [question],
  );
  for (const [grade, daysAgo] of grades) {
    await sql(`INSERT INTO "CardReview" (id, "userId", "cardId", grade, "reviewedAt") VALUES (gen_random_uuid()::text, ${ME}, $1, $2, now() - ($3 || ' days')::interval)`, [row.id, grade, String(daysAgo)]);
  }
  return row.id;
}

test("no weak cards means no Weak spots deck", async ({ page }) => {
  await seedCard("Fine card", [["again", 2], ["good", 1]]);
  await page.goto("/cards");
  await expect(main(page).getByRole("navigation", { name: "Decks" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: /Weak spots/ })).toHaveCount(0);
});

test("a card failed twice is in the Weak spots deck even though it is not due, and grading it is an ordinary review", async ({ page }) => {
  await seedCard("Weak question", [["again", 4], ["again", 2]]);
  await seedCard("Strong question", [["again", 3], ["good", 2]]);

  await page.goto("/cards");
  await expect(main(page).getByRole("link", { name: /Weak spots/ })).toContainText("1 card");
  await main(page).getByRole("link", { name: /Weak spots/ }).click();
  await expect(page).toHaveURL(/weak=1/);
  await expect(main(page).getByRole("link", { name: /Weak spots/ })).toHaveAttribute("aria-current", "page");
  await expect(main(page)).toContainText("Weak question");
  await expect(main(page)).not.toContainText("Strong question");
  await expect(main(page)).toContainText("1 card you got wrong at least twice");
  await expect(main(page).getByText("1 of 1", { exact: true })).toBeVisible();

  await main(page).getByRole("button", { name: /show answer/i }).click();
  await main(page).getByRole("button", { name: "Good" }).click();
  await expect.poll(async () => (await sql(`SELECT 1 FROM "CardReview" WHERE "userId" IN ${ME} AND grade = 'good'`)).length).toBe(2);
});

test("on a phone the deck chip fits and is touch sized", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedCard("Weak question", [["again", 4], ["again", 2]]);
  await page.goto("/cards");
  const chip = main(page).getByRole("link", { name: /Weak spots/ });
  await expect(chip).toBeVisible();
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
