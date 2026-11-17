/**
 * Page references for imported PDFs (ROADMAP item 41), against a real Postgres and no Ollama: the embedder is replaced by one that gives each text
 * a vector of its own, so the pages stored, searched and cited can be checked exactly.
 */
import "dotenv/config";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import * as ollama from "@/lib/ollama";
import { indexEntity, searchWorkspaceVectors } from "@/lib/vector";
import { retrieveContext } from "@/services/assistant-service";
import * as noteService from "@/services/note-service";
import { EMBEDDING_DIMENSIONS } from "@/lib/config";

// Texts that mention "alpha" point one way, "beta" another, so a question about either lands on its own page.
const vectorFor = (text: string) => {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = /alpha/i.test(text) ? 1 : 0;
  v[1] = /beta/i.test(text) ? 1 : 0;
  v[2] = /gamma/i.test(text) ? 1 : 0;
  if (v[0] + v[1] + v[2] === 0) v[3] = 1;
  return v;
};
mock.method(ollama.ollama, "embed", async (request: { input: string | string[] }) => ({ embeddings: [request.input].flat().map(vectorFor) }));

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `pdfp-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const long = (word: string) => `${word} is discussed at some length here. `.repeat(8).trim();
const paper = (pages: string[]) => pages.map((text, i) => `${text}\n-- ${i + 1} of ${pages.length} --`).join("\n");
const rowsOf = (userId: string, sourceId: string) =>
  prisma.$queryRaw<{ page: number | null; contentChunk: string }[]>`SELECT "page", "contentChunk" FROM "WorkspaceEmbedding" WHERE "userId" = ${userId} AND "sourceId" = ${sourceId} ORDER BY "page" NULLS FIRST`;

test("a note from a PDF is indexed with the page of each chunk, and a plain note with none", async () => {
  const me = await newUser();
  const pdf = await noteService.createNote(me, { title: "Paper", content: paper([long("alpha"), long("beta"), long("gamma")]), tags: ["imported"], isFavorite: false, projectId: null, courseId: null });
  assert.deepEqual((await rowsOf(me, pdf.id)).map((r) => r.page), [1, 2, 3]);
  const plain = await noteService.createNote(me, { title: "Plain", content: long("alpha"), tags: [], isFavorite: false, projectId: null, courseId: null });
  assert.deepEqual((await rowsOf(me, plain.id)).map((r) => r.page), [null]);
});

test("a task or an event whose text looks like page markers gets no pages", async () => {
  const me = await newUser();
  const id = randomUUID();
  await indexEntity(me, "task", id, paper([long("alpha"), long("beta")]));
  assert.ok((await rowsOf(me, id)).every((r) => r.page === null));
});

test("search returns the page, and an answer cites the page it drew on", async () => {
  const me = await newUser();
  const pdf = await noteService.createNote(me, { title: "Paper on three things", content: paper([long("alpha"), long("beta"), long("gamma")]), tags: [], isFavorite: false, projectId: null, courseId: null });
  const hits = await searchWorkspaceVectors(me, vectorFor("beta"), 3);
  assert.equal(hits[0].page, 2);
  const { citations } = await retrieveContext(me, "what does it say about beta", [], { kind: "note", id: pdf.id });
  assert.equal(citations[0].page, 2);
  assert.equal(citations[0].title, "Paper on three things");
});

test("editing the note re-indexes its pages, and removing the markers leaves plain chunks", async () => {
  const me = await newUser();
  const note = await noteService.createNote(me, { title: "Edited", content: paper([long("alpha"), long("beta")]), tags: [], isFavorite: false, projectId: null, courseId: null });
  await noteService.updateNote(me, note.id, { title: "Edited", content: paper([long("alpha"), long("beta"), long("gamma")]), tags: [], isFavorite: false, projectId: null, courseId: null, } as never);
  const after3 = await rowsOf(me, note.id);
  assert.ok(after3.length >= 2);
  await noteService.updateNote(me, note.id, { title: "Edited", content: `${long("alpha")}\n\n${long("beta")}`, tags: [], isFavorite: false, projectId: null, courseId: null } as never);
  assert.ok((await rowsOf(me, note.id)).every((r) => r.page === null));
});

test("another account's pages never appear in my search", async () => {
  const me = await newUser();
  const other = await newUser();
  await noteService.createNote(other, { title: "Theirs", content: paper([long("alpha"), long("beta")]), tags: [], isFavorite: false, projectId: null, courseId: null });
  assert.deepEqual(await searchWorkspaceVectors(me, vectorFor("beta"), 5), []);
});
