import { test, expect, type Page } from "@playwright/test";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

// While `g` is waiting, a live region (always mounted, empty otherwise) says so.
const hint = (page: Page) => page.getByRole("status").filter({ hasText: "Go to…" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const single = (page: Page) =>
  sheet(page).getByRole("switch", { name: "Single-key shortcuts" });
const sidebarButton = (page: Page) =>
  page.getByRole("button", { name: /^Keyboard shortcuts/ });

// A "nothing happens" check has to wait: a client-side navigation takes a moment
// to change the URL, so an assertion made at once would pass even if a key had
// started one. The routes a key could wrongly go to are fetched first, so the
// dev server has compiled them and a wrong navigation would be quick.
async function warm(page: Page, ...paths: string[]) {
  for (const path of paths) await page.request.get(path);
}

async function expectNothingHappened(page: Page, url: RegExp) {
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(url);
  await expect(hint(page)).toBeHidden();
}

test("g then a letter goes there, and the hint shows in between", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("g");
  await expect(hint(page)).toBeVisible();
  await page.keyboard.press("n");
  await page.waitForURL("**/notes");
  await expect(hint(page)).toBeHidden();

  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.waitForURL("**/tasks");
  await page.keyboard.press("g");
  await page.keyboard.press(",");
  await page.waitForURL("**/settings");
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await page.waitForURL(/localhost:\d+\/$/);
});

test("the hint goes away on its own, and an old g is forgotten", async ({ page }) => {
  await warm(page, "/tasks");
  await page.goto("/notes");
  await page.keyboard.press("g");
  await expect(hint(page)).toBeVisible();
  await page.waitForTimeout(1700);
  await expect(hint(page)).toBeHidden();

  await page.keyboard.press("t");
  await expectNothingHappened(page, /\/notes$/);
});

test("typing never navigates", async ({ page }) => {
  await warm(page, "/notes", "/tasks");
  await page.goto("/notes/new");
  const title = main(page).getByLabel("Note title");
  const content = main(page).getByLabel("Note content");

  await title.click();
  await page.keyboard.type("gn");
  await expect(title).toHaveValue("gn");
  await expectNothingHappened(page, /\/notes\/new$/);

  await content.click();
  await page.keyboard.type("?");
  await expect(content).toHaveValue("?");
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeHidden();

  // A g pressed on the page, then focus moving into a field: the next letter is typed.
  await title.fill("");
  await main(page).getByRole("heading", { name: "New note" }).click();
  await page.keyboard.press("g");
  await expect(hint(page)).toBeVisible();
  await title.click();
  await page.keyboard.type("t");
  await expect(title).toHaveValue("t");
  await expectNothingHappened(page, /\/notes\/new$/);
});

test("? opens the cheat-sheet; Escape, Close and the sidebar button work; nothing fires behind it", async ({
  page,
}) => {
  await warm(page, "/tasks");
  await page.goto("/notes");
  await page.keyboard.press("?");
  await expect(sheet(page)).toBeVisible();
  for (const text of [
    "Notes",
    "Audit trail",
    "Search and jump to anything",
    "Ask the assistant",
    "Show this list",
    "Close a panel",
  ]) {
    await expect(sheet(page)).toContainText(text);
  }

  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();

  await sidebarButton(page).click();
  await expect(sheet(page)).toBeVisible();
  // With the sheet open, g then t must not leave the page.
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expectNothingHappened(page, /\/notes$/);
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toBeHidden();
});

test("the switch turns the single-key shortcuts off, keeps that across a reload, and leaves ⌘K and the button alone", async ({
  page,
}) => {
  await warm(page, "/tasks");
  await page.goto("/notes");
  await page.keyboard.press("?");
  await expect(single(page)).toHaveAttribute("aria-checked", "true");
  await single(page).click();
  await expect(single(page)).toHaveAttribute("aria-checked", "false");
  await expect(sheet(page).getByText("Off: these keys do nothing")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expectNothingHappened(page, /\/notes$/);
  await page.keyboard.press("?");
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeHidden();

  await page.reload();
  await sidebarButton(page).click();
  await expect(single(page)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");

  await sidebarButton(page).click();
  await single(page).click();
  await expect(single(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await page.waitForURL("**/tasks");
});

test("the command palette takes g and t as typing, not as a shortcut", async ({ page }) => {
  await warm(page, "/tasks");
  await page.goto("/notes");
  await page.keyboard.press("Control+k");
  const box = page.getByRole("dialog", { name: "Command palette" }).getByRole("textbox");
  await expect(box).toBeFocused();

  await page.keyboard.type("gt");
  await expect(box).toHaveValue("gt");
  await expectNothingHappened(page, /\/notes$/);
});

test("on a phone the cheat-sheet fits and is easy to use", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/notes");
  await page.keyboard.press("?");
  await expect(sheet(page)).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const close = await sheet(page).getByRole("button", { name: "Close" }).boundingBox();
  const toggle = await single(page).boundingBox();
  expect(close?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(toggle?.height ?? 0).toBeGreaterThanOrEqual(44);
});
