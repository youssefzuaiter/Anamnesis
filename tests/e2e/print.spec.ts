import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** Print-ready notes (ROADMAP item 34): the print stylesheet, emulated, for a note and for a course. */

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

const made: { notes: string[]; courses: string[] } = { notes: [], courses: [] };
test.afterEach(async () => {
  if (made.notes.length) await sql(`DELETE FROM "Note" WHERE "id" = ANY($1::text[])`, [made.notes.splice(0)]);
  if (made.courses.length) await sql(`DELETE FROM "Course" WHERE "id" = ANY($1::text[])`, [made.courses.splice(0)]);
});

async function course() {
  const id = randomUUID();
  const code = `PR${id.slice(0, 4).toUpperCase()}`;
  await sql(`INSERT INTO "Course" ("id","userId","code","title","term","updatedAt") VALUES ($1,$2,$3,'Calculus','Fall 2026',now())`, [id, await me(), code]);
  made.courses.push(id);
  return { id, code };
}
async function note(title: string, content: string, courseId: string | null = null) {
  const id = randomUUID();
  await sql(
    `INSERT INTO "Note" ("id","userId","title","content","tags","courseId","updatedAt") VALUES ($1,$2,$3,$4,'{}',$5,now())`,
    [id, await me(), title, content, courseId],
  );
  made.notes.push(id);
  return id;
}

const MATHS_AND_CODE = "Limits.\n\n$$\n\\lim_{x\\to a} f(x) = L\n$$\n\n```python\ndef approach(f, a, h=1e-6):\n    return (f(a + h) - f(a)) / h\n```\n";

const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
};
const colours = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { colour: style.color, background: style.backgroundColor };
  });

for (const theme of ["light", "dark"] as const) {
  test(`a note prints as black on white with no app chrome, in the ${theme} theme`, async ({ page }) => {
    const title = `Lecture limits ${randomUUID().slice(0, 6)}`;
    const id = await note(title, MATHS_AND_CODE);
    await page.addInitScript((value) => localStorage.setItem("anamnesis-theme", value), theme);
    await page.goto(`/notes/${id}`);
    await expect(page.locator("main .katex-display")).toBeVisible();

    await page.emulateMedia({ media: "print" });

    // The chrome is gone ...
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit" })).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Note context" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
    // ... and the note is not.
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("main .katex-display")).toBeVisible();
    await expect(page.locator("main pre")).toContainText("def approach");

    // Black on white, whatever the theme: the page, the title, and a line of code.
    const body = await colours(page, "body");
    expect(luminance(body.background)).toBe(255);
    const heading = await colours(page, "main h1");
    expect(luminance(heading.colour)).toBe(0);
    const code = await colours(page, "main pre");
    expect(luminance(code.colour)).toBe(0);
    expect(luminance(code.background)).toBe(255);
    const word = await colours(page, "main pre .hljs-keyword");
    expect(luminance(word.colour)).toBe(0);

    // The code wraps inside the page instead of being cut or scrolled.
    const fits = await page.locator("main pre").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fits).toBe(true);
    // No horizontal overflow for the page itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("a very long line of code wraps inside the printed page instead of running off it", async ({ page }) => {
  const id = await note(`Long ${randomUUID().slice(0, 6)}`, `\`\`\`js\nconst total = ${"alpha + ".repeat(80)}1;\n\`\`\`\n`);
  await page.goto(`/notes/${id}`);
  await expect(page.locator("main pre")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const box = await page.locator("main pre").evaluate((element) => ({
    fits: element.scrollWidth <= element.clientWidth + 1,
    inside: element.getBoundingClientRect().right <= document.documentElement.clientWidth,
  }));
  expect(box).toEqual({ fits: true, inside: true });
});

test("on screen the same note keeps its chrome and offers the print button", async ({ page }) => {
  const id = await note(`Screen ${randomUUID().slice(0, 6)}`, "plain");
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  let printed = 0;
  await page.exposeFunction("countPrint", () => printed++);
  await page.evaluate(() => {
    window.print = () => void (window as unknown as { countPrint: () => void }).countPrint();
  });
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  await expect.poll(() => printed).toBe(1);
});

test("a course prints its notes in the order written, each on a page of its own, and only its own", async ({ page }) => {
  const mine = await course();
  const other = await course();
  const stamp = randomUUID().slice(0, 6);
  await note(`First ${stamp}`, MATHS_AND_CODE, mine.id);
  await note(`Second ${stamp}`, "Derivatives.", mine.id);
  await note(`Elsewhere ${stamp}`, "not here", other.id);

  await page.goto(`/courses/${mine.id}/print`);
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toContainText(`${mine.code} · Calculus`);
  await expect(main.getByRole("list", { name: "Contents" }).getByRole("listitem")).toHaveText([`First ${stamp}`, `Second ${stamp}`]);
  await expect(main).not.toContainText(`Elsewhere ${stamp}`);
  await expect(main.locator(".katex-display")).toHaveCount(1);

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("link", { name: `← ${mine.code}` })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
  const breaks = await main.locator("section[aria-label]").evaluateAll((sections) => sections.map((section) => getComputedStyle(section).breakBefore));
  expect(breaks).toEqual(["page", "page"]);
  expect(luminance((await colours(page, "body")).background)).toBe(255);
});

test("a course with no notes says so, and a stranger's course id is not found", async ({ page }) => {
  const empty = await course();
  await page.goto(`/courses/${empty.id}/print`);
  await expect(page.locator("main")).toContainText("This course has no notes to print.");
  const response = await page.goto(`/courses/${randomUUID()}/print`);
  expect(response?.status()).toBe(404);
});

test("the course page links to the printable view, which fits a phone in the dark", async ({ page }) => {
  const mine = await course();
  await note(`Phone ${randomUUID().slice(0, 6)}`, MATHS_AND_CODE, mine.id);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addInitScript(() => localStorage.setItem("anamnesis-theme", "dark"));
  await page.goto(`/courses/${mine.id}`);
  await page.getByRole("link", { name: "Print this course's notes" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${mine.id}/print$`));
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
