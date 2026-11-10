/**
 * Clipping a page into a note, against a real Postgres. The page itself comes from an injected fetcher
 * (the network path, with its guard, is tested in safe-fetch.test.ts); everything after it is real.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { SafeFetchError } from "@/lib/safe-fetch";
import { clipUrl } from "@/services/clip-service";

const users: string[] = [];
async function newUser() {
  const user = await prisma.user.create({ data: { email: `clip-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const prose = "Readable prose that a reader view keeps, written long enough to count as an article on its own. ".repeat(4);
const article = (title: string, body = `<p>${prose}</p><p>${prose}</p>`) =>
  `<html><head><title>${title}</title></head><body><nav>Home · About</nav><article><h1>${title}</h1>${body}</article></body></html>`;
const fetcher = (html: string, finalUrl?: string) => {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: URL) => {
      calls.push(url.href);
      return { text: html, finalUrl: new URL(finalUrl ?? url.href), contentType: "text/html" };
    },
  };
};
const now = new Date(2026, 10, 10, 14, 0);
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);

test("a page becomes a note with its title, its source and the clipped tag", async () => {
  const user = await newUser();
  const other = await newUser();
  const page = fetcher(article("Gradient descent explained"), "https://blog.example.com/posts/gd?ref=x");
  const result = await clipUrl(user.id, "  https://blog.example.com/posts/gd  ", { fetch: page.fetch, now });
  assert.deepEqual(page.calls, ["https://blog.example.com/posts/gd"]);
  const note = await prisma.note.findUniqueOrThrow({ where: { id: result.noteId } });
  assert.equal(note.userId, user.id);
  assert.equal(note.title, "Gradient descent explained");
  assert.equal(result.title, "Gradient descent explained");
  assert.deepEqual(note.tags, ["clipped"]);
  assert.ok(note.content.startsWith("> Source: [blog.example.com](<https://blog.example.com/posts/gd?ref=x>) · clipped "), note.content.slice(0, 120));
  assert.match(note.content, /Readable prose that a reader view keeps/);
  assert.ok(!note.content.includes("Home · About"));
  assert.equal(await prisma.note.count({ where: { userId: other.id } }), 0);
});

test("a page without a title is named after its host", async () => {
  const user = await newUser();
  const html = `<html><head><title></title></head><body><article><p>${prose}</p><p>${prose}</p></article></body></html>`;
  const result = await clipUrl(user.id, "https://notitle.example.org/a", { fetch: fetcher(html).fetch, now });
  assert.equal(result.title, "notitle.example.org");
});

test("a page with no article, or a fetch that fails, makes no note and says why", async () => {
  const user = await newUser();
  await assert.rejects(
    () => clipUrl(user.id, "https://example.com/login", { fetch: fetcher("<html><body><form><input></form></body></html>").fetch, now }),
    refused("VALIDATION_ERROR", /Could not find an article on that page/),
  );
  const failing = (error: Error) => ({
    fetch: async () => {
      throw error;
    },
    now,
  });
  await assert.rejects(() => clipUrl(user.id, "https://example.com/big", failing(new SafeFetchError("too-large"))), refused("VALIDATION_ERROR", /too large to clip \(over 5 MB\)/));
  await assert.rejects(() => clipUrl(user.id, "https://example.com/doc.pdf", failing(new SafeFetchError("type"))), refused("VALIDATION_ERROR", /does not lead to a web page/));
  await assert.rejects(() => clipUrl(user.id, "https://example.com/slow", failing(new SafeFetchError("timeout"))), refused("INTEGRATION_ERROR", /took too long/));
  await assert.rejects(() => clipUrl(user.id, "https://example.com/gone", failing(new SafeFetchError("status", undefined, 404))), refused("INTEGRATION_ERROR", /answered 404/));
  await assert.rejects(() => clipUrl(user.id, "https://rebind.example.com/", failing(new SafeFetchError("blocked"))), refused("VALIDATION_ERROR", /not reachable from this server/));
  assert.equal(await prisma.note.count({ where: { userId: user.id } }), 0);
});

test("a link to this machine or its network is refused before anything is fetched", async () => {
  const user = await newUser();
  const page = fetcher(article("Secret"));
  for (const url of ["http://localhost:3200/", "http://127.0.0.1/", "http://host.docker.internal:11434/api/tags", "http://ntfy/", "file:///etc/passwd", "not a link", ""]) {
    await assert.rejects(() => clipUrl(user.id, url, { fetch: page.fetch, now }), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR", url);
  }
  assert.deepEqual(page.calls, []);
});

test("a very long article is cut to the note limit, and the note says where the rest is", async () => {
  const user = await newUser();
  const long = Array.from({ length: 2_000 }, (_, i) => `<p>Paragraph ${i}. ${prose}</p>`).join("");
  const result = await clipUrl(user.id, "https://long.example.com/a", { fetch: fetcher(article("Long read", long)).fetch, now });
  const note = await prisma.note.findUniqueOrThrow({ where: { id: result.noteId } });
  assert.ok(note.content.length <= MAX_NOTE_LENGTH, `${note.content.length}`);
  assert.match(note.content, /The rest is at the source\._$/);
});

test("an article just over the limit is cut, and one under it is kept whole", async () => {
  const user = await newUser();
  const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i}. ${prose}</p>`).join("");
  const over = await clipUrl(user.id, "https://over.example.com/a", { fetch: fetcher(article("Just over", paragraphs(260))).fetch, now });
  const overNote = await prisma.note.findUniqueOrThrow({ where: { id: over.noteId } });
  assert.ok(overNote.content.length <= MAX_NOTE_LENGTH, `${overNote.content.length}`);
  assert.match(overNote.content, /The rest is at the source\._$/);
  const under = await clipUrl(user.id, "https://under.example.com/a", { fetch: fetcher(article("Just under", paragraphs(200))).fetch, now });
  const underNote = await prisma.note.findUniqueOrThrow({ where: { id: under.noteId } });
  assert.ok(underNote.content.length > 50_000 && underNote.content.length < MAX_NOTE_LENGTH, `${underNote.content.length}`);
  assert.match(underNote.content, /Paragraph 199\./);
  assert.ok(!underNote.content.includes("The rest is at the source"));
});
