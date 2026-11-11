import { test } from "node:test";
import assert from "node:assert/strict";
import type { RefFields } from "@/lib/bibtex";
import { apaContext, inTextApa, referenceApa, referenceListApa } from "@/lib/apa";

const ref = (key: string, extra: Partial<RefFields>): RefFields => ({ key, type: "article", title: `Title ${key}`, authors: [], year: 2020, ...extra });
const item = (key: string, more: Partial<{ prefix: string; locator: string; suppressAuthor: boolean }> = {}) => ({ key, prefix: "", locator: "", suppressAuthor: false, ...more });
const plain = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

const one = ref("one", { authors: [{ family: "Smith", given: "John" }], year: 2019 });
const two = ref("two", { authors: [{ family: "Smith", given: "John" }, { family: "Doe", given: "Jane" }], year: 2018 });
const three = ref("three", { authors: [{ family: "Vaswani", given: "Ashish" }, { family: "Shazeer", given: "Noam" }, { family: "Parmar", given: "Niki" }], year: 2017 });
const group = ref("who", { authors: [{ literal: "World Health Organization" }], year: 2023 });
const undated = ref("nd", { authors: [{ family: "Brown", given: "Ann" }], year: null });

test("in-text citations follow APA 7: one, two, three or more authors, groups, no date", () => {
  const ctx = apaContext([one, two, three, group, undated]);
  assert.equal(inTextApa(ctx, [item("one")], false), "(Smith, 2019)");
  assert.equal(inTextApa(ctx, [item("two")], false), "(Smith & Doe, 2018)");
  assert.equal(inTextApa(ctx, [item("two")], true), "Smith and Doe (2018)");
  assert.equal(inTextApa(ctx, [item("three")], false), "(Vaswani et al., 2017)");
  assert.equal(inTextApa(ctx, [item("three")], true), "Vaswani et al. (2017)");
  assert.equal(inTextApa(ctx, [item("who")], false), "(World Health Organization, 2023)");
  assert.equal(inTextApa(ctx, [item("nd")], false), "(Brown, n.d.)");
});

test("locators, prefixes, year only, and several works in reference-list order", () => {
  const ctx = apaContext([one, two, three]);
  assert.equal(inTextApa(ctx, [item("three", { locator: "p. 3" })], false), "(Vaswani et al., 2017, p. 3)");
  assert.equal(inTextApa(ctx, [item("one", { suppressAuthor: true })], false), "(2019)");
  assert.equal(inTextApa(ctx, [item("three", { prefix: "see" }), item("one")], false), "(Smith, 2019; see Vaswani et al., 2017)");
  assert.equal(inTextApa(ctx, [item("missing")], false), "(missing?)");
});

test("the same authors in the same year get a and b, by title", () => {
  const first = ref("x1", { authors: [{ family: "Lee", given: "K" }], year: 2021, title: "Zebra studies" });
  const second = ref("x2", { authors: [{ family: "Lee", given: "K" }], year: 2021, title: "Apple studies" });
  const ctx = apaContext([first, second]);
  assert.equal(inTextApa(ctx, [item("x1")], false), "(Lee, 2021b)");
  assert.equal(inTextApa(ctx, [item("x2")], false), "(Lee, 2021a)");
  assert.deepEqual(referenceListApa(ctx).map((r) => r.key), ["x2", "x1"]);
  assert.match(plain(referenceApa(ctx, second)), /^Lee, K\. \(2021a\)\./);
});

test("reference list entries for each type, italics where APA puts them", () => {
  const article = ref("art", {
    authors: [{ family: "LeCun", given: "Yann" }, { family: "Bengio", given: "Yoshua" }, { family: "Hinton", given: "Geoffrey" }],
    year: 2015, title: "Deep learning", container: "Nature", volume: "521", issue: "7553", pages: "436–444", doi: "10.1038/nature14539",
  });
  const book = ref("bk", { type: "book", authors: [{ family: "Goodfellow", given: "Ian" }], year: 2016, title: "Deep learning", edition: "2", publisher: "MIT Press" });
  const chapter = ref("ch", { type: "chapter", authors: [{ family: "Doe", given: "Jane-Marie" }], year: 2001, title: "A chapter", editors: [{ family: "Editor", given: "Ed" }], container: "Big book", pages: "1–20", publisher: "P" });
  const paper = ref("pp", { type: "paper", authors: [{ family: "Vaswani", given: "Ashish" }], year: 2017, title: "Attention is all you need", container: "Advances in Neural Information Processing Systems 30", pages: "5998–6008" });
  const thesis = ref("th", { type: "thesis", authors: [{ family: "Öztürk", given: "Ayşe" }], year: 2020, title: "Derin öğrenme", institution: "Bahçeşehir Üniversitesi", degree: "doctoral" });
  const report = ref("rp", { type: "report", authors: [{ literal: "World Health Organization" }], year: 2023, title: "Report", number: "12", institution: "WHO" });
  const web = ref("wb", { type: "web", authors: [], year: 2024, title: "A page", container: "Example", url: "https://example.com/page" });
  const ctx = apaContext([article, book, chapter, paper, thesis, report, web]);

  assert.equal(plain(referenceApa(ctx, article)), "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444. https://doi.org/10.1038/nature14539");
  assert.deepEqual(referenceApa(ctx, article).filter((p) => p.italic).map((p) => p.text), ["Nature, 521"]);
  assert.equal(plain(referenceApa(ctx, book)), "Goodfellow, I. (2016). Deep learning (2nd ed.). MIT Press.");
  const first = { ...book, key: "bk1", edition: "1" };
  assert.equal(plain(referenceApa(apaContext([first]), first)), "Goodfellow, I. (2016). Deep learning. MIT Press.", "a first edition is not named");
  assert.deepEqual(referenceApa(ctx, book).filter((p) => p.italic).map((p) => p.text), ["Deep learning"]);
  assert.equal(plain(referenceApa(ctx, chapter)), "Doe, J.-M. (2001). A chapter. In E. Editor (Ed.), Big book (pp. 1–20). P.");
  assert.equal(plain(referenceApa(ctx, paper)), "Vaswani, A. (2017). Attention is all you need. In Advances in Neural Information Processing Systems 30 (pp. 5998–6008).");
  assert.equal(plain(referenceApa(ctx, thesis)), "Öztürk, A. (2020). Derin öğrenme [Doctoral dissertation, Bahçeşehir Üniversitesi].");
  assert.equal(plain(referenceApa(ctx, report)), "World Health Organization. (2023). Report (Report No. 12). WHO.");
  assert.equal(plain(referenceApa(ctx, web)), "A page. (2024). Example. https://example.com/page");
  const masters = { ...thesis, key: "ms", degree: "masters" as const };
  assert.equal(plain(referenceApa(apaContext([masters]), masters)), "Öztürk, A. (2020). Derin öğrenme [Master's thesis, Bahçeşehir Üniversitesi].");
});

test("up to 20 authors are listed; more become the first 19, an ellipsis and the last", () => {
  const many = (n: number) => ref(`m${n}`, { authors: Array.from({ length: n }, (_, i) => ({ family: `A${i + 1}`, given: "B" })) });
  const twenty = plain(referenceApa(apaContext([many(20)]), many(20)));
  assert.match(twenty, /A19, B\., & A20, B\. \(2020\)/);
  const twentyOne = plain(referenceApa(apaContext([many(21)]), many(21)));
  assert.match(twentyOne, /A19, B\., \. \. \. A21, B\. \(2020\)/);
  assert.ok(!twentyOne.includes("A20,"));
});

test("the list is sorted by author, then year, then title; a work without authors by its title", () => {
  const ctx = apaContext([three, one, undated, two, ref("anon", { authors: [], title: "Anonymous work", year: 2010 })]);
  assert.deepEqual(referenceListApa(ctx).map((r) => r.key), ["anon", "nd", "one", "two", "three"], "one author before the same author with others");
});
