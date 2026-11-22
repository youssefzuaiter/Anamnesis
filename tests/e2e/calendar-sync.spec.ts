import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Imported calendars (ROADMAP item 54): who a calendar is, what is shown of its link, why a sync failed, and where an imported event came from. No network: rows are seeded. */
const main = (page: Page) => page.locator("main");
const ME = `(SELECT id FROM "User" WHERE email LIKE 'e2e-%@test.local' LIMIT 1)`;

async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as Record<string, string>[];
  } finally {
    await client.end();
  }
}

const SECRET = "private-secret-9f3a1c";

test("an imported calendar shows its provider and host, never its link; a failure is explained; the help names where to click", async ({ page }) => {
  const name = `Sync ${Date.now()}`;
  const eventTitle = `Imported class ${Date.now()}`;
  try {
    await sql(
      `INSERT INTO "CalendarSubscription" ("id","userId","name","url","lastSyncedAt","lastEventCount","lastAttemptAt","lastError") VALUES (gen_random_uuid()::text, ${ME}, $1, $2, now() - interval '2 hours', 3, now(), $3)`,
      [name, `https://calendar.google.com/calendar/ical/me%40gmail.com/${SECRET}/basic.ics`, "The calendar returned 503."],
    );
    const [sub] = await sql(`SELECT id FROM "CalendarSubscription" WHERE name = $1`, [name]);
    await sql(
      `INSERT INTO "Event" ("id","userId","title","startTime","endTime","subscriptionId","externalUid","updatedAt") VALUES (gen_random_uuid()::text, ${ME}, $1, now() + interval '3 days', now() + interval '3 days 1 hour', $2, 'uid-1', now())`,
      [eventTitle, sub.id],
    );

    await page.goto("/calendar/subscriptions");
    const row = main(page).getByRole("listitem").filter({ hasText: name });
    await expect(row).toContainText("Google Calendar");
    await expect(row).toContainText("calendar.google.com/…");
    await expect(row).toContainText("The last try failed: The calendar returned 503.");
    await expect(row).toContainText("The events from the last good sync are still shown.");
    expect(await page.content(), "the secret part of the link is nowhere in the page, not even in its data").not.toContain(SECRET);
    expect(await page.content()).not.toContain("me%40gmail.com");

    await main(page).getByText("Where do I find the link?").click();
    await expect(main(page).getByText("Secret address in iCal format")).toBeVisible();
    await expect(main(page).getByText("Publish a calendar")).toBeVisible();
    await expect(main(page)).toContainText("administrator");

    // An imported event names its calendar and says it is replaced at the next sync; the link is not on that page either.
    const [event] = await sql(`SELECT id FROM "Event" WHERE title = $1`, [eventTitle]);
    await page.goto(`/calendar/${event.id}`);
    await expect(main(page)).toContainText(`Imported from ${name} (Google Calendar)`);
    await expect(main(page)).toContainText("replaced at the next sync");
    expect(await page.content()).not.toContain(SECRET);
  } finally {
    await sql(`DELETE FROM "CalendarSubscription" WHERE name = $1`, [name]);
  }
});

test("on a phone the imported calendars page fits and its controls are touch-sized", async ({ page }) => {
  const name = `Phone ${Date.now()}`;
  try {
    await sql(`INSERT INTO "CalendarSubscription" ("id","userId","name","url") VALUES (gen_random_uuid()::text, ${ME}, $1, 'https://outlook.office365.com/owa/calendar/x/y/reachcalendar.ics')`, [name]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/calendar/subscriptions");
    await expect(main(page).getByRole("listitem").filter({ hasText: name })).toContainText("Outlook or Teams calendar");
    await main(page).getByText("Where do I find the link?").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const summary = await main(page).getByText("Where do I find the link?").boundingBox();
    expect(summary!.height).toBeGreaterThanOrEqual(40);
  } finally {
    await sql(`DELETE FROM "CalendarSubscription" WHERE name = $1`, [name]);
  }
});
