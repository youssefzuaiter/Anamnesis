import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** The reading tracker on References (ROADMAP item 43): status filter, status and takeaway on a work, the notes that cite it, a phone. No model. */

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
const me = async () => (await sql<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id;

const madeNotes: string[] = [];
test.afterEach(async () => {
  const userId = await me();
  await sql(`DELETE FROM "Reference" WHERE "userId" = $1`, [userId]);
  if (madeNotes.length) await sql(`DELETE FROM "Note" WHERE "userId" = $1 AND "id" = ANY($2::text[])`, [userId, madeNotes]);
  madeNotes.length = 0;
});

async function seed(key: string, title: string, status = "to_read", takeaway: string | null = null): Promise<string> {
  const userId = await me();
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "Reference" (id, "userId", key, type, title, authors, year, details, "readStatus", takeaway, "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'article', $3, '[{"family":"Ada","given":"A."}]', 2020, '{}', $4, $5, now()) RETURNING id`,
    [userId, key, title, status, takeaway],
  );
  return row.id;
}
async function seedNote(content: string) {
  const userId = await me();
  const [row] = await sql<{ id: string }>(`INSERT INTO "Note" (id, "userId", title, content, tags, "updatedAt") VALUES (gen_random_uuid()::text, $1, 'Cites it', $2, '{}', now()) RETURNING id`, [userId, content]);
  madeNotes.push(row.id);
}

test("the list shows each work's status, takeaway and how many notes cite it, and filters by status", async ({ page }) => {
  await seed("alpha2020", "Alpha paper", "reading");
  await seed("beta2020", "Beta paper", "done", "Beta in one line.");
  await seed("gamma2020", "Gamma paper");
  await seedNote("As [@beta2020] shows, and [@beta2020, p. 3] too.");
  await seedNote("Also @beta2020.");

  await page.goto("/references");
  const tabs = main(page).getByRole("group", { name: "Reading status" });
  await expect(tabs.getByRole("link", { name: /^All 3/ })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: /^To read 1/ })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Reading 1/ })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Done 1/ })).toBeVisible();
  await expect(main(page)).toContainText("1 you are reading now");

  const beta = main(page).getByRole("listitem").filter({ hasText: "beta2020" });
  await expect(beta).toContainText("Done");
  await expect(beta).toContainText("Beta in one line.");
  await expect(beta).toContainText("Cited in 2 notes");
  await expect(main(page).getByRole("listitem").filter({ hasText: "gamma2020" })).toContainText("Not cited yet");

  await tabs.getByRole("link", { name: /^Reading/ }).click();
  await expect(page).toHaveURL(/status=reading$/);
  await expect(tabs.getByRole("link", { name: /^Reading/ })).toHaveAttribute("aria-current", "page");
  await expect(main(page).getByRole("listitem").filter({ hasText: "alpha2020" })).toBeVisible();
  await expect(main(page)).not.toContainText("beta2020");

  for (const odd of ["?status=bogus", "?status=reading&status=done", "?status=", "?status=READING"]) {
    await page.goto(`/references${odd}`);
    await expect(main(page).getByRole("listitem")).toHaveCount(3);
  }
});

test("an empty filter says so instead of showing a blank page", async ({ page }) => {
  await seed("only2020", "Only paper");
  await page.goto("/references?status=done");
  await expect(main(page)).toContainText("Nothing is marked “Done” yet");
});

test("a work's status and takeaway are set on its page, kept, and shown on the list", async ({ page }) => {
  const id = await seed("delta2020", "Delta paper");
  await page.goto(`/references/${id}`);
  const card = main(page).getByRole("region", { name: "Reading" });
  await expect(card.getByRole("button", { name: "To read" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

  await card.getByRole("button", { name: "Reading" }).click();
  await card.getByLabel("One-line takeaway").fill("Skim the method first.");
  await expect(card.getByText("22 / 200")).toBeVisible();
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("status")).toHaveText("Saved.");
  await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.reload();
  await expect(main(page).getByRole("region", { name: "Reading" }).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
  await expect(main(page).getByLabel("One-line takeaway")).toHaveValue("Skim the method first.");
  const [row] = await sql<{ readStatus: string; takeaway: string }>(`SELECT "readStatus", takeaway FROM "Reference" WHERE id = $1`, [id]);
  expect(row).toEqual({ readStatus: "reading", takeaway: "Skim the method first." });

  await page.goto("/references");
  const listed = main(page).getByRole("listitem").filter({ hasText: "delta2020" });
  await expect(listed).toContainText("Skim the method first.");
  await expect(listed).toContainText("Reading");
});

test("a takeaway over 200 characters cannot be saved, and the counter says why", async ({ page }) => {
  const id = await seed("long2020", "Long paper");
  await page.goto(`/references/${id}`);
  const card = main(page).getByRole("region", { name: "Reading" });
  await card.getByRole("button", { name: "Done" }).click();
  await card.getByLabel("One-line takeaway").fill("x".repeat(201));
  await expect(card.getByText("201 / 200")).toBeVisible();
  await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
  await card.getByLabel("One-line takeaway").fill("x".repeat(200));
  await expect(card.getByRole("button", { name: "Save" })).toBeEnabled();
  expect((await sql(`SELECT 1 FROM "Reference" WHERE id = $1 AND "readStatus" <> 'to_read'`, [id])).length).toBe(0);
});

test("on a phone the tabs and the controls are touch sized and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const id = await seed("phone2020", "Phone paper", "reading", "A takeaway long enough to wrap onto a second line on a narrow screen, with more words after it.");
  await page.goto("/references");
  for (const name of [/^All/, /^To read/, /^Reading/, /^Done/]) {
    expect((await main(page).getByRole("group", { name: "Reading status" }).getByRole("link", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto(`/references/${id}`);
  const card = main(page).getByRole("region", { name: "Reading" });
  for (const name of ["To read", "Reading", "Done", "Save"]) expect((await card.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
