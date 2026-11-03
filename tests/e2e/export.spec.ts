import { test, expect } from "@playwright/test";

/**
 * The download, end to end: no model is involved. The file's contents are checked against the
 * database in `tests/integration/export.test.ts`; this is what only a browser and a server can
 * show: who may ask, how it is delivered, and what the person is told before they click.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
const main = (page: import("@playwright/test").Page) => page.locator("main");

test("signed out, the export is refused and the body holds no data", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const response = await anonymous.get("/api/export");
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.data).toBeNull();
  expect(body.error.code).toBe("AUTH_REQUIRED");
  for (const key of ["user", "notes", "formatVersion", "calendarSubscriptions"]) expect(body).not.toHaveProperty(key);
  await anonymous.dispose();
});

test("signed in, the download is a JSON attachment kept out of caches, and it holds what the app holds", async ({ page }) => {
  const title = `Export note ${Date.now()}`;
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "A note the export must carry.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  const response = await page.request.get("/api/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="[^"]+\.json"$/);
  expect(response.headers()["cache-control"]).toContain("no-store");

  const file = await response.json(); // a streamed body must still be one valid JSON document
  expect(file.formatVersion).toBe(2);
  expect(Object.keys(file.notIncluded)).toEqual(
    expect.arrayContaining(["attachmentFiles", "calendarFeedUrls", "deletedItems", "searchIndex", "signInPassword"]),
  );
  expect(file.notes.some((note: { title: string }) => note.title === title)).toBe(true);
  expect(file.user.email).toMatch(/^e2e-/);
  expect(file.user).not.toHaveProperty("passwordHash");
  for (const key of ["courses", "assessments", "flashcards", "noteVersions", "conversations", "messages", "attachments", "calendarSubscriptions"]) {
    expect(Array.isArray(file[key]), key).toBe(true);
  }
});

test("settings says what the download holds and what it leaves out, before the click", async ({ page }) => {
  await page.goto("/settings");
  await expect(main(page).getByRole("link", { name: "Download my data as JSON" })).toBeVisible();
  await expect(main(page)).toContainText("Attachment files and calendar feed addresses are not in the file");
  await expect(main(page)).toContainText("deleted items");
});
