import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * Summarise a note: the card, and who may ask. What the model writes is measured in the evals
 * ("Summaries"); the summary itself, its grounding and the proposal are tested in
 * tests/integration/summary.test.ts with a scripted model. No test here waits on the model.
 */

const main = (page: Page) => page.locator("main");

async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}
const me = async () =>
  (await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id;

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await sql(`DELETE FROM "Note" WHERE "id" = ANY($1::text[])`, [made.splice(0)]);
});

async function myNote(title: string, content: string) {
  const id = randomUUID();
  await sql(`INSERT INTO "Note" ("id", "userId", "title", "content", "tags", "updatedAt") VALUES ($1, $2, $3, $4, '{}', now())`, [id, await me(), title, content]);
  made.push(id);
  return id;
}

test("a note offers to be summarised into a new note, said plainly", async ({ page }) => {
  const id = await myNote(`Summarise me ${randomUUID().slice(0, 6)}`, "Gradient descent moves the weights against the gradient.");
  await page.goto(`/notes/${id}`);
  const card = main(page).getByRole("region", { name: "Summary" });
  await expect(card).toContainText("You read it before anything is saved.");
  await expect(card.getByRole("button", { name: "Summarise into a new note" })).toBeEnabled();
});

test("the summary route refuses another account's note, a made-up id, bad input, and no session", async ({ page, playwright, baseURL }) => {
  const stranger = (await sql<{ id: string }>(`INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, 'x', now()) RETURNING "id"`, [randomUUID(), `summary-stranger-${randomUUID()}@test.local`]))[0].id;
  const theirs = randomUUID();
  await sql(`INSERT INTO "Note" ("id", "userId", "title", "content", "tags", "updatedAt") VALUES ($1, $2, 'Their secret', 'Secret research text.', '{}', now())`, [theirs, stranger]);
  try {
    for (const noteId of [theirs, randomUUID()]) {
      const response = await page.request.post("/api/ai/summarise", { data: { noteId } });
      expect(response.status(), noteId).toBe(404);
      expect(await response.text()).not.toContain("Secret");
    }
    for (const data of [{ noteId: "not-a-uuid" }, { noteId: theirs, userId: stranger }, {}]) {
      expect((await page.request.post("/api/ai/summarise", { data })).status(), JSON.stringify(data)).toBe(400);
    }
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    expect((await anonymous.post("/api/ai/summarise", { data: { noteId: theirs } })).status()).toBe(401);
    await anonymous.dispose();
  } finally {
    await sql(`DELETE FROM "User" WHERE "id" = $1`, [stranger]);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`the card fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await myNote("A note on a phone", "Short text to summarise.");
    await page.goto(`/notes/${id}`);
    await expect(main(page).getByRole("button", { name: "Summarise into a new note" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
