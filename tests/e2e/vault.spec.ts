import { test, expect } from "@playwright/test";
import { openZip } from "@/lib/zip";

/**
 * The vault, end to end: no model is involved. What is inside a vault is checked against the
 * database in `tests/integration/vault-export.test.ts` and what an import does in
 * `vault-import.test.ts`; this is what only a browser and a server can show: who may ask, how a
 * download is delivered, what the person is told, and the import form itself.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
const main = (page: import("@playwright/test").Page) => page.locator("main");

test("signed out, the vault download is refused and the body holds no data", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const response = await anonymous.get("/api/export/vault");
  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.data).toBeNull();
  expect(body.error.code).toBe("AUTH_REQUIRED");
  await anonymous.dispose();
});

test("signed in, the vault is a zip attachment kept out of caches, and it holds the note and its links", async ({ page }) => {
  const title = `Vault note ${Date.now()}`;
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', `Links to [[${title} target]] and nothing else.`);
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  const response = await page.request.get("/api/export/vault");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/zip");
  expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="anamnesis-vault-\d{4}-\d{2}-\d{2}\.zip"$/);
  expect(response.headers()["cache-control"]).toContain("no-store");

  const bytes = await response.body();
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  const zip = openZip(bytes);
  const entry = zip.entries.find((e) => e.name === `${title}.md`);
  expect(entry, "the note's file").toBeTruthy();
  const text = (await zip.read(entry!)).toString("utf8");
  expect(text).toContain(`title: ${JSON.stringify(title)}`);
  expect(text).toContain(`Links to [[${title} target]] and nothing else.`);
  const manifest = JSON.parse((await zip.read(zip.entries.find((e) => e.name === ".anamnesis/manifest.json")!)).toString("utf8"));
  expect(manifest.formatVersion).toBe(1);
  expect(manifest.notes).toBeGreaterThanOrEqual(1);
  for (const e of zip.entries) expect(e.name.startsWith("/") || e.name.includes("..")).toBe(false);
});

test("settings offers the vault, and says what it holds and leaves out, before the click", async ({ page }) => {
  await page.goto("/settings");
  await expect(main(page).getByRole("link", { name: "Download my notes as a Markdown vault (.zip)" })).toBeVisible();
  await expect(main(page)).toContainText("Only notes and their attachments are in it");
  await expect(main(page).getByRole("link", { name: "Import notes" })).toHaveAttribute("href", "/notes/import");
});
