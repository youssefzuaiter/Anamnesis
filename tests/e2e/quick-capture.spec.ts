import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { TEST_PASSWORD } from "./test-account";

/** Quick capture (ROADMAP item 45): /capture opens the capture box ready to type, prefills from ?text=, creates nothing by itself, and is in the manifest. */

const main = (page: Page) => page.locator("main");
const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local')`;
async function sql<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}
const counts = async () => {
  const [row] = await sql<{ n: string }>(`SELECT ((SELECT count(*) FROM "Task" WHERE "userId" IN ${ME}) + (SELECT count(*) FROM "Note" WHERE "userId" IN ${ME}) + (SELECT count(*) FROM "Event" WHERE "userId" IN ${ME}))::text AS n`);
  return Number(row.n);
};

test.afterEach(async () => {
  await sql(`DELETE FROM "Task" WHERE "userId" IN ${ME} AND title LIKE 'qc %'`);
  await sql(`DELETE FROM "Note" WHERE "userId" IN ${ME} AND title LIKE 'qc %'`);
});

const box = (page: Page) => main(page).getByLabel("Quick capture", { exact: true });

test("the page opens the capture box ready to type, with nothing else to get past", async ({ page }) => {
  await page.goto("/capture");
  await expect(main(page).getByRole("heading", { name: "Quick capture" })).toBeVisible();
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue("");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(main(page).getByRole("link", { name: "Open Anamnesis" })).toHaveAttribute("href", "/");
});

test("?text= fills the box and the cursor ends after it; nothing is created until the person confirms", async ({ page }) => {
  const before = await counts();
  await page.goto(`/capture?text=${encodeURIComponent("qc buy milk")}`);
  await expect(box(page)).toHaveValue("qc buy milk");
  await expect(box(page)).toBeFocused();
  await page.keyboard.type(" tomorrow");
  await expect(box(page)).toHaveValue("qc buy milk tomorrow");
  await page.waitForTimeout(500);
  expect(await counts()).toBe(before);
  await expect(main(page).getByRole("status")).toHaveCount(0);
});

test("a repeated or oversized text is not carried over as sent: none for a repeat, a cut at 1,000 for a long one", async ({ page }) => {
  await page.goto("/capture?text=one&text=two");
  await expect(box(page)).toHaveValue("");
  await page.goto(`/capture?text=${"x".repeat(1200)}`);
  expect((await box(page).inputValue()).length).toBe(1000);
  await page.goto(`/capture?text=${encodeURIComponent("line one\nline two")}`);
  await expect(box(page)).toHaveValue("line one line two");
});

test("capture then confirm makes the thing and opens it", async ({ page }) => {
  await page.goto("/capture");
  await box(page).fill("qc write the report");
  await box(page).press("Enter");
  const proposal = main(page).getByRole("status");
  await expect(proposal).toContainText("qc write the report", { timeout: 30_000 });
  await proposal.getByRole("button", { name: /^Create / }).click();
  await page.waitForURL(/\/(tasks|notes|calendar)\//, { timeout: 30_000 });
  expect((await sql(`SELECT 1 FROM "Task" WHERE "userId" IN ${ME} AND title LIKE 'qc %' UNION ALL SELECT 1 FROM "Note" WHERE "userId" IN ${ME} AND title LIKE 'qc %'`)).length).toBe(1);
});

test("signed out, it goes through sign-in and asks to come back, with the text kept; a hostile text stays in the query", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/capture?text=${encodeURIComponent("call Ada")}`);
  await expect(page).toHaveURL(/\/login\?next=%2Fcapture%3Ftext%3Dcall%2520Ada$/);
  await page.goto(`${baseURL}/capture?text=${encodeURIComponent("//evil.example/x")}`);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")!.startsWith("/capture?text=")).toBe(true);
  await context.close();
});

test("after signing in it comes back to quick capture with the text in the box", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/capture?text=${encodeURIComponent("call Ada at 5")}`);
  await page.fill('input[name="email"]', readFileSync("tests/e2e/.auth/email.txt", "utf8").trim());
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/capture\?text=/, { timeout: 30_000 });
  await expect(page.getByLabel("Quick capture", { exact: true })).toHaveValue("call Ada at 5");
  await expect(page.getByLabel("Quick capture", { exact: true })).toBeFocused();
  await context.close();
});

test("the manifest lists Quick capture as a shortcut", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.shortcuts).toEqual([expect.objectContaining({ name: "Quick capture", url: "/capture" })]);
  expect(manifest.start_url).toBe("/");
});

test("on a phone nothing overflows, the controls are touch sized, and the home-screen help opens", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/capture?text=hello");
  for (const name of ["Capture", "Capture by voice"]) expect((await main(page).getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await main(page).getByRole("link", { name: "Open Anamnesis" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await main(page).getByText("Put this on your home screen").click();
  await expect(main(page)).toContainText("Add to Home Screen");
  await expect(main(page)).toContainText("Not tried on an iPhone yet");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
