import { test, expect, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/**
 * Who may register (ROADMAP item 25). The server here has accounts and an invite code configured,
 * so /register asks for it; the closed and first-account cases are tested in
 * tests/integration/registration.test.ts and tests/unit/registration.test.ts.
 */

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows;
  } finally {
    await client.end();
  }
}

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await sql(`DELETE FROM "User" WHERE "email" = ANY($1::text[])`, [made.splice(0)]);
});

async function signedOut(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

async function fill(page: import("@playwright/test").Page, email: string, inviteCode: string) {
  await page.goto("/register");
  await page.getByLabel("Name").fill("Invited person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByLabel("Invite code").fill(inviteCode);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("a wrong invite code creates nothing and says so; the right one creates the account", async ({ browser }) => {
  const { context, page } = await signedOut(browser);
  const email = `registration-${randomUUID()}@test.local`;
  made.push(email);

  await fill(page, email, "not-the-code-at-all-123");
  await expect(page.locator("form").getByRole("alert")).toHaveText("That invite code is not right.");
  expect(await sql(`SELECT 1 FROM "User" WHERE "email" = $1`, [email])).toHaveLength(0);

  await fill(page, email, process.env.REGISTRATION_CODE ?? "");
  await page.waitForURL("http://localhost:3100/", { timeout: 30_000 });
  expect(await sql(`SELECT 1 FROM "User" WHERE "email" = $1`, [email])).toHaveLength(1);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the register page with its invite code fits a phone in ${scheme} mode`, async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/register");
    await expect(page.getByLabel("Invite code")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await context.close();
  });
}
