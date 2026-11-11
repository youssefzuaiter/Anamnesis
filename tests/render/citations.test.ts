import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown";
import type { RefFields } from "@/lib/bibtex";
import { citationContext, NoteReferences, withCitations } from "@/components/note-citations";
import { citedKeys } from "@/lib/citations";

const refs: { id: string; fields: RefFields }[] = [
  { id: "11111111-1111-4111-8111-111111111111", fields: { key: "vaswani2017", type: "paper", title: "Attention is all you need", authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }, { family: "Parmar", given: "Niki" }], year: 2017, container: "NeurIPS" } },
  { id: "22222222-2222-4222-8222-222222222222", fields: { key: "lecun2015", type: "article", title: "Deep learning", authors: [{ family: "LeCun", given: "Yann" }], year: 2015, container: "Nature", volume: "521" } },
];

/** A note rendered the way NoteContent does it: citations substituted into paragraph text, then the list. */
function render(markdown: string): string {
  const ctx = citationContext(refs, citedKeys(markdown));
  const p = ({ children }: { children?: React.ReactNode }) => createElement("p", null, withCitations(children, ctx, (text) => text));
  const body = renderToStaticMarkup(createElement(Markdown, { remarkPlugins, rehypePlugins, components: { p } }, markdown));
  return body + renderToStaticMarkup(createElement(Fragment, null, createElement(NoteReferences, { ctx })));
}

test("a citation becomes APA text linked to its reference, and the list follows", () => {
  const html = render("Transformers [@vaswani2017, p. 3] replaced RNNs; @lecun2015 surveys it.");
  assert.match(html, /<a[^>]*href="\/references\/11111111-1111-4111-8111-111111111111"[^>]*>\(Vaswani et al\., 2017, p\. 3\)<\/a>/);
  assert.match(html, /<a[^>]*href="\/references\/22222222-2222-4222-8222-222222222222"[^>]*>LeCun \(2015\)<\/a>/);
  assert.match(html, /<h2[^>]*>References<\/h2>/);
  const list = html.slice(html.indexOf("References"));
  assert.ok(list.indexOf("LeCun, Y.") < list.indexOf("Vaswani, A."), "the list is in APA order");
  assert.match(list, /<i>Nature, 521<\/i>/);
});

test("an unknown key stays as typed, marked, and is not listed", () => {
  const html = render("Unknown [@nobody2020] here.");
  assert.match(html, /<span[^>]*title="No reference has the key &quot;nobody2020&quot;"[^>]*>\[@nobody2020\]<\/span>/);
  assert.ok(!html.includes("References"), "no list when nothing resolved");
});

test("nothing inside code is a citation, and maths still renders beside citations", () => {
  const html = render("Inline `[@vaswani2017]` and $x^2$ with [@lecun2015].\n\n```\n[@vaswani2017]\n```");
  assert.match(html, /<code[^>]*>\[@vaswani2017\]<\/code>/);
  assert.ok(html.includes('class="katex"'));
  assert.match(html, /\(LeCun, 2015\)/);
  const list = html.slice(html.indexOf("References"));
  assert.ok(!list.includes("Vaswani"), "a key cited only in code is not listed");
});

test("several works in one bracket link to the list, and the rest of the text is passed on", () => {
  const ctx = citationContext(refs, ["vaswani2017", "lecun2015"]);
  const seen: string[] = [];
  const html = renderToStaticMarkup(createElement("p", null, withCitations("A [@vaswani2017; @lecun2015] B", ctx, (text) => (seen.push(text), text))));
  assert.match(html, /<a[^>]*href="#note-references"[^>]*>\(LeCun, 2015; Vaswani et al\., 2017\)<\/a>/);
  assert.deepEqual(seen, ["A ", " B"]);
});
