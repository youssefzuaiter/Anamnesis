import { test, expect, type Page } from "@playwright/test";

/**
 * The web clipper in a browser. A real public page is never fetched in CI, so this covers what only a
 * browser and the server together show: the card, a link the server refuses before any request, and
 * nothing being created. The fetch, the guard and the note itself are tested in
 * tests/integration/safe-fetch.test.ts and clip.test.ts.
 */

const main = (page: Page) => page.locator("main");
const field = (page: Page) => main(page).getByLabel("Link to a web page");
const clip = (page: Page) => main(page).getByRole("button", { name: "Clip page" });

test("a link to this machine or its network is refused with a reason, and nothing is created", async ({ page }) => {
  await page.goto("/notes/import");
  for (const url of ["http://127.0.0.1:3100/api/health", "http://localhost:3100/", "http://192.168.1.1/", "http://[::1]/"]) {
    await field(page).fill(url);
    await clip(page).click();
    await expect(main(page).getByRole("alert")).toHaveText("That address is not reachable from this server.");
    await expect(page).toHaveURL(/\/notes\/import$/);
  }
});

test("a link that is not http(s) is refused by the server", async ({ page }) => {
  await page.goto("/notes/import");
  await field(page).fill("ftp://example.com/file");
  await clip(page).click();
  await expect(main(page).getByRole("alert")).toHaveText("Use an http(s) link.");
  await expect(page).toHaveURL(/\/notes\/import$/);
});

test("text that is not a link never reaches the server", async ({ page }) => {
  await page.goto("/notes/import");
  await field(page).fill("not a link");
  await clip(page).click();
  expect(await field(page).evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await expect(main(page).getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes\/import$/);
});

test("on a phone the card fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/notes/import");
  await expect(field(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await clip(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
