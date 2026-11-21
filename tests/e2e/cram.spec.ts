import { test, expect, type Page } from "@playwright/test";

const main = (page: Page) => page.locator("main");
const dialog = (page: Page) => page.getByRole("dialog", { name: "New card" });

test("the course page starts a cram deck: the course's cards, with the course named, and a card can be graded", async ({ page }) => {
  const code = `CR${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', `Title ${code}`);
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  const courseUrl = page.url();

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', `Cram note ${code}`);
  await page.fill('textarea[name="content"]', "Notes.");
  const value = await page.locator('select[name="courseId"] option', { hasText: code }).first().getAttribute("value");
  await page.selectOption('select[name="courseId"]', value!);
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  for (const n of [1, 2]) {
    await main(page).getByRole("button", { name: "New card", exact: true }).click();
    await dialog(page).getByRole("radio", { name: "Question and answer" }).check();
    await dialog(page).getByLabel("Question", { exact: true }).fill(`Cram question ${n}?`);
    await dialog(page).getByLabel("Answer", { exact: true }).fill(`Cram answer ${n}`);
    await dialog(page).getByRole("button", { name: "Add card" }).click();
    await expect(dialog(page)).toBeHidden();
  }

  await page.goto(courseUrl);
  await expect(main(page).getByText("0 weak, 0 failed lately, 2 never reviewed, 0 others.")).toBeVisible();
  await main(page).getByRole("link", { name: "Cram this course", exact: true }).click();
  await page.waitForURL(/\/cards\?course=[0-9a-f-]{36}&cram=1$/);

  await expect(main(page)).toContainText(`Cramming ${code}: 2 cards, weakest first`);
  await expect(page.getByRole("navigation", { name: "Decks" }).getByRole("link", { name: new RegExp(`Cram ${code}`) })).toHaveAttribute("aria-current", "page");
  await expect(main(page)).toContainText("1 of 2");
  await expect(main(page)).toContainText("Never reviewed");
  await main(page).getByRole("button", { name: "Show answer" }).click();
  await main(page).getByRole("button", { name: "Good", exact: true }).click();
  await expect(main(page)).toContainText("2 of 2");

  // Not a course id, or a deck that is not a course: the ordinary queue, no error.
  await page.goto("/cards?cram=1");
  await expect(main(page)).not.toContainText("Cramming");
  await page.goto("/cards?course=none&cram=1");
  await expect(main(page)).not.toContainText("Cramming");
});
