import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { TEST_PASSWORD } from "./test-account";

/**
 * Sharing a page in: /share only redirects, to the clip card with the link filled in, through sign-in
 * when needed. Nothing is fetched or created until Clip page is pressed, so no test here presses it.
 */

const main = (page: Page) => page.locator("main");
const field = (page: Page) => main(page).getByLabel("Link to a web page");
const noteCount = async (page: Page) => (await (await page.request.get("/api/export")).json()).notes.length as number;

test("a share from another app opens the clip card with its link, focused, and creates nothing", async ({ page }) => {
  const before = await noteCount(page);
  const text = "Worth a read https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture). via @someone";
  await page.goto(`/share?title=Transformer&text=${encodeURIComponent(text)}`);
  await expect(page).toHaveURL(/\/notes\/import\?url=/);
  await expect(field(page)).toHaveValue("https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)");
  await expect(main(page).getByRole("button", { name: "Clip page" })).toBeFocused();
  expect(await noteCount(page)).toBe(before);
});

test("the url parameter wins over the text, and a share with no link opens an empty card", async ({ page }) => {
  await page.goto(`/share?url=${encodeURIComponent("https://example.com/a?b=1&c=2")}&text=${encodeURIComponent("https://other.example/")}`);
  await expect(field(page)).toHaveValue("https://example.com/a?b=1&c=2");
  await page.goto(`/share?text=${encodeURIComponent("just words, no address")}`);
  await expect(page).toHaveURL(/\/notes\/import$/);
  await expect(field(page)).toHaveValue("");
  await page.goto("/share?url=https%3A%2F%2Fa.example%2F&url=https%3A%2F%2Fb.example%2F");
  await expect(page, "a repeated parameter counts as absent").toHaveURL(/\/notes\/import$/);
  await expect(field(page)).toHaveValue("");
  await page.goto(`/notes/import?url=${encodeURIComponent("javascript:alert(1)")}`);
  await expect(field(page)).toHaveValue("");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the shared link survives signing in", async ({ page }) => {
    await page.goto(`/share?url=${encodeURIComponent("https://example.com/article")}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.fill('input[name="email"]', readFileSync("tests/e2e/.auth/email.txt", "utf8").trim());
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/notes\/import\?url=https%3A%2F%2Fexample\.com%2Farticle$/, { timeout: 30_000 });
    await expect(field(page)).toHaveValue("https://example.com/article");
  });

  test("a next that points at another site is ignored after signing in", async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent("//evil.example/x")}`);
    await page.fill('input[name="email"]', readFileSync("tests/e2e/.auth/email.txt", "utf8").trim());
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
    expect(new URL(page.url()).host).toBe(new URL(page.url()).host);
    expect(page.url()).not.toContain("evil");
  });
});

test("the manifest declares the share target", async ({ page }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.share_target).toEqual({ action: "/share", method: "GET", params: { url: "url", text: "text", title: "title" } });
});

test("on a phone the prefilled card fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/share?url=${encodeURIComponent(`https://example.com/${"long-path-segment/".repeat(20)}`)}`);
  await expect(field(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
