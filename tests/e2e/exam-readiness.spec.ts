import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** Today's "Next exam" card (ROADMAP item 38): the countdown, the review sessions, the due cards, the mark so far. */

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows;
  } finally {
    await client.end();
  }
}
const me = async (): Promise<string> =>
  (await sql(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id as string;

let code = "";
let courseId = "";
test.beforeEach(() => {
  code = `RD${randomUUID().slice(0, 6).toUpperCase()}`;
});
test.afterEach(async () => {
  await sql(`DELETE FROM "Flashcard" WHERE "noteId" IN (SELECT "id" FROM "Note" WHERE "courseId" = $1)`, [courseId]);
  await sql(`DELETE FROM "Note" WHERE "courseId" = $1`, [courseId]);
  await sql(`DELETE FROM "Task" WHERE "assessmentId" IN (SELECT "id" FROM "Assessment" WHERE "courseId" = $1)`, [courseId]);
  await sql(`DELETE FROM "Course" WHERE "id" = $1`, [courseId]);
});

async function seed({ sessions = 0, done = 0, cards = 0, marked = false }: { sessions?: number; done?: number; cards?: number; marked?: boolean }) {
  const user = await me();
  courseId = randomUUID();
  await sql(`INSERT INTO "Course" ("id","userId","code","title","term","updatedAt") VALUES ($1,$2,$3,'Systems','Fall',now())`, [courseId, user, code]);
  const exam = randomUUID();
  // A few hours ahead keeps it the nearest exam of the shared account whatever else a spec left behind.
  await sql(`INSERT INTO "Assessment" ("id","userId","courseId","title","weight","maxScore","dueDate") VALUES ($1,$2,$3,$4,30,100, now() + interval '3 hours')`, [exam, user, courseId, `Midterm ${code}`]);
  if (marked) await sql(`INSERT INTO "Assessment" ("id","userId","courseId","title","weight","score","maxScore","dueDate") VALUES ($1,$2,$3,'Quiz',20,80,100, now() - interval '3 days')`, [randomUUID(), user, courseId]);
  for (let index = 0; index < sessions; index++) {
    await sql(
      `INSERT INTO "Task" ("id","userId","assessmentId","title","status","priority","tags","estimatedMinutes","scheduledStart","scheduledEnd","updatedAt") VALUES ($1,$2,$3,$4,$5,'medium','{exam-prep}',60, now() + interval '1 day' + ($6 || ' hours')::interval, now() + interval '1 day' + ($6 || ' hours')::interval + interval '1 hour', now())`,
      [randomUUID(), user, exam, `Review ${index} ${code}`, index < done ? "done" : "todo", String(index)],
    );
  }
  if (cards > 0) {
    const note = randomUUID();
    await sql(`INSERT INTO "Note" ("id","userId","courseId","title","content","tags","updatedAt") VALUES ($1,$2,$3,$4,'x','{}',now())`, [note, user, courseId, `Cards ${code}`]);
    for (let index = 0; index < cards; index++) {
      await sql(`INSERT INTO "Flashcard" ("id","userId","noteId","question","answer","dueAt") VALUES ($1,$2,$3,'Q','A', now() - interval '1 day')`, [randomUUID(), user, note]);
    }
  }
}
const card = (page: Page) => page.getByRole("region", { name: "Next exam" });

test("the card shows the countdown, the review sessions, the due cards and the mark so far", async ({ page }) => {
  await seed({ sessions: 4, done: 1, cards: 3, marked: true });
  await page.goto("/");
  await expect(card(page)).toContainText(`Midterm ${code}`);
  await expect(card(page)).toContainText(code);
  await expect(card(page).getByText(/^(Today|Tomorrow)$/)).toBeVisible();
  await expect(card(page)).toContainText("1 of 4 done");
  await expect(card(page).getByRole("img", { name: "1 of 4 review sessions done" })).toBeVisible();
  await expect(card(page)).toContainText("Next:");
  await expect(card(page).getByRole("link", { name: "3, review now" })).toHaveAttribute("href", `/cards?course=${courseId}`);
  await expect(card(page)).toContainText("Your mark so far80%");
  await expect(card(page)).toContainText("Best possible in the course");
  await card(page).getByRole("link", { name: "Plan more review" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}#exam-prep$`));
  await expect(page.getByRole("heading", { name: "Exam prep" })).toBeInViewport();
});

test("with no review planned and nothing due, the card says so and offers to plan one", async ({ page }) => {
  await seed({});
  await page.goto("/");
  await expect(card(page)).toContainText("No review planned for this exam.");
  await expect(card(page)).toContainText("none");
  await expect(card(page)).toContainText("nothing marked yet");
  await expect(card(page).getByRole("link", { name: "Plan review" })).toBeVisible();
  await expect(card(page).getByRole("link", { name: "Open course" })).toHaveAttribute("href", `/courses/${courseId}`);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the card fits a phone in the ${scheme} theme with touch-sized links`, async ({ page }) => {
    await seed({ sessions: 3, done: 1, cards: 2 });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), scheme);
    await page.goto("/");
    await expect(card(page)).toContainText(`Midterm ${code}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const name of ["Plan more review", "Open course"]) {
      expect(await card(page).getByRole("link", { name }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  });
}
