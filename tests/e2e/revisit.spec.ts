import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** Notes that come back (ROADMAP item 32): one older note on the dashboard, read only. */

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

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await sql(`DELETE FROM "Note" WHERE "id" = ANY($1::text[])`, [made.splice(0)]);
});

test("the dashboard offers a note from this day two years ago, and says so", async ({ page }) => {
  const id = randomUUID();
  const title = `Two years ago ${id.slice(0, 6)}`;
  const today = new Date();
  // Local time, as the server reads it: the same calendar day, two years earlier.
  const when = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate(), 12, 0);
  await sql(
    `INSERT INTO "Note" ("id","userId","title","content","tags","updatedAt") VALUES ($1,$2,$3,'Written then.','{}',$4)`,
    [id, await me(), title, when],
  );
  made.push(id);
  await page.goto("/");
  const card = page.locator("main").getByRole("region", { name: "Come back to" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link").first()).toBeVisible();
  await expect(card).toContainText("On this day, 2 years ago");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the dashboard's revisit card fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("main").getByRole("heading", { name: /Good|Today/ }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
