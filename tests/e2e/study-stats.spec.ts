import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** The study stats page (ROADMAP item 39): the streak, the three weekly charts, the way to it, the phone. */

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

const made: { tasks: string[]; reviews: string[]; sessions: string[] } = { tasks: [], reviews: [], sessions: [] };
test.afterEach(async () => {
  if (made.tasks.length) await sql(`DELETE FROM "Task" WHERE "id" = ANY($1::text[])`, [made.tasks.splice(0)]);
  if (made.reviews.length) await sql(`DELETE FROM "CardReview" WHERE "id" = ANY($1::text[])`, [made.reviews.splice(0)]);
  if (made.sessions.length) await sql(`DELETE FROM "StudySession" WHERE "id" = ANY($1::text[])`, [made.sessions.splice(0)]);
});

/** Activity on each of the last `days` days, so the streak is at least that long whatever else the shared account holds. */
async function seed(days: number) {
  const user = await me();
  for (let back = 0; back < days; back++) {
    const when = new Date();
    when.setDate(when.getDate() - back);
    when.setHours(9, 0, 0, 0);
    const task = randomUUID();
    made.tasks.push(task);
    await sql(`INSERT INTO "Task" ("id","userId","title","status","priority","tags","completedAt","updatedAt") VALUES ($1,$2,'Stats task','done','low','{}',$3,now())`, [task, user, when]);
    const review = randomUUID();
    made.reviews.push(review);
    await sql(`INSERT INTO "CardReview" ("id","userId","grade","reviewedAt") VALUES ($1,$2,'good',$3)`, [review, user, when]);
    const session = randomUUID();
    made.sessions.push(session);
    await sql(`INSERT INTO "StudySession" ("id","userId","seconds","recordedAt") VALUES ($1,$2,600,$3)`, [session, user, when]);
  }
}
const streak = (page: Page) => page.getByRole("region", { name: "Streak" });

test("the page shows a streak of at least the days seeded, three charts, and what each counts", async ({ page }) => {
  await seed(3);
  await page.goto("/stats");
  await expect(page.getByRole("heading", { level: 1, name: "Study stats" })).toBeVisible();
  const text = (await streak(page).innerText()).replace(/\s+/g, " ");
  const days = Number(/Current streak (\d+) days?/.exec(text)?.[1]);
  expect(days).toBeGreaterThanOrEqual(3);
  await expect(streak(page).getByRole("list", { name: "The last seven days" }).getByRole("listitem")).toHaveCount(7);
  await expect(streak(page).getByRole("list", { name: "The last seven days" })).toContainText("active");
  for (const title of ["Tasks finished", "Cards reviewed", "Study time"]) {
    await expect(page.getByRole("region", { name: title }).getByRole("img")).toHaveAttribute("aria-label", new RegExp(`^${title} per week, oldest to newest: (\\d+, ){7}\\d+$`));
  }
  const tasksNow = /This week (\d+) tasks?/.exec((await page.getByRole("region", { name: "Tasks finished" }).innerText()).replace(/\s+/g, " "));
  expect(Number(tasksNow?.[1])).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("region", { name: "Cards reviewed" })).toContainText("15 Nov 2026");
});

test("the study chart says whether the recorder is on, and points to the Focus page when it is off", async ({ page }) => {
  const user = await me();
  const before = (await sql(`SELECT "timerSessionsEnabled" FROM "UserProfile" WHERE "userId" = $1`, [user]))[0]?.timerSessionsEnabled as boolean | undefined;
  const setRecorder = (on: boolean) =>
    sql(
      `INSERT INTO "UserProfile" ("id","userId","timerSessionsEnabled") VALUES ($1,$2,$3) ON CONFLICT ("userId") DO UPDATE SET "timerSessionsEnabled" = EXCLUDED."timerSessionsEnabled"`,
      [randomUUID(), user, on],
    );
  try {
    await setRecorder(false);
    await page.goto("/stats");
    const study = page.getByRole("region", { name: "Study time" });
    await expect(study).toContainText("Off. Turn on Remember timer sessions");
    await expect(study.getByRole("link", { name: "Focus page" })).toHaveAttribute("href", "/focus");
    await setRecorder(true);
    await page.goto("/stats");
    await expect(study).toContainText("Recorded only while Remember timer sessions is on.");
    await expect(study.getByRole("link", { name: "Focus page" })).toHaveCount(0);
  } finally {
    await setRecorder(before ?? false);
  }
});

test("g then m opens it from anywhere, and the sidebar names it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Stats" })).toHaveAttribute("href", "/stats");
  // The key is only heard once the page has hydrated, and the hint is the sign of it: press again until it shows.
  const hint = page.getByRole("status").filter({ hasText: "Go to…" });
  await expect(async () => {
    await page.keyboard.press("g");
    await expect(hint).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("m");
  await expect(page).toHaveURL(/\/stats$/);
});

test("on a phone the More sheet lists it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const more = page.getByRole("button", { name: "More" });
  await expect(more).toBeVisible();
  // One click, once React has attached to the button: a second click would close the sheet again. In `next dev` the framework's
  // own badge sits over this button (CLAUDE.md, "Design system"), so the click is dispatched on the button, not at its pixels.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "More");
    return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
  await more.dispatchEvent("click");
  await expect(page.getByRole("dialog").getByRole("link", { name: "Stats" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the page fits a phone in the ${scheme} theme`, async ({ page }) => {
    await seed(2);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), scheme);
    await page.goto("/stats");
    await expect(page.getByRole("region", { name: "Study time" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
