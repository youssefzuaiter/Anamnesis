import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * References in a browser: import BibTeX with a preview, cite in a note, the APA text and list, delete,
 * and the pages on a phone. The parsing and formatting rules are in the unit tests; ownership and the
 * import's rules in tests/integration/references.test.ts. No model is involved.
 */

const main = (page: Page) => page.locator("main");

async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}
const me = async () =>
  (await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id;

// The account is shared by every spec in a run: delete what this one makes (see CLAUDE.md).
const made = { notes: [] as string[] };
test.afterEach(async () => {
  const userId = await me();
  await sql(`DELETE FROM "Reference" WHERE "userId" = $1`, [userId]);
  if (made.notes.length) await sql(`DELETE FROM "Note" WHERE "userId" = $1 AND "id" = ANY($2::text[])`, [userId, made.notes]);
  made.notes = [];
});

const BIB = `@inproceedings{vaswani2017,
  title = {Attention is all you need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle = {Advances in Neural Information Processing Systems 30},
  pages = {5998--6008}, year = {2017}
}
@article{ozturk2020, author = {{\\"O}zt{\\"u}rk, Ay{\\c{s}}e}, title = {Derin {\\"o}{\\u{g}}renme}, journal = {Bilim}, year = {2020}}
@article{broken, title = {Never closed
`;

async function importBib(page: Page, text = BIB) {
  await page.goto("/references");
  await main(page).getByLabel("BibTeX", { exact: true }).fill(text);
  await main(page).getByRole("button", { name: "Preview import" }).click();
}

async function newNote(page: Page, title: string, content: string) {
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', content);
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  made.notes.push(page.url().split("/").pop()!);
}

test("a BibTeX import is previewed, then adds the entries it can read", async ({ page }) => {
  await importBib(page);
  const preview = main(page).getByRole("region", { name: "Import preview" });
  await expect(preview).toContainText("2 new, 1 that could not be read.");
  await expect(preview).toContainText("Derin öğrenme");
  await expect(preview).toContainText(/Line 8: The entry that starts here is not closed/);
  expect((await sql(`SELECT 1 FROM "Reference" WHERE "userId" = $1`, [await me()])).length, "a preview writes nothing").toBe(0);

  await preview.getByRole("button", { name: "Add 2 references" }).click();
  await expect(main(page).getByRole("status")).toHaveText("Added 2 references.");
  const list = main(page).getByRole("list").first();
  await expect(list).toContainText("Öztürk, A. (2020). Derin öğrenme. Bilim.");
  await expect(list).toContainText("Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. In Advances in Neural Information Processing Systems 30 (pp. 5998–6008).");

  await importBib(page);
  await expect(main(page).getByRole("region", { name: "Import preview" })).toContainText("0 new, 2 you already have");
});

test("a note cites with [@key], shows APA text and a reference list, and the reference lists the note", async ({ page }) => {
  await importBib(page);
  await main(page).getByRole("button", { name: "Add 2 references" }).click();
  await expect(main(page).getByRole("status")).toHaveText("Added 2 references.");

  const title = `Cites ${randomUUID().slice(0, 8)}`;
  await newNote(page, title, "Transformers [@vaswani2017, p. 3] changed things, as @ozturk2020 notes. Not [@nobody1999].\n\n`[@vaswani2017]` in code.");
  const body = main(page).locator("article");
  await expect(body.getByRole("link", { name: "(Vaswani et al., 2017, p. 3)" })).toBeVisible();
  await expect(body.getByRole("link", { name: "Öztürk (2020)" })).toBeVisible();
  await expect(body.getByTitle('No reference has the key "nobody1999"')).toHaveText("[@nobody1999]");
  await expect(body.locator("code").filter({ hasText: "[@vaswani2017]" })).toBeVisible();
  const references = body.getByRole("region", { name: "References" });
  await expect(references.getByRole("listitem")).toHaveCount(2);
  await expect(references.getByRole("listitem").first()).toContainText("Öztürk, A. (2020).");

  await body.getByRole("link", { name: "(Vaswani et al., 2017, p. 3)" }).click();
  await page.waitForURL(/\/references\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Attention is all you need");
  await expect(main(page).getByRole("link", { name: title })).toBeVisible();

  // Deleting it keeps the citation in the note, shown as not found.
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: "Delete reference" }).click();
  await page.waitForURL(/\/references$/);
  await page.goto(`/notes/${made.notes[0]}`);
  await expect(main(page).locator("article").getByTitle('No reference has the key "vaswani2017"')).toHaveText("[@vaswani2017, p. 3]");
});

test("adding by hand: a refusal keeps what was typed, then the reference is made", async ({ page }) => {
  await page.goto("/references/new");
  await main(page).getByLabel("Citation key").fill("bad key");
  await main(page).getByLabel("Title", { exact: true }).fill("My handmade work");
  await main(page).getByLabel("Authors").fill("Lee, Kim");
  await main(page).getByLabel("Year").fill("2021");
  await main(page).getByRole("button", { name: "Add reference" }).click();
  await expect(main(page).getByRole("alert")).toContainText("A citation key uses letters");
  await expect(main(page).getByLabel("Title", { exact: true })).toHaveValue("My handmade work");
  await expect(main(page).getByLabel("Authors")).toHaveValue("Lee, Kim");

  await main(page).getByLabel("Citation key").fill("lee2021");
  await main(page).getByRole("button", { name: "Add reference" }).click();
  await page.waitForURL(/\/references\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("region", { name: "APA reference" })).toContainText("Lee, K. (2021). My handmade work.");
  await expect(main(page).getByRole("region", { name: "APA reference" })).toContainText("(Lee, 2021) or Lee (2021)");
});

test("another account's reference, or a made-up id, is not found", async ({ page }) => {
  const stranger = await sql<{ id: string }>(`INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ($1, $2, 'x', now()) RETURNING "id"`, [randomUUID(), `refs-stranger-${randomUUID()}@test.local`]);
  const theirs = randomUUID();
  await sql(`INSERT INTO "Reference" ("id", "userId", "key", "type", "title", "updatedAt") VALUES ($1, $2, 'secret', 'article', 'Their secret work', now())`, [theirs, stranger[0].id]);
  try {
    for (const path of [`/references/${theirs}`, `/references/${theirs}/edit`, `/references/${randomUUID()}`, "/references/not-a-uuid"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.locator("body")).not.toContainText("Their secret work");
    }
  } finally {
    await sql(`DELETE FROM "User" WHERE "id" = $1`, [stranger[0].id]);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`the pages fit a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await importBib(page);
    await main(page).getByRole("button", { name: "Add 2 references" }).click();
    await expect(main(page).getByRole("status")).toHaveText("Added 2 references.");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await main(page).getByRole("link", { name: /Attention is all you need/ }).click();
    await page.waitForURL(/\/references\/[0-9a-f-]{36}$/);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.goto("/references/new");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
