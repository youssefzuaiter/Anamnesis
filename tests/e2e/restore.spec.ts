import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** Restore from a JSON export (ROADMAP item 35): choose, check, restore, and the refusals of the route. */

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows;
  } finally {
    await client.end();
  }
}

let stamp = "";
test.beforeEach(() => {
  stamp = `rs${randomUUID().slice(0, 6)}`;
});
test.afterEach(async () => {
  const like = `%${stamp}%`;
  await sql(`DELETE FROM "Task" WHERE "title" LIKE $1`, [like]);
  await sql(`DELETE FROM "Event" WHERE "title" LIKE $1`, [like]);
  await sql(`DELETE FROM "Note" WHERE "title" LIKE $1`, [like]);
  await sql(`DELETE FROM "Project" WHERE "title" LIKE $1`, [like]);
});

const exportFile = () => ({
  formatVersion: 2,
  user: { id: "someone-else", passwordHash: "scrypt$forged" },
  projects: [{ id: "p1", title: `Thesis ${stamp}`, category: "University" }],
  notes: [{ id: "n1", title: `Lecture ${stamp}`, content: "A limit.", tags: ["calc"], projectId: "p1" }],
  tasks: [
    { id: "t1", title: `Revise ${stamp}`, status: "done", projectId: "p1", noteId: "n1" },
    { id: "t2", title: `Practise ${stamp}`, projectId: "p1" },
  ],
  events: [{ title: `Exam ${stamp}`, startTime: "2026-12-01T09:00:00.000Z", endTime: "2026-12-01T11:00:00.000Z" }],
});

async function choose(page: import("@playwright/test").Page, file: unknown, name = "export.json") {
  await page.goto("/settings");
  await page.getByLabel("Export file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(typeof file === "string" ? file : JSON.stringify(file)) });
}

test("a file is checked first, nothing is saved by checking, restoring adds it, and doing it again adds nothing", async ({ page }) => {
  await choose(page, exportFile());
  await page.getByRole("button", { name: "Check the file" }).click();
  const status = page.getByRole("group", { name: "Restore result" });
  await expect(status).toContainText("This is what restoring would do.");
  await expect(status).toContainText("Would add 1 project.");
  await expect(status).toContainText("Would add 2 tasks.");
  expect(await sql(`SELECT 1 FROM "Task" WHERE "title" LIKE $1`, [`%${stamp}%`])).toHaveLength(0);

  await page.getByRole("button", { name: /^Restore 5 items$/ }).click();
  await expect(status).toContainText("Restored 5 items.");
  const tasks = await sql(`SELECT t."title", t."status", t."completedAt", p."title" AS "project", n."title" AS "note" FROM "Task" t LEFT JOIN "Project" p ON p."id" = t."projectId" LEFT JOIN "Note" n ON n."id" = t."noteId" WHERE t."title" LIKE $1 ORDER BY t."title"`, [`%${stamp}%`]);
  expect(tasks).toHaveLength(2);
  expect(tasks[1]).toMatchObject({ title: `Revise ${stamp}`, status: "done", project: `Thesis ${stamp}`, note: `Lecture ${stamp}` });
  expect(tasks[1].completedAt).not.toBeNull();
  expect(tasks[0].project).toBe(`Thesis ${stamp}`);

  // The same file again: nothing is new.
  await choose(page, exportFile());
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(status).toContainText("There is nothing new to restore.");
  await expect(page.getByRole("button", { name: /^Restore/ })).toHaveCount(0);
});

test("a file that is not an export says why and writes nothing", async ({ page }) => {
  await choose(page, "this is not json");
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByRole("group", { name: "Restore problem" })).toContainText("not valid JSON");
  await choose(page, { formatVersion: 99, notes: [] });
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByRole("group", { name: "Restore problem" })).toContainText("newer version");
});

test("the route refuses a request from another site, a missing mode and a stranger's session", async ({ page, playwright, baseURL }) => {
  const body = JSON.stringify({ notes: [{ title: `Nope ${stamp}` }] });
  const refuse = await page.request.post(`/api/import/json?mode=apply`, { data: body, headers: { "sec-fetch-site": "cross-site" } });
  expect(refuse.status()).toBe(403);
  expect((await page.request.post(`/api/import/json`, { data: body })).status()).toBe(400);
  const stranger = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  expect((await stranger.post(`/api/import/json?mode=apply`, { data: body })).status()).toBe(401);
  await stranger.dispose();
  expect(await sql(`SELECT 1 FROM "Note" WHERE "title" LIKE $1`, [`%${stamp}%`])).toHaveLength(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the restore card fits a phone and shows its report in the ${scheme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), scheme);
    await choose(page, exportFile());
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByRole("group", { name: "Restore result" })).toContainText("This is what restoring would do.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: "Check the file" })).toBeHidden();
    const sizes = await page.getByRole("button", { name: /^Restore \d+ items$/ }).evaluate((element) => element.getBoundingClientRect().height);
    expect(sizes).toBeGreaterThanOrEqual(44);
  });
}
