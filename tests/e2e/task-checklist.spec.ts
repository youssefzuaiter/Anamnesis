import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * A task's checklist, driven through the browser. No model is involved. Every test makes its own task
 * (a title with the time in it), so the shared account's other tasks never matter.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const checklist = (page: Page) => main(page).getByRole("region", { name: "Checklist" });
const items = (page: Page) => checklist(page).getByRole("listitem");
const status = (page: Page) => checklist(page).getByRole("status");
const addField = (page: Page) => checklist(page).getByLabel("Add an item");
const addButton = (page: Page) => checklist(page).getByRole("button", { name: "Add item" });

/** Runs one statement against the database the app uses (for what the page cannot be asked to do). */
async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(statement, params);
  } finally {
    await client.end();
  }
}

/** Makes a task through the form on /tasks, opens it, and returns its address. */
async function makeTask(page: Page, title: string): Promise<string> {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await main(page).getByRole("link", { name: title }).first().click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  return page.url();
}

/** Adds one item by typing it and pressing Enter, and waits until the list shows it. */
async function addByEnter(page: Page, title: string) {
  await addField(page).fill(title);
  await addField(page).press("Enter");
  await expect(checklist(page)).toContainText(title);
}

/** Adds one item with the button. */
async function addByButton(page: Page, title: string) {
  await addField(page).fill(title);
  await addButton(page).click();
  await expect(checklist(page)).toContainText(title);
}

const tick = (page: Page, title: string) => checklist(page).getByRole("button", { name: `Mark "${title}" done` });
const untick = (page: Page, title: string) => checklist(page).getByRole("button", { name: `Mark "${title}" not done` });

test("a new task offers an empty checklist, and items are added with Enter or the button, in order", async ({ page }) => {
  const title = `Checklist add ${Date.now()}`;
  const url = await makeTask(page, title);
  await expect(main(page).getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(status(page)).toHaveText("0 of 0 done");
  await expect(items(page)).toHaveCount(0);
  // An empty list is not a finished one: no prompt to finish the task.
  await expect(checklist(page).getByText("Every item is done.")).toHaveCount(0);
  // A task with no items has no badge on the list of tasks.
  await page.goto("/tasks");
  await expect(main(page).getByRole("link", { name: title })).toBeVisible();
  await expect(main(page).locator("li", { has: page.getByRole("link", { name: title }) })).not.toContainText("checklist items done");
  await page.goto(url);
  // An empty field has nothing to add.
  await expect(addButton(page)).toBeDisabled();

  await addByEnter(page, "Read chapter one");
  await expect(status(page)).toHaveText("0 of 1 done");
  // The field is empty again and keeps the keyboard, so the next item can be typed straight away.
  await expect(addField(page)).toHaveValue("");
  await expect(addField(page)).toBeFocused();

  await addByButton(page, "Do the exercises");
  // After the button too, not only after Enter, the field is empty and ready for the next one.
  await expect(addField(page)).toHaveValue("");
  await expect(addField(page)).toBeFocused();
  await addByEnter(page, "Write the summary");
  await expect(status(page)).toHaveText("0 of 3 done");
  await expect(items(page)).toContainText(["Read chapter one", "Do the exercises", "Write the summary"]);
});

test("ticking items counts them, shows the badge on /tasks, and survives a reload", async ({ page }) => {
  const title = `Checklist tick ${Date.now()}`;
  const url = await makeTask(page, title);
  for (const item of ["Alpha step", "Bravo step", "Charlie step"]) await addByEnter(page, item);

  await tick(page, "Bravo step").click();
  await expect(status(page)).toHaveText("1 of 3 done");
  await expect(untick(page, "Bravo step")).toBeVisible();
  // The name says which way it is: a button named "...not done" is a ticked item. No pressed state is added
  // on top of a name that already changes, which a screen reader would read twice.
  await expect(tick(page, "Alpha step")).toBeVisible();
  await expect(untick(page, "Bravo step")).not.toHaveAttribute("aria-pressed", /.*/);
  // Done is shown in the text as well as by the box: struck through, and not for the others.
  await expect(checklist(page).getByText("Bravo step", { exact: true })).toHaveCSS("text-decoration-line", "line-through");
  await expect(checklist(page).getByText("Alpha step", { exact: true })).toHaveCSS("text-decoration-line", "none");

  await page.goto(url);
  await expect(status(page)).toHaveText("1 of 3 done");
  await expect(untick(page, "Bravo step")).toBeVisible();

  // The list of tasks shows the same count next to the task, and it is read out in words.
  await page.goto("/tasks");
  const row = main(page).locator("li", { has: page.getByRole("link", { name: title }) });
  await expect(row.getByText("1 of 3 checklist items done")).toBeAttached();
  await expect(row.getByText("1/3", { exact: true })).toBeVisible();

  // Unticking takes it back.
  await page.goto(url);
  await untick(page, "Bravo step").click();
  await expect(status(page)).toHaveText("0 of 3 done");
});

test("Up and Down reorder the items, the ends are disabled, and the order survives a reload", async ({ page }) => {
  const url = await makeTask(page, `Checklist order ${Date.now()}`);
  for (const item of ["First thing", "Second thing", "Third thing"]) await addByEnter(page, item);

  const up = (title: string) => checklist(page).getByRole("button", { name: `Move "${title}" up` });
  const down = (title: string) => checklist(page).getByRole("button", { name: `Move "${title}" down` });
  await expect(up("First thing")).toBeDisabled();
  await expect(down("Third thing")).toBeDisabled();
  await expect(down("First thing")).toBeEnabled();

  await down("First thing").click();
  await expect(items(page)).toContainText(["Second thing", "First thing", "Third thing"]);
  await up("Third thing").click();
  await expect(items(page)).toContainText(["Second thing", "Third thing", "First thing"]);

  await page.goto(url);
  await expect(items(page)).toContainText(["Second thing", "Third thing", "First thing"]);
});

test("Edit renames an item (Enter saves, Escape cancels), and a blank name is refused", async ({ page }) => {
  const url = await makeTask(page, `Checklist edit ${Date.now()}`);
  await addByEnter(page, "Original wording");

  const edit = checklist(page).getByRole("button", { name: 'Edit "Original wording"' });
  const field = checklist(page).getByLabel("Edit item");

  await edit.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Original wording");
  await field.fill("Changed my mind");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(checklist(page)).toContainText("Original wording");

  await edit.click();
  await field.fill("   ");
  await field.press("Enter");
  await expect(checklist(page).getByRole("alert")).toContainText("Write what needs doing.");
  await expect(field).toBeVisible();

  await field.fill("Better wording");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(checklist(page)).toContainText("Better wording");
  await expect(checklist(page)).not.toContainText("Original wording");
  // The error from the blank try is gone once a change succeeds.
  await expect(checklist(page).getByRole("alert")).toHaveCount(0);

  await page.goto(url);
  await expect(items(page)).toContainText(["Better wording"]);
});

test("Remove deletes an item and the count follows", async ({ page }) => {
  const url = await makeTask(page, `Checklist remove ${Date.now()}`);
  for (const item of ["Keep this one", "Drop this one"]) await addByEnter(page, item);
  await tick(page, "Drop this one").click();
  await expect(status(page)).toHaveText("1 of 2 done");

  await checklist(page).getByRole("button", { name: 'Remove "Drop this one"' }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(status(page)).toHaveText("0 of 1 done");

  await page.goto(url);
  await expect(items(page)).toContainText(["Keep this one"]);
  await expect(checklist(page)).not.toContainText("Drop this one");
});

test("ticking every item prompts to finish the task but does not finish it", async ({ page }) => {
  await makeTask(page, `Checklist finish ${Date.now()}`);
  const hint = checklist(page).getByText("Every item is done. Mark the task complete above.");
  await addByEnter(page, "Only step");
  await expect(hint).toHaveCount(0);

  await tick(page, "Only step").click();
  await expect(status(page)).toHaveText("1 of 1 done");
  await expect(hint).toBeVisible();
  // The task itself is still open: a checklist is not the task.
  await expect(main(page).getByRole("button", { name: "Mark complete" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Reopen task" })).toHaveCount(0);

  await main(page).getByRole("button", { name: "Mark complete" }).click();
  await expect(main(page).getByRole("button", { name: "Reopen task" })).toBeVisible();
  // Once the task is done there is nothing left to prompt about.
  await expect(hint).toHaveCount(0);
});

test("markup in an item is shown as text, and a 500-character title is cut to 200", async ({ page }) => {
  const url = await makeTask(page, `Checklist hostile ${Date.now()}`);
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });

  await addByEnter(page, "<img src=x onerror=alert(1)>");
  await expect(items(page)).toContainText(["<img src=x onerror=alert(1)>"]);
  await expect(checklist(page).locator("img")).toHaveCount(0);

  // A line break and tabs typed or pasted into the title are spaces once stored.
  await addField(page).fill("two\nlines\tand tabs");
  await addButton(page).click();
  await expect(checklist(page)).toContainText("two lines and tabs");

  // The field limits what a person types; a longer value has to be cut by the server.
  await addField(page).evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.removeAttribute("maxlength");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, "z".repeat(500));
  await addButton(page).click();
  await expect(items(page)).toHaveCount(3);
  await page.goto(url);
  const long = items(page).filter({ hasText: "zzzz" }).locator("span").first();
  await expect(long).toHaveText("z".repeat(200));
  expect(dialogs, "no script ran").toBe(0);
});

test("two quick clicks on Add make one item", async ({ page }) => {
  await makeTask(page, `Checklist double ${Date.now()}`);
  await addField(page).fill("Only once");
  await addButton(page).dblclick();
  await expect(checklist(page)).toContainText("Only once");
  await expect(items(page)).toHaveCount(1);
  await expect(status(page)).toHaveText("0 of 1 done");
  // Wait out any late second request before looking again.
  await page.waitForTimeout(700);
  await expect(items(page)).toHaveCount(1);
});

test("text typed while an add is still being saved is kept, not wiped when it lands", async ({ page }) => {
  // Found by looking: typing the next item straight after Enter lost it, because the first add's success
  // cleared the field. The save is slowed here so the window is wide instead of a few milliseconds.
  await makeTask(page, `Checklist typing ${Date.now()}`);
  await page.route("**/tasks/*", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await addField(page).fill("First of two");
  await addField(page).press("Enter");
  await addField(page).fill("Second of two"); // typed while the first is still being saved
  await expect(checklist(page)).toContainText("First of two");
  await expect(addField(page)).toHaveValue("Second of two");

  await addField(page).press("Enter");
  await expect(items(page)).toContainText(["First of two", "Second of two"]);
  await expect(addField(page)).toHaveValue("");
});

test("by keyboard, focus stays on the control that was used, or moves to a neighbour", async ({ page }) => {
  await makeTask(page, `Checklist keys ${Date.now()}`);
  for (const item of ["Alpha", "Bravo", "Charlie"]) await addByEnter(page, item);
  const button = (name: string) => checklist(page).getByRole("button", { name });

  await button('Move "Alpha" down').focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toContainText(["Bravo", "Alpha", "Charlie"]);
  await expect(button('Move "Alpha" down')).toBeFocused();

  await button('Mark "Bravo" done').focus();
  await page.keyboard.press("Space");
  await expect(status(page)).toHaveText("1 of 3 done");
  await expect(button('Mark "Bravo" not done')).toBeFocused();

  // After a removal focus goes to the next row, or the previous one when it was the last, or the field.
  await button('Remove "Alpha"').focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveCount(2);
  await expect(button('Edit "Charlie"')).toBeFocused();
  await button('Remove "Charlie"').focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveCount(1);
  await expect(button('Edit "Bravo"')).toBeFocused();
  await button('Remove "Bravo"').focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveCount(0);
  await expect(addField(page)).toBeFocused();
});

test("by keyboard, closing the editor puts focus back on that item's Edit button", async ({ page }) => {
  await makeTask(page, `Checklist edit focus ${Date.now()}`);
  await addByEnter(page, "Original");
  const field = checklist(page).getByLabel("Edit item");
  const edit = (name: string) => checklist(page).getByRole("button", { name: `Edit "${name}"` });

  await edit("Original").focus();
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await field.fill("Changed");
  await page.keyboard.press("Enter");
  await expect(checklist(page)).toContainText("Changed");
  await expect(edit("Changed")).toBeFocused();

  await edit("Changed").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(edit("Changed")).toBeFocused();

  await edit("Changed").focus();
  await page.keyboard.press("Enter");
  await checklist(page).getByRole("button", { name: "Cancel" }).click();
  await expect(edit("Changed")).toBeFocused();
});

test("an action on a step that is gone says so and brings the list up to date", async ({ page }) => {
  const url = await makeTask(page, `Checklist stale ${Date.now()}`);
  for (const item of ["Stays", "Goes"]) await addByEnter(page, item);
  // Removed behind this page's back, the way a second tab would.
  await sql(`DELETE FROM "TaskChecklistItem" WHERE "taskId" = $1 AND "title" = 'Goes'`, [url.split("/").pop()]);

  await tick(page, "Goes").click();
  await expect(checklist(page).getByRole("alert")).toContainText("no longer exists");
  await expect(items(page)).toHaveCount(1);
  await expect(checklist(page)).not.toContainText("Goes");
});

test("until the refreshed list arrives the buttons do nothing, instead of acting on a row that is gone", async ({ page }) => {
  await makeTask(page, `Checklist refresh ${Date.now()}`);
  for (const item of ["Keep this", "Drop this"]) await addByEnter(page, item);
  // Slow down only the page refresh (the request Next makes after a change), not the change itself.
  await page.route("**/tasks/*", async (route) => {
    if (route.request().method() === "GET") await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  const saved = page.waitForResponse((response) => response.request().method() === "POST");
  await checklist(page).getByRole("button", { name: 'Remove "Drop this"' }).click();
  await saved;
  // The row is still drawn for a moment. A click on it must not reach the server.
  await checklist(page).getByRole("button", { name: 'Move "Drop this" up' }).click({ force: true });
  await checklist(page).getByRole("button", { name: 'Mark "Drop this" done' }).click({ force: true });
  await expect(items(page)).toHaveCount(1);
  await expect(checklist(page).getByRole("alert")).toHaveCount(0);
});

test("another task's page has its own list, and a full list says so and stops", async ({ page }) => {
  const stamp = Date.now();
  const first = await makeTask(page, `Checklist one ${stamp}`);
  await addByEnter(page, "Belongs to the first");
  await makeTask(page, `Checklist two ${stamp}`);
  await expect(items(page)).toHaveCount(0);
  await expect(checklist(page)).not.toContainText("Belongs to the first");

  // Fill this task's list to the limit directly in the database: fifty adds through the page would test
  // the speed of the browser, not the rule.
  const id = page.url().split("/").pop()!;
  await sql(
    `INSERT INTO "TaskChecklistItem" ("id", "userId", "taskId", "title", "position", "updatedAt")
     SELECT gen_random_uuid()::text, t."userId", t."id", 'Seeded item ' || g, g, now()
     FROM "Task" t, generate_series(0, 49) AS g WHERE t."id" = $1`,
    [id],
  );

  await page.goto(page.url());
  await expect(status(page)).toHaveText("0 of 50 done");
  await expect(checklist(page)).toContainText("A checklist holds at most 50 items.");
  await expect(addField(page)).toBeDisabled();
  await expect(addButton(page)).toBeDisabled();

  // Removing one opens a place again.
  await checklist(page).getByRole("button", { name: 'Remove "Seeded item 49"' }).click();
  await expect(status(page)).toHaveText("0 of 49 done");
  await expect(addField(page)).toBeEnabled();

  await page.goto(first);
  await expect(items(page)).toContainText(["Belongs to the first"]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the checklist fits a phone in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const stamp = Date.now();
    const url = await makeTask(page, `Checklist phone ${scheme} ${stamp}`);

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tall = async (target: Locator, label: string) => {
      const box = await target.boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(375);
    };

    await addByEnter(page, "A short step");
    await addByEnter(page, `A long step ${"wordy ".repeat(12)}and an unbroken ${"x".repeat(80)}`);
    await tick(page, "A short step").click();
    await expect(status(page)).toHaveText("1 of 2 done");

    await page.goto(url);
    await tall(addField(page), "Add an item field");
    await tall(addButton(page), "Add item");
    for (const button of await checklist(page).getByRole("button", { name: /^(Edit|Move|Remove) / }).all()) {
      await tall(button, (await button.getAttribute("aria-label")) ?? "button");
    }
    expect(await overflow()).toBeLessThanOrEqual(0);

    // The tick box is drawn 20px wide; the button around it has to be 44px, which only a hit test can show.
    const tickName = 'Mark "A short step" not done';
    const missed = await page.evaluate((name) => {
      const tick = document.querySelector(`button[aria-label='${name}']`) as HTMLElement;
      const r = tick.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return [[-21, 0], [21, 0], [0, -21], [0, 21], [-21, -21], [21, 21]].filter(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest("button") !== tick);
    }, tickName);
    expect(missed, "points within 21px of the tick box's centre that do not reach it").toEqual([]);

    // The editing row is as wide as the page allows and no wider.
    await checklist(page).getByRole("button", { name: 'Edit "A short step"' }).click();
    await tall(checklist(page).getByLabel("Edit item"), "Edit field");
    await tall(checklist(page).getByRole("button", { name: "Save" }), "Save");
    await tall(checklist(page).getByRole("button", { name: "Cancel" }), "Cancel");
    expect(await overflow()).toBeLessThanOrEqual(0);

    // The /tasks list carries the badge without widening the row.
    await page.goto("/tasks");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
