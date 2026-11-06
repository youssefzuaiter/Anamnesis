import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * A project's Kanban board, driven through the browser. No model is involved. Every test makes its own project
 * (a title with the time in it), so the shared account's other projects never matter.
 */

/** Assertions read `main`, never `body` (see workspace.spec.ts for why). */
function main(page: Page) {
  return page.locator("main");
}

const board = (page: Page) => main(page).getByRole("region", { name: "Board" });
const column = (page: Page, name: string) => board(page).getByRole("region", { name });
const card = (page: Page, name: string, title: string) => column(page, name).getByRole("listitem").filter({ hasText: title });
const moveButton = (page: Page, from: string, title: string, to: string) =>
  card(page, from, title).getByRole("button", { name: `Move "${title}" to ${to}` });
const progress = (page: Page) => main(page).getByRole("progressbar", { name: "Project progress" });
const alertIn = (page: Page) => board(page).getByRole("alert");

const pad = (n: number) => String(n).padStart(2, "0");
function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Runs one statement against the database the app uses, for what a second tab or a bulk seed would do. */
async function sql(statement: string, params: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(statement, params);
  } finally {
    await client.end();
  }
}

/** Reads rows from the database the app uses. */
async function rows<T = Record<string, string>>(statement: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Makes a project through the form and returns the address of its page. */
async function makeProject(page: Page, title: string): Promise<string> {
  await page.goto("/projects");
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /create project/i }).click();
  await main(page).getByRole("link", { name: new RegExp(title) }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  return page.url();
}

/** Adds a task to a project through the ordinary task form. */
async function addTask(page: Page, title: string, project: string, due?: string) {
  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await page.selectOption('select[name="projectId"]', { label: project });
  if (due) await page.fill('input[name="dueDate"]', due);
  await main(page).getByRole("button", { name: /add task/i }).click();
  await expect(main(page)).toContainText(title);
}

/** A project with the given tasks, opened as a board. Returns its list address and the project's title. */
async function projectWith(page: Page, label: string, titles: string[]) {
  const project = `${label} ${Date.now()}`;
  const url = await makeProject(page, project);
  for (const title of titles) await addTask(page, title, project);
  await page.goto(`${url}?view=board`);
  await expect(board(page)).toBeVisible();
  return { project, url };
}

test("a project opens as a list, and the board is opt-in", async ({ page }) => {
  const stamp = Date.now();
  const title = `Optin ${stamp}`;
  const { url } = await projectWith(page, "Optin", [title]);

  await page.goto(url);
  await expect(board(page)).toHaveCount(0);
  const nav = main(page).getByRole("navigation", { name: "Task view" });
  await expect(nav.getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "true");
  await expect(nav.getByRole("link", { name: "Board" })).not.toHaveAttribute("aria-current", /.*/);
  await expect(main(page).getByRole("link", { name: title })).toHaveCount(1);

  await nav.getByRole("link", { name: "Board" }).click();
  await expect(page).toHaveURL(/\?view=board$/);
  await expect(nav.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "true");
  for (const name of ["To do", "In progress", "Done"]) await expect(column(page, name)).toBeVisible();
  await expect(card(page, "To do", title)).toBeVisible();
  // The board replaces the list: the title is on the page once.
  await expect(main(page).getByRole("link", { name: title })).toHaveCount(1);

  // Anything but "board" is the list.
  await page.goto(`${url}?view=sideways`);
  await expect(board(page)).toHaveCount(0);
});

test("a project with no tasks says so, in both views", async ({ page }) => {
  const url = await makeProject(page, `Empty ${Date.now()}`);
  for (const view of ["", "?view=board"]) {
    await page.goto(`${url}${view}`);
    await expect(main(page)).toContainText("No tasks yet");
    await expect(board(page)).toHaveCount(0);
  }
});

test("Move buttons put a card in another column, and the counts and progress follow", async ({ page }) => {
  const stamp = Date.now();
  const a = `Alpha ${stamp}`;
  const b = `Bravo ${stamp}`;
  const { url } = await projectWith(page, "Move", [a, b]);

  await expect(column(page, "To do").getByText("2 tasks", { exact: true })).toBeVisible();
  await expect(column(page, "In progress").getByText("0 tasks", { exact: true })).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");

  await moveButton(page, "To do", a, "In progress").click();
  await expect(card(page, "In progress", a)).toBeVisible();
  await expect(card(page, "To do", a)).toHaveCount(0);
  await expect(column(page, "In progress").getByText("1 task", { exact: true })).toBeVisible();
  await expect(board(page).getByRole("status")).toHaveText(`Moved “${a}” to In progress.`);
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0"); // in progress is not done

  await moveButton(page, "In progress", a, "Done").click();
  await expect(card(page, "Done", a)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "50");

  await page.reload();
  await expect(card(page, "Done", a)).toBeVisible();
  await expect(card(page, "To do", b)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${url.split("/").pop()}\\?view=board$`));

  // And back: from Done to To do.
  await moveButton(page, "Done", a, "To do").click();
  await expect(card(page, "To do", a)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
});

test("the checkbox completes and reopens a card through the same move", async ({ page }) => {
  const title = `Tick ${Date.now()}`;
  await projectWith(page, "Tick", [title]);
  await card(page, "To do", title).getByRole("button", { name: `Complete ${title}` }).click();
  await expect(card(page, "Done", title)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "100");
  await card(page, "Done", title).getByRole("button", { name: `Reopen ${title}` }).click();
  await expect(card(page, "To do", title)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
});

test("dragging a card to another column moves it, and dropping it where it is does nothing", async ({ page }) => {
  const title = `Drag ${Date.now()}`;
  await projectWith(page, "Drag", [title]);

  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  await card(page, "To do", title).dragTo(column(page, "In progress"));
  await expect(card(page, "In progress", title)).toBeVisible();
  await expect(card(page, "To do", title)).toHaveCount(0);
  await expect(board(page).getByRole("status")).toHaveText(`Moved “${title}” to In progress.`);
  const afterMove = posts.length;
  expect(afterMove).toBeGreaterThan(0);

  await card(page, "In progress", title).dragTo(column(page, "In progress"));
  await page.waitForTimeout(700);
  expect(posts.length, "nothing was sent for a drop on its own column").toBe(afterMove);
  await expect(card(page, "In progress", title)).toBeVisible();

  await card(page, "In progress", title).dragTo(column(page, "Done"));
  await expect(card(page, "Done", title)).toBeVisible();
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "100");
});

test("a move the server cannot take puts the card back and says so", async ({ page }) => {
  const title = `Offline ${Date.now()}`;
  await projectWith(page, "Offline", [title]);
  // Slow, then refuse: the card is seen in its new column first, then back.
  await page.route("**/projects/*", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.abort();
      return;
    }
    await route.continue();
  });

  await moveButton(page, "To do", title, "In progress").click();
  await expect(card(page, "In progress", title)).toBeVisible();
  await expect(alertIn(page)).toContainText("Could not reach the server");
  await expect(card(page, "To do", title)).toBeVisible();
  await expect(card(page, "In progress", title)).toHaveCount(0);
});

test("a task removed behind the page's back: the move says so and the card leaves", async ({ page }) => {
  const stamp = Date.now();
  const gone = `Gone ${stamp}`;
  const stays = `Stays ${stamp}`;
  await projectWith(page, "Gone", [gone, stays]);
  await sql(`UPDATE "Task" SET "deletedAt" = now() WHERE "title" = $1`, [gone]);

  await moveButton(page, "To do", gone, "In progress").click();
  await expect(alertIn(page)).toContainText("no longer exists");
  await expect(card(page, "To do", gone)).toHaveCount(0);
  await expect(card(page, "In progress", gone)).toHaveCount(0);
  await expect(card(page, "To do", stays)).toBeVisible();
});

test("a refreshed list does not flash the card back into the column it left", async ({ page }) => {
  const title = `Flash ${Date.now()}`;
  await projectWith(page, "Flash", [title, `Other ${Date.now()}`]);
  // Slow the answer so the optimistic card is on screen for a while before the real list arrives.
  await page.route("**/projects/*", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.evaluate((text) => {
    const todo = document.querySelector('section[aria-label="To do"]')!;
    const w = window as unknown as { __back: number };
    w.__back = 0;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.textContent?.includes(text)) w.__back += 1;
    }).observe(todo, { childList: true, subtree: true });
  }, title);

  await moveButton(page, "To do", title, "In progress").click();
  await expect(card(page, "In progress", title)).toBeVisible();
  await expect(board(page).getByRole("status")).toHaveText(`Moved “${title}” to In progress.`);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as unknown as { __back: number }).__back), "the card was drawn in To do again").toBe(0);
  await expect(card(page, "In progress", title)).toBeVisible();
});

test("while one move is being saved another is ignored, so a double click moves one card once", async ({ page }) => {
  const stamp = Date.now();
  const first = `First ${stamp}`;
  const second = `Second ${stamp}`;
  await projectWith(page, "Busy", [first, second]);
  await page.route("**/projects/*", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await moveButton(page, "To do", first, "In progress").click();
  await expect(card(page, "In progress", first)).toBeVisible();
  // The next card has slid into the place of the first. A click on it must not reach the server.
  await moveButton(page, "To do", second, "In progress").click({ force: true });
  await page.waitForTimeout(1500);
  await expect(card(page, "To do", second)).toBeVisible();
  await expect(card(page, "In progress", second)).toHaveCount(0);

  // A real double click on the same button, with nothing in flight yet.
  await moveButton(page, "To do", second, "Done").dblclick();
  await expect(card(page, "Done", second)).toBeVisible();
  await expect(column(page, "Done").getByRole("listitem")).toHaveCount(1);
});

test("by keyboard, a Move button works and focus follows the card", async ({ page }) => {
  const title = `Keys ${Date.now()}`;
  await projectWith(page, "Keys", [title]);
  await moveButton(page, "To do", title, "In progress").focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "In progress", title)).toBeVisible();
  await expect(card(page, "In progress", title).getByRole("link", { name: title })).toBeFocused();

  // The first move is still being saved until its notice arrives and the buttons are available again.
  await expect(board(page).getByRole("status")).toHaveText(`Moved “${title}” to In progress.`);
  await expect(moveButton(page, "In progress", title, "Done")).not.toHaveAttribute("aria-disabled", /.*/);
  await moveButton(page, "In progress", title, "Done").focus();
  await page.keyboard.press("Space");
  await expect(card(page, "Done", title)).toBeVisible();
  await expect(card(page, "Done", title).getByRole("link", { name: title })).toBeFocused();
});

test("a drop that carries an id that is not on this board does nothing and sends nothing", async ({ page }) => {
  const stamp = Date.now();
  const mine = `Mine ${stamp}`;
  const theirs = `Theirs ${stamp}`;
  const markup = `<img src=x onerror=alert(1)> ${stamp}`;
  const { url } = await projectWith(page, "Forge", [mine, markup]);
  const otherProject = `Elsewhere ${stamp}`;
  await makeProject(page, otherProject);
  await addTask(page, theirs, otherProject);
  const [{ id: foreignId }] = await rows<{ id: string }>(`SELECT "id" FROM "Task" WHERE "title" = $1`, [theirs]);
  await page.goto(`${url}?view=board`);

  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });

  // A drop as another tab, another window or another site could make one: our type with any text in it, or text of
  // another type. Only a card that is on this board may move.
  const dropOn = (name: string, type: string, payload: string) =>
    column(page, name).evaluate(
      (el, [mime, data]) => {
        const transfer = new DataTransfer();
        transfer.setData(mime, data);
        el.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      },
      [type, payload],
    );
  const mime = "application/x-anamnesis-board-task-id";
  const myId = (await card(page, "To do", mine).getByRole("link").getAttribute("href"))!.split("/").pop()!;

  await dropOn("In progress", mime, "00000000-0000-4000-8000-000000000000");
  await dropOn("In progress", mime, foreignId);
  await dropOn("Done", mime, "'; DROP TABLE \"Task\"; --");
  await dropOn("Done", mime, "x".repeat(100_000));
  await dropOn("In progress", "text/plain", myId);
  await dropOn("In progress", "application/x-nexus-task-id", myId); // the calendar's type is not a board card
  await page.waitForTimeout(700);

  expect(posts, "nothing was sent").toEqual([]);
  expect(dialogs, "no script ran").toBe(0);
  await expect(card(page, "To do", mine)).toBeVisible();
  const [still] = await rows<{ status: string }>(`SELECT "status" FROM "Task" WHERE "id" = $1`, [foreignId]);
  expect(still.status, "another project's task was not touched").toBe("todo");

  // A title of markup is text on a card, and nothing more.
  await expect(card(page, "To do", markup)).toBeVisible();
  await expect(board(page).locator("img")).toHaveCount(0);

  // The same drop with this board's own card does move it: the helper is not what made the rest do nothing.
  await dropOn("In progress", mime, myId);
  await expect(card(page, "In progress", mine)).toBeVisible();
  expect(posts.length).toBeGreaterThan(0);
});

test("an empty column says what to do", async ({ page }) => {
  await projectWith(page, "Quiet", [`Only ${Date.now()}`]);
  await expect(column(page, "In progress")).toContainText("Nothing in progress");
  await expect(column(page, "Done")).toContainText("Nothing done yet");
});

test("Done shows the ten newest, and Show all draws the rest", async ({ page }) => {
  const { url } = await projectWith(page, "Many", [`Seed ${Date.now()}`]);
  const id = url.split("/").pop()!;
  await sql(
    `INSERT INTO "Task" ("id", "userId", "projectId", "title", "status", "tags", "completedAt", "updatedAt")
     SELECT gen_random_uuid()::text, p."userId", p."id", 'Finished ' || g, 'done', ARRAY[]::text[], now() - (g || ' hours')::interval, now()
     FROM "Project" p, generate_series(1, 12) AS g WHERE p."id" = $1`,
    [id],
  );
  await page.goto(`${url}?view=board`);

  const done = column(page, "Done");
  await expect(done.getByText("12 tasks", { exact: true })).toBeVisible();
  await expect(done.getByRole("listitem")).toHaveCount(10);
  await expect(done.getByRole("listitem").first()).toContainText("Finished 1");
  const toggle = done.getByRole("button", { name: "Show all 12" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(done.getByRole("listitem")).toHaveCount(12);
  await expect(done.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  await done.getByRole("button", { name: "Show fewer" }).click();
  await expect(done.getByRole("listitem")).toHaveCount(10);
});

test("a card shows its due day, overdue only while open, its checklist and nothing from elsewhere", async ({ page }) => {
  const stamp = Date.now();
  const project = `Facts ${stamp}`;
  const late = `Late ${stamp}`;
  const url = await makeProject(page, project);
  await addTask(page, late, project, isoDay(-1));
  const otherProject = `Elsewhere ${stamp}`;
  await makeProject(page, otherProject);
  await addTask(page, `Foreign ${stamp}`, otherProject);
  await addTask(page, `Trashed ${stamp}`, project);
  await sql(`UPDATE "Task" SET "deletedAt" = now() WHERE "title" = $1`, [`Trashed ${stamp}`]);
  await sql(
    `INSERT INTO "TaskChecklistItem" ("id", "userId", "taskId", "title", "done", "position", "updatedAt")
     SELECT gen_random_uuid()::text, t."userId", t."id", 'Step ' || g, g = 1, g, now() FROM "Task" t, generate_series(1, 2) AS g WHERE t."title" = $1`,
    [late],
  );
  await page.goto(`${url}?view=board`);

  const lateCard = card(page, "To do", late);
  await expect(lateCard).toContainText("Overdue");
  await expect(lateCard.getByText("1 of 2 checklist items done")).toBeAttached();
  await expect(lateCard.getByText("1/2", { exact: true })).toBeVisible();
  await expect(board(page)).not.toContainText(`Foreign ${stamp}`);
  await expect(board(page)).not.toContainText(`Trashed ${stamp}`);

  await moveButton(page, "To do", late, "Done").click();
  await expect(card(page, "Done", late)).toBeVisible();
  await expect(card(page, "Done", late)).not.toContainText("Overdue");
});

for (const scheme of ["light", "dark"] as const) {
  test(`on a phone the board shows one column at a time in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const stamp = Date.now();
    const a = `Phone A ${scheme} ${stamp}`;
    const b = `Phone B ${scheme} ${stamp}`;
    const c = `A very long task title for a phone ${scheme} ${stamp} ${"wordy ".repeat(10)}`;
    await projectWith(page, `Phone ${scheme}`, [a, b, c]);

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tall = async (target: Locator, label: string) => {
      const box = await target.boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${label} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(375);
    };

    // A card's checkbox is drawn 20px wide with a 44px hit area, which only a hit test can show; the rest are measured.
    const tallButtons = async (scope: Locator) => {
      for (const button of await scope.getByRole("button").all()) {
        const name = (await button.getAttribute("aria-label")) ?? "";
        if (/^(Complete|Reopen) /.test(name)) {
          const missed = await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return [[-21, 0], [21, 0], [0, -21], [0, 21]].filter(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest("button") !== el);
          });
          expect(missed, `${name}: points 21px from the box's centre that do not reach it`).toEqual([]);
        } else {
          await tall(button, name || "card button");
        }
      }
    };

    const show = main(page).getByRole("group", { name: "Show column" });
    await expect(show).toBeVisible();
    for (const button of await show.getByRole("button").all()) await tall(button, "column button");
    expect(await overflow()).toBeLessThanOrEqual(0);

    // One column at a time: To do is showing, the others are not.
    await expect(column(page, "To do")).toBeVisible();
    await expect(column(page, "In progress")).toBeHidden();
    await expect(column(page, "Done")).toBeHidden();
    await expect(show.getByRole("button", { name: /^To do/ })).toHaveAttribute("aria-pressed", "true");
    await expect(show.getByRole("button", { name: /^In progress/ })).toHaveAttribute("aria-pressed", "false");
    await expect(show.getByRole("button", { name: /^Done/ })).toHaveAttribute("aria-pressed", "false");
    await tallButtons(column(page, "To do"));
    expect(await overflow()).toBeLessThanOrEqual(0);

    await moveButton(page, "To do", a, "In progress").click();
    await expect(card(page, "To do", a)).toHaveCount(0);
    await show.getByRole("button", { name: /^In progress/ }).click();
    await expect(column(page, "In progress")).toBeVisible();
    await expect(column(page, "To do")).toBeHidden();
    await expect(card(page, "In progress", a)).toBeVisible();
    await expect(show.getByRole("button", { name: /^In progress/ })).toHaveAttribute("aria-pressed", "true");
    await expect(show.getByRole("button", { name: /^To do/ })).toHaveAttribute("aria-pressed", "false");
    await tallButtons(column(page, "In progress"));
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}

test("on a desktop all three columns show and there is no column switch", async ({ page }) => {
  await projectWith(page, "Wide", [`Wide ${Date.now()}`]);
  await expect(main(page).getByRole("group", { name: "Show column" })).toBeHidden();
  for (const name of ["To do", "In progress", "Done"]) await expect(column(page, name)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
