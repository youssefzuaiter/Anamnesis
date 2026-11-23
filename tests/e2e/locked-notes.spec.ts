import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Locking a note and opening it again, driven through the browser. The note is made by SQL for the run's account and removed after each test. */
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
const title = `Locked ${stamp}`;
const SECRET = `the launch code is swordfish ${stamp}`;
const PW = "correct horse battery";
let noteId = "";

test.beforeEach(async () => {
  const userId = (await sql(`SELECT "id" FROM "User" WHERE "email" LIKE 'e2e-%' ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
  noteId = (await sql(`INSERT INTO "Note" ("id","userId","title","content","updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING "id"`, [userId, title, `# Plans\n\n${SECRET}`]))[0].id;
});
test.afterEach(async () => {
  await sql(`DELETE FROM "Note" WHERE "id" = $1`, [noteId]);
});

const lockCard = (page: Page) => page.getByRole("region", { name: "Lock", exact: true });
const main = (page: Page) => page.locator("main");

async function lockIt(page: Page): Promise<string> {
  await page.goto(`/notes/${noteId}`);
  await lockCard(page).getByLabel("Password", { exact: true }).fill(PW);
  await lockCard(page).getByLabel("Password again").fill(PW);
  await lockCard(page).getByRole("button", { name: "Lock this note" }).click();
  const key = (await page.getByTestId("recovery-key").innerText()).trim();
  await page.getByLabel("I have saved the recovery key").check();
  await page.getByRole("button", { name: "Done" }).click();
  return key;
}

test("lock a note, see its recovery key once, and find the database holding no plaintext", async ({ page }) => {
  const key = await lockIt(page);
  expect(key).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(main(page)).not.toContainText(SECRET);
  const row = (await sql(`SELECT "content","locked" FROM "Note" WHERE "id" = $1`, [noteId]))[0];
  expect(String(row.locked)).toBe("true");
  expect(row.content).not.toContain("swordfish");
  expect(row.content.startsWith("nxl1:")).toBe(true);
  await page.goto("/notes");
  await expect(main(page)).toContainText("Locked. Open it and enter its password");
  await expect(main(page)).not.toContainText("swordfish");
});

test("a wrong password does not open it; the right one does, stays open on reload, in an httpOnly cookie, and Lock now closes it", async ({ page, context }) => {
  await lockIt(page);
  await page.getByLabel("Password or recovery key").fill("not the password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page).getByRole("alert")).toContainText("not the right password");
  await page.getByLabel("Password or recovery key").fill(PW);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page)).toContainText(SECRET);
  await page.reload();
  await expect(main(page)).toContainText(SECRET);
  const cookie = (await context.cookies()).find((c) => c.name === `nxu_${noteId}`);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect(cookie?.value).not.toContain(SECRET);
  await page.getByRole("button", { name: "Lock now" }).click();
  await expect(page.getByLabel("Password or recovery key")).toBeVisible();
  await expect(main(page)).not.toContainText(SECRET);
});

test("the recovery key opens it; an edit is saved encrypted; removing the lock gives the text back", async ({ page }) => {
  const key = await lockIt(page);
  await page.getByLabel("Password or recovery key").fill(key);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page)).toContainText(SECRET);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Text").fill(`${SECRET}\n\nand the hunter2 password`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(main(page)).toContainText("hunter2");
  expect((await sql(`SELECT "content" FROM "Note" WHERE "id" = $1`, [noteId]))[0].content).not.toContain("hunter2");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remove the lock" }).click();
  await expect(page.getByRole("button", { name: "Lock this note" })).toBeVisible();
  expect((await sql(`SELECT "content","locked" FROM "Note" WHERE "id" = $1`, [noteId]))[0].content).toContain("hunter2");
});

test("a note with an attached file cannot be locked, and says why", async ({ page }) => {
  await sql(`INSERT INTO "Attachment" ("id","userId","noteId","filename","mimeType","byteSize","storageKey") SELECT gen_random_uuid(), "userId", "id", 'a.png', 'image/png', 1, $2 FROM "Note" WHERE "id" = $1`, [noteId, `e2e-${stamp}`]);
  await page.goto(`/notes/${noteId}`);
  await expect(lockCard(page)).toContainText("attached files, which are not encrypted");
  await expect(lockCard(page).getByRole("button", { name: "Lock this note" })).toHaveCount(0);
});

test("on a phone the lock card and the unlock page fit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/notes/${noteId}`);
  await expect(lockCard(page)).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await fits()).toBeLessThanOrEqual(0);
  await lockIt(page);
  await expect(page.getByLabel("Password or recovery key")).toBeVisible();
  expect(await fits()).toBeLessThanOrEqual(0);
});

test("the lock card can make a strong password and fill both fields with it, and that password locks the note", async ({ page }) => {
  await page.goto(`/notes/${noteId}`);
  const card = lockCard(page);
  await card.getByText("Make a strong password").click();
  await card.getByRole("button", { name: "Make one" }).click();
  const made = await card.getByLabel("Result").inputValue();
  expect(made.length).toBeGreaterThanOrEqual(10);
  await card.getByRole("button", { name: "Use this" }).click();
  await expect(card.getByLabel("Password", { exact: true })).toHaveValue(made);
  await expect(card.getByLabel("Password again")).toHaveValue(made);
  await card.getByRole("button", { name: "Lock this note" }).click();
  await page.getByTestId("recovery-key").waitFor();
  await page.getByLabel("I have saved the recovery key").check();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Password or recovery key").fill(made);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page)).toContainText(SECRET);
});
