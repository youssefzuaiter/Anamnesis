import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { TEST_PASSWORD } from "./test-account";

/**
 * Signed-in devices (ROADMAP item 27) through two real browsers. As in the two-factor spec, the shared
 * e2e account is never touched (ending its sessions would sign out every other spec); each test makes
 * its own account with the same password.
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

async function newAccount(): Promise<string> {
  const email = `sessions-${randomUUID()}@test.local`;
  const mine = readFileSync("tests/e2e/.auth/email.txt", "utf8").trim();
  await sql(
    `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt") SELECT $1, $2, 'Sessions', "passwordHash", now() FROM "User" WHERE "email" = $3`,
    [randomUUID(), email, mine],
  );
  made.push(email);
  return email;
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

async function signedIn(browser: Browser, email: string, userAgent?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies: [], origins: [] }, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:3100/");
  return { context, page };
}

const devices = (page: Page) => page.getByRole("list", { name: "Signed-in devices" }).getByRole("listitem");

test("signing a device out ends it on its very next request, in pages and in routes", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  const phone = await signedIn(browser, email, IPHONE);

  await laptop.page.goto("/settings");
  await expect(devices(laptop.page)).toHaveCount(2);
  await expect(devices(laptop.page).filter({ hasText: "This device" })).toHaveCount(1);
  await expect(devices(laptop.page).filter({ hasText: "Safari on iPhone" })).toHaveCount(1);
  // The phone works until it is signed out.
  expect((await phone.page.request.get("/api/export")).status()).toBe(200);

  await devices(laptop.page).filter({ hasText: "Safari on iPhone" }).getByRole("button", { name: /^Sign out Safari on iPhone/ }).click();
  await expect(devices(laptop.page)).toHaveCount(1);

  // The phone's next page goes to sign-in, and so does a route called with its cookie.
  await phone.page.goto("/");
  await expect(phone.page).toHaveURL(/\/login/);
  expect((await phone.page.request.get("/api/export")).status()).toBe(401);
  // The laptop is untouched.
  await laptop.page.goto("/");
  await expect(laptop.page).toHaveURL("http://localhost:3100/");
  await laptop.context.close();
  await phone.context.close();
});

test("a server action from a signed-out device writes nothing", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  const phone = await signedIn(browser, email, IPHONE);
  // The phone opens the new-note form while it is still signed in, then the laptop signs it out.
  await phone.page.goto("/notes/new");
  const title = `Written after sign-out ${randomUUID().slice(0, 8)}`;
  await phone.page.getByLabel("Title").fill(title);
  await laptop.page.goto("/settings");
  await devices(laptop.page).filter({ hasText: "Safari on iPhone" }).getByRole("button", { name: /^Sign out Safari on iPhone/ }).click();
  await expect(devices(laptop.page)).toHaveCount(1);
  await phone.page.getByRole("button", { name: /save|create/i }).first().click();
  await phone.page.waitForTimeout(1500);
  expect(await sql(`SELECT 1 FROM "Note" WHERE "title" = $1`, [title])).toHaveLength(0);
  await laptop.context.close();
  await phone.context.close();
});

test("sign out all other devices keeps this one", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  const phone = await signedIn(browser, email, IPHONE);
  const tablet = await signedIn(browser, email, IPHONE);
  await laptop.page.goto("/settings");
  await expect(devices(laptop.page)).toHaveCount(3);
  laptop.page.once("dialog", (dialog) => void dialog.accept());
  await laptop.page.getByRole("button", { name: "Sign out all other devices" }).click();
  await expect(laptop.page.getByText("Signed out 2 other devices.")).toBeVisible();
  await expect(devices(laptop.page)).toHaveCount(1);
  for (const other of [phone, tablet]) {
    await other.page.goto("/");
    await expect(other.page).toHaveURL(/\/login/);
  }
  await laptop.page.goto("/");
  await expect(laptop.page).toHaveURL("http://localhost:3100/");
  for (const { context } of [laptop, phone, tablet]) await context.close();
});

test("sign out everywhere ends this device too", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  const phone = await signedIn(browser, email, IPHONE);
  await laptop.page.goto("/settings");
  laptop.page.once("dialog", (dialog) => void dialog.accept());
  await laptop.page.getByRole("button", { name: "Sign out everywhere" }).click();
  await laptop.page.waitForURL(/\/login/);
  await phone.page.goto("/");
  await expect(phone.page).toHaveURL(/\/login/);
  expect(await sql(`SELECT 1 FROM "AuthSession" s JOIN "User" u ON u."id" = s."userId" WHERE u."email" = $1`, [email])).toHaveLength(0);
  await laptop.context.close();
  await phone.context.close();
});

test("signing out ends the session row, so a copy of the cookie stops working too", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  const cookies = await laptop.context.cookies();
  await laptop.page.getByRole("button", { name: "Sign out", exact: true }).click();
  await laptop.page.waitForURL(/\/login/);
  const copy = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies, origins: [] } });
  const page = await copy.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await copy.close();
  await laptop.context.close();
});

test("a token from before sessions were tracked is refused once", async ({ browser }) => {
  const email = await newAccount();
  const laptop = await signedIn(browser, email);
  // Deleting the row is what a token without one looks like to the check.
  await sql(`DELETE FROM "AuthSession" WHERE "userId" = (SELECT "id" FROM "User" WHERE "email" = $1)`, [email]);
  await laptop.page.goto("/settings");
  await expect(laptop.page).toHaveURL(/\/login/);
  await laptop.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the signed-in devices card fits a phone in ${scheme} mode`, async ({ browser }) => {
    const email = await newAccount();
    const laptop = await signedIn(browser, email);
    const phone = await signedIn(browser, email, IPHONE);
    await laptop.page.emulateMedia({ colorScheme: scheme });
    await laptop.page.setViewportSize({ width: 375, height: 812 });
    await laptop.page.goto("/settings");
    await expect(devices(laptop.page)).toHaveCount(2);
    expect(await laptop.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await laptop.context.close();
    await phone.context.close();
  });
}
