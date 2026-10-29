import { test, expect, type Page } from "@playwright/test";
import { dateLabel } from "@/lib/note-templates";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day as yyyy-mm-dd, `offset` days from today. */
function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tomorrowLabel(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateLabel(d);
}

async function addTask(page: Page, title: string, dueDay: string) {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="dueDate"]', dueDay);
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await expect(main(page)).toContainText(title);
}

const review = (page: Page) =>
  main(page).getByRole("button", { name: "Review unfinished tasks" });
const moveButton = (page: Page) =>
  main(page).getByRole("button", { name: /^Move \d+ tasks? to / });
const row = (page: Page, title: string) =>
  main(page).getByRole("checkbox", { name: new RegExp(title) });

/** The number in "Move 3 tasks to Thu 29 Oct". Other tests may leave tasks due today, so counts are read, not assumed. */
async function moveCount(page: Page): Promise<number> {
  const text = await moveButton(page).innerText();
  return Number(/\d+/.exec(text)?.[0]);
}

test("today's note is made once, opens, and is found again", async ({ page }) => {
  const title = `Daily task ${Date.now()}`;
  await addTask(page, title, isoDay());

  await page.goto("/");
  await main(page).getByRole("button", { name: "Open today's note" }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  const noteUrl = page.url();

  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(isoDay());
  for (const heading of ["Schedule", "Open tasks", "Notes"]) {
    await expect(main(page).getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(main(page)).toContainText(title);
  await expect(main(page)).toContainText("due today");

  // The card now links to it instead of offering to make one.
  await page.goto("/");
  await expect(main(page).getByRole("button", { name: "Open today's note" })).toHaveCount(0);
  // The note also shows under Recent notes, so scope to the card.
  await main(page)
    .getByRole("region", { name: "Today's note" })
    .getByRole("link", { name: isoDay() })
    .click();
  await page.waitForURL(noteUrl);

  await page.goto("/notes");
  await expect(main(page).getByText(isoDay(), { exact: true })).toHaveCount(1);
});

test("shut down moves what is ticked, and overdue is opt-in", async ({ page }) => {
  const stamp = Date.now();
  const a = `Keep A ${stamp}`;
  const b = `Keep B ${stamp}`;
  const c = `Old C ${stamp}`;
  await addTask(page, a, isoDay());
  await addTask(page, b, isoDay());
  await addTask(page, c, isoDay(-3));

  await page.goto("/");
  await review(page).click();
  await expect(main(page).getByRole("heading", { name: "Move unfinished tasks to tomorrow?" })).toBeVisible();
  await expect(main(page)).toContainText(`They move to ${tomorrowLabel()}.`);

  await expect(row(page, a)).toBeChecked();
  await expect(row(page, b)).toBeChecked();
  await expect(row(page, c)).not.toBeChecked(); // overdue is opt-in

  const base = await moveCount(page);
  await row(page, c).check();
  await expect.poll(() => moveCount(page)).toBe(base + 1);
  await row(page, b).uncheck();
  await expect.poll(() => moveCount(page)).toBe(base);

  // Nothing ticked: the move button gives way to a disabled "Nothing selected".
  for (const box of await main(page).getByRole("checkbox").all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await expect(main(page).getByRole("button", { name: "Nothing selected" })).toBeDisabled();

  await row(page, a).check();
  await moveButton(page).click();
  await expect(main(page).getByRole("status").filter({ hasText: "Moved 1 task" })).toContainText(
    `to ${tomorrowLabel()}`,
  );

  // A is gone from today; B (left unticked) and C (never ticked) are untouched.
  await expect(main(page)).not.toContainText(a);
  await expect(main(page)).toContainText(b);
  await expect(main(page)).toContainText(c);
});

test("Cancel closes the panel and changes nothing", async ({ page }) => {
  const title = `Stay put ${Date.now()}`;
  await addTask(page, title, isoDay());

  await page.goto("/");
  await review(page).click();
  await expect(row(page, title)).toBeChecked();
  await main(page).getByRole("button", { name: "Cancel" }).click();

  await expect(main(page).getByRole("heading", { name: "Move unfinished tasks to tomorrow?" })).toBeHidden();
  await expect(main(page)).toContainText(title);
});

test("on a phone the panel fits and is easy to use", async ({ page }) => {
  await addTask(page, `Phone check ${Date.now()}`, isoDay());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await review(page).click();
  await expect(moveButton(page)).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const heights: number[] = [];
  for (const label of await main(page).getByRole("group").locator("label").all()) {
    heights.push((await label.boundingBox())?.height ?? 0);
  }
  for (const button of [moveButton(page), main(page).getByRole("button", { name: "Cancel" })]) {
    heights.push((await button.boundingBox())?.height ?? 0);
  }
  expect(heights.length).toBeGreaterThanOrEqual(3);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});
