import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { TEST_PASSWORD } from "./test-account";

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

const lockDialog = (page: Page) => page.getByRole("dialog", { name: "Lock this note" });
const main = (page: Page) => page.locator("main");

async function openLock(page: Page) {
  await page.goto(`/notes/${noteId}`);
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(lockDialog(page)).toBeVisible();
}

/** Locks the note with a password of its own (the default is the sign-in password) and returns the recovery key. */
async function lockIt(page: Page, how: "own" | "account" = "own"): Promise<string> {
  await openLock(page);
  const dialog = lockDialog(page);
  if (how === "own") {
    await dialog.getByLabel("Use a different password for this note").check();
    await dialog.getByLabel("Password for this note", { exact: true }).fill(PW);
    await dialog.getByLabel("Password again").fill(PW);
  } else {
    await dialog.getByLabel("Your sign-in password").fill(TEST_PASSWORD);
  }
  await dialog.getByRole("button", { name: "Lock note" }).click();
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
  await expect(page.getByRole("button", { name: "Lock", exact: true })).toBeVisible();
  expect((await sql(`SELECT "content","locked" FROM "Note" WHERE "id" = $1`, [noteId]))[0].content).toContain("hunter2");
});

test("a note with an attached file cannot be locked, and says why", async ({ page }) => {
  await sql(`INSERT INTO "Attachment" ("id","userId","noteId","filename","mimeType","byteSize","storageKey") SELECT gen_random_uuid(), "userId", "id", 'a.png', 'image/png', 1, $2 FROM "Note" WHERE "id" = $1`, [noteId, `e2e-${stamp}`]);
  await openLock(page);
  await expect(lockDialog(page)).toContainText("attached files, which are not encrypted");
  await expect(lockDialog(page).getByRole("button", { name: "Lock note" })).toHaveCount(0);
});

test("on a phone the lock dialog and the lock screen fit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await openLock(page);
  const box = (await lockDialog(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await fits()).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await lockIt(page);
  await expect(page.getByLabel("Password or recovery key")).toBeVisible();
  expect(await fits()).toBeLessThanOrEqual(0);
});

test("the lock dialog can make a strong password and fill both fields with it, and that password locks the note", async ({ page }) => {
  await openLock(page);
  const dialog = lockDialog(page);
  await dialog.getByLabel("Use a different password for this note").check();
  await dialog.getByText("Make a strong password").click();
  await dialog.getByRole("button", { name: "Make one" }).click();
  const made = await dialog.getByLabel("Result").inputValue();
  expect(made.length).toBeGreaterThanOrEqual(10);
  await dialog.getByRole("button", { name: "Use this" }).click();
  await expect(dialog.getByLabel("Password for this note", { exact: true })).toHaveValue(made);
  await expect(dialog.getByLabel("Password again")).toHaveValue(made);
  await dialog.getByRole("button", { name: "Lock note" }).click();
  await page.getByTestId("recovery-key").waitFor();
  await page.getByLabel("I have saved the recovery key").check();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Password or recovery key", { exact: true }).fill(made);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page)).toContainText(SECRET);
});

test("the sign-in password is the default: a wrong one is refused and locks nothing, the right one locks the note and opens it, and the lock screen asks for it", async ({ page }) => {
  await openLock(page);
  const dialog = lockDialog(page);
  await expect(dialog.getByLabel("Use my sign-in password")).toBeChecked();
  await dialog.getByLabel("Your sign-in password").fill("not my password");
  await dialog.getByRole("button", { name: "Lock note" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not your sign-in password");
  expect((await sql(`SELECT "locked" FROM "Note" WHERE "id" = $1`, [noteId]))[0].locked).toBe(false);
  await page.keyboard.press("Escape");
  await lockIt(page, "account");
  await expect(main(page)).toContainText("This note is locked.");
  await expect(main(page)).toContainText("Enter your sign-in password to view this note.");
  await expect(main(page)).not.toContainText(SECRET);
  await page.getByLabel("Sign-in password or recovery key").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(main(page)).toContainText(SECRET);
});

test("a note locked with its own password says so on the lock screen, and the note list shows a lock", async ({ page }) => {
  await lockIt(page, "own");
  await expect(main(page)).toContainText("Enter this note's password to view it.");
  await page.goto("/notes");
  await expect(main(page).getByRole("link", { name: new RegExp(`Locked: ${title}`) })).toBeVisible();
});
