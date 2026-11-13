import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { base32Decode, totp } from "../../src/lib/totp";
import { TEST_PASSWORD } from "./test-account";

/**
 * Two-factor sign-in (ROADMAP item 26) through the real pages. The shared e2e account is never given
 * two-factor (every other spec is signed in as it); each test makes its own account with the same password.
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
  const email = `twofactor-${randomUUID()}@test.local`;
  const mine = readFileSync("tests/e2e/.auth/email.txt", "utf8").trim();
  await sql(
    `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt") SELECT $1, $2, 'Two factor', "passwordHash", now() FROM "User" WHERE "email" = $3`,
    [randomUUID(), email, mine],
  );
  made.push(email);
  return email;
}

async function fresh(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

async function signIn(page: Page, email: string, code?: string, password = TEST_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  if (code !== undefined) await page.getByLabel("Authentication code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const message = (page: Page) => page.locator("form").getByRole("alert");
const ahead = (key: Buffer, steps = 1) => totp(key, Date.now() + steps * 30_000);

/** Turns two-factor on in the settings page; returns the key and the recovery codes shown. */
async function turnOn(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Set up two-factor sign-in" }).click();
  const secret = await page.getByLabel("Setup key").inputValue();
  const key = base32Decode(secret)!;
  await page.getByLabel("2. Enter the 6-digit code it shows").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That code is not right." })).toBeVisible();
  await page.getByLabel("2. Enter the 6-digit code it shows").fill(totp(key, Date.now()));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("list", { name: "Recovery codes" })).toBeVisible();
  const codes = await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allInnerTexts();
  return { key, codes };
}

test("two-factor: set up, sign in needs the code, a recovery code works once, then turn it off", async ({ browser }) => {
  const email = await newAccount();
  const first = await fresh(browser);
  await signIn(first.page, email);
  await first.page.waitForURL("http://localhost:3100/");
  const { key, codes } = await turnOn(first.page);
  expect(codes).toHaveLength(10);
  await expect(first.page.getByText("Two-factor sign-in is on.").first()).toBeVisible();
  await first.page.getByRole("button", { name: "I have saved them" }).click();
  await expect(first.page.getByText("9 recovery codes left.")).toHaveCount(0);
  await expect(first.page.getByText("10 recovery codes left.")).toBeVisible();

  // Signing in now: no code and a wrong code are refused with the same sentence.
  const second = await fresh(browser);
  await signIn(second.page, email);
  await expect(message(second.page)).toHaveText("Incorrect email, password or code.");
  await signIn(second.page, email, "000000");
  await expect(message(second.page)).toHaveText("Incorrect email, password or code.");
  await signIn(second.page, email, ahead(key));
  await second.page.waitForURL("http://localhost:3100/");
  // The same code is spent.
  const replay = await fresh(browser);
  await signIn(replay.page, email, ahead(key));
  await expect(message(replay.page)).toHaveText("Incorrect email, password or code.");

  // A recovery code: once.
  const viaRecovery = await fresh(browser);
  await signIn(viaRecovery.page, email, codes[0].toUpperCase().replaceAll("-", " "));
  await viaRecovery.page.waitForURL("http://localhost:3100/");
  const again = await fresh(browser);
  await signIn(again.page, email, codes[0]);
  await expect(message(again.page)).toHaveText("Incorrect email, password or code.");

  // Turning off needs the password and a code; then sign-in is plain again.
  await first.page.reload();
  await expect(first.page.getByText("9 recovery codes left.")).toBeVisible();
  await first.page.getByRole("button", { name: "Turn off", exact: true }).click();
  await first.page.getByLabel("Password").fill("not the password");
  await first.page.getByLabel("Authenticator or recovery code").fill(codes[1]);
  await first.page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(first.page.getByRole("alert").filter({ hasText: "Incorrect password or code." })).toBeVisible();
  await first.page.getByLabel("Password").fill(TEST_PASSWORD);
  await first.page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(first.page.getByRole("button", { name: "Set up two-factor sign-in" })).toBeVisible();
  const plain = await fresh(browser);
  await signIn(plain.page, email);
  await plain.page.waitForURL("http://localhost:3100/");
  for (const { context } of [first, second, replay, viaRecovery, again, plain]) await context.close();
});

test("a failure with two-factor on reads exactly like an unknown account or a wrong password", async ({ browser }) => {
  const email = await newAccount();
  const setup = await fresh(browser);
  await signIn(setup.page, email);
  await setup.page.waitForURL("http://localhost:3100/");
  await turnOn(setup.page);
  const texts: string[] = [];
  for (const [who, password, code] of [
    [`nobody-${randomUUID()}@test.local`, TEST_PASSWORD, "123456"],
    [email, "wrong password here", "123456"],
    [email, TEST_PASSWORD, ""],
    [email, TEST_PASSWORD, "123456"],
  ] as const) {
    const { context, page } = await fresh(browser);
    await signIn(page, who, code, password);
    texts.push((await message(page).innerText()).trim());
    await context.close();
  }
  expect(new Set(texts)).toEqual(new Set(["Incorrect email, password or code."]));
  await setup.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the sign-in code field and the setup card fit a phone in ${scheme} mode`, async ({ browser }) => {
    const email = await newAccount();
    const { context, page } = await fresh(browser);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await expect(page.getByLabel("Authentication code")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await signIn(page, email);
    await page.waitForURL("http://localhost:3100/");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up two-factor sign-in" }).click();
    await expect(page.getByLabel("Setup key")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await context.close();
  });
}
