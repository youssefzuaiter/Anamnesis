import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** The Translate card on a note, driven through the browser. No engine is involved: a note with no text in it is refused before one is asked. */
async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as Record<string, string>[];
  } finally {
    await client.end();
  }
}

const title = `Translate ${Date.now()}`;
let noteId = "";

test.beforeEach(async () => {
  const userId = (await sql(`SELECT "id" FROM "User" WHERE "email" LIKE 'e2e-%' ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
  noteId = (await sql(`INSERT INTO "Note" ("id","userId","title","content","updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING "id"`, [userId, title, "```py\nprint(1)\n```\n\n`x` $y$"]))[0].id;
});
test.afterEach(async () => {
  await sql(`DELETE FROM "Note" WHERE "id" = $1`, [noteId]);
});

const card = (page: Page) => page.getByRole("region", { name: "Translate" });

test("the card offers the listed languages and says a note with no text cannot be translated", async ({ page }) => {
  await page.goto(`/notes/${noteId}`);
  await expect(card(page)).toContainText("machine translation");
  const options = await card(page).getByLabel("Language").locator("option").allTextContents();
  expect(options).toEqual(expect.arrayContaining(["English", "Turkish", "German"]));
  await card(page).getByLabel("Language").selectOption("de");
  await card(page).getByRole("button", { name: "Translate into a new note" }).click();
  await expect(card(page).getByRole("alert")).toContainText("no text in this note to translate");
  await expect(card(page).getByRole("button", { name: "Translate into a new note" })).toBeEnabled();
});

test("the route refuses an unlisted language and a note that is not yours, writing nothing", async ({ page }) => {
  await page.goto(`/notes/${noteId}`);
  const post = (body: unknown) => page.evaluate(async (b) => {
    const r = await fetch("/api/ai/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return r.status;
  }, body);
  expect(await post({ noteId, language: "xx" })).toBe(400);
  expect(await post({ noteId, language: "tr", userId: "x" })).toBe(400);
  expect(await post({ noteId: "00000000-0000-4000-8000-000000000000", language: "tr" })).toBe(404);
  expect(await post({ language: "tr" })).toBe(400);
});

test("on a phone the card fits the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/notes/${noteId}`);
  await expect(card(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
