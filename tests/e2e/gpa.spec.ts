import { test, expect, type Locator, type Page } from "@playwright/test";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const gpaCard = (page: Page) => main(page).getByRole("region", { name: "Grade point average" });

/** Courses a test made, so each one is deleted afterwards and the shared account's GPA stays deterministic. */
let made: string[] = [];

/** Creates a course through the form and returns the address of its page. */
async function makeCourse(page: Page, code: string, title: string): Promise<string> {
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link").filter({ hasText: code }).first().click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  made.push(page.url());
  return page.url();
}

async function waitSaved(page: Page) {
  await expect(main(page).getByText("Saved", { exact: true })).toBeVisible();
}

/** Sets credits (by clicking +) and a letter from the list on the course page, and waits until it is saved. */
async function setGrade(page: Page, url: string, credits: number, letter: string | null) {
  await page.goto(url);
  for (let click = 0; click < credits; click++) {
    await main(page).getByRole("button", { name: "One credit more" }).click();
  }
  if (letter) {
    await main(page).getByLabel("Final grade", { exact: true }).selectOption(letter);
  }
  await waitSaved(page);
}

async function deleteCourse(page: Page, url: string) {
  await page.goto(url);
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /delete course/i }).click();
  await page.waitForURL(/\/courses$/);
}

test.beforeEach(() => {
  made = [];
});

test.afterEach(async ({ page }) => {
  // Put the account back: the scale and the target are settings, not courses.
  await page.goto("/courses");
  const reset = main(page).getByRole("button", { name: "Reset to preset" });
  if (await reset.count()) {
    // The scale sits in a disclosure that is closed after a navigation.
    if (!(await reset.isVisible())) await main(page).getByText("Edit the letter scale").click();
    await reset.click();
    await expect(main(page).getByText("Scale saved.")).toBeVisible();
  }
  const target = main(page).getByLabel("Target CGPA");
  if ((await target.count()) && (await target.inputValue()) !== "") {
    await target.selectOption("");
    await expect(main(page).getByText("Target saved.")).toBeVisible();
  }
  for (const url of made) await deleteCourse(page, url);
});

/** The two big numbers, by name: a bare number would also match the same text in the Target list. */
const cumulative = (card: Locator) => card.getByRole("group", { name: "Cumulative GPA" });
const projected = (card: Locator) => card.getByRole("group", { name: /go(es)? as expected/ });

const rowOf = (card: Locator, text: string) => card.getByRole("listitem").filter({ hasText: text });

test("credits and a final letter count in the GPA", async ({ page }) => {
  const stamp = Date.now();
  const a = await makeCourse(page, `GPA${stamp}A`, "First course");
  await setGrade(page, a, 4, "AA");
  const b = await makeCourse(page, `GPA${stamp}B`, "Second course");
  await setGrade(page, b, 4, "BB");

  await page.goto(b);
  await expect(main(page)).toContainText("Counted in your GPA.");
  await expect(main(page)).toContainText("4 credits × 3.0 points = 12.0 quality points");

  await page.goto("/courses");
  const card = gpaCard(page);
  await expect(cumulative(card)).toContainText("3.50");
  await expect(cumulative(card)).toContainText("8 credits counted");

  const cardOfA = main(page).getByRole("link").filter({ hasText: `GPA${stamp}A` });
  await expect(cardOfA).toContainText("4 credits");
  await expect(cardOfA).toContainText("AA · 4.0");
});

test("a target and an expected letter show what is needed", async ({ page }) => {
  const stamp = Date.now();
  const done = await makeCourse(page, `GPA${stamp}D`, "Finished");
  await setGrade(page, done, 4, "AA");
  const open = await makeCourse(page, `GPA${stamp}O`, "Still open");
  await setGrade(page, open, 4, null);

  await page.goto("/courses");
  const card = gpaCard(page);
  await card.getByLabel("Target CGPA").selectOption("3.75");
  await expect(card).toContainText("You need an average of 3.50 on the 4 open credits.");
  await expect(card).toContainText("That is exactly BA.");

  await expect(projected(card)).toContainText("4.00");
  await card.getByLabel(`Expected letter for GPA${stamp}O`).selectOption("CC");
  await expect(projected(card)).toContainText("3.00");
  await expect(card).toContainText("Your expected letters give 2.00.");

  await card.getByLabel("Target CGPA").selectOption("2.00");
  await expect(card).toContainText("You are already at or above 2.00.");
});

test("a letter outside the scale is not counted, and the reason is shown", async ({ page }) => {
  const stamp = Date.now();
  const a = await makeCourse(page, `GPA${stamp}A`, "Graded");
  await setGrade(page, a, 4, "AA");
  const pf = await makeCourse(page, `GPA${stamp}P`, "Pass or fail");
  await setGrade(page, pf, 3, null);
  await main(page).getByLabel("Final grade", { exact: true }).selectOption({ label: "Other letter…" });
  await main(page).getByLabel("Other letter").fill("s");
  await main(page).getByLabel("Other letter").press("Enter");
  await waitSaved(page);
  await expect(main(page)).toContainText("Not counted: S is not in your letter scale.");

  await page.goto("/courses");
  const card = gpaCard(page);
  await expect(rowOf(card, `GPA${stamp}P`)).toContainText(
    "Its letter, S, is not in your letter scale, so it is left out.",
  );
  await expect(cumulative(card)).toContainText("4 credits counted");
  await expect(cumulative(card)).toContainText("4.00");
});

test("a course with no credits is listed, and Set credits opens it", async ({ page }) => {
  const stamp = Date.now();
  await makeCourse(page, `GPA${stamp}N`, "No credits yet");

  await page.goto("/courses");
  const row = rowOf(gpaCard(page), `GPA${stamp}N`);
  await expect(row).toContainText("Credits are not set, so it cannot be part of the open credits.");
  await row.getByRole("link", { name: "Set credits" }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText(`GPA${stamp}N`);
});

test("the scale is editable, previews live, and is saved", async ({ page }) => {
  const stamp = Date.now();
  const a = await makeCourse(page, `GPA${stamp}A`, "AA course");
  await setGrade(page, a, 4, "AA");
  const b = await makeCourse(page, `GPA${stamp}B`, "BB course");
  await setGrade(page, b, 4, "BB");

  await page.goto("/courses");
  const card = gpaCard(page);
  await expect(cumulative(card)).toContainText("3.50");

  await card.getByText("Edit the letter scale").click();
  for (let click = 0; click < 5; click++) {
    await card.getByRole("button", { name: "Raise BB by 0.1" }).click();
  }
  await expect(cumulative(card)).toContainText("3.75");
  await expect(card).toContainText("Not saved yet");

  await card.getByRole("button", { name: "Save scale" }).click();
  await expect(card.getByText("Scale saved.")).toBeVisible();

  await page.reload();
  await expect(cumulative(gpaCard(page))).toContainText("3.75");
  await expect(gpaCard(page)).not.toContainText("Not saved yet");

  await gpaCard(page).getByText("Edit the letter scale").click();
  await gpaCard(page).getByRole("button", { name: "Reset to preset" }).click();
  await expect(gpaCard(page).getByText("Scale saved.")).toBeVisible();
  await page.reload();
  await expect(cumulative(gpaCard(page))).toContainText("3.50");
});

test("the target is kept across a reload", async ({ page }) => {
  await makeCourse(page, `GPA${Date.now()}T`, "Target course");

  await page.goto("/courses");
  await gpaCard(page).getByLabel("Target CGPA").selectOption("3.25");
  await expect(main(page).getByText("Target saved.")).toBeVisible();

  await page.reload();
  await expect(gpaCard(page).getByLabel("Target CGPA")).toHaveValue("3.25");
});

test("four quick clicks on the credits stepper end on four and are saved", async ({ page }) => {
  const course = await makeCourse(page, `GPA${Date.now()}Q`, "Quick clicks");
  await page.goto(course);
  const more = main(page).getByRole("button", { name: "One credit more" });
  for (let click = 0; click < 4; click++) await more.click({ noWaitAfter: true });
  await waitSaved(page);

  await page.reload();
  await expect(main(page).getByRole("group", { name: "Credits" })).toContainText("4");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`on a phone, ${colorScheme}, nothing widens the page and every control is easy to hit`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme });
    const stamp = Date.now();
    const open = await makeCourse(page, `GPA${stamp}O`, "Open on a phone");
    await setGrade(page, open, 4, null);
    await makeCourse(page, `GPA${stamp}N`, "No credits on a phone");

    const tall = async (locator: Locator) => {
      const box = await locator.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    };
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    await page.goto(open);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await tall(main(page).getByRole("button", { name: "One credit more" }));
    await tall(main(page).getByRole("button", { name: "One credit fewer" }));
    await tall(main(page).getByLabel("Final grade", { exact: true }));

    await page.goto("/courses");
    const card = gpaCard(page);
    await card.getByLabel("Target CGPA").selectOption("3.50");
    await card.getByText("Edit the letter scale").click();
    await card.getByRole("button", { name: "Raise BB by 0.1" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await tall(card.getByLabel("Target CGPA"));
    await tall(card.getByLabel(`Expected letter for GPA${stamp}O`));
    await tall(card.getByRole("button", { name: "Raise BB by 0.1" }));
    await tall(card.getByRole("button", { name: "Lower BB by 0.1" }));
    await tall(card.getByRole("button", { name: "Save scale" }));
    await tall(rowOf(card, `GPA${stamp}N`).getByRole("link", { name: "Set credits" }));
  });
}
