import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_PROBLEM, analyseLayout, convertPage, databaseCode, resolveTarget, splitNotionName, type PageContext } from "@/lib/notion";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);

test("a Notion file name is a title and the 32-character id Notion appended", () => {
  assert.deepEqual(splitNotionName(`Project plan ${A}`), { title: "Project plan", id: A });
  assert.deepEqual(splitNotionName(`Project plan ${A.toUpperCase()}`), { title: "Project plan", id: A }, "ids are compared in lower case");
  assert.deepEqual(splitNotionName("No id here"), { title: "No id here", id: null });
  assert.deepEqual(splitNotionName(`${A}`), { title: "", id: A });
  assert.deepEqual(splitNotionName(`Title ${"g".repeat(32)}`), { title: `Title ${"g".repeat(32)}`, id: null }, "not hex, not an id");
  assert.equal(splitNotionName(`Title ${"a".repeat(31)}`).id, null);
});

test("the layout names pages, the rows of a database, and files; a zip that is not a Markdown export says what it is", () => {
  const layout = analyseLayout([
    `Home ${A}.md`,
    `Home ${A}/Sub page ${B}.md`,
    `Home ${A}/diagram.png`,
    `Reading ${C}.csv`,
    `Reading ${C}_all.csv`,
    `Reading ${C}/Book one ${"d".repeat(32)}.md`,
    `Reading ${C}/Book two ${"e".repeat(32)}.md`,
    "notes.txt",
  ]);
  assert.equal(layout.problem, null);
  assert.equal(layout.pages.length, 4);
  assert.deepEqual(layout.databases, [{ id: C, name: "Reading", rows: 2 }]);
  assert.equal(layout.pages.find((page) => page.title === "Book one")?.database, C);
  assert.equal(layout.pages.find((page) => page.title === "Sub page")?.database, null, "a sub-page of a page is not a database row");
  assert.deepEqual(layout.files.sort(), [`Home ${A}/diagram.png`, "notes.txt"]);

  assert.equal(analyseLayout(["page.html", "other.html"]).problem, "html");
  assert.equal(analyseLayout([`Export-${A}-Part-1.zip`]).problem, "nested");
  assert.equal(analyseLayout(["readme.txt"]).problem, "none");
  assert.equal(analyseLayout([]).problem, "none");
  for (const text of Object.values(LAYOUT_PROBLEM)) assert.match(text, /\S/);
  // A database with a csv but no row pages is not offered.
  assert.deepEqual(analyseLayout([`Empty ${C}.csv`, "a.md"]).databases, []);
});

test("a link target resolves from the page's folder, decoded, and never climbs out of the zip", () => {
  assert.equal(resolveTarget("Home", "Sub%20page.md"), "Home/Sub page.md");
  assert.equal(resolveTarget("Home/Sub", "../Other.md"), "Home/Other.md");
  assert.equal(resolveTarget("", "a/./b.md"), "a/b.md");
  assert.equal(resolveTarget("Home", "x.md#section"), "Home/x.md");
  assert.equal(resolveTarget("", "../escape.md"), null);
  assert.equal(resolveTarget("a", "../../escape.md"), null);
  assert.equal(resolveTarget("", "/etc/passwd"), null);
  assert.equal(resolveTarget("", "%2e%2e/x.md"), null, "an encoded climb is a climb");
  assert.equal(resolveTarget("", "bad%zz"), null);
  assert.equal(resolveTarget("", "a\u0000b.md"), null);
  assert.equal(resolveTarget("", "..\\x.md"), null);
  assert.equal(resolveTarget("", ""), null);
});

const context = (pages: Record<string, string>, files: string[] = [], byId: Record<string, string> = {}): PageContext => ({
  path: "Home.md",
  titleByPath: (path) => pages[path] ?? null,
  titleById: (id) => byId[id] ?? null,
  fileAt: (path) => (files.includes(path) ? path : null),
});

test("the first heading is the title and leaves the body; links to pages become wiki links, others keep their words", () => {
  const raw = `# Home page\n\nSee [the plan](Home%20page%20${A}/Plan%20${B}.md) and [site](https://example.com/x) and [gone](Missing%20${C}.md).\n\n- [ ] item`;
  const out = convertPage(raw, "fallback", { ...context({ [`Home page ${A}/Plan ${B}.md`]: "Project plan" }), path: `Home page ${A}.md` });
  assert.equal(out.title, "Home page");
  assert.equal(out.content, "See [[Project plan]] and [site](https://example.com/x) and gone.\n\n- [ ] item");
  assert.equal(out.linksConverted, 1);
  assert.equal(out.linksUnresolved, 1);
});

test("a page without a heading is titled by its file, and the title is cleaned", () => {
  assert.equal(convertPage("just text", "From the file", context({})).title, "From the file");
  assert.equal(convertPage("# \n\ntext", "From the file", context({})).title, "From the file");
  assert.equal(convertPage(`# ${"x".repeat(500)}`, "f", context({})).title.length, 200);
  assert.equal(convertPage("", "", context({})).title, "Untitled");
  assert.equal(convertPage("## Not a title\n\nx", "File", context({})).title, "File", "only a first-level heading is the title");
  assert.equal(convertPage("text\n\n# Later heading", "File", context({})).title, "File", "a heading after the first text is a heading");
});

test("links in code are left alone, and a link by Notion address or by the id in the file name finds its page", () => {
  const byId = { [B]: "Plan" };
  const raw = `\`[x](Plan%20${B}.md)\` and [y](https://www.notion.so/workspace/Plan-${B}) and [z](Elsewhere/Plan%20${B}.md)\n\n\`\`\`\n[w](Plan%20${B}.md)\n\`\`\``;
  const out = convertPage(raw, "t", context({}, [], byId));
  assert.equal(out.content, `\`[x](Plan%20${B}.md)\` and [[Plan]] and [[Plan]]\n\n\`\`\`\n[w](Plan%20${B}.md)\n\`\`\``);
  assert.equal(out.linksConverted, 2);
});

test("a file a page shows is attached once, its line says so, and a missing file keeps the words", () => {
  const out = convertPage("![diagram](Home/diagram.png)\n\n![again](Home/diagram.png) and [report](Home/report.pdf) and ![gone](Home/none.png)", "t", { ...context({}, ["Home/diagram.png", "Home/report.pdf"]), path: "Home.md" });
  assert.deepEqual(out.attachments, ["Home/diagram.png", "Home/report.pdf"]);
  assert.equal(out.content, "(attached: diagram.png)\n\n(attached: diagram.png) and (attached: report.pdf) and gone");
  assert.equal(out.linksUnresolved, 1);
  // An image of a page is not a link to it.
  const image = convertPage(`![x](P%20${A}.md)`, "t", context({ [`P ${A}.md`]: "P" }));
  assert.equal(image.content, "x");
});

test("a link that is not a page, a file of the zip or a web or mail address is not carried into a note", () => {
  const out = convertPage("[a](javascript:alert) ![b](data:image/png;base64,AAAA) [c](file:///etc/passwd) [d](/api/export) ![e](../../etc/x.png) [f](https://example.com) [g](mailto:a@b.c) [h](#section)", "t", context({}));
  assert.equal(out.content, "a b c d e [f](https://example.com) [g](mailto:a@b.c) h");
  assert.equal(out.linksUnresolved, 6);
});

test("a page whose title cannot be written as a link keeps its words", () => {
  const out = convertPage(`[a](B%20${B}.md) and [c](C%20${C}.md)`, "t", context({ [`B ${B}.md`]: "Has [brackets]", [`C ${C}.md`]: "Fine" }));
  assert.equal(out.content, "a and [[Fine]]");
});

test("a database's name makes a course code of at most 20 characters", () => {
  assert.equal(databaseCode("Reading list"), "Reading list");
  assert.equal(databaseCode("A very long database name indeed").length <= 20, true);
  assert.equal(databaseCode("   "), "Notion");
});

test("hostile pages cost little: a hundred thousand brackets and links, a million backticks", () => {
  const started = performance.now();
  convertPage("[".repeat(100_000), "t", context({}));
  convertPage("[a](".repeat(50_000), "t", context({}));
  convertPage("](".repeat(100_000), "t", context({}));
  convertPage("`".repeat(1_000_000), "t", context({}));
  convertPage(`[x](${"%2e%2e/".repeat(20_000)}a.md)`.repeat(50), "t", context({}));
  convertPage("# t\n".repeat(100_000), "t", context({}));
  assert.ok(performance.now() - started < 4000, "linear, not quadratic");
});
