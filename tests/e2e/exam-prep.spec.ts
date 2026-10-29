import { test, expect, type Page } from "@playwright/test";

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day as yyyy-mm-dd, `offset` days from today. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Makes a course and one assessment on it, and leaves the browser on the course page. */
async function courseWithAssessment(
  page: Page,
  assessment: { title: string; weight: number; score?: number; dueInDays: number },
) {
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', "Prep Course");
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);

  await page.fill('input[name="title"]', assessment.title);
  await page.fill('input[name="weight"]', String(assessment.weight));
  if (assessment.score !== undefined) await page.fill('input[name="score"]', String(assessment.score));
  await page.fill('input[name="dueDate"]', isoDay(assessment.dueInDays));
  await main(page).getByRole("button", { name: /add assessment/i }).click();
  await expect(main(page)).toContainText(assessment.title);
}

const propose = (page: Page) => main(page).getByRole("button", { name: "Propose a plan" });
const chip = (page: Page, name: string) => main(page).getByRole("button", { name, exact: true });
const sessionRows = (page: Page) =>
  main(page).getByRole("group", { name: "Sessions", exact: true }).getByRole("checkbox");
const addButton = (page: Page) =>
  main(page).getByRole("button", { name: /^Add \d+ sessions? to my calendar$/ });

test("propose, untick one, confirm, and a second plan counts what is already planned", async ({ page }) => {
  await courseWithAssessment(page, { title: "Midterm", weight: 30, dueInDays: 12 });

  await expect(main(page).getByRole("heading", { name: "Exam prep" })).toBeVisible();
  await propose(page).click();
  await expect(main(page).getByRole("heading", { name: "Review plan for Midterm" })).toBeVisible({ timeout: 15_000 });

  await expect(sessionRows(page)).toHaveCount(6);
  for (const box of await sessionRows(page).all()) await expect(box).toBeChecked();
  await expect(addButton(page)).toHaveText("Add 6 sessions to my calendar");

  await sessionRows(page).nth(1).uncheck();
  await expect(addButton(page)).toHaveText("Add 5 sessions to my calendar");
  await addButton(page).click();

  await expect(main(page).getByRole("status").filter({ hasText: "Added 5 sessions to your calendar." })).toBeVisible();
  // The course's own task list now holds them.
  await expect(main(page).getByText(/Review: Midterm \(\d of 6\)/)).toHaveCount(5);

  await propose(page).click();
  await expect(main(page).getByText("Already planned: 5 sessions (5 h)")).toBeVisible();
  await expect(sessionRows(page)).toHaveCount(1);
});

test("the controls change the plan, and changing one closes an open proposal", async ({ page }) => {
  await courseWithAssessment(page, { title: "Midterm", weight: 30, dueInDays: 12 });

  await expect(chip(page, "6 h")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "60 min")).toHaveAttribute("aria-pressed", "true");
  await chip(page, "3 h").click();
  await chip(page, "90 min").click();
  await expect(chip(page, "3 h")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "6 h")).toHaveAttribute("aria-pressed", "false");

  await propose(page).click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });

  await chip(page, "45 min").click();
  await expect(main(page).getByRole("heading", { name: "Review plan for Midterm" })).toBeHidden();
});

test("with nothing to plan towards the card says so and offers no plan", async ({ page }) => {
  await courseWithAssessment(page, { title: "Quiz", weight: 10, score: 80, dueInDays: 12 });

  await expect(main(page).getByText("Add an assessment with a date to plan review sessions.")).toBeVisible();
  await expect(propose(page)).toHaveCount(0);
});

test("the sessions show up on the tasks page and on the calendar", async ({ page }) => {
  await courseWithAssessment(page, { title: "Midterm", weight: 30, dueInDays: 12 });
  await chip(page, "3 h").click();
  await chip(page, "90 min").click();
  await propose(page).click();
  await expect(sessionRows(page)).toHaveCount(2, { timeout: 15_000 });
  await addButton(page).click();
  await expect(main(page).getByRole("status").filter({ hasText: "Added 2 sessions" })).toBeVisible();

  await page.goto("/tasks");
  await expect(main(page).getByText("Review: Midterm (1 of 2)")).toBeVisible();

  // Two sessions over eleven days: one tomorrow and one the day before the assessment.
  await page.goto(`/calendar?view=day&date=${isoDay(1)}`);
  await expect(main(page)).toContainText("Review: Midterm (1 of 2)");
});

test("on a phone the card fits and is easy to use", async ({ page }) => {
  await courseWithAssessment(page, { title: "Midterm", weight: 30, dueInDays: 12 });
  await page.setViewportSize({ width: 375, height: 812 });
  await propose(page).click();
  await expect(sessionRows(page)).toHaveCount(6, { timeout: 15_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const heights: number[] = [];
  for (const button of await main(page).locator("button[aria-pressed]").all()) {
    heights.push((await button.boundingBox())?.height ?? 0);
  }
  for (const label of await main(page).getByRole("group", { name: "Sessions", exact: true }).locator("label").all()) {
    heights.push((await label.boundingBox())?.height ?? 0);
  }
  for (const button of [propose(page), addButton(page), main(page).getByRole("button", { name: "Cancel" })]) {
    heights.push((await button.boundingBox())?.height ?? 0);
  }
  expect(heights.length).toBeGreaterThanOrEqual(12);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});
