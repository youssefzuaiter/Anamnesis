import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { cspHeaderName } from "../../src/lib/csp";

/**
 * The Content-Security-Policy (ROADMAP item 30). The browser reports every breach of the policy as a
 * `securitypolicyviolation` event, in report-only mode as well as when enforcing, so this suite is both the
 * measurement and the proof: any page that trips the policy fails here, with the directive and the blocked source.
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
const me = async (): Promise<string> =>
  (await sql(`SELECT "id" FROM "User" WHERE "email" = $1`, [readFileSync("tests/e2e/.auth/email.txt", "utf8").trim()]))[0].id as string;

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await sql(`DELETE FROM "Note" WHERE "id" = ANY($1::text[])`, [made.splice(0)]);
});

/** Records every violation in this document, from before its own scripts run. */
async function listen(page: Page) {
  await page.addInitScript(() => {
    const record = window as unknown as { __cspViolations: string[] };
    record.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      record.__cspViolations.push(`${event.effectiveDirective} blocked ${event.blockedURI || "inline"}: ${event.sample}`);
    });
  });
}

async function violationsOn(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations ?? []);
}

test("every page sends the policy, with a nonce that the theme script also carries", async ({ page }) => {
  const response = await page.goto("/login");
  const header = response?.headers()[cspHeaderName().toLowerCase()];
  expect(header, "the policy header is present").toBeTruthy();
  expect(header).toMatch(/script-src [^;]*'nonce-[^']+'/);
  expect(header).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  expect(header).toContain("frame-ancestors 'none'");
  const nonce = /script-src [^;]*'nonce-([^']+)'/.exec(header!)![1];
  // Read from the server's HTML: a browser clears a script's nonce attribute once it has run, so the live page shows "".
  const html = await response!.text();
  expect(html).toContain(`<script nonce="${nonce}"`);
});

test("a new nonce on every response", async ({ page }) => {
  const first = (await page.goto("/login"))?.headers()[cspHeaderName().toLowerCase()];
  const second = (await page.goto("/register"))?.headers()[cspHeaderName().toLowerCase()];
  expect(first).not.toEqual(second);
});

test("signed-out pages raise no policy violations", async ({ page }) => {
  await listen(page);
  for (const path of ["/login", "/register"]) {
    expect(await violationsOn(page, path), path).toEqual([]);
  }
});

test("signed-in pages, including a note with maths and code, raise no policy violations", async ({ page }) => {
  const id = randomUUID();
  await sql(
    `INSERT INTO "Note" ("id", "userId", "title", "content", "tags", "updatedAt") VALUES ($1, $2, $3, $4, '{}', now())`,
    [
      id,
      await me(),
      `Policy check ${id.slice(0, 6)}`,
      "Maths: $x^2 + y^2 = r^2$ and\n\n$$\\int_0^1 f(x)\\,dx$$\n\n```ts\nconst answer: number = 42;\n```\n",
    ],
  );
  made.push(id);
  await listen(page);
  const found: { path: string; violations: string[] }[] = [];
  for (const path of ["/", `/notes/${id}`, "/notes", "/courses", "/cards", "/tasks", "/calendar", "/settings", "/search", "/ai"]) {
    found.push({ path, violations: await violationsOn(page, path) });
  }
  // The client code the policy most often trips: the command palette and the assistant panel.
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+j");
  await page.waitForTimeout(300);
  found.push({ path: "/ (palette and assistant open)", violations: await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations ?? []) });
  expect(found.filter((row) => row.violations.length > 0)).toEqual([]);
});
