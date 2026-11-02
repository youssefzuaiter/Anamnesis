import { randomUUID } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Nothing here depends on a model: CI has one and this machine often does not. Notes are shorter
 * than 200 characters, so the quiz never tries to write questions from them, and every answer is
 * one a rule decides (an exact answer, or none at all).
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

/** Makes a course and returns its id. Short codes: a long one widens forms in the shared test account. */
async function makeCourse(page: Page, code: string): Promise<string> {
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', `T ${code}`);
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** Creates a note through the form, in a course if one is named by its code, and returns its address. */
async function makeNote(page: Page, title: string, content: string, courseCode?: string): Promise<string> {
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', content);
  if (courseCode) {
    const value = await page
      .locator('select[name="courseId"] option', { hasText: courseCode })
      .first()
      .getAttribute("value");
    await page.selectOption('select[name="courseId"]', value!);
  }
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  return page.url();
}

async function addBasic(page: Page, noteUrl: string, question: string, answer: string) {
  await page.goto(noteUrl);
  await main(page).getByRole("button", { name: "New card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New card" });
  await dialog.getByRole("radio", { name: "Question and answer" }).check();
  await dialog.getByLabel("Question", { exact: true }).fill(question);
  await dialog.getByLabel("Answer", { exact: true }).fill(answer);
  await dialog.getByRole("button", { name: "Add card" }).click();
  await expect(main(page).getByRole("status").filter({ hasText: "Added 1 card." })).toBeVisible();
}

const start = (page: Page) => main(page).getByRole("button", { name: "Start quiz" });
const check = (page: Page) => main(page).getByRole("button", { name: "Check answer" });
const answerBox = (page: Page) => main(page).getByLabel("Your answer");
/** The result region, found by the word it opens with. */
const result = (page: Page, heading: "Correct" | "Partly right" | "Not quite") =>
  main(page).getByRole("status").filter({ hasText: heading });

test("the Quiz me link on a note starts a quiz of its cards", async ({ page }) => {
  const s = Date.now();
  const url = await makeNote(page, `Quiz note ${s}`, "Short.");
  await addBasic(page, url, `First question ${s}?`, "alpha");
  await addBasic(page, url, `Second question ${s}?`, "beta");

  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await expect(page).toHaveURL(/\/quiz\?scope=note:[0-9a-f-]{36}$/);
  await expect(main(page)).toContainText(`Quiz note ${s}`);

  await start(page).click();
  await expect(main(page)).toContainText("Question 1 of 2");
  await expect(main(page)).toContainText("Not enough written material to make more questions.");
  await expect(main(page)).toContainText(`First question ${s}?`);

  await answerBox(page).fill("Alpha");
  await check(page).click();
  await expect(result(page, "Correct")).toBeVisible();
  await expect(result(page, "Correct")).toBeFocused();
  await main(page).getByRole("button", { name: "Good (suggested)" }).click();

  await expect(main(page)).toContainText("Question 2 of 2");
  await expect(main(page)).toContainText(`Second question ${s}?`);
  await check(page).click(); // no answer at all
  await expect(result(page, "Not quite")).toBeVisible();
  await expect(main(page)).toContainText("The answer: beta");
  await main(page).getByRole("button", { name: "Again (suggested)" }).click();

  await expect(main(page)).toContainText("You scored 1 of 2");
  await expect(main(page).getByRole("button", { name: "Quiz again" })).toBeVisible();
});

test("no grade is recorded until one is clicked", async ({ page }) => {
  const s = Date.now();
  const code = `Q${String(s).slice(-5)}`;
  const courseId = await makeCourse(page, code);
  const url = await makeNote(page, `Grades ${s}`, "Short.", code);
  await addBasic(page, url, `Grade one ${s}?`, "uno");
  await addBasic(page, url, `Grade two ${s}?`, "dos");
  const quizUrl = `/quiz?scope=course:${courseId}`;
  const deck = () =>
    page.getByRole("navigation", { name: "Decks" }).getByRole("link", { name: new RegExp(code) });

  // Answer and check, but leave without choosing a grade: both cards are still due.
  await page.goto(quizUrl);
  await start(page).click();
  await answerBox(page).fill("uno");
  await check(page).click();
  await expect(result(page, "Correct")).toBeVisible();
  await page.goto("/cards");
  await expect(deck()).toContainText("2 due");

  // Choosing grades records them: Good schedules tomorrow, Again in ten minutes.
  await page.goto(quizUrl);
  await start(page).click();
  await answerBox(page).fill("uno");
  await check(page).click();
  await main(page).getByRole("button", { name: "Good (suggested)" }).click();
  await check(page).click();
  await main(page).getByRole("button", { name: "Again (suggested)" }).click();
  await expect(main(page)).toContainText("You scored 1 of 2");

  await page.goto(`/cards?course=${courseId}`);
  await expect(main(page)).toContainText("Nothing due right now.");
});

test("a card can be skipped without grading, and the person's own grade wins over the suggestion", async ({ page }) => {
  const s = Date.now();
  const url = await makeNote(page, `Override ${s}`, "Short.");
  await addBasic(page, url, `Override one ${s}?`, "uno");
  await addBasic(page, url, `Override two ${s}?`, "dos");

  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await start(page).click();

  await answerBox(page).fill("uno");
  await check(page).click();
  await main(page).getByRole("button", { name: "Next without grading" }).click(); // counts as the verdict it had: correct

  await expect(main(page)).toContainText("Question 2 of 2");
  await answerBox(page).fill("dos");
  await check(page).click();
  await expect(result(page, "Correct")).toBeVisible();
  await main(page).getByRole("button", { name: "Again" }).click(); // the person says otherwise

  await expect(main(page)).toContainText("You scored 1 of 2");
});

// What the model says is not asserted: with Ollama off the result says it could not judge, with it
// on the result is a verdict, and either way the person can grade the card and finish. That
// shows the unavailable path here and the model path in CI, with the same assertions.
test("an answer the rules cannot decide still lets the person grade and finish, whatever the model says", async ({ page }) => {
  const s = Date.now();
  const url = await makeNote(page, `Undecided ${s}`, "Short.");
  await addBasic(page, url, `Undecided one ${s}: what organelle makes most of a cell's ATP?`, "the mitochondria");

  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await start(page).click();
  await answerBox(page).fill("Something in the cell that is quite large and has a double membrane, I think.");
  await check(page).click();

  await expect(
    main(page).getByRole("status").filter({ hasText: /Correct|Partly right|Not quite|could not judge/ }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(main(page)).toContainText("The answer: the mitochondria");
  await main(page).getByRole("group", { name: "Grade this question" }).getByRole("button", { name: /^Hard/ }).click();
  await expect(main(page)).toContainText(/You scored [0-9.]+ of 1/);
});

test("a double click on Check answer checks once and does not skip a question", async ({ page }) => {
  const s = Date.now();
  const url = await makeNote(page, `Twice ${s}`, "Short.");
  await addBasic(page, url, `Twice one ${s}?`, "alpha");
  await addBasic(page, url, `Twice two ${s}?`, "beta");

  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await start(page).click();
  await answerBox(page).fill("alpha");
  await check(page).dblclick();

  await expect(result(page, "Correct")).toBeVisible();
  await expect(main(page)).toContainText("Question 1 of 2");
  await expect(main(page).getByRole("status").filter({ hasText: "Correct" })).toHaveCount(1);
});

// The double click that does harm is on a grade: the second press would record the card again and
// list the question twice in the results, which the score then counts.
test("a double click on a grade records one review and counts the question once", async ({ page }) => {
  const s = Date.now();
  const url = await makeNote(page, `Grade twice ${s}`, "Short.");
  await addBasic(page, url, `Grade twice one ${s}?`, "alpha");
  await addBasic(page, url, `Grade twice two ${s}?`, "beta");

  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await start(page).click();
  await answerBox(page).fill("alpha");
  await check(page).click();
  await main(page).getByRole("button", { name: "Good (suggested)" }).dblclick();

  await expect(main(page)).toContainText("Question 2 of 2");
  await answerBox(page).fill("beta");
  await check(page).click();
  // A second, late settle of the first question would reset this one while it is being answered.
  await expect(result(page, "Correct")).toBeVisible();
  await main(page).getByRole("button", { name: "Good (suggested)" }).click();

  await expect(main(page)).toContainText("You scored 2 of 2");
  await expect(main(page).locator("ol > li")).toHaveCount(2);
});

test("a note with almost no text and no cards says there is nothing to quiz yet", async ({ page }) => {
  const url = await makeNote(page, `Empty ${Date.now()}`, "Short.");
  await page.goto(url);
  await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
  await start(page).click();

  await expect(main(page)).toContainText("Nothing to quiz yet: make some cards or write more in this note.");
  await expect(main(page)).not.toContainText("Question 1");
  await expect(main(page).getByRole("alert")).toHaveCount(0);
});

test("/quiz without a usable scope explains how to start, and a stranger's id is just gone", async ({ page }) => {
  for (const address of ["/quiz", `/quiz?scope=project:${randomUUID()}`, "/quiz?scope=note:not-an-id"]) {
    await page.goto(address);
    await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Quiz me");
    await expect(main(page)).toContainText("Open a note or a course and choose Quiz me");
    await expect(main(page).getByRole("link", { name: "Notes" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Courses" })).toBeVisible();
    await expect(start(page)).toHaveCount(0);
  }

  await page.goto(`/quiz?scope=note:${randomUUID()}`);
  await expect(main(page)).toContainText("That note no longer exists.");
  await page.goto(`/quiz?scope=course:${randomUUID()}`);
  await expect(main(page)).toContainText("That course no longer exists.");
  await expect(start(page)).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the quiz fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const s = Date.now();
    const url = await makeNote(page, `Phone ${scheme} ${s}`, "Short.");
    await addBasic(page, url, `Phone question ${scheme} ${s}: what is the longest word you can think of for a protein?`, "titin");

    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tall = async (target: Locator, label: string) => {
      const box = await target.boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(375);
    };

    await page.goto(url);
    await main(page).getByRole("link", { name: "Quiz me on this note" }).click();
    await tall(start(page), "Start quiz");
    for (const label of await main(page).locator("label:has(input[type=radio])").all()) await tall(label, "count");
    expect(await overflow()).toBeLessThanOrEqual(0);

    await start(page).click();
    await tall(answerBox(page), "answer box");
    await tall(check(page), "Check answer");
    expect(await overflow()).toBeLessThanOrEqual(0);

    await answerBox(page).fill("titin");
    await check(page).click();
    await expect(result(page, "Correct")).toBeVisible();
    for (const button of await main(page).getByRole("button").all()) await tall(button, "result button");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
