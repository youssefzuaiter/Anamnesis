import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** The weekly review (ROADMAP item 31): read-only, plain queries, no model. */

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows;
  } finally {
    await client.end();
  }
}
const me = async (): Promise<string> =>
  (await sql(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id as string;

const made: { goals: string[]; tasks: string[] } = { goals: [], tasks: [] };
test.afterEach(async () => {
  if (made.tasks.length) await sql(`DELETE FROM "Task" WHERE "id" = ANY($1::text[])`, [made.tasks.splice(0)]);
  if (made.goals.length) await sql(`DELETE FROM "Goal" WHERE "id" = ANY($1::text[])`, [made.goals.splice(0)]);
});

test("the review shows goals moved, without any model summary", async ({ page }) => {
  const goal = `Read widely ${randomUUID().slice(0, 6)}`;
  const goalId = randomUUID();
  await sql(`INSERT INTO "Goal" ("id","userId","title","category","progress","updatedAt") VALUES ($1,$2,$3,'career',40,now())`, [goalId, await me(), goal]);
  made.goals.push(goalId);
  const taskId = randomUUID();
  await sql(
    `INSERT INTO "Task" ("id","userId","title","status","completedAt","goalId","updatedAt") VALUES ($1,$2,$3,'done',now() - interval '1 day',$4,now())`,
    [taskId, await me(), `Chapter ${goal}`, goalId],
  );
  made.tasks.push(taskId);

  await page.goto("/review");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Weekly review" })).toBeVisible();
  for (const heading of ["Goals moved", "Courses", "Assessments due next week"]) {
    await expect(main.getByText(new RegExp(`^${heading} · \\d+$`))).toBeVisible();
  }
  await expect(main.getByRole("link", { name: goal, exact: true })).toBeVisible();
  await expect(main.getByText("1 done · 40%")).toBeVisible();
  await expect(main.getByRole("button", { name: /summar/i })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the review fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/review");
    await expect(page.locator("main").getByRole("heading", { name: "Weekly review" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
