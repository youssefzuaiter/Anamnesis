import { test, expect, type Page } from "@playwright/test";

const main = (page: Page) => page.locator("main");
const dialog = (page: Page) => page.getByRole("dialog", { name: "New card" });

async function makeNote(page: Page, title: string) {
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "Notes.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
}

test("find cards by exact text, edit a basic card and a fill-in-the-blank text, refuse a new blank, delete one", async ({ page }) => {
  const token = `zq${Date.now().toString(36)}`;
  await makeNote(page, `Browser ${token}`);

  await main(page).getByRole("button", { name: "New card", exact: true }).click();
  await dialog(page).getByRole("radio", { name: "Question and answer" }).check();
  await dialog(page).getByLabel("Question", { exact: true }).fill(`What is ${token}?`);
  await dialog(page).getByLabel("Answer", { exact: true }).fill("A made-up word.");
  await dialog(page).getByRole("button", { name: "Add card" }).click();
  await expect(dialog(page)).toBeHidden();

  await main(page).getByRole("button", { name: "New card", exact: true }).click();
  await dialog(page).getByRole("radio", { name: "Fill in the blank" }).check();
  await dialog(page).getByLabel("Text with blanks").fill(`The ${token} {{c1::runs}} on {{c2::wheels}}`);
  await dialog(page).getByRole("button", { name: "Add 2 cards" }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto("/cards");
  await main(page).getByRole("link", { name: "Browse and edit all cards" }).click();
  await page.waitForURL(/\/cards\/all$/);

  await page.getByLabel("Search the text of cards").fill(token.toUpperCase());
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${token.toUpperCase()}`));
  await expect(main(page).getByRole("status")).toHaveText(`3 cards match “${token.toUpperCase()}”.`);
  await expect(main(page).getByRole("listitem")).toHaveCount(3);

  await page.goto(`/cards/all?q=${token}`);

  // Edit the basic card.
  const basic = main(page).getByRole("listitem").filter({ hasText: "A made-up word." });
  await basic.getByRole("button", { name: "Edit" }).click();
  await basic.getByLabel("Answer").fill("A word I invented.");
  await basic.getByRole("button", { name: "Save", exact: true }).click();
  await expect(main(page).getByRole("listitem").filter({ hasText: "A word I invented." })).toBeVisible();
  await expect(main(page).getByRole("status").filter({ hasText: "Saved." }).first()).toBeVisible();

  // Edit the fill-in-the-blank text: both cards change; a third blank is refused.
  const cloze = main(page).getByRole("listitem").filter({ hasText: "Blank 1: runs" });
  await cloze.getByRole("button", { name: "Edit" }).click();
  const text = cloze.getByLabel("Text with its blanks");
  await text.fill(`The ${token} {{c1::runs}} on {{c2::wheels}} and {{c3::rails}}`);
  await cloze.getByRole("button", { name: "Save all cards" }).click();
  await expect(cloze.getByRole("alert")).toContainText("That would add a blank");
  await text.fill(`The ${token} {{c1::drives}} on {{c2::tracks}}`);
  await cloze.getByRole("button", { name: "Save all cards" }).click();
  await expect(main(page).getByRole("listitem").filter({ hasText: "Blank 1: drives" })).toBeVisible();
  await expect(main(page).getByRole("listitem").filter({ hasText: "Blank 2: tracks" })).toBeVisible();

  // Delete one.
  page.once("dialog", (d) => void d.accept());
  await main(page).getByRole("listitem").filter({ hasText: "A word I invented." }).getByRole("button", { name: "Delete" }).click();
  await expect(main(page).getByRole("listitem")).toHaveCount(2);
});
