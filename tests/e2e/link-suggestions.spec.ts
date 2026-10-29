import { test, expect, type Page } from "@playwright/test";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const rail = (page: Page) => main(page).getByRole("complementary", { name: "Note context" });
const card = (page: Page, heading: string) =>
  rail(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading }) });
const rowOf = (page: Page, heading: string, title: string) =>
  card(page, heading).getByRole("listitem").filter({ hasText: title });

const ADDED = "Added to See also. You can undo it from History.";

/** Creates a note through the form and returns its address. */
async function makeNote(page: Page, title: string, content: string): Promise<string> {
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', content);
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  return page.url();
}

/** The note's text exactly as the editor holds it. */
async function contentOf(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await main(page).getByRole("button", { name: /^edit$/i }).click();
  return page.inputValue('textarea[name="content"]');
}

test("a note named in the text is suggested, and Add link puts it under See also", async ({ page }) => {
  const stamp = Date.now();
  const target = `Gradient descent ${stamp}`;
  await makeNote(page, target, "Steps against the gradient.");
  await makeNote(page, `Study log ${stamp}`, `I revised ${target} today.`);

  const row = rowOf(page, "Suggested links", target);
  await expect(row).toContainText("Named in this note");
  await row.getByRole("button", { name: "Add link" }).click();
  await expect(card(page, "Suggested links")).toContainText(ADDED);

  const article = main(page).locator("article");
  await expect(article.getByRole("heading", { name: "See also" })).toBeVisible();
  await expect(article.getByRole("link", { name: target })).toBeVisible();
  await expect(rail(page)).toContainText("Links to · 1");

  // Offered once; after a reload it is a link, not a suggestion.
  await page.reload();
  await expect(card(page, "Suggested links").getByRole("link", { name: target })).toHaveCount(0);
});

test("a note that mentions this one can be linked from this page", async ({ page }) => {
  const stamp = Date.now();
  const target = `Backpropagation ${stamp}`;
  const log = `Study log ${stamp}`;
  const targetUrl = await makeNote(page, target, "The chain rule through the layers.");
  const logUrl = await makeNote(page, log, `Reread ${target} before the quiz.`);

  await page.goto(targetUrl);
  const mentions = card(page, "Mentions this note");
  await expect(mentions).toContainText('Adding a link puts this note under "See also" in that note.');
  const row = rowOf(page, "Mentions this note", log);
  await expect(row).toContainText(`Reread ${target} before the quiz.`);
  await row.getByRole("button", { name: "Add link there" }).click();
  await expect(mentions).toContainText(ADDED);

  await page.reload();
  await expect(card(page, "Mentions this note")).toHaveCount(0);

  await page.goto(logUrl);
  const article = main(page).locator("article");
  await expect(article.getByRole("heading", { name: "See also" })).toBeVisible();
  await expect(article.getByRole("link", { name: target })).toBeVisible();
});

test("opening a note, its suggestions and its history changes nothing", async ({ page }) => {
  const stamp = Date.now();
  const target = `Regularisation ${stamp}`;
  await makeNote(page, target, "L2 weight decay and dropout.");
  const logUrl = await makeNote(page, `Study log ${stamp}`, `Notes on ${target}.`);

  const before = await contentOf(page, logUrl);
  for (let visit = 0; visit < 3; visit++) {
    await page.goto(logUrl);
    await expect(card(page, "Suggested links")).toContainText(target);
  }
  await page.goto(`${logUrl}/history`);
  await expect(main(page)).toContainText("No earlier versions yet");

  expect(await contentOf(page, logUrl)).toBe(before);
});

test("History undoes an added link", async ({ page }) => {
  const stamp = Date.now();
  const target = `Dropout ${stamp}`;
  await makeNote(page, target, "Silences units while training.");
  const logUrl = await makeNote(page, `Study log ${stamp}`, `Why ${target} helps.`);

  await rowOf(page, "Suggested links", target).getByRole("button", { name: "Add link" }).click();
  await expect(card(page, "Suggested links")).toContainText(ADDED);

  await page.goto(`${logUrl}/history`);
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /restore/i }).first().click();
  await page.waitForURL(logUrl);

  expect(await contentOf(page, logUrl)).toBe(`Why ${target} helps.`);
  await page.goto(logUrl);
  await expect(main(page).locator("article").getByRole("heading", { name: "See also" })).toHaveCount(0);
});

test("a title shared by two notes is never offered", async ({ page }) => {
  const stamp = Date.now();
  const shared = `Reading list ${stamp}`;
  await makeNote(page, shared, "First one.");
  await makeNote(page, shared, "Second one.");
  await makeNote(page, `Study log ${stamp}`, `Check the ${shared} again.`);

  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Study log");
  await expect(card(page, "Suggested links").getByRole("link", { name: shared })).toHaveCount(0);
});

test("a note nobody mentions has no Mentions card", async ({ page }) => {
  const url = await makeNote(page, `Lonely note ${Date.now()}`, "Nothing else names this.");
  await page.goto(url);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Lonely note");
  await expect(card(page, "Mentions this note")).toHaveCount(0);
});

test("on a phone the suggestion fits the screen and its button is easy to hit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const stamp = Date.now();
  const target = `Convolutional networks ${stamp}`;
  await makeNote(page, target, "Share small filters across an image.");
  await makeNote(page, `Study log ${stamp}`, `Compared ${target} with a dense layer.`);

  const button = rowOf(page, "Suggested links", target).getByRole("button", { name: "Add link" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
