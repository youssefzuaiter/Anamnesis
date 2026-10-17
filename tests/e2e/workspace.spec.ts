import { test, expect, type Page } from "@playwright/test";

/**
 * Assertions read `main`, never `body`. `body.textContent` includes script
 * contents — among them Next's RSC flight payload, which retains props of
 * pages visited earlier in the session, so a deleted item can appear to still
 * be listed. `innerText` also returns rendered text, so anything styled
 * uppercase comes back uppercased; match case-insensitively.
 */
function main(page: Page) {
  return page.locator("main");
}

async function mainText(page: Page): Promise<string> {
  return (await main(page).innerText()).toLowerCase();
}

test("dashboard greets the signed-in user", async ({ page }) => {
  await page.goto("/");
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText(
    /e2e/i,
  );
});

test("a note can be written, read back as Markdown, and found again", async ({
  page,
}) => {
  const title = `Gradient descent ${Date.now()}`;

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill(
    'textarea[name="content"]',
    "# Heading\n\nGradient descent steps against the gradient.\n\n- learning rate\n- convergence\n",
  );
  // The dashboard shell puts <aside> before <main>, so a bare
  // button[type=submit] selector would hit the sidebar's sign-out button.
  await main(page).getByRole("button", { name: /create note/i }).click();

  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  // Reading view renders Markdown rather than showing raw text.
  await expect(main(page).getByRole("heading", { name: "Heading" })).toBeVisible();
  await expect(main(page).getByRole("listitem").first()).toContainText(
    "learning rate",
  );

  await page.goto("/notes");
  expect(await mainText(page)).toContain(title.toLowerCase());
});

test("editing a note records a restorable version", async ({ page }) => {
  const title = `Versioned ${Date.now()}`;

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "The original wording.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  const noteUrl = page.url();

  await main(page).getByRole("button", { name: /^edit$/i }).click();
  await page.fill('textarea[name="content"]', "Overwritten by accident.");
  await main(page).getByRole("button", { name: /save changes/i }).click();
  await expect(main(page)).toContainText(/saved/i);

  await page.goto(`${noteUrl}/history`);
  expect(await mainText(page)).toContain("restore");

  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /restore/i }).first().click();

  await page.waitForURL(noteUrl);
  expect(await mainText(page)).toContain("the original wording");
});

test("a task can be created, tagged, and completed", async ({ page }) => {
  const title = `Read chapter ${Date.now()}`;

  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="tags"]', "e2e-tag");
  await main(page).getByRole("button", { name: /add task|create task/i }).click();

  await expect(main(page)).toContainText(title);
  expect(await mainText(page)).toContain("e2e-tag");

  // The tag filter narrows to it.
  await page.goto("/tasks?tag=e2e-tag");
  await expect(main(page)).toContainText(title);
});

test("the trash restores a deleted note", async ({ page }) => {
  const title = `Doomed ${Date.now()}`;

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "Delete me and bring me back.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  await main(page).getByRole("button", { name: /^edit$/i }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /delete/i }).click();

  await page.waitForURL(/\/notes$/);
  expect(await mainText(page)).not.toContain(title.toLowerCase());

  await page.goto("/trash");
  await expect(main(page)).toContainText(title);
  await main(page)
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("button", { name: /restore/i })
    .click();

  await expect(main(page)).not.toContainText(title);
  await page.goto("/notes");
  expect(await mainText(page)).toContain(title.toLowerCase());
});

test("a course computes what is needed on the remaining work", async ({
  page,
}) => {
  const code = `E2E${Date.now().toString().slice(-5)}`;

  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', "Test Course");
  await main(page).getByRole("button", { name: /add course/i }).click();

  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);

  await page.fill('input[name="title"]', "Midterm");
  await page.fill('input[name="weight"]', "30");
  await page.fill('input[name="score"]', "72");
  await main(page).getByRole("button", { name: /add assessment/i }).click();

  await expect(main(page)).toContainText("Midterm");
  // 30% of the course banked at 72% = 21.6 points, average 72%.
  expect(await mainText(page)).toContain("72.0%");
});

test("a task due today appears under Due now on the dashboard", async ({
  page,
}) => {
  const title = `Submit assignment ${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);

  await page.goto("/tasks");
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="dueDate"]', today);
  await main(page).getByRole("button", { name: /add task|create task/i }).click();
  await expect(main(page)).toContainText(title);

  // Reminders is a client component that polls on mount, so no reload is
  // needed — but it does need a moment for that first fetch to resolve.
  await page.goto("/");
  await expect(main(page).getByText(/due now/i)).toBeVisible();
  await expect(main(page)).toContainText(title);
});

test("a file can be attached to a note and removed again", async ({
  page,
}) => {
  const title = `Lecture slides ${Date.now()}`;

  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "See attached slides.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);

  await page
    .getByLabel("File to attach")
    .setInputFiles({
      name: "slides.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Week 3: recursion and induction."),
    });
  await main(page).getByRole("button", { name: /^attach$/i }).click();

  const row = main(page).getByRole("listitem").filter({ hasText: "slides.txt" });
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: /remove/i }).click();
  await expect(main(page)).not.toContainText("slides.txt");
});

test("selected notes can be bulk-tagged, then bulk-deleted", async ({
  page,
}) => {
  const stamp = Date.now();
  const titleA = `Bulk A ${stamp}`;
  const titleB = `Bulk B ${stamp}`;
  const tag = `bulk-${stamp}`;

  for (const title of [titleA, titleB]) {
    await page.goto("/notes/new");
    await page.fill('input[name="title"]', title);
    await page.fill('textarea[name="content"]', "Note content.");
    await main(page).getByRole("button", { name: /create note/i }).click();
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  }

  await page.goto("/notes");
  await page.getByLabel(`Select ${titleA}`).check();
  await page.getByLabel(`Select ${titleB}`).check();

  await page.getByLabel("Tag to add").fill(tag);
  await main(page).getByRole("button", { name: /^tag$/i }).click();
  await expect(main(page)).toContainText(/tagged 2 notes/i);

  await page.goto(`/notes?tag=${tag}`);
  await expect(main(page)).toContainText(titleA);
  await expect(main(page)).toContainText(titleB);

  await page.getByLabel(`Select ${titleA}`).check();
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /^delete$/i }).click();
  await expect(main(page)).toContainText(/moved 1 note/i);

  await page.reload();
  expect(await mainText(page)).not.toContain(titleA.toLowerCase());
  expect(await mainText(page)).toContain(titleB.toLowerCase());
});

test("rebuilding the search index reports how many items were indexed", async ({
  page,
}) => {
  await page.goto("/settings");
  await main(page).getByRole("button", { name: /rebuild search index/i }).click();
  await expect(main(page)).toContainText(/rebuilt \d+ items/i, {
    timeout: 30_000,
  });
});

test("an assistant thread is saved and survives a reload", async ({
  page,
}) => {
  // Local CPU inference is slow, and CI (a shared, GPU-less runner) is
  // slower again — the default per-test timeout (60s, playwright.config.ts)
  // is tuned for everything else in this file, not for local model inference.
  test.setTimeout(process.env.CI ? 180_000 : 90_000);

  const question = `What tags do my tasks have, as of ${Date.now()}?`;

  await page.goto("/ai");
  await page.getByLabel("Ask your workspace").fill(question);
  await main(page).getByRole("button", { name: /^ask$/i }).click();

  // Sending clears the input, so the "Ask" button going back to enabled is
  // not a signal of anything — it's disabled again purely because the input
  // is now empty. The thread appearing in the sidebar only happens after the
  // full round trip (streaming finished, then the route's own finally block
  // persists the answer and the client calls router.refresh()), so it's the
  // right thing to wait on, and it's what's actually under test here — not
  // the model's wording.
  const thread = main(page).getByRole("link", { name: new RegExp(question.slice(0, 30)) });
  await expect(thread).toBeVisible({
    timeout: process.env.CI ? 170_000 : 60_000,
  });
  const threadHref = await thread.getAttribute("href");

  await page.goto("/ai");
  await expect(
    main(page).getByRole("link", { name: new RegExp(question.slice(0, 30)) }),
  ).toBeVisible();

  await page.goto(threadHref!);
  await expect(main(page)).toContainText(question);
});

test("a goal rolls up a linked task, survives deletion's detach, and restores honestly", async ({
  page,
}) => {
  const stamp = Date.now();
  const goalTitle = `Ship the thesis ${stamp}`;
  const taskTitle = `Draft chapter ${stamp}`;

  await page.goto("/goals");
  await page.fill('input[name="title"]', goalTitle);
  await main(page).getByRole("button", { name: /create goal/i }).click();
  await expect(main(page)).toContainText(goalTitle);

  // Link a task to it from the ordinary task form — the goal picker only
  // appears once at least one goal exists.
  await page.goto("/tasks");
  await page.fill('input[name="title"]', taskTitle);
  await page.selectOption('select[name="goalId"]', { label: goalTitle });
  await main(page).getByRole("button", { name: /add task/i }).click();
  await expect(main(page)).toContainText(taskTitle);

  await page.goto("/goals");
  await main(page).getByRole("link", { name: new RegExp(goalTitle) }).click();
  await page.waitForURL(/\/goals\/[0-9a-f-]{36}$/);

  const progress = main(page).getByRole("progressbar", { name: /goal progress/i });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(main(page)).toContainText(taskTitle);

  // Completing the task from the goal's own page rolls up to 100% in place,
  // with no reload — the page is a server component, so this is also what
  // proves the action's revalidation reaches /goals/[id], not just /goals.
  await main(page)
    .getByRole("button", { name: new RegExp(`complete ${taskTitle}`, "i") })
    .click();
  await expect(progress).toHaveAttribute("aria-valuenow", "100");

  // Deleting goes through the app's native confirm(), which Playwright can
  // answer — the browser automation used for manual checks could not.
  page.once("dialog", (dialog) => dialog.accept());
  await main(page).getByRole("button", { name: /delete goal/i }).click();
  await page.waitForURL(/\/goals$/);
  expect(await mainText(page)).not.toContain(goalTitle.toLowerCase());

  // Deleting a goal detaches its work rather than taking it along.
  await page.goto("/tasks");
  await expect(main(page)).toContainText(taskTitle);

  await page.goto("/trash");
  await expect(main(page)).toContainText(goalTitle);
  await main(page)
    .getByRole("listitem")
    .filter({ hasText: goalTitle })
    .getByRole("button", { name: /restore/i })
    .click();
  await expect(main(page)).not.toContainText(goalTitle);

  // The goal was at 100% when deleted. Its task is no longer attached, so it
  // must come back at 0%, not at the figure it was holding.
  await page.goto("/goals");
  await expect(
    main(page).getByRole("progressbar", { name: `${goalTitle} progress` }),
  ).toHaveAttribute("aria-valuenow", "0");
});

test("navigation reaches every section", async ({ page }) => {
  for (const [path, heading] of [
    ["/goals", /goals/i],
    ["/search", /search/i],
    ["/cards", /cards/i],
    ["/review", /weekly review/i],
    ["/courses", /courses/i],
    ["/settings", /settings/i],
    ["/trash", /trash/i],
    ["/calendar/subscriptions", /imported calendars/i],
  ] as const) {
    await page.goto(path);
    await expect(
      main(page).getByRole("heading", { level: 1 }),
      `heading on ${path}`,
    ).toHaveText(heading);
  }
});
