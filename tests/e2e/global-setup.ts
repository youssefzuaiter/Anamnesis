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
  await warmRoutes(page);
  await browser.close();
}

/**
 * The suite runs against `next dev`, which compiles a route the first time it is asked for. The first test to open a project page, a task or a
 * note paid that compile inside its own 10 s expect: about 5 s on a good runner and 12.6 s on a slow one, so the board spec failed on a different
 * test in five pull requests in a row with no change to anything it covers. Asking for each route once here, signed in, moves the cost out of the
 * timed tests. A made-up id is enough: a segment compiles whether or not the row exists (the page is a 404, which is fine). Nothing here can fail
 * the run: a route that does not load is simply not warmed.
 */
async function warmRoutes(page: import("@playwright/test").Page) {
  const missing = "00000000-0000-4000-8000-000000000000";
  const routes = [
    "/projects", "/tasks", "/calendar", "/calendar?view=week", "/notes", "/notes/new", "/courses", "/goals", "/cards", "/review", "/stats", "/focus", "/references", "/search", "/settings", "/trash", "/quiz", "/capture",
    `/projects/${missing}`, `/tasks/${missing}`, `/notes/${missing}`, `/calendar/${missing}`, `/courses/${missing}`, `/goals/${missing}`, `/references/${missing}`,
  ];
  for (const route of routes) {
    await page.goto(`http://localhost:3100${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => undefined);
  }
}
