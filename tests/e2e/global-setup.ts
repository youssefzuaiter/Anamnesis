import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import "dotenv/config";
import {
  deleteTestAccounts,
  testEmail,
  TEST_PASSWORD,
  STORAGE_STATE,
} from "./test-account";

/**
 * Registers a fresh account through the UI and saves its session, so every
 * spec starts signed in. Registering rather than inserting a row means the
 * signup path is covered too, and it keeps this file free of Prisma.
 */
export default async function globalSetup() {
  await deleteTestAccounts();

  const email = testEmail();
  await mkdir("tests/e2e/.auth", { recursive: true });
  await writeFile("tests/e2e/.auth/email.txt", email, "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: "http://localhost:3100" });

  await page.goto("/register");
  await page.fill('input[name="name"]', "E2E Runner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  // After the first account, registration asks for the invite code (CI's database starts empty,
  // so its first run registers without one; this machine's has accounts and needs it).
  const invite = page.locator('input[name="inviteCode"]');
  if (await invite.count()) await invite.fill(process.env.REGISTRATION_CODE ?? "");
  await page.getByRole("button", { name: /create account/i }).click();

  // Registration signs in and lands on the dashboard.
  await page.waitForURL("http://localhost:3100/", { timeout: 30_000 });

  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
