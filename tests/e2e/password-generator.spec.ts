import { test, expect, type Page } from "@playwright/test";

/** The password generator at /password, in the browser. It makes things only in the page, so the test also checks that nothing was sent to the server. */
const main = (page: Page) => page.locator("main");

test("a passphrase of the words asked, with its strength, and nothing sent to the server", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") requests.push(request.url()); });
  await page.goto("/password");
  await page.getByRole("button", { name: "Make one" }).click();
  const value = await page.getByLabel("Result").inputValue();
  expect(value.split("-")).toHaveLength(6);
  await expect(page.getByTestId("strength")).toContainText(/Fair: about 58 bits|Fair|Strong/);
  await page.getByLabel(/^Words: /).fill("8");
  expect((await page.getByLabel("Result").inputValue()).split("-")).toHaveLength(8);
  await page.getByRole("button", { name: "Make another" }).click();
  expect(await page.getByLabel("Result").inputValue()).not.toBe(value);
  expect(requests).toEqual([]);
});

test("a password follows the length and the character sets, and refuses having none", async ({ page }) => {
  await page.goto("/password");
  await page.getByRole("button", { name: "Password", exact: true }).click();
  await page.getByLabel(/^Length: /).fill("30");
  const value = await page.getByLabel("Result").inputValue();
  expect(value).toHaveLength(30);
  expect(value).toMatch(/^[A-Za-z2-9]+$/);
  for (const name of ["a–z", "A–Z", "0–9"]) await page.getByLabel(name, { exact: true }).uncheck();
  await expect(main(page).getByRole("alert")).toContainText("Choose at least one kind of character");
  await page.getByLabel("0–9", { exact: true }).check();
  expect(await page.getByLabel("Result").inputValue()).toMatch(/^[2-9]{30}$/);
});

test("Copy puts the result on the clipboard and Hide masks it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/password");
  await page.getByRole("button", { name: "Make one" }).click();
  const value = await page.getByLabel("Result").inputValue();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByLabel("Result")).toHaveAttribute("type", "password");
});

test("Settings links to it", async ({ page }) => {
  await page.goto("/settings");
  await main(page).getByRole("link", { name: "Open the password generator" }).click();
  await expect(page).toHaveURL(/\/password$/);
  await expect(main(page).getByRole("heading", { name: "Password generator" })).toBeVisible();
});

test("on a phone the generator fits the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/password");
  await page.getByRole("button", { name: "Make one" }).click();
  await page.getByRole("button", { name: "Password", exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
