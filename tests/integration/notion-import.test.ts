/**
 * Importing a Notion "Markdown & CSV" export (ROADMAP item 37), against a real Postgres and a real attachment store. The zip
 * is hostile data, so most tests are about what must NOT happen: a name used as a path, another account touched, a second run
 * adding anything, a project or course made twice.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { deleteAttachment, getAttachment } from "@/lib/attachment-store";
import { ZipWriter } from "@/lib/zip";
import { parseChoices, runNotionImport } from "@/services/notion-service";

const users: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `notion-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
after(async () => {
  const rows = await prisma.attachment.findMany({ where: { userId: { in: users } }, select: { storageKey: true } });
  await Promise.all(rows.map((row) => deleteAttachment(row.storageKey)));
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const when = new Date("2026-10-01T09:00:00Z");
type File = { name: string; data: string | Buffer };
async function makeZip(files: File[]): Promise<Buffer> {
  const writer = new ZipWriter();
  const parts: Buffer[] = [];
  for (const file of files) parts.push(await writer.add({ name: file.name, data: Buffer.from(file.data), modified: when }));
  parts.push(writer.finish());
  return Buffer.concat(parts);
}

const HOME = "1".repeat(32);
const SUB = "2".repeat(32);
const DB = "3".repeat(32);
const ROW1 = "4".repeat(32);
const ROW2 = "5".repeat(32);

/** A small export shaped as Notion writes one: a page with a sub-page and an image, and a database with two rows. */
function notionFiles(extra: File[] = []): File[] {
  return [
    { name: `Home ${HOME}.md`, data: `# Home\n\nSee [the sub page](Home%20${HOME}/Sub%20page%20${SUB}.md), the [reading list](Reading%20list%20${DB}.csv) and the picture:\n\n![diagram](Home%20${HOME}/diagram.png)\n\n[External](https://example.com)\n` },
    { name: `Home ${HOME}/Sub page ${SUB}.md`, data: `# Sub page\n\nBack to [Home](../Home%20${HOME}.md).\n` },
    { name: `Home ${HOME}/diagram.png`, data: PNG },
    { name: `Reading list ${DB}.csv`, data: "Name,Status\nBook one,Done\nBook two,Todo\n" },
    { name: `Reading list ${DB}_all.csv`, data: "Name,Status\nBook one,Done\nBook two,Todo\n" },
    { name: `Reading list ${DB}/Book one ${ROW1}.md`, data: `# Book one\n\nStatus: Done\n\nGreat. See [Home](../Home%20${HOME}.md).\n` },
    { name: `Reading list ${DB}/Book two ${ROW2}.md`, data: `# Book two\n\nStatus: Todo\n\nNot yet.\n` },
    ...extra,
  ];
}
const counts = async (userId: string) => ({
  notes: await prisma.note.count({ where: { userId } }),
  projects: await prisma.project.count({ where: { userId } }),
  courses: await prisma.course.count({ where: { userId } }),
  attachments: await prisma.attachment.count({ where: { userId } }),
});

test("a preview says what would happen and writes nothing", async () => {
  const me = await newUser();
  const report = await runNotionImport(me, await makeZip(notionFiles()), { apply: false });
  assert.deepEqual(await counts(me), { notes: 0, projects: 0, courses: 0, attachments: 0 });
  assert.equal(report.notes.found, 4);
  assert.equal(report.notes.create, 4);
  assert.equal(report.notes.created, 0);
  assert.deepEqual(report.databases, [{ id: DB, name: "Reading list", rows: 2, choice: "project", target: "new" }]);
  assert.deepEqual(report.made, { projects: ["Reading list"], courses: [] });
  assert.equal(report.links.converted, 3);
  assert.equal(report.attachments.stored, 1, "the image is counted");
});

test("an import makes the notes, turns links into wiki links, attaches the image and makes the database a project", async () => {
  const me = await newUser();
  const report = await runNotionImport(me, await makeZip(notionFiles()), { apply: true });
  assert.equal(report.notes.created, 4);
  const notes = await prisma.note.findMany({ where: { userId: me }, orderBy: { title: "asc" } });
  assert.deepEqual(notes.map((note) => note.title), ["Book one", "Book two", "Home", "Sub page"]);
  const home = notes.find((note) => note.title === "Home")!;
  assert.equal(home.content, "See [[Sub page]], the reading list and the picture:\n\n(attached: diagram.png)\n\n[External](https://example.com)");
  assert.deepEqual(home.tags, ["imported", "notion"]);
  assert.equal(notes.find((note) => note.title === "Sub page")!.content, "Back to [[Home]].");
  // Links are real links: the two pages point at each other.
  assert.equal(await prisma.entityLink.count({ where: { userId: me, sourceId: home.id } }), 1);
  const project = await prisma.project.findFirstOrThrow({ where: { userId: me } });
  assert.equal(project.title, "Reading list");
  assert.deepEqual((await prisma.note.findMany({ where: { projectId: project.id }, orderBy: { title: "asc" } })).map((note) => note.title), ["Book one", "Book two"]);
  assert.equal(home.projectId, null, "a page that is not a row of the database is not in its project");
  const file = await prisma.attachment.findFirstOrThrow({ where: { userId: me } });
  assert.equal(file.noteId, home.id);
  assert.equal(file.mimeType, "image/png");
  assert.deepEqual(await getAttachment(file.storageKey), PNG);
  assert.notEqual(file.storageKey, "diagram.png", "the stored name is generated");
});

test("importing the same export again adds nothing, and the project is not made twice", async () => {
  const me = await newUser();
  const zip = await makeZip(notionFiles());
  await runNotionImport(me, zip, { apply: true });
  const before = await counts(me);
  const again = await runNotionImport(me, zip, { apply: true });
  assert.equal(again.notes.created, 0);
  assert.equal(again.notes.present, 4);
  assert.deepEqual(again.made, { projects: [], courses: [] });
  assert.deepEqual(await counts(me), before);
});

test("a database can become a course, or just notes, as the person chooses", async () => {
  const course = await newUser();
  const report = await runNotionImport(course, await makeZip(notionFiles()), { apply: true, choices: new Map([[DB, "course" as const]]) });
  assert.deepEqual(report.made, { projects: [], courses: ["Reading list"] });
  const made = await prisma.course.findFirstOrThrow({ where: { userId: course } });
  assert.deepEqual([made.code, made.title, made.term], ["Reading list", "Reading list", "Notion import"]);
  assert.equal(await prisma.note.count({ where: { userId: course, courseId: made.id } }), 2);
  assert.equal(await prisma.project.count({ where: { userId: course } }), 0);
  const none = await newUser();
  await runNotionImport(none, await makeZip(notionFiles()), { apply: true, choices: new Map([[DB, "none" as const]]) });
  assert.deepEqual(await counts(none), { notes: 4, projects: 0, courses: 0, attachments: 1 });
});

test("an existing project or course of that name is used, never made again; two of that name are not guessed between", async () => {
  const me = await newUser();
  const existing = await prisma.project.create({ data: { userId: me, title: "reading LIST", category: "Personal" } });
  const report = await runNotionImport(me, await makeZip(notionFiles()), { apply: true });
  assert.deepEqual(report.made.projects, []);
  assert.equal(await prisma.project.count({ where: { userId: me } }), 1);
  assert.equal(await prisma.note.count({ where: { userId: me, projectId: existing.id } }), 2);

  const other = await newUser();
  await prisma.project.createMany({ data: [{ userId: other, title: "Reading list", category: "Personal" }, { userId: other, title: "Reading List", category: "Personal" }] });
  const preview = await runNotionImport(other, await makeZip(notionFiles()), { apply: false });
  assert.equal(preview.databases[0].target, "ambiguous");
  await runNotionImport(other, await makeZip(notionFiles()), { apply: true });
  assert.equal(await prisma.project.count({ where: { userId: other } }), 2, "no third project");
  assert.equal(await prisma.note.count({ where: { userId: other, projectId: { not: null } } }), 0);
});

test("another account's notes, projects and files are untouched, and a note of the same name in another account is not 'present'", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await prisma.note.create({ data: { userId: other, title: "Home", content: "See [[Sub page]], the reading list and the picture:\n\n(attached: diagram.png)\n\n[External](https://example.com)", tags: [] } });
  const project = await prisma.project.create({ data: { userId: other, title: "Reading list", category: "Personal" } });
  const before = JSON.stringify(await prisma.note.findMany({ where: { userId: other } }));
  const report = await runNotionImport(me, await makeZip(notionFiles()), { apply: true });
  assert.equal(report.notes.created, 4);
  assert.equal(JSON.stringify(await prisma.note.findMany({ where: { userId: other } })), before);
  assert.equal(await prisma.project.count({ where: { userId: other } }), 1);
  assert.equal(await prisma.note.count({ where: { projectId: project.id } }), 0);
  assert.ok(theirs.id);
});

test("a different note under a title the account already uses comes in renamed, and the existing one keeps the title", async () => {
  const me = await newUser();
  await prisma.note.create({ data: { userId: me, title: "Sub page", content: "mine", tags: [] } });
  const report = await runNotionImport(me, await makeZip(notionFiles()), { apply: true });
  assert.deepEqual(report.notes.renamed, [{ from: "Sub page", to: "Sub page (imported)" }]);
  assert.equal((await prisma.note.findFirstOrThrow({ where: { userId: me, title: "Sub page" } })).content, "mine");
});

test("no name in the zip is a path: climbing, absolute and system names are skipped and counted, and nothing is written outside the database", async () => {
  const me = await newUser();
  const zip = await makeZip([
    ...notionFiles(),
    { name: "../evil.md", data: "# Evil\n\nx" },
    { name: "/etc/passwd.md", data: "# Passwd\n\nx" },
    { name: "C:/win.md", data: "# Win\n\nx" },
    { name: "a/../../up.md", data: "# Up\n\nx" },
    { name: "__MACOSX/._Home.md", data: "junk" },
    { name: ".hidden/secret.md", data: "# Secret\n\nx" },
  ]);
  const report = await runNotionImport(me, zip, { apply: true });
  assert.equal(report.skippedTotal, 4);
  assert.ok(report.ignored >= 2);
  const titles = (await prisma.note.findMany({ where: { userId: me } })).map((note) => note.title);
  for (const bad of ["Evil", "Passwd", "Win", "Up", "Secret"]) assert.ok(!titles.includes(bad), bad);
  // A link that tries to climb out of the zip keeps its words and attaches nothing.
  const sneaky = await newUser();
  const out = await runNotionImport(sneaky, await makeZip([{ name: `P ${HOME}.md`, data: "# P\n\n![x](../../etc/passwd.png) and [y](/etc/passwd) and [z](../up.md)" }]), { apply: true });
  assert.equal(out.attachments.stored, 0);
  assert.equal((await prisma.note.findFirstOrThrow({ where: { userId: sneaky } })).content, "x and y and z", "a path outside the zip keeps its words and is no link at all");
});

test("a zip that is not a Markdown export is refused with a sentence and writes nothing", async () => {
  const me = await newUser();
  const refusals = [
    [await makeZip([{ name: "page.html", data: "<html></html>" }]), /HTML export/],
    [await makeZip([{ name: `Export-${HOME}-Part-1.zip`, data: "PK" }]), /another zip/],
    [await makeZip([{ name: "readme.txt", data: "x" }]), /no Markdown pages/],
  ] as const;
  for (const [zip, pattern] of refusals) {
    await assert.rejects(() => runNotionImport(me, zip, { apply: true }), (error: { code?: string; message?: string }) => error.code === "VALIDATION_ERROR" && pattern.test(error.message ?? ""));
  }
  await assert.rejects(() => runNotionImport(me, Buffer.from("not a zip"), { apply: true }), { code: "VALIDATION_ERROR" });
  await assert.rejects(() => runNotionImport(me, new Uint8Array(0), { apply: true }), { code: "VALIDATION_ERROR" });
  const valid = await makeZip(notionFiles());
  await assert.rejects(() => runNotionImport("", valid, { apply: true }), { code: "VALIDATION_ERROR" });
  assert.deepEqual(await counts(me), { notes: 0, projects: 0, courses: 0, attachments: 0 });
});

test("a zip with a wrapper folder is read the same", async () => {
  const me = await newUser();
  const report = await runNotionImport(me, await makeZip(notionFiles().map((file) => ({ ...file, name: `Export-abc/${file.name}` }))), { apply: false });
  assert.equal(report.notes.found, 4);
  assert.equal(report.links.converted, 3);
});

test("a run adds at most the limit, and the rest waits for the next run", async () => {
  const me = await newUser();
  const zip = await makeZip(Array.from({ length: 5 }, (_, index) => ({ name: `Page ${index} ${String(index).repeat(32)}.md`, data: `# Page ${index}\n\ntext ${index}` })));
  const first = await runNotionImport(me, zip, { apply: true, limit: 2 });
  assert.deepEqual([first.notes.created, first.notes.deferred], [2, 3]);
  const second = await runNotionImport(me, zip, { apply: true, limit: 10 });
  assert.deepEqual([second.notes.created, second.notes.present], [3, 2]);
  assert.equal(await prisma.note.count({ where: { userId: me } }), 5);
});

test("a file the zip lies about, one that is not what its name says, and a note too long are skipped, not fatal", async () => {
  const me = await newUser();
  const zip = await makeZip([
    { name: `P ${HOME}.md`, data: "# P\n\n![fake](P/fake.png) ![ok](P/ok.png)" },
    { name: "P/fake.png", data: "this is not a png" },
    { name: "P/ok.png", data: PNG },
    { name: `Long ${SUB}.md`, data: `# Long\n\n${"word ".repeat(30_000)}` },
    { name: `Huge ${DB}.md`, data: `# Huge\n\n${"x".repeat(600_000)}` },
  ]);
  const report = await runNotionImport(me, zip, { apply: true });
  assert.equal(report.attachments.stored, 1);
  assert.deepEqual(report.attachments.rejected.map((r) => r.reason), ["Its content is not what its name says."]);
  assert.ok(report.skipped.some((s) => /longer than a note can be/.test(s.reason)));
  assert.ok(report.skipped.some((s) => /too large for a note/.test(s.reason)), "a page over 512 KB is refused before it is read");
  assert.equal(await prisma.note.count({ where: { userId: me } }), 1);
});

test("the database choices in a request: only a 32-character id and a known choice count", () => {
  const parsed = parseChoices([`${DB}:course`, `${DB.toUpperCase()}:none`, "short:project", `${HOME}:delete`, `${HOME}:project`, `${SUB}`, "", ...Array.from({ length: 500 }, (_, i) => `${String(i).padStart(32, "0")}:none`)]);
  assert.equal(parsed.get(DB), "none", "the last one wins, in lower case");
  assert.equal(parsed.get(HOME), "project");
  assert.equal(parsed.has(SUB), false);
  assert.ok(parsed.size <= 201);
});

test("a project is made only when a row of it is created: with every row already there, a deleted project is not brought back", async () => {
  const me = await newUser();
  const zip = await makeZip(notionFiles());
  await runNotionImport(me, zip, { apply: true });
  await prisma.project.deleteMany({ where: { userId: me } });
  const again = await runNotionImport(me, zip, { apply: true });
  assert.equal(again.notes.created, 0);
  assert.deepEqual(again.made, { projects: [], courses: [] });
  assert.equal(await prisma.project.count({ where: { userId: me } }), 0);
});

test("what one run reads for attachments is held to a budget, and the note that would pass it waits", async () => {
  const me = await newUser();
  const zip = await makeZip(notionFiles());
  const first = await runNotionImport(me, zip, { apply: true, byteBudget: 10 });
  assert.equal(first.notes.deferred, 1, "the page with the image waits");
  assert.equal(await prisma.attachment.count({ where: { userId: me } }), 0);
  const second = await runNotionImport(me, zip, { apply: true });
  assert.equal(second.notes.created, 1);
  assert.equal(await prisma.attachment.count({ where: { userId: me } }), 1);
});

test("a note keeps at most 20 files; the rest are named as not attached", async () => {
  const me = await newUser();
  const images = Array.from({ length: 22 }, (_, index) => `![i${index}](P/img${index}.png)`).join("\n\n");
  const zip = await makeZip([{ name: `P ${HOME}.md`, data: `# P\n\n${images}` }, ...Array.from({ length: 22 }, (_, index) => ({ name: `P/img${index}.png`, data: PNG }))]);
  const report = await runNotionImport(me, zip, { apply: true });
  assert.equal(report.attachments.stored, 20);
  assert.equal(report.attachments.rejectedTotal, 1);
  assert.equal(await prisma.attachment.count({ where: { userId: me } }), 20);
});

test("a name used twice in the zip uses the first and counts the second", async () => {
  const me = await newUser();
  const zip = await makeZip([{ name: `P ${HOME}.md`, data: "# P\n\nfirst" }, { name: `P ${HOME}.md`, data: "# P\n\nsecond" }]);
  const report = await runNotionImport(me, zip, { apply: true });
  assert.equal(report.skippedTotal, 1);
  assert.equal((await prisma.note.findFirstOrThrow({ where: { userId: me } })).content, "first");
});
