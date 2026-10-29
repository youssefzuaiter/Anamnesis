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
