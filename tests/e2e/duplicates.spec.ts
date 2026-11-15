import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** Duplicate-note cleanup (ROADMAP item 36): the page, the confirmation, the merge, keep both, the phone. */

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

let stamp = "";
test.beforeEach(() => {
  stamp = `dp${randomUUID().slice(0, 6)}`;
});
test.afterEach(async () => {
  await sql(`DELETE FROM "Task" WHERE "title" LIKE $1`, [`%${stamp}%`]);
  await sql(`DELETE FROM "WorkspaceEmbedding" WHERE "sourceId" IN (SELECT "id" FROM "Note" WHERE "title" LIKE $1)`, [`%${stamp}%`]);
  await sql(`DELETE FROM "Note" WHERE "title" LIKE $1`, [`%${stamp}%`]);
});

const TEXT = (word: string) => `Gradient descent ${word} minimises a loss function by repeatedly stepping in the direction of the negative gradient with a learning rate.`;
async function pair(extra = "") {
  const user = await me();
  const ids: string[] = [];
  for (const [title, content] of [[`Gradient descent ${stamp}`, TEXT(stamp)], [`Gradient descent copy ${stamp}`, `${TEXT(stamp)}${extra}`]]) {
    const id = randomUUID();
    ids.push(id);
    await sql(`INSERT INTO "Note" ("id","userId","title","content","tags","updatedAt") VALUES ($1,$2,$3,$4,'{}',now())`, [id, user, title, content]);
  }
  return ids;
}
/** Stored vectors 0.97 alike, so a pair that is not word for word the same is found by meaning as it would be after indexing. */
async function vectors(userId: string, a: string, b: string) {
  const vec = (x: number, y: number) => `[${[x, y, ...new Array(766).fill(0)].join(",")}]`;
  for (const [id, literal] of [[a, vec(1, 0)], [b, vec(0.97, Math.sqrt(1 - 0.97 * 0.97))]]) {
    await sql(`INSERT INTO "WorkspaceEmbedding" ("id","userId","sourceType","sourceId","contentChunk","embedding") VALUES ($1,$2,'note',$3,'c',$4::vector)`, [randomUUID(), userId, id, literal]);
  }
}
const pairCard = (page: import("@playwright/test").Page) => page.getByRole("group", { name: new RegExp(`Gradient descent ${stamp}`) }).first();

test("a pair of identical notes is offered, merging asks first, then keeps one and trashes the other", async ({ page }) => {
  const [first, second] = await pair();
  await sql(`INSERT INTO "Task" ("id","userId","noteId","title","status","priority","tags","estimatedMinutes","updatedAt") VALUES ($1,$2,$3,$4,'todo','low','{}',30,now())`, [randomUUID(), await me(), second, `Task on copy ${stamp}`]);
  await page.goto("/notes/duplicates");
  const card = pairCard(page);
  await expect(card).toContainText("Same text");
  await expect(card).toContainText("identical wording");
  await card.getByRole("radio", { name: new RegExp(`Keep “Gradient descent ${stamp}”`) }).check();
  // Nothing changes before the confirmation.
  await card.getByRole("button", { name: /^Merge into/ }).click();
  await expect(card).toContainText("will go to the trash");
  expect((await sql(`SELECT "deletedAt" FROM "Note" WHERE "id" = $1`, [second]))[0].deletedAt).toBeNull();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: /^Merge into/ })).toBeVisible();
  await card.getByRole("button", { name: /^Merge into/ }).click();
  await card.getByRole("button", { name: "Merge now" }).click();
  await expect(card).toContainText("is in the trash");
  expect((await sql(`SELECT "deletedAt" FROM "Note" WHERE "id" = $1`, [second]))[0].deletedAt).not.toBeNull();
  expect((await sql(`SELECT "deletedAt" FROM "Note" WHERE "id" = $1`, [first]))[0].deletedAt).toBeNull();
  expect((await sql(`SELECT "noteId" FROM "Task" WHERE "title" = $1`, [`Task on copy ${stamp}`]))[0].noteId).toBe(first);
  await page.goto("/trash");
  await expect(page.locator("main")).toContainText(`Gradient descent copy ${stamp}`);
});

test("a paragraph only the other note has is added under a heading when the shorter note is kept", async ({ page }) => {
  const [shorter, longer] = await pair(`\n\nOnly the copy says this ${stamp}.`);
  await vectors(await me(), shorter, longer);
  await page.goto("/notes/duplicates");
  const card = pairCard(page);
  await expect(card).toContainText("Same text");
  // The longer note is suggested; keeping the shorter one would add its extra paragraph.
  await expect(card.getByRole("radio", { name: new RegExp(`Keep “Gradient descent copy ${stamp}”`) })).toBeChecked();
  await expect(card).toContainText("has 0 paragraphs".replace("has 0 paragraphs", "is already in"));
  await card.getByRole("radio", { name: new RegExp(`Keep “Gradient descent ${stamp}”`) }).check();
  await expect(card).toContainText("has 1 paragraph that");
  await card.getByRole("button", { name: /^Merge into/ }).click();
  await card.getByRole("button", { name: "Merge now" }).click();
  await expect(card).toContainText("1 paragraph was added");
  const kept = (await sql(`SELECT "content" FROM "Note" WHERE "id" = $1`, [shorter]))[0].content as string;
  expect(kept).toContain(`## Merged from Gradient descent copy ${stamp}`);
  expect(kept).toContain(`Only the copy says this ${stamp}.`);
  expect((await sql(`SELECT "deletedAt" FROM "Note" WHERE "id" = $1`, [longer]))[0].deletedAt).not.toBeNull();
});

test("keep both hides the pair for good", async ({ page }) => {
  await pair();
  await page.goto("/notes/duplicates");
  const card = pairCard(page);
  await card.getByRole("button", { name: "Keep both" }).click();
  await expect(card).toContainText("will not be offered again");
  await page.reload();
  await expect(pairCard(page)).toHaveCount(0);
});

test("a note changed since the page was shown is not merged", async ({ page }) => {
  const [first, second] = await pair();
  await page.goto("/notes/duplicates");
  const card = pairCard(page);
  await expect(card).toBeVisible();
  await sql(`UPDATE "Note" SET "content" = $1, "updatedAt" = now() + interval '1 minute' WHERE "id" = $2`, [`${TEXT(stamp)} edited`, second]);
  await card.getByRole("button", { name: /^Merge into/ }).click();
  await card.getByRole("button", { name: "Merge now" }).click();
  await expect(card.getByRole("group", { name: "Problem" })).toContainText("changed since");
  expect((await sql(`SELECT "deletedAt" FROM "Note" WHERE "id" = $1`, [second]))[0].deletedAt).toBeNull();
  void first;
});

for (const scheme of ["light", "dark"] as const) {
  test(`the page fits a phone in the ${scheme} theme, with touch-sized buttons`, async ({ page }) => {
    await pair();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), scheme);
    await page.goto("/notes/duplicates");
    await expect(pairCard(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const heights = await pairCard(page).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await page.goto("/notes");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
