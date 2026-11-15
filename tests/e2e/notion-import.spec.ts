import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ZipWriter } from "@/lib/zip";

/** Notion import (ROADMAP item 37): the form on /notes/import, what it asks, what it reports, the route's refusals, the phone. */

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
const hex = (seed: string) => (seed + "0".repeat(32)).slice(0, 32);
test.beforeEach(() => {
  stamp = `nt${randomUUID().slice(0, 6)}`;
});
test.afterEach(async () => {
  const like = `%${stamp}%`;
  await sql(`DELETE FROM "Attachment" WHERE "noteId" IN (SELECT "id" FROM "Note" WHERE "title" LIKE $1)`, [like]);
  await sql(`DELETE FROM "Note" WHERE "title" LIKE $1`, [like]);
  await sql(`DELETE FROM "Project" WHERE "title" LIKE $1`, [like]);
  await sql(`DELETE FROM "Course" WHERE "code" LIKE $1 OR "title" LIKE $1`, [like]);
});

async function zipOf(files: { name: string; data: string }[]): Promise<Buffer> {
  const writer = new ZipWriter();
  const parts: Buffer[] = [];
  for (const file of files) parts.push(await writer.add({ name: file.name, data: Buffer.from(file.data), modified: new Date("2026-10-01T09:00:00Z") }));
  parts.push(writer.finish());
  return Buffer.concat(parts);
}
const exportZip = () =>
  zipOf([
    { name: `Home ${stamp} ${hex("a")}.md`, data: `# Home ${stamp}\n\nSee [the book](Reading%20${stamp}%20${hex("b")}/Book%20${stamp}%20${hex("c")}.md).\n` },
    { name: `Reading ${stamp} ${hex("b")}.csv`, data: "Name\nBook\n" },
    { name: `Reading ${stamp} ${hex("b")}/Book ${stamp} ${hex("c")}.md`, data: `# Book ${stamp}\n\nBack to [Home](../Home%20${stamp}%20${hex("a")}.md).\n` },
  ]);

async function choose(page: Page, zip: Buffer) {
  await page.goto("/notes/import");
  await page.getByLabel("Notion export").setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: zip });
}
const result = (page: Page) => page.getByRole("group", { name: "Notion import result" });

test("a Notion export is checked first, the database is a project unless chosen otherwise, and importing twice adds nothing", async ({ page }) => {
  await choose(page, await exportZip());
  await page.getByRole("button", { name: "Check the Notion export" }).click();
  await expect(result(page)).toContainText("This is what importing would do.");
  await expect(result(page)).toContainText("Would add 2 notes.");
  await expect(result(page)).toContainText("2 links to other pages became");
  await expect(result(page)).toContainText("will be made");
  expect(await sql(`SELECT 1 FROM "Note" WHERE "title" LIKE $1`, [`%${stamp}%`])).toHaveLength(0);

  // Changing what the database becomes re-checks it.
  await page.getByLabel(new RegExp(`Reading ${stamp}`)).selectOption("course");
  await expect(result(page)).toContainText("This is what importing would do.");
  await expect(result(page)).toContainText("the course");
  await page.getByLabel(new RegExp(`Reading ${stamp}`)).selectOption("project");
  await expect(result(page)).toContainText(`the project “Reading ${stamp}”`);

  await page.getByRole("button", { name: /^Import 2 notes from Notion$/ }).click();
  await expect(result(page)).toContainText("Imported 2 notes.");
  const rows = await sql(`SELECT n."title", p."title" AS "project", n."tags" FROM "Note" n LEFT JOIN "Project" p ON p."id" = n."projectId" WHERE n."title" LIKE $1 ORDER BY n."title"`, [`%${stamp}%`]);
  expect(rows.map((row) => [row.title, row.project])).toEqual([[`Book ${stamp}`, `Reading ${stamp}`], [`Home ${stamp}`, null]]);
  expect(rows[0].tags).toEqual(["imported", "notion"]);
  const home = await sql(`SELECT "content" FROM "Note" WHERE "title" = $1`, [`Home ${stamp}`]);
  expect(home[0].content).toBe(`See [[Book ${stamp}]].`);

  await choose(page, await exportZip());
  await page.getByRole("button", { name: "Check the Notion export" }).click();
  await expect(result(page)).toContainText("There is nothing new to import.");
  await expect(page.getByRole("button", { name: /^Import \d+ notes? from Notion$/ })).toHaveCount(0);
});

test("a course can be chosen, and a zip that is not a Markdown export says so", async ({ page }) => {
  await choose(page, await exportZip());
  await page.getByRole("button", { name: "Check the Notion export" }).click();
  await page.getByLabel(new RegExp(`Reading ${stamp}`)).selectOption("course");
  await page.getByRole("button", { name: /^Import 2 notes from Notion$/ }).click();
  await expect(result(page)).toContainText("Imported 2 notes.");
  const course = await sql(`SELECT "code", "term" FROM "Course" WHERE "title" LIKE $1`, [`%${stamp}%`]);
  expect(course).toHaveLength(1);
  expect(course[0].term).toBe("Notion import");

  await choose(page, await zipOf([{ name: "page.html", data: "<html></html>" }]));
  await page.getByRole("button", { name: "Check the Notion export" }).click();
  await expect(page.getByRole("group", { name: "Notion import problem" })).toContainText("HTML export");
});

test("the route refuses another site, a missing mode, a stranger and a file that is not a zip", async ({ page, playwright, baseURL }) => {
  const zip = await exportZip();
  expect((await page.request.post("/api/import/notion?mode=apply", { data: zip, headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
  expect((await page.request.post("/api/import/notion", { data: zip })).status()).toBe(400);
  expect((await page.request.post("/api/import/notion?mode=preview", { data: "plain text" })).status()).toBe(400);
  const stranger = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  expect((await stranger.post("/api/import/notion?mode=apply", { data: zip })).status()).toBe(401);
  await stranger.dispose();
  expect(await sql(`SELECT 1 FROM "Note" WHERE "title" LIKE $1`, [`%${stamp}%`])).toHaveLength(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the Notion card fits a phone in the ${scheme} theme with touch-sized controls`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), scheme);
    await choose(page, await exportZip());
    await page.getByRole("button", { name: "Check the Notion export" }).click();
    await expect(result(page)).toContainText("This is what importing would do.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const heights = await page.getByRole("button", { name: /^Import 2 notes from Notion$/ }).evaluate((element) => element.getBoundingClientRect().height);
    expect(heights).toBeGreaterThanOrEqual(44);
    expect(await page.getByLabel(new RegExp(`Reading ${stamp}`)).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  });
}
