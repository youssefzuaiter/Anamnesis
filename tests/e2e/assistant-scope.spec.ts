import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const chat = (page: Page, data: unknown) => page.request.post("/api/ai/chat", { data });

test("a malformed scope in the request is a validation error", async ({ page }) => {
  const id = randomUUID();
  const malformed: unknown[] = [
    { kind: "folder", id },
    { kind: "course", id: "not-a-uuid" },
    { kind: "course", id, userId: "someone-else" },
    [{ kind: "course", id }],
  ];
  for (const scope of malformed) {
    const response = await chat(page, { question: "hello", scope });
    expect(response.status(), JSON.stringify(scope)).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/course, a project or a note/i);
  }
});

test("a scope that is not the caller's own is refused with a 404, before any thread is opened", async ({ page }) => {
  const question = `Scope probe ${Date.now()}`;
  for (const kind of ["course", "project", "note"]) {
    const response = await chat(page, { question, scope: { kind, id: randomUUID() } });
    expect(response.status(), kind).toBe(404);
    expect((await response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  }

  await page.goto("/ai");
  await expect(page.locator("main")).not.toContainText(question);
});

// The control and the links ---------------------------------------------------

function main(page: Page) {
  return page.locator("main");
}

const idFromUrl = (page: Page) => /([0-9a-f-]{36})$/.exec(page.url())![1];

/** Makes a course and leaves the browser on its page. */
async function makeCourse(page: Page): Promise<{ id: string; option: string }> {
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await page.goto("/courses");
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="title"]', "Prep Course");
  await main(page).getByRole("button", { name: /add course/i }).click();
  await main(page).getByRole("link", { name: new RegExp(code) }).click();
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/);
  return { id: idFromUrl(page), option: `${code} — Prep Course` };
}

async function makeProject(page: Page): Promise<{ id: string; title: string }> {
  const title = `Scope project ${Date.now()}`;
  await page.goto("/projects");
  await page.fill('input[name="title"]', title);
  await main(page).getByRole("button", { name: /create project/i }).click();
  await main(page).getByRole("link", { name: new RegExp(title) }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  return { id: idFromUrl(page), title };
}

async function makeNote(page: Page): Promise<{ id: string; title: string }> {
  const title = `Scope note ${Date.now()}`;
  await page.goto("/notes/new");
  await page.fill('input[name="title"]', title);
  await page.fill('textarea[name="content"]', "Something to ask about.");
  await main(page).getByRole("button", { name: /create note/i }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  return { id: idFromUrl(page), title };
}

const picker = (page: Page) => main(page).getByLabel("Ask about", { exact: true });
const searching = (page: Page) => main(page).getByText(/^Searching only this /);

test("the control starts on Everything, says what a choice searches, and shapes the placeholder", async ({ page }) => {
  const course = await makeCourse(page);
  await page.goto("/ai");

  await expect(picker(page)).toHaveValue("");
  await expect(searching(page)).toHaveCount(0);
  await expect(page.getByLabel("Ask your workspace")).toHaveAttribute("placeholder", "Ask your workspace…");

  await picker(page).selectOption({ label: course.option });
  await expect(main(page).getByText("Searching only this course: its notes, tasks, events and grades.")).toBeVisible();
  await expect(page.getByLabel("Ask your workspace")).toHaveAttribute("placeholder", `Ask about ${course.option}…`);

  await picker(page).selectOption({ label: "Everything" });
  await expect(searching(page)).toHaveCount(0);
  await expect(page.getByLabel("Ask your workspace")).toHaveAttribute("placeholder", "Ask your workspace…");
});

test("a question is sent with its scope, and with none after going back to Everything", async ({ page }) => {
  const course = await makeCourse(page);
  const bodies: unknown[] = [];
  // The wiring is what is under test, so the model is not needed: the server side has its own tests.
  await page.route("**/api/ai/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "citations", citations: [] })}\n${JSON.stringify({ type: "delta", text: "ok" })}\n`,
    });
  });

  await page.goto("/ai");
  await picker(page).selectOption({ label: course.option });
  await page.getByLabel("Ask your workspace").fill("What is in this course?");
  await main(page).getByRole("button", { name: /^ask$/i }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect((bodies[0] as { scope: unknown }).scope).toEqual({ kind: "course", id: course.id });

  await picker(page).selectOption({ label: "Everything" });
  await page.getByLabel("Ask your workspace").fill("And overall?");
  await main(page).getByRole("button", { name: /^ask$/i }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect((bodies[1] as { scope: unknown }).scope).toBeNull();
});

test("the Ask about links open the assistant with that scope chosen", async ({ page }) => {
  const course = await makeCourse(page);
  await main(page).getByRole("link", { name: "Ask about this course" }).click();
  await page.waitForURL(`**/ai?scope=course:${course.id}`);
  await expect(picker(page)).toHaveValue(`course:${course.id}`);
  await expect(main(page).getByText("Searching only this course:", { exact: false })).toBeVisible();

  const project = await makeProject(page);
  await main(page).getByRole("link", { name: "Ask about this project" }).click();
  await page.waitForURL(`**/ai?scope=project:${project.id}`);
  await expect(picker(page)).toHaveValue(`project:${project.id}`);
  await expect(main(page).getByText("Searching only this project: its notes, tasks and events.")).toBeVisible();

  const note = await makeNote(page);
  await main(page).getByRole("link", { name: "Ask about this note" }).click();
  await page.waitForURL(`**/ai?scope=note:${note.id}`);
  await expect(picker(page)).toHaveValue(`note:${note.id}`);
  await expect(picker(page).locator("optgroup[label='This note'] option")).toHaveText(note.title);
  await expect(main(page).getByText("Searching only this note.")).toBeVisible();
});

test("a scope in the URL that is malformed, unknown or of the wrong kind is ignored", async ({ page }) => {
  const course = await makeCourse(page);
  const bad = [
    "course:not-a-uuid",
    `course:${crypto.randomUUID()}`,
    `note:${course.id}`,
    `project:${course.id}`,
    "folder:x",
  ];
  for (const scope of bad) {
    await page.goto(`/ai?scope=${scope}`);
    await expect(picker(page), scope).toHaveValue("");
    await expect(searching(page)).toHaveCount(0);
    await expect(main(page)).not.toContainText("no longer exists");
  }
});

test("the docked assistant has no scope control", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+j");
  await expect(page.getByLabel("Ask your workspace")).toBeVisible();
  await expect(page.getByLabel("Ask about", { exact: true })).toHaveCount(0);
});

test("on a phone the control fits and is easy to use", async ({ page }) => {
  const course = await makeCourse(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/ai?scope=course:${course.id}`);

  await expect(picker(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await picker(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("a follow-up carries only the turns asked under the same scope", async ({ page }) => {
  const course = await makeCourse(page);
  const bodies: { history: { role: string; content: string }[]; scope: unknown }[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "citations", citations: [] })}\n${JSON.stringify({ type: "delta", text: "ok" })}\n`,
    });
  });
  const ask = async (question: string) => {
    const before = bodies.length;
    await page.getByLabel("Ask your workspace").fill(question);
    await main(page).getByRole("button", { name: /^ask$/i }).click();
    await expect.poll(() => bodies.length).toBe(before + 1);
    await expect(page.getByLabel("Ask your workspace")).toBeEnabled();
  };
  const sent = (n: number) => bodies[n].history.map((turn) => turn.content);

  await page.goto("/ai");
  await picker(page).selectOption({ label: course.option });
  await ask("one, about the course");
  await ask("two, still the course");
  expect(sent(0)).toEqual([]);
  expect(sent(1)).toEqual(["one, about the course", "ok"]);

  // Another scope must not see what was said under this one, or the model answers from it.
  await picker(page).selectOption({ label: "Everything" });
  await ask("three, about everything");
  expect(sent(2)).toEqual([]);
  await ask("four, still everything");
  expect(sent(3)).toEqual(["three, about everything", "ok"]);

  // Going back, the earlier course turns are the history again.
  await picker(page).selectOption({ label: course.option });
  await ask("five, the course again");
  expect(sent(4)).toEqual(["one, about the course", "ok", "two, still the course", "ok"]);
});
