import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** TODO lines become tasks (ROADMAP item 33): the note's card, confirmed by the person. */

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

const made: { notes: string[]; titles: string[] } = { notes: [], titles: [] };
test.afterEach(async () => {
  if (made.titles.length) await sql(`DELETE FROM "Task" WHERE "title" = ANY($1::text[])`, [made.titles.splice(0)]);
  if (made.notes.length) await sql(`DELETE FROM "Note" WHERE "id" = ANY($1::text[])`, [made.notes.splice(0)]);
});

async function noteWith(content: string) {
  const id = randomUUID();
  await sql(`INSERT INTO "Note" ("id","userId","title","content","tags","updatedAt") VALUES ($1,$2,$3,$4,'{}',now())`, [id, await me(), `Lines ${id.slice(0, 6)}`, content]);
  made.notes.push(id);
  return id;
}

test("the card lists the open lines, unticked ones stay lines, and confirming makes the rest into tasks", async ({ page }) => {
  const stamp = randomUUID().slice(0, 6);
  const keep = `Email Ada ${stamp}`;
  const skip = `Ignore this ${stamp}`;
  made.titles.push(keep);
  const id = await noteWith(`- [ ] ${keep}\nTODO: ${skip}\n- [x] Already finished ${stamp}\n`);

  await page.goto(`/notes/${id}`);
  const card = page.locator("main").getByRole("region", { name: "Tasks from this note" });
  await expect(card.getByRole("checkbox")).toHaveCount(2);
  await card.getByRole("checkbox", { name: skip }).uncheck();
  await card.getByRole("button", { name: "Make 1 task" }).click();
  await expect(card).toContainText("Made 1 task.");
  await expect.poll(async () => (await sql(`SELECT "title" FROM "Task" WHERE "title" = $1`, [keep])).length).toBe(1);
  expect(await sql(`SELECT "title" FROM "Task" WHERE "title" = $1`, [skip])).toHaveLength(0);
  // Only the line that stays a line is left, and the done one is never offered.
  await expect(card.getByRole("checkbox")).toHaveCount(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the card fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await noteWith(`- [ ] A fairly long line that has to wrap on a narrow screen because it is long ${randomUUID()}\n`);
    await page.goto(`/notes/${id}`);
    await expect(page.locator("main").getByRole("region", { name: "Tasks from this note" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
