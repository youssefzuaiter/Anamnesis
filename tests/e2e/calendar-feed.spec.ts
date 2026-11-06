import { test, expect, type Page } from "@playwright/test";

/**
 * The calendar feed, end to end: no model is involved. What is in the feed is checked against the
 * database in `tests/integration/calendar-feed.test.ts` and its text in `tests/unit/ics-write.test.ts`;
 * this is what only a browser and a server can show: that the address works with no session at all, that
 * every wrong address gets the same answer, that making a new link kills the old one, and the card.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
const main = (page: Page) => page.locator("main");

const FEED_PATH = /\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/;

/** Opens Settings, makes the link (or replaces it, accepting the question), and returns the address that was shown. */
async function makeLink(page: Page): Promise<string> {
  await page.goto("/settings");
  const create = main(page).getByRole("button", { name: "Create link" });
  if (await create.count()) {
    await create.click();
  } else {
    page.once("dialog", (dialog) => void dialog.accept());
    await main(page).getByRole("button", { name: "Make a new link" }).click();
  }
  const field = main(page).getByLabel("Calendar feed address");
  await expect(field).toBeVisible();
  const address = await field.inputValue();
  expect(address).toMatch(FEED_PATH);
  return address;
}

/** A request that carries no cookie at all, like a phone's calendar app. */
async function anonymous(playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"], baseURL: string | undefined) {
  return playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

test("settings offers the card, and a new account's feed is off", async ({ page }) => {
  await page.goto("/settings");
  await expect(main(page).getByRole("heading", { name: "Calendar feed" })).toBeVisible();
  await expect(main(page)).toContainText("Anyone who has the link can read those titles and times");
  await expect(main(page)).toContainText("The calendar feed is off.");
  await expect(main(page).getByRole("button", { name: "Create link" })).toBeVisible();
});

test("an address is shown once, works with no session, and is not shown again after a reload", async ({ page, playwright, baseURL, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const stamp = Date.now();

  // An event and a dated task made through the app.
  await page.goto("/calendar");
  const soon = new Date(Date.now() + 2 * 86_400_000);
  const local = (hour: number) => `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
  await page.getByLabel("Event title").fill(`Feed event ${stamp}`);
  await page.getByLabel("Start time").fill(local(10));
  await page.getByLabel("End time").fill(local(11));
  await main(page).getByRole("button", { name: "Add event" }).click();
  await expect(main(page)).toContainText(`Feed event ${stamp}`);
  await page.goto("/tasks");
  await page.fill('input[name="title"]', `Feed task ${stamp}`);
  await page.fill('input[name="dueDate"]', local(10).slice(0, 10));
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await expect(main(page)).toContainText(`Feed task ${stamp}`);

  const address = await makeLink(page);
  await expect(main(page).getByLabel("Calendar feed address"), "focus is taken to the address").toBeFocused();
  await expect(main(page)).toContainText("This is the only time the address is shown");
  await expect(main(page).getByRole("note")).toContainText("only works on this computer");
  await main(page).getByRole("button", { name: "Copy address" }).click();
  await expect(main(page).getByRole("status")).toContainText("Address copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

  const phone = await anonymous(playwright, baseURL);
  const response = await phone.get(new URL(address).pathname);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toContain("text/calendar");
  expect(headers["cache-control"]).toBe("private, no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const body = await response.text();
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(body).toContain(`SUMMARY:Feed event ${stamp}`);
  expect(body).toContain(`SUMMARY:Due: Feed task ${stamp}`);
  expect(body).not.toContain("e2e-"); // no account name or address of the person
  await phone.dispose();

  await page.reload();
  await expect(main(page).getByLabel("Calendar feed address")).toHaveCount(0);
  await expect(main(page)).toContainText("The calendar feed is on");
  expect(await main(page).innerText()).not.toContain(address.slice(address.lastIndexOf("/") + 1, -4));
});

test("every wrong address is the same answer, byte for byte", async ({ page, playwright, baseURL }) => {
  const address = await makeLink(page);
  const path = new URL(address).pathname;
  const token = path.slice(path.lastIndexOf("/") + 1, -4);
  const phone = await anonymous(playwright, baseURL);
  const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  const answers = [];
  for (const wrong of [`/api/calendar/${flipped}.ics`, `/api/calendar/${token}`, `/api/calendar/${token}.ICS`, `/api/calendar/short.ics`, `/api/calendar/${"A".repeat(43)}.ics`, `/api/calendar/.ics`]) {
    const response = await phone.get(wrong);
    expect(response.status(), wrong).toBe(404);
    answers.push({ body: await response.text(), headers: response.headers() });
  }
  for (const answer of answers) {
    expect(answer.body).toBe("Not found");
    expect(answer.headers["cache-control"]).toBe("private, no-store");
    expect(answer.headers["content-type"]).toBe(answers[0].headers["content-type"]);
    expect(answer.headers["content-length"]).toBe(answers[0].headers["content-length"]);
  }
  expect((await phone.post(path)).status(), "a feed is read-only").toBe(405);
  await phone.dispose();
});

test("making a new link ends the old one, and turning the feed off ends the new one", async ({ page, playwright, baseURL }) => {
  const first = await makeLink(page);
  await page.reload();
  const second = await makeLink(page);
  expect(second).not.toBe(first);

  const phone = await anonymous(playwright, baseURL);
  expect((await phone.get(new URL(first).pathname)).status(), "the old address is dead").toBe(404);
  expect((await phone.get(new URL(second).pathname)).status()).toBe(200);

  page.once("dialog", (dialog) => void dialog.accept());
  await main(page).getByRole("button", { name: "Turn off" }).click();
  await expect(main(page).getByRole("status")).toContainText("The calendar feed is turned off.");
  await expect(main(page).getByRole("button", { name: "Create link" })).toBeVisible();
  expect((await phone.get(new URL(second).pathname)).status()).toBe(404);
  await phone.dispose();
});

test("declining the question changes nothing", async ({ page, playwright, baseURL }) => {
  const address = await makeLink(page);
  await page.reload();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await main(page).getByRole("button", { name: "Make a new link" }).click();
  await expect(main(page).getByLabel("Calendar feed address")).toHaveCount(0);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await main(page).getByRole("button", { name: "Turn off" }).click();
  await expect(main(page)).toContainText("The calendar feed is on");
  const phone = await anonymous(playwright, baseURL);
  expect((await phone.get(new URL(address).pathname)).status(), "the link still works").toBe(200);
  await phone.dispose();
});

test("the address is not in the JSON export", async ({ page }) => {
  const address = await makeLink(page);
  const token = address.slice(address.lastIndexOf("/") + 1, -4);
  const exported = await (await page.request.get("/api/export")).text();
  expect(exported).not.toContain(token);
  expect(exported).not.toContain("calendarFeedHash");
  expect(exported).toContain("calendarFeedCreatedAt");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the card fits a phone in ${scheme} mode: the address wraps in its field and the buttons are touch-sized`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 812 });
      await makeLink(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `sideways overflow at ${width}px in ${scheme}`).toBeLessThanOrEqual(0);
      for (const name of ["Copy address", "Make a new link", "Turn off"]) {
        const box = await main(page).getByRole("button", { name }).boundingBox();
        expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
      }
      const field = await main(page).getByLabel("Calendar feed address").boundingBox();
      expect((field?.x ?? 0) + (field?.width ?? 0), "the field stays inside the screen").toBeLessThanOrEqual(width);
    }
  });
}
