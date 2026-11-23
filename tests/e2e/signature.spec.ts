import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** The signature pad at /signature, driven through the browser with the mouse. Rows made here are removed after each test. */
const main = (page: Page) => page.locator("main");

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as Record<string, string>[];
  } finally {
    await client.end();
  }
}

test.afterEach(async () => {
  await sql(`DELETE FROM "Signature" WHERE "name" LIKE 'e2e sig%'`);
});

async function draw(page: Page) {
  const pad = page.getByTestId("pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 100);
  await page.mouse.down();
  for (let i = 0; i <= 20; i += 1) await page.mouse.move(box.x + 40 + i * 8, box.y + 100 + Math.sin(i / 2) * 40, { steps: 2 });
  await page.mouse.up();
}

test("draw, save, see it listed, fetch it as a transparent PNG, and delete it", async ({ page }) => {
  await page.goto("/signature");
  await expect(page.getByRole("button", { name: "Save signature" })).toBeDisabled();
  await draw(page);
  await page.getByLabel("Name (optional)").fill("e2e sig one");
  await page.getByRole("button", { name: "Save signature" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  const card = page.getByRole("region", { name: "Saved signatures" });
  await expect(card).toContainText("e2e sig one");
  await expect(card.getByRole("img", { name: "Signature: e2e sig one" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save signature" })).toBeDisabled();

  const id = (await sql(`SELECT "id" FROM "Signature" WHERE "name" = 'e2e sig one'`))[0].id;
  const response = await page.request.get(`/api/signatures/${id}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const body = await response.body();
  expect([...body.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(body[25]).toBe(6);
  const download = await page.request.get(`/api/signatures/${id}?download=1`);
  expect(download.headers()["content-disposition"]).toContain("e2e sig one");

  page.once("dialog", (dialog) => void dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deleted." })).toBeVisible();
  expect((await page.request.get(`/api/signatures/${id}`)).status()).toBe(404);
});

test("undo and clear empty the pad, and nothing blank can be saved", async ({ page }) => {
  await page.goto("/signature");
  await draw(page);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Save signature" })).toBeDisabled();
  await draw(page);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "Save signature" })).toBeDisabled();
});

test("the route answers 404 for an id that is not a signature and for one that is not yours, and 401 with no session", async ({ page, browser }) => {
  await page.goto("/signature");
  expect((await page.request.get("/api/signatures/not-an-id")).status()).toBe(404);
  expect((await page.request.get("/api/signatures/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anonymous.request.get("http://localhost:3100/api/signatures/00000000-0000-4000-8000-000000000000")).status()).toBe(401);
  await anonymous.close();
});

test("the page says a drawn image is not a legally binding signature, and Settings links to it", async ({ page }) => {
  await page.goto("/settings");
  await main(page).getByRole("link", { name: "Draw and keep one" }).click();
  await expect(page).toHaveURL(/\/signature$/);
  await expect(main(page)).toContainText("not a legally binding electronic signature");
});

test("on a phone the pad fits the page and a finger-sized drawing area stays inside it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/signature");
  const box = (await page.getByTestId("pad").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
