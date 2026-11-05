import { test, expect } from "@playwright/test";
import { ZipWriter, openZip } from "@/lib/zip";
import { noteFile } from "@/lib/vault";

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

// --- Importing a vault --------------------------------------------------------------------------

type Page = import("@playwright/test").Page;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const when = new Date("2026-10-01T09:00:00Z");

/** A vault in the exporter's own format; one short line per note, so each save is one embedding chunk. */
async function vaultZip(notes: { title: string; content: string; attachments?: string[] }[], files: { name: string; data: Buffer }[] = []): Promise<Buffer> {
  const writer = new ZipWriter();
  const parts: Buffer[] = [];
  for (const note of notes) {
    const text = noteFile(
      { title: note.title, content: note.content, tags: ["vault-e2e"], isFavorite: false, createdAt: when, updatedAt: when },
      { course: null, project: null, attachments: note.attachments ?? [] },
    );
    parts.push(await writer.add({ name: `${note.title}.md`, data: Buffer.from(text), modified: when }));
  }
  for (const file of files) parts.push(await writer.add({ name: file.name, data: file.data, modified: when, store: true }));
  parts.push(writer.finish());
  return Buffer.concat(parts);
}

const choose = (page: Page, buffer: Buffer, name = "vault.zip") => page.getByLabel("Vault zip").setInputFiles({ name, mimeType: "application/zip", buffer });

/** How many entries of the account's vault have this exact title as their file name. */
async function inVault(page: Page, title: string): Promise<number> {
  const zip = openZip(await (await page.request.get("/api/export/vault")).body());
  return zip.entries.filter((e) => e.name === `${title}.md` || e.name.startsWith(`${title} (`)).length;
}

test("the import page offers the vault form, and Check is off until a file is chosen", async ({ page }) => {
  await page.goto("/notes/import");
  await expect(main(page).getByLabel("Vault zip")).toBeVisible();
  await expect(main(page).getByLabel("Markdown files")).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Check the file" })).toBeDisabled();
  await expect(main(page)).toContainText("You see what would happen before anything is saved");
});

test("a vault is checked first, then imported, and importing it again adds nothing", async ({ page }) => {
  const stamp = Date.now();
  const titles = [`Vault A ${stamp}`, `Vault B ${stamp}`, `Vault C ${stamp}`];
  const zip = await vaultZip(
    [
      { title: titles[0], content: `Points at [[${titles[1]}]].`, attachments: ["diagram.png"] },
      { title: titles[1], content: "Second." },
      { title: titles[2], content: "Third." },
    ],
    [{ name: "attachments/diagram.png", data: PNG }],
  );

  await page.goto("/notes/import");
  await choose(page, zip);
  await main(page).getByRole("button", { name: "Check the file" }).click();
  const status = main(page).getByRole("status");
  await expect(status).toContainText("This is what importing would do.");
  await expect(status).toContainText("Would add 3 notes");
  await expect(status).toContainText("Would store 1 attachment");
  await expect(status).toBeFocused();
  expect(await inVault(page, titles[0]), "a check saves nothing").toBe(0);

  await main(page).getByRole("button", { name: "Import 3 notes" }).click();
  await expect(status).toContainText("Imported 3 notes and 1 attachment.", { timeout: 30_000 });
  expect(await inVault(page, titles[0])).toBe(1);
  expect(await inVault(page, titles[2])).toBe(1);

  await main(page).getByRole("link", { name: "Open notes" }).click();
  await page.waitForURL(/\/notes$/);
  await main(page).getByRole("link", { name: new RegExp(titles[0]) }).first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(main(page)).toContainText("diagram.png");

  await page.goto("/notes/import");
  await choose(page, zip);
  await main(page).getByRole("button", { name: "Check the file" }).click();
  await expect(main(page).getByRole("status")).toContainText("There is nothing new to import.");
  await expect(main(page).getByRole("status")).toContainText("3 notes are already in your notes");
  await expect(main(page).getByRole("button", { name: /^Import \d/ })).toHaveCount(0);
});

test("a file that is not a zip is refused in a sentence, and the person can choose another", async ({ page }) => {
  await page.goto("/notes/import");
  await choose(page, Buffer.from("this is not a zip file at all"), "notes.zip");
  await main(page).getByRole("button", { name: "Check the file" }).click();
  await expect(main(page).getByRole("alert")).toContainText(/not a zip/i);
  await expect(main(page).getByRole("alert")).toBeFocused();
  await main(page).getByRole("button", { name: "Choose another file" }).click();
  await expect(main(page).getByRole("button", { name: "Check the file" })).toBeDisabled();
});

test("a double click on Import adds each note once", async ({ page }) => {
  const stamp = Date.now();
  const titles = [`Twice A ${stamp}`, `Twice B ${stamp}`];
  await page.goto("/notes/import");
  await choose(page, await vaultZip(titles.map((title) => ({ title, content: "once" }))));
  await main(page).getByRole("button", { name: "Check the file" }).click();
  await expect(main(page).getByRole("status")).toContainText("Would add 2 notes");
  await main(page).getByRole("button", { name: "Import 2 notes" }).dblclick();
  await expect(main(page).getByRole("status")).toContainText("Imported 2 notes", { timeout: 30_000 });
  for (const title of titles) expect(await inVault(page, title)).toBe(1);
});

test("the route refuses what it should: signed out, another site, no mode, no body", async ({ page, playwright, baseURL }) => {
  const zip = await vaultZip([{ title: `Route ${Date.now()}`, content: "x" }]);
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const signedOut = await anonymous.post("/api/import/vault?mode=preview", { data: zip, headers: { "content-type": "application/zip" } });
  expect(signedOut.status()).toBe(401);
  expect((await signedOut.json()).data).toBeNull();
  await anonymous.dispose();

  const post = (query: string, headers: Record<string, string> = {}, data: Buffer = zip) =>
    page.request.post(`/api/import/vault${query}`, { data, headers: { "content-type": "application/zip", ...headers } });
  expect((await post("?mode=preview", { origin: "https://evil.example" })).status()).toBe(403);
  expect((await post("?mode=preview", { "sec-fetch-site": "cross-site" })).status()).toBe(403);
  expect((await post("?mode=import")).status()).toBe(400);
  expect((await post("")).status()).toBe(400);
  expect((await post("?mode=preview", {}, Buffer.alloc(0))).status()).toBe(400);

  const ok = await post("?mode=preview");
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.success).toBe(true);
  expect(body.data.apply).toBe(false);
  expect(body.data.notes.create).toBe(1);
  const notZip = await post("?mode=preview", {}, Buffer.from("nope"));
  expect(notZip.status()).toBe(400);
  expect((await notZip.json()).error.code).toBe("VALIDATION_ERROR");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the import form fits a phone, ${scheme}: a preview with every list has no sideways scroll`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const stamp = Date.now();
    const long = `A very long title that goes on and on so that a quoted rename wraps instead of widening the page ${stamp}`;
    const zip = await vaultZip(
      [
        { title: long, content: "one" },
        { title: `Linked ${stamp}`, content: "two", attachments: ["gone.png", "also-gone.pdf"] },
      ],
      [{ name: "attachments/unused.png", data: PNG }],
    );
    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/notes/import");
      await choose(page, zip);
      await main(page).getByRole("button", { name: "Check the file" }).click();
      await expect(main(page).getByRole("status")).toContainText("This is what importing would do.");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `sideways overflow at ${width}px in ${scheme}`).toBeLessThanOrEqual(0);
      const box = await main(page).getByRole("button", { name: /^Import \d/ }).boundingBox();
      expect(box?.height ?? 0, "a touch-sized button (44px)").toBeGreaterThanOrEqual(44);
    }
  });
}
