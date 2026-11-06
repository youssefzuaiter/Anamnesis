import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_TYPES, mimeForExtension } from "@/lib/attachment-types";
import { allocateNames, attachmentParts, manifestJson, noteFile, safeStem, VAULT } from "@/lib/vault";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const day = (iso: string) => new Date(iso);

// --- attachment types ---------------------------------------------------------------------------

test("the attachment table maps every allowed mime type to one extension, and back", () => {
  assert.deepEqual(Object.keys(ATTACHMENT_TYPES).sort(), [
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/markdown",
    "text/plain",
  ]);
  for (const [mime, ext] of Object.entries(ATTACHMENT_TYPES)) assert.equal(mimeForExtension(ext), mime);
  assert.equal(mimeForExtension("jpeg"), "image/jpeg");
  assert.equal(mimeForExtension(".PNG"), "image/png");
  assert.equal(mimeForExtension("svg"), null);
  assert.equal(mimeForExtension("html"), null);
  assert.equal(mimeForExtension(""), null);
});

// --- safeStem -----------------------------------------------------------------------------------

test("every character Obsidian cannot link, and every control character, becomes a hyphen", () => {
  for (const ch of ["\\", "/", ":", "*", "?", '"', "<", ">", "|", "#", "^", "[", "]", "\u0000", "\u001f", "\u007f", "\u202e", "\u2028", "\ufeff"]) {
    assert.equal(safeStem(`a${ch}b`), "a-b", JSON.stringify(ch));
  }
  assert.equal(safeStem("What is 1/2? A [draft]: yes|no"), "What is 1-2- A -draft-- yes-no");
});

test("Windows device names are made safe, with or without an extension", () => {
  assert.equal(safeStem("CON"), "CON_");
  assert.equal(safeStem("con.txt"), "con_.txt");
  assert.equal(safeStem("COM1"), "COM1_");
  assert.equal(safeStem("nul"), "nul_");
  assert.equal(safeStem("LPT9.notes"), "LPT9_.notes");
  assert.equal(safeStem("Console"), "Console");
  assert.equal(safeStem("Conclusion"), "Conclusion");
});

test("a name cut at the byte limit does not end in a dot or a space, and a device name followed by a dot is still a device name", () => {
  assert.equal(safeStem(`${"a".repeat(179)}. tail`), "a".repeat(179), "the cut lands after the dot");
  assert.equal(safeStem(`${"a".repeat(178)}  tail`), "a".repeat(178), "the cut lands after the spaces");
  assert.equal(safeStem("con ."), "con_", "trailing dots and spaces go before the device check");
  assert.equal(safeStem("nul  "), "nul_");
});

test("leading dots, trailing dots and spaces are removed", () => {
  assert.equal(safeStem(".hidden"), "hidden");
  assert.equal(safeStem("name. "), "name");
  assert.equal(safeStem("  spaced out  "), "spaced out");
  assert.equal(safeStem("a  b"), "a  b");
});

test("nothing left to name a note by gives Untitled", () => {
  for (const text of ["", "   ", "...", "///", "-", "?:*"]) assert.equal(safeStem(text), "Untitled", JSON.stringify(text));
});

test("a long title is cut by bytes without splitting a character", () => {
  const turkish = safeStem("ğ".repeat(200)); // two bytes each: 400 bytes
  assert.ok(bytes(turkish) <= 180);
  assert.equal(Buffer.from(turkish, "utf8").toString("utf8"), turkish, "valid UTF-8");
  assert.equal(turkish, "ğ".repeat(90));
  const emoji = safeStem("😀".repeat(100)); // four bytes each
  assert.equal(emoji, "😀".repeat(45));
  assert.equal(safeStem("x".repeat(1000)).length, 180);
  assert.equal(safeStem("x".repeat(100), 50).length, 50);
  assert.equal(safeStem(`${"a".repeat(179)}.`), "a".repeat(179), "trailing dot after the cut is dropped");
});

test("a decomposed s-cedilla from a Mac is the same name as the composed one", () => {
  assert.equal(safeStem("ş"), "ş");
  assert.equal(safeStem("Şükrü".normalize("NFD")), "Şükrü".normalize("NFC"));
});

test("hostile 100,000-character titles are cut in a few milliseconds", () => {
  for (const text of ["/".repeat(100_000), ".".repeat(100_000), " ".repeat(100_000), `${"a".repeat(100_000)}.`, "con".repeat(33_000), "😀".repeat(100_000), "\u202e".repeat(100_000)]) {
    const start = performance.now();
    safeStem(text);
    assert.ok(performance.now() - start < 50, "slow");
  }
});

// --- attachmentParts ----------------------------------------------------------------------------

test("an attachment's stem and extension follow its mime type", () => {
  assert.deepEqual(attachmentParts("diagram.png", "image/png"), { stem: "diagram", ext: ".png" });
  assert.deepEqual(attachmentParts("Scan.PDF", "application/pdf"), { stem: "Scan", ext: ".pdf" });
  assert.deepEqual(attachmentParts("x.jpeg", "image/jpeg"), { stem: "x", ext: ".jpeg" });
  assert.deepEqual(attachmentParts("photo", "image/png"), { stem: "photo", ext: ".png" });
  assert.deepEqual(attachmentParts("notes.txt", "text/markdown"), { stem: "notes.txt", ext: ".md" });
  assert.deepEqual(attachmentParts("../../x.png", "image/png"), { stem: "-..-x", ext: ".png" });
  assert.equal(attachmentParts("evil.html", "text/html"), null);
});

// --- allocateNames ------------------------------------------------------------------------------

const note = (id: string, stem: string, rank: string) => ({ id, stem, ext: ".md", rank: day(rank) });

test("the newest of equal titles keeps the plain name, the others are numbered", () => {
  const names = allocateNames([
    note("old", "Thesis", "2026-01-01"),
    note("newest", "Thesis", "2026-03-01"),
    note("mid", "Thesis", "2026-02-01"),
  ]);
  assert.equal(names.get("newest"), "Thesis.md");
  assert.equal(names.get("mid"), "Thesis (2).md");
  assert.equal(names.get("old"), "Thesis (3).md");
});

test("a tie in time goes to the smaller id, so two exports agree", () => {
  const names = allocateNames([note("b", "Same", "2026-01-01"), note("a", "Same", "2026-01-01")]);
  assert.equal(names.get("a"), "Same.md");
  assert.equal(names.get("b"), "Same (2).md");
});

test("names differing only in case are three names, because a Mac or Windows disk would merge them", () => {
  const names = allocateNames([note("1", "Note", "2026-01-03"), note("2", "note", "2026-01-02"), note("3", "NOTE", "2026-01-01")]);
  const folded = [...names.values()].map((n) => n.toLowerCase());
  assert.equal(new Set(folded).size, 3);
  assert.equal(names.get("1"), "Note.md");
});

test("a numbered name never takes the plain name of a real note", () => {
  const names = allocateNames([note("a", "Meeting", "2026-01-02"), note("b", "Meeting", "2026-01-01"), note("c", "Meeting (2)", "2020-01-01")]);
  assert.equal(names.get("c"), "Meeting (2).md");
  assert.equal(names.get("a"), "Meeting.md");
  assert.equal(names.get("b"), "Meeting (3).md");
});

test("an attachment called Meeting.md and a note called Meeting are two files", () => {
  const names = allocateNames([note("n", "Meeting", "2026-01-02"), { id: "att", stem: "Meeting", ext: ".md", rank: day("2026-01-01") }]);
  assert.equal(new Set([...names.values()].map((n) => n.toLowerCase())).size, 2);
  const png = allocateNames([note("n", "diagram.png", "2026-01-02"), { id: "att", stem: "diagram", ext: ".png", rank: day("2026-01-01") }]);
  assert.equal(png.get("n"), "diagram.png.md");
  assert.equal(png.get("att"), "diagram.png");
});

test("a name and its numbered form stay within 200 bytes", () => {
  const stem = "ğ".repeat(90); // 180 bytes
  const names = allocateNames([note("a", stem, "2026-01-02"), note("b", stem, "2026-01-01"), note("c", stem, "2025-12-31")]);
  for (const name of names.values()) assert.ok(bytes(name) <= 200, name);
  assert.equal(new Set(names.values()).size, 3);
});

test("a numbered name is cut to stay within 200 bytes even when its stem was already long", () => {
  const stem = "a".repeat(198); // not from safeStem: with ".md" the plain name is 201 bytes, and a number would add more
  const names = allocateNames([note("x", stem, "2026-01-03"), note("y", stem, "2026-01-02"), note("z", stem, "2026-01-01")]);
  for (const id of ["y", "z"]) assert.ok(bytes(names.get(id) as string) <= 200, `${id}: ${bytes(names.get(id) as string)} bytes`);
  assert.equal(new Set([...names.values()].map((n) => n.toLowerCase())).size, 3);
});

test("a composed and a decomposed spelling of one name are the same name", () => {
  const names = allocateNames([note("a", "ş", "2026-01-02"), note("b", "ş", "2026-01-01")]);
  assert.notEqual(names.get("a")?.normalize("NFC"), names.get("b")?.normalize("NFC"));
});

test("ten thousand names, distinct or all the same, are allocated quickly", () => {
  const distinct = Array.from({ length: 10_000 }, (_, i) => note(`d${i}`, `Title ${i}`, "2026-01-01"));
  let start = performance.now();
  assert.equal(new Set(allocateNames(distinct).values()).size, 10_000);
  assert.ok(performance.now() - start < 200, "distinct was slow");
  const same = Array.from({ length: 10_000 }, (_, i) => note(`s${i}`, "Same", `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}`));
  start = performance.now();
  assert.equal(new Set([...allocateNames(same).values()].map((n) => n.toLowerCase())).size, 10_000);
  assert.ok(performance.now() - start < 500, "identical was slow");
});

// --- the note file ------------------------------------------------------------------------------

const base = {
  title: "Thesis outline",
  content: "# Outline\n\nSee [[Related note]].",
  tags: ["ai", "school"],
  isFavorite: true,
  createdAt: day("2026-10-01T09:00:00.000Z"),
  updatedAt: day("2026-11-05T12:00:00.000Z"),
};

test("a note file is exactly this", () => {
  const text = noteFile(base, { course: "CMP2003", project: "Thesis", attachments: ["diagram.png", "slides.pdf"] });
  assert.equal(
    text,
    [
      "---",
      "anamnesis: 1",
      'title: "Thesis outline"',
      'tags: ["ai","school"]',
      "favorite: true",
      'course: "CMP2003"',
      'project: "Thesis"',
      'attachments: ["[[diagram.png]]","[[slides.pdf]]"]',
      'created: "2026-10-01T09:00:00.000Z"',
      'updated: "2026-11-05T12:00:00.000Z"',
      "---",
      "",
      "# Outline",
      "",
      "See [[Related note]].",
    ].join("\n"),
  );
});

test("keys with nothing to say are left out", () => {
  const text = noteFile({ ...base, tags: [], isFavorite: false }, { course: null, project: null, attachments: [] });
  const keys = text.split("\n---\n")[0].split("\n").slice(1).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["anamnesis", "title", "created", "updated"]);
});

test("a title with quotes, a backslash, a line separator and an emoji is one valid line", () => {
  const title = 'He said "hi" \\ back\u2028and\u2029more\u0085 😀 \ud800';
  const line = noteFile({ ...base, title }, { course: null, project: null, attachments: [] })
    .split("\n")
    .find((l) => l.startsWith("title: "));
  assert.ok(line);
  for (const raw of ["\u2028", "\u2029", "\u0085"]) assert.ok(!line.includes(raw), "a raw YAML line break");
  assert.equal(JSON.parse(line.slice("title: ".length)), title, "the value reads back unchanged");
  assert.ok(JSON.parse(line.slice("title: ".length)).startsWith('He said "hi" \\ back\u2028and'));
});

test("content is kept exactly after the separator, even when it looks like front matter", () => {
  for (const content of ["---\nnot front matter\n---\nx", "\n\nstarts blank", "", "trailing\n\n", "a\r\nb"]) {
    const text = noteFile({ ...base, content }, { course: null, project: null, attachments: [] });
    const marker = '"\n---\n\n';
    assert.equal(text.slice(text.indexOf(marker) + marker.length), content);
  }
});

test("only the documented keys are written: no id, no owner", () => {
  const text = noteFile(base, { course: "CMP2003", project: "Thesis", attachments: ["a.png"] });
  const keys = text.split("\n---\n")[0].split("\n").slice(1).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["anamnesis", "title", "tags", "favorite", "course", "project", "attachments", "created", "updated"]);
});

// --- the manifest -------------------------------------------------------------------------------

test("the manifest counts what is in the vault and says what is not", () => {
  const text = manifestJson({ exportedAt: day("2026-11-05T12:00:00Z"), notes: 3, attachments: 2, missing: [{ note: "A", name: "gone.png" }] });
  assert.ok(text.endsWith("\n"));
  const manifest = JSON.parse(text);
  assert.equal(manifest.formatVersion, VAULT.formatVersion);
  assert.equal(manifest.exportedAt, "2026-11-05T12:00:00.000Z");
  assert.equal(manifest.notes, 3);
  assert.equal(manifest.attachments, 2);
  assert.deepEqual(manifest.missing, [{ note: "A", name: "gone.png" }]);
  const left = manifest.notIncluded.join(" ").toLowerCase();
  for (const word of ["tasks", "events", "flashcards", "grades", "versions", "trash", "search index"]) assert.ok(left.includes(word), word);
});

test("the vault constants are the plan's", () => {
  assert.equal(VAULT.attachmentsDir, "attachments");
  assert.equal(VAULT.manifestPath, ".anamnesis/manifest.json");
  assert.equal(VAULT.maxImportNotes, 500);
  assert.equal(VAULT.maxMdBytes, 512 * 1024);
  assert.equal(VAULT.maxAttachmentsPerNote, 20);
});
