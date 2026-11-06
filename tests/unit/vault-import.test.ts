import { test } from "node:test";
import assert from "node:assert/strict";
import { noteFile } from "@/lib/vault";
import {
  classifyEntry,
  contentHash,
  importedTitle,
  parseNoteFile,
  planImport,
  sniffAttachment,
  vaultRoot,
  type ExistingNote,
  type ParsedNote,
} from "@/lib/vault-import";

const slow = (label: string, fn: () => void, ms = 50) => {
  const start = performance.now();
  fn();
  const took = performance.now() - start;
  assert.ok(took < ms, `${label} took ${took.toFixed(0)} ms, budget ${ms} ms`);
};

const parsed = (path: string, text: string): ParsedNote => {
  const result = parseNoteFile(path, text);
  assert.ok(!("skip" in result), `skipped: ${"skip" in result ? result.skip : ""}`);
  return result;
};

// --- classifyEntry ------------------------------------------------------------------------------

test("notes, attachments and what is ignored", () => {
  assert.deepEqual(classifyEntry("a.md"), { kind: "note" });
  assert.deepEqual(classifyEntry("dir/sub/A Note.MD"), { kind: "note" });
  assert.deepEqual(classifyEntry("attachments/x.png"), { kind: "attachment", mime: "image/png" });
  assert.deepEqual(classifyEntry("attachments/deep/dir/x.JPEG"), { kind: "attachment", mime: "image/jpeg" });
  assert.deepEqual(classifyEntry("attachments/x.md"), { kind: "attachment", mime: "text/markdown" }, "under attachments/ a .md is a file, not a note");
  assert.deepEqual(classifyEntry("Attachments/x.png"), { kind: "attachment", mime: "image/png" }, "a Mac or Windows disk does not mind the case of the folder");
  assert.deepEqual(classifyEntry("ATTACHMENTS/x.png"), { kind: "attachment", mime: "image/png" });
  for (const name of ["x.png", "readme.txt", "notes.markdown", "attachments/x.html", "attachments/x.svg", "attachments/noext"]) {
    assert.equal(classifyEntry(name).kind, "ignored", name);
  }
  assert.equal(classifyEntry("folder/").kind, "ignored");
});

test("metadata and hidden folders are ignored", () => {
  for (const name of ["__MACOSX/a.md", "__MACOSX/._a.md", "._a.md", "dir/._a.md", ".obsidian/app.json", ".obsidian/notes.md", ".trash/old.md", ".anamnesis/manifest.json", "dir/.hidden/x.md", ".DS_Store", "dir/Thumbs.db"]) {
    assert.equal(classifyEntry(name).kind, "ignored", name);
  }
});

test("paths that climb, or are absolute, or carry control characters are unsafe", () => {
  for (const name of ["../x.md", "a/../../x.md", "/x.md", "\\x.md", "a\\..\\b.md", "C:\\x.md", "C:/x.md", "a\u0000b.md", "a\nb.md", "attachments/../x.png"]) {
    assert.equal(classifyEntry(name).kind, "unsafe", JSON.stringify(name));
  }
  assert.equal(classifyEntry("a/./b.md").kind, "note", "a dot segment climbs nowhere");
  assert.equal(classifyEntry("a/b..c.md").kind, "note", "two dots inside a name are a name");
});

// --- vaultRoot ----------------------------------------------------------------------------------

test("a vault zipped as a folder has a root to look inside; anything else has none", () => {
  const wrapped = ["MyVault/", "MyVault/Note.md", "MyVault/attachments/", "MyVault/attachments/x.png", "MyVault/.anamnesis/manifest.json", "__MACOSX/MyVault/._Note.md", "__MACOSX/", ".DS_Store"];
  assert.equal(vaultRoot(wrapped), "MyVault/", "Finder's Compress: one folder, plus its own metadata beside it");
  assert.equal(vaultRoot(["V/a.md", "V/sub/b.md"]), "V/");
  assert.equal(vaultRoot(["V\\a.md", "V\\attachments\\x.png"]), "V\\", "old Windows tools write backslashes");
  assert.equal(vaultRoot(["A/a.md", "B/b.md"]), "", "two top-level folders");
  assert.equal(vaultRoot(["a.md", "V/b.md"]), "", "a file at the top level");
  assert.equal(vaultRoot(["attachments/x.png", "attachments/y.png"]), "", "attachments/ is a folder of the vault, never its wrapper");
  assert.equal(vaultRoot(["Attachments/x.png"]), "");
  assert.equal(vaultRoot([".obsidian/app.json", ".obsidian/x.json"]), "", "a hidden folder is not a wrapper");
  assert.equal(vaultRoot(["V/a.md", "../evil.md"]), "", "a climbing path stays visible");
  assert.equal(vaultRoot(["V/a.md", "V/../x.md"]), "V/", "judged later, by classifyEntry, once the root is removed");
  assert.equal(vaultRoot([]), "");
  assert.equal(vaultRoot(["__MACOSX/._a.md"]), "");
  assert.equal(vaultRoot(["V/V/a.md", "V/V/b.md"]), "V/", "only one level is a wrapper");
});

// --- parseNoteFile ------------------------------------------------------------------------------

test("what the exporter writes reads back exactly (200 generated notes)", () => {
  let seed = 20261105;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (alphabet: string, min: number, max: number) => {
    const chars = Array.from(alphabet);
    const n = min + Math.floor(rnd() * (max - min + 1));
    return Array.from({ length: n }, () => chars[Math.floor(rnd() * chars.length)]).join("");
  };
  const textAlphabet = 'abcXYZ019 -_.,;:!?"\'\\/[]{}()#@*ğşıİöüçŞ😀\n';
  for (let i = 0; i < 200; i++) {
    const title = pick("abcXYZ019 -_.,;:!?\"'\\/[]{}()#@ğşıİöüç😀", 1, 80).trim() || "t";
    const tags = [...new Set(Array.from({ length: Math.floor(rnd() * 6) }, () => pick("abc019-/ ", 1, 12).trim().toLowerCase()).filter((t) => t !== "" && !t.startsWith("#")))];
    const content = pick(textAlphabet, 0, 400);
    const isFavorite = rnd() < 0.5;
    const course = rnd() < 0.5 ? pick("ABC0123", 3, 8) : null;
    const project = rnd() < 0.5 ? pick("abc XYZ", 1, 20).trim() || "p" : null;
    const attachments = rnd() < 0.4 ? [`${pick("abc", 1, 5)}.png`, `${pick("xyz", 1, 5)}.pdf`] : [];
    const file = noteFile({ title, content, tags, isFavorite, createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 5, 1) }, { course, project, attachments });
    const back = parsed(`${pick("abc", 3, 8)}.md`, file);
    assert.equal(back.title, title);
    assert.equal(back.content, content.replace(/\r\n?/g, "\n"));
    assert.deepEqual(back.tags, tags);
    assert.equal(back.favorite, isFavorite);
    assert.equal(back.course, course);
    assert.equal(back.project, project);
    assert.deepEqual(back.attachments, attachments);
    assert.equal(back.ours, true);
    assert.deepEqual(back.droppedProperties, []);
  }
});

test("content that starts with a blank line, or looks like front matter, is kept", () => {
  for (const content of ["\nstarts blank", "\n\n\ntwo more", "---\nnot front matter\n---\nx", "---", "", "text\n"]) {
    const file = noteFile({ title: "T", content, tags: [], isFavorite: false, createdAt: new Date(0), updatedAt: new Date(0) }, { course: null, project: null, attachments: [] });
    assert.equal(parsed("T.md", file).content, content, JSON.stringify(content));
  }
});

test("a file written with CR LF line breaks reads with LF", () => {
  const text = "---\r\nanamnesis: 1\r\ntitle: \"T\"\r\n---\r\n\r\nline one\r\nline two\r\n";
  assert.equal(parsed("T.md", text).content, "line one\nline two\n");
  assert.equal(parsed("T.md", "\ufeff---\r\ntags: [a]\r\n---\r\nBody").content, "Body", "a byte order mark is ignored");
});

test("a foreign Obsidian note: flow tags, with quotes and hashes", () => {
  const note = parsed("Notes/Trip.md", "---\ntags: [Alpha, \"Beta Two\", '#gamma', alpha]\n---\nBody text\n");
  assert.deepEqual(note.tags, ["alpha", "beta two", "gamma"]);
  assert.equal(note.title, "Trip");
  assert.equal(note.content, "Body text\n");
  assert.equal(note.ours, false);
  assert.equal(note.favorite, false);
  assert.equal(note.course, null);
});

test("a foreign note: block tags, and properties the app has no place for are named", () => {
  const text = "---\ntags:\n  - Alpha\n  - \"#beta\"\naliases: [x, y]\ncssclass: wide\nfavorite: true\ncourse: CMP\n---\n\nBody\n";
  const note = parsed("a.md", text);
  assert.deepEqual(note.tags, ["alpha", "beta"]);
  assert.deepEqual(note.droppedProperties.sort(), ["aliases", "course", "cssclass", "favorite"]);
  assert.equal(note.content, "Body\n");
  assert.equal(note.favorite, false, "only our own files say favourite");
  assert.equal(note.course, null, "only our own files name a course");
});

test("a foreign note: comma text, a single tag, the legacy tag key", () => {
  assert.deepEqual(parsed("a.md", "---\ntags: a, B ,c\n---\nx").tags, ["a", "b", "c"]);
  assert.deepEqual(parsed("a.md", "---\ntag: Single\n---\nx").tags, ["single"]);
  assert.deepEqual(parsed("a.md", "---\ntags: []\n---\nx").tags, []);
});

test("a tag this app stored with a leading # keeps it in a file this app wrote, and loses it in another tool's", () => {
  const mine = noteFile({ title: "T", content: "c", tags: ["#exam", "plain"], isFavorite: false, createdAt: new Date(0), updatedAt: new Date(0) }, { course: null, project: null, attachments: [] });
  assert.deepEqual(parsed("T.md", mine).tags, ["#exam", "plain"]);
  assert.deepEqual(parsed("T.md", "---\ntags: [\"#exam\", plain]\n---\nx").tags, ["exam", "plain"], "Obsidian writes tags without it");
});

test("tags are limited to 12 of at most 50 characters", () => {
  const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(", ");
  assert.equal(parsed("a.md", `---\ntags: ${many}\n---\nx`).tags.length, 12);
  assert.equal(parsed("a.md", `---\ntags: ${"x".repeat(80)}\n---\nx`).tags[0].length, 50);
});

test("no front matter, an unterminated one, and the closing dots", () => {
  assert.equal(parsed("a.md", "just text\n---\nmore").content, "just text\n---\nmore");
  assert.equal(parsed("a.md", "---\ntags: [a]\nno end").content, "---\ntags: [a]\nno end", "an unterminated block is text");
  assert.deepEqual(parsed("a.md", "---\ntags: [a]\n...\nbody").tags, ["a"]);
  assert.deepEqual(parsed("a.md", "text\n").droppedProperties, []);
});

test("the title of a foreign file is its file name, composed, and a title property is ignored", () => {
  assert.equal(parsed("dir/Şükrü ğ.md".normalize("NFD"), "x").title, "Şükrü ğ".normalize("NFC"));
  assert.equal(parsed("Real name.md", "---\ntitle: Other\n---\nx").title, "Real name");
  assert.equal(parsed("a/b/c.MD", "x").title, "c");
  assert.equal(parsed("dir\\Win name.md", "x").title, "Win name");
  assert.deepEqual(parsed("Real name.md", "---\ntitle: Other\n---\nx").droppedProperties, ["title"]);
});

test("our own file takes its title from the property, even when the file name was changed to be safe", () => {
  const file = noteFile({ title: "What is 1/2?", content: "c", tags: [], isFavorite: false, createdAt: new Date(0), updatedAt: new Date(0) }, { course: null, project: null, attachments: [] });
  assert.equal(parsed("What is 1-2-.md", file).title, "What is 1/2?");
});

test("our own file keeps what an editor added, and names it", () => {
  const file = noteFile({ title: "T", content: "c", tags: [], isFavorite: false, createdAt: new Date(0), updatedAt: new Date(0) }, { course: null, project: null, attachments: [] });
  const edited = file.replace("anamnesis: 1\n", "anamnesis: 1\nstatus: draft\n");
  assert.deepEqual(parsed("T.md", edited).droppedProperties, ["status"]);
});

test("attachment links are reduced to base names, deduplicated and limited to 20", () => {
  const file = '---\nanamnesis: 1\ntitle: "T"\nattachments: ["[[a.png]]", "[[dir/b.pdf|alias]]", "![[c.png]]", "[[a.png]]", "d.txt", ""]\n---\n';
  assert.deepEqual(parsed("T.md", file).attachments, ["a.png", "b.pdf", "c.png", "d.txt"]);
  const many = JSON.stringify(Array.from({ length: 50 }, (_, i) => `[[f${i}.png]]`));
  assert.equal(parsed("T.md", `---\nanamnesis: 1\nattachments: ${many}\n---\n`).attachments.length, 20);
});

test("a note that is too long, and one with no title, are skipped with a reason", () => {
  const long = parseNoteFile("a.md", "x".repeat(100_001));
  assert.ok("skip" in long && /100,000/.test(long.skip));
  assert.ok(!("skip" in parseNoteFile("a.md", "x".repeat(100_000))));
  const crlf = parseNoteFile("a.md", "x\r\n".repeat(50_000)); // 100,000 characters once the CR is gone
  assert.ok(!("skip" in crlf), "length is judged after line breaks are normalised");
  const none = parseNoteFile(".md", "text");
  assert.ok("skip" in none && /title/i.test(none.skip));
  assert.ok("skip" in parseNoteFile("  .md", "text"));
});

test("a NUL in a note is refused with its reason, not left for the database to fail on", () => {
  // Postgres text cannot hold U+0000: a note with one would fail to save on every run, with no reason given.
  const nul = String.fromCharCode(0);
  const result = parseNoteFile("a.md", `before${nul}after`);
  assert.ok("skip" in result && /NUL|null character/i.test(result.skip), JSON.stringify(result));
  assert.ok(!("skip" in parseNoteFile("a.md", "before after")));
  // In the front matter a control character is only a space in a name: the note itself is fine.
  assert.equal(parsed("a.md", `---\nanamnesis: 1\ntitle: "T${"\\u0000"}x"\n---\nbody`).title, "T x");
});

test("a title is cut at 200 characters without splitting a pair", () => {
  assert.equal(parsed(`${"a".repeat(500)}.md`, "x").title.length, 200);
  const emoji = parsed(`${"😀".repeat(150)}.md`, "x").title;
  assert.ok(emoji.length <= 200);
  assert.equal(Array.from(emoji).every((c) => c === "😀"), true, "no half of an emoji");
});

test("hostile 100,000-character inputs are read in milliseconds", () => {
  const big = 100_000;
  slow("title", () => parseNoteFile(`${"a".repeat(big)}.md`, "x"));
  slow("front matter lines", () => parseNoteFile("a.md", `---\n${"a: 1\n".repeat(big / 4)}---\nbody`));
  slow("one huge front matter line", () => parseNoteFile("a.md", `---\ntags: ${"a,".repeat(big / 2)}\n---\nbody`));
  slow("tag commas", () => parseNoteFile("a.md", `---\ntags: [${",".repeat(big)}]\n---\nx`));
  slow("tag brackets", () => parseNoteFile("a.md", `---\ntags: ${"[".repeat(big)}\n---\nx`));
  slow("list lines", () => parseNoteFile("a.md", `---\ntags:\n${"- a\n".repeat(big / 3)}---\nx`));
  slow("fence runs", () => parseNoteFile("a.md", "---\n".repeat(big / 4)));
  slow("link runs", () => parseNoteFile("a.md", `---\nanamnesis: 1\nattachments: ["${"[[".repeat(big / 2)}"]\n---\nx`));
  slow("quotes", () => parseNoteFile("a.md", `---\ntitle: "${'"'.repeat(big)}\n---\nx`));
  slow("spaces after dashes", () => parseNoteFile("a.md", `---${" ".repeat(big)}\nx`));
  slow("dots and spaces in the name", () => classifyEntry(`${". ".repeat(big / 2)}.md`));
  slow("long unsafe name", () => classifyEntry(`${"a/".repeat(big / 2)}../x.md`));
});

// --- sniffAttachment ----------------------------------------------------------------------------

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const GIF = Buffer.from("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x1a, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

test("a file whose bytes agree with its extension is accepted", () => {
  assert.equal(sniffAttachment("a.png", PNG), "image/png");
  assert.equal(sniffAttachment("a.JPG", JPEG), "image/jpeg");
  assert.equal(sniffAttachment("a.jpeg", JPEG), "image/jpeg");
  assert.equal(sniffAttachment("a.gif", GIF), "image/gif");
  assert.equal(sniffAttachment("a.gif", Buffer.from("GIF87a....")), "image/gif");
  assert.equal(sniffAttachment("a.webp", WEBP), "image/webp");
  assert.equal(sniffAttachment("a.pdf", PDF), "application/pdf");
  assert.equal(sniffAttachment("a.pdf", Buffer.concat([Buffer.alloc(100, 0x20), PDF])), "application/pdf", "the header may follow a little junk");
  assert.equal(sniffAttachment("a.txt", Buffer.from("héllo wörld ğ")), "text/plain");
  assert.equal(sniffAttachment("a.md", Buffer.from("# Title\n")), "text/markdown");
  assert.equal(sniffAttachment("a.csv", Buffer.from("a,b\n1,2\n")), "text/csv");
  assert.equal(sniffAttachment("a.txt", Buffer.from("\ufeffwith a byte order mark")), "text/plain");
  assert.equal(sniffAttachment("a.txt", Buffer.alloc(0)), "text/plain", "an empty text file is text");
});

test("bytes that do not agree with the extension, or a type that may not be attached, are refused", () => {
  assert.equal(sniffAttachment("a.png", Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniffAttachment("a.pdf", PNG), null);
  assert.equal(sniffAttachment("a.png", JPEG), null);
  assert.equal(sniffAttachment("a.png", Buffer.alloc(0)), null);
  assert.equal(sniffAttachment("a.pdf", Buffer.concat([Buffer.alloc(2000, 0x20), PDF])), null, "the header must be near the start");
  assert.equal(sniffAttachment("a.txt", Buffer.from([0x61, 0x00, 0x62])), null, "a NUL is not text");
  assert.equal(sniffAttachment("a.txt", Buffer.from([0xc3, 0x28])), null, "invalid UTF-8 is not text");
  assert.equal(sniffAttachment("a.svg", Buffer.from("<svg/>")), null);
  assert.equal(sniffAttachment("a.html", Buffer.from("<html/>")), null);
  assert.equal(sniffAttachment("noext", PNG), null);
});

// --- contentHash and titles ---------------------------------------------------------------------

test("the hash ignores the kind of line break and nothing else", () => {
  assert.equal(contentHash("a\r\nb\rc\n"), contentHash("a\nb\nc\n"));
  assert.notEqual(contentHash("a\nb"), contentHash("a\nb\n"));
  assert.notEqual(contentHash("a"), contentHash("A"));
  assert.match(contentHash("ğ"), /^[0-9a-f]{64}$/);
});

test("an imported title is numbered and stays within 200", () => {
  assert.equal(importedTitle("Thesis", 1), "Thesis (imported)");
  assert.equal(importedTitle("Thesis", 2), "Thesis (imported 2)");
  assert.equal(importedTitle("Thesis", 12), "Thesis (imported 12)");
  assert.equal(importedTitle("x".repeat(300), 3).length, 200);
  assert.ok(importedTitle("😀".repeat(150), 1).length <= 200);
  assert.ok(importedTitle("x".repeat(300), 1).endsWith("x (imported)"));
});

// --- planImport ---------------------------------------------------------------------------------

const incoming = (path: string, title: string, content: string): ParsedNote => ({
  path,
  title,
  content,
  tags: [],
  favorite: false,
  course: null,
  project: null,
  attachments: [],
  ours: true,
  droppedProperties: [],
});
const existing = (title: string, content: string): ExistingNote => ({ title, hash: contentHash(content) });

test("with nothing in the account everything is created, in path order", () => {
  const plan = planImport([], [incoming("b.md", "B", "two"), incoming("a.md", "A", "one")], 500);
  assert.deepEqual(plan.create.map((n) => n.finalTitle), ["A", "B"]);
  assert.deepEqual(plan.create.map((n) => n.renamed), [false, false]);
  assert.equal(plan.present.length + plan.deferred.length, 0);
});

test("the same import twice creates nothing the second time", () => {
  const notes = [incoming("a.md", "A", "one"), incoming("b.md", "B", "two"), incoming("c.md", "C", "")];
  const first = planImport([], notes, 500);
  const after = first.create.map((n) => existing(n.finalTitle, n.content));
  const second = planImport(after, notes, 500);
  assert.equal(second.create.length, 0);
  assert.equal(second.present.length, 3);
});

test("a note of the same title with other text comes in as a new note, renamed so it cannot take the link", () => {
  const plan = planImport([existing("Thesis", "the one I have")], [incoming("Thesis.md", "Thesis", "an older draft")], 500);
  assert.equal(plan.create[0].finalTitle, "Thesis (imported)");
  assert.equal(plan.create[0].renamed, true);
  assert.equal(plan.create[0].title, "Thesis", "the file's own title is kept beside it");
});

test("the title match is by normalised title: case and spacing do not escape the rename", () => {
  const plan = planImport([existing("My  Note", "x")], [incoming("a.md", "my note", "y")], 500);
  assert.equal(plan.create[0].finalTitle, "my note (imported)");
});

test("a second import after a rename creates nothing, and a third does not number again", () => {
  const notes = [incoming("a.md", "Thesis", "an older draft")];
  const first = planImport([existing("Thesis", "mine")], notes, 500);
  const have = [existing("Thesis", "mine"), existing(first.create[0].finalTitle, "an older draft")];
  assert.equal(planImport(have, notes, 500).create.length, 0);
  assert.equal(planImport(have, notes, 500).present.length, 1);
});

test("renames take the first free number, skipping titles in use", () => {
  const have = [existing("Thesis", "mine"), existing("Thesis (imported)", "someone else's")];
  const plan = planImport(have, [incoming("a.md", "Thesis", "x"), incoming("b.md", "Thesis", "y")], 500);
  assert.deepEqual(plan.create.map((n) => n.finalTitle), ["Thesis (imported 2)", "Thesis (imported 3)"]);
});

test("two notes of one title inside the file both keep it; an identical copy is not made twice", () => {
  const plan = planImport([], [incoming("a/Same.md", "Same", "one"), incoming("b/Same.md", "Same", "two"), incoming("c/Same.md", "Same", "one")], 500);
  assert.deepEqual(plan.create.map((n) => n.finalTitle), ["Same", "Same"]);
  assert.equal(plan.present.length, 1);
  const again = planImport(plan.create.map((n) => existing(n.finalTitle, n.content)), [incoming("a/Same.md", "Same", "one"), incoming("b/Same.md", "Same", "two")], 500);
  assert.equal(again.create.length, 0);
});

test("a note with the same text as one in the account is there already, whatever its title family suffix", () => {
  const plan = planImport([existing("Foo (imported 2)", "text")], [incoming("a.md", "Foo", "text"), incoming("b.md", "Foo (imported)", "text")], 500);
  assert.equal(plan.present.length, 2);
});

test("line breaks do not make a note new", () => {
  const plan = planImport([existing("A", "one\r\ntwo")], [incoming("a.md", "A", "one\ntwo")], 500);
  assert.equal(plan.present.length, 1);
});

test("the limit defers the rest in path order, and a later run carries on", () => {
  const notes = Array.from({ length: 7 }, (_, i) => incoming(`n${i}.md`, `N${i}`, `text ${i}`));
  const run1 = planImport([], notes, 3);
  assert.deepEqual(run1.create.map((n) => n.path), ["n0.md", "n1.md", "n2.md"]);
  assert.equal(run1.deferred.length, 4);
  const have = run1.create.map((n) => existing(n.finalTitle, n.content));
  const run2 = planImport(have, notes, 3);
  assert.deepEqual(run2.create.map((n) => n.path), ["n3.md", "n4.md", "n5.md"]);
  assert.equal(run2.present.length, 3);
  assert.equal(run2.deferred.length, 1);
});

test("a title is cut at 200 when renamed", () => {
  const long = "x".repeat(200);
  const plan = planImport([existing(long, "a")], [incoming("a.md", long, "b")], 500);
  assert.ok(plan.create[0].finalTitle.length <= 200);
  assert.ok(plan.create[0].finalTitle.endsWith("(imported)"));
});

test("planning ten thousand notes is fast", () => {
  const have = Array.from({ length: 10_000 }, (_, i) => existing(`T${i}`, `c${i}`));
  const notes = Array.from({ length: 10_000 }, (_, i) => incoming(`p${i}.md`, `T${i}`, i % 2 === 0 ? `c${i}` : `d${i}`));
  slow("plan", () => {
    const plan = planImport(have, notes, 500);
    assert.equal(plan.present.length, 5000);
    assert.equal(plan.create.length, 500);
  }, 1500);
});
