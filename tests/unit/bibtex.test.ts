import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeLatex, parseBibtex, parseNames, toBibtex } from "@/lib/bibtex";

test("LaTeX accents and special letters decode, Turkish ones included", () => {
  assert.equal(decodeLatex(`G{\\"o}del and {\\"{U}}nl{\\"u} and \\"Ozt\\"urk`), "Gödel and Ünlü and Öztürk");
  assert.equal(decodeLatex(`Do{\\u{g}}an, Do{\\u g}an, Do\\u{g}an`), "Doğan, Doğan, Doğan");
  assert.equal(decodeLatex(`I{\\c{s}}{\\i}k, I\\c{s}{\\i}k, \\c{C}elik`), "Işık, Işık, Çelik");
  assert.equal(decodeLatex(`{\\.I}stanbul and \\.{I}zmir`), "İstanbul and İzmir");
  assert.equal(decodeLatex(`Erd{\\H{o}}s, Ca{\\~n}on, Fran{\\c c}ois, {\\'E}cole, \\v{C}apek`), "Erdős, Cañon, François, École, Čapek");
  assert.equal(decodeLatex(`{\\ss} {\\ae} {\\o} {\\aa} {\\l}`), "ß æ ø å ł");
  assert.equal(decodeLatex(`10\\% of \\$5 \\& more, 1--10, a---b, x~y`), "10% of $5 & more, 1–10, a—b, x y");
  assert.equal(decodeLatex(`{BERT}: \\emph{deep} \\textit{bidirectional} {\\bf models}`), "BERT: deep bidirectional models");
});

test("names split on 'and' outside braces, in every BibTeX form", () => {
  assert.deepEqual(parseNames("Vaswani, Ashish and Shazeer, Noam and others"), [
    { family: "Vaswani", given: "Ashish" },
    { family: "Shazeer", given: "Noam" },
    { literal: "others" },
  ]);
  assert.deepEqual(parseNames("Ashish Vaswani and Ludwig van Beethoven"), [
    { family: "Vaswani", given: "Ashish" },
    { family: "van Beethoven", given: "Ludwig" },
  ]);
  assert.deepEqual(parseNames("{World Health Organization} and {Barnes and Noble}"), [
    { literal: "World Health Organization" },
    { literal: "Barnes and Noble" },
  ]);
  assert.deepEqual(parseNames("King, Jr., Martin Luther"), [{ family: "King, Jr.", given: "Martin Luther" }]);
  assert.deepEqual(parseNames("Plato"), [{ family: "Plato" }]);
  assert.deepEqual(parseNames(`{\\"O}zt{\\"u}rk, Ay{\\c{s}}e`), [{ family: "Öztürk", given: "Ayşe" }]);
});

const scholar = `
% exported from Google Scholar
@string{neurips = "Advances in Neural Information Processing Systems"}
@comment{ignored}
@inproceedings{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle=neurips # " 30",
  pages={5998--6008},
  year={2017},
  month=dec,
  doi = {10.48550/arXiv.1706.03762}
}

@ARTICLE{lecun2015,
  author = "LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey",
  title = "Deep learning",
  journal = {Nature},
  volume = 521,
  number = {7553},
  pages = {436--444},
  year = 2015,
}

@book{goodfellow, title = {Deep {Learning}}, author = {Goodfellow, Ian}, publisher = {MIT Press}, year = {2016}, edition = {1}, url = {http://www.deeplearningbook.org}}
@phdthesis{ozturk2020, author = {{\\"O}zt{\\"u}rk, Ay{\\c{s}}e}, title = {Derin {\\"o}{\\u{g}}renme}, school = {Bah{\\c{c}}e{\\c{s}}ehir {\\"U}niversitesi}, year = {2020}}
@techreport{who2023, author = {{World Health Organization}}, title = {Report}, institution = {WHO}, number = {12}, year = {2023}}
@misc{site, title = {A page}, howpublished = {\\url{https://example.com/page}}, year = {2024}}
@incollection{chap, author = {A, B}, editor = {Editor, Ed}, title = {Chapter}, booktitle = {Big Book}, pages = {1--20}, publisher = {P}, year = {2001}}
`;

test("a Google Scholar style export parses into references", () => {
  const { entries, problems } = parseBibtex(scholar);
  assert.deepEqual(problems, []);
  assert.deepEqual(entries.map((e) => [e.key, e.type]), [
    ["vaswani2017attention", "paper"], ["lecun2015", "article"], ["goodfellow", "book"], ["ozturk2020", "thesis"],
    ["who2023", "report"], ["site", "web"], ["chap", "chapter"],
  ]);
  const [vaswani, lecun, book, thesis, report, site, chap] = entries;
  assert.equal(vaswani.container, "Advances in Neural Information Processing Systems 30", "@string and # concatenation");
  assert.equal(vaswani.pages, "5998–6008");
  assert.equal(vaswani.year, 2017);
  assert.equal(vaswani.doi, "10.48550/arXiv.1706.03762");
  assert.equal(vaswani.line, 5);
  assert.equal(lecun.volume, "521");
  assert.equal(lecun.issue, "7553");
  assert.equal(lecun.container, "Nature");
  assert.equal(book.title, "Deep Learning");
  assert.equal(book.edition, "1");
  assert.equal(book.url, "http://www.deeplearningbook.org");
  assert.deepEqual(thesis.authors, [{ family: "Öztürk", given: "Ayşe" }]);
  assert.equal(thesis.title, "Derin öğrenme");
  assert.equal(thesis.institution, "Bahçeşehir Üniversitesi");
  assert.deepEqual(report.authors, [{ literal: "World Health Organization" }]);
  assert.equal(report.number, "12");
  assert.equal(site.url, "https://example.com/page");
  assert.deepEqual(chap.editors, [{ family: "Editor", given: "Ed" }]);
  assert.match(vaswani.bibtex, /^@inproceedings\{vaswani2017attention,/);
});

test("a broken entry is reported with its line, and the entries after it still parse", () => {
  const text = `@article{good1, title={A}, year={2001}}
@article{broken, title={Unclosed, year={2002}
@article{good2, title={B}, year={2003}}`;
  const { entries, problems } = parseBibtex(text);
  assert.ok(entries.some((e) => e.key === "good1"));
  assert.ok(problems.some((p) => p.line === 2), JSON.stringify(problems));
  const three = parseBibtex(`@article{a, title={Unclosed, year={2002}\n@article{b, title={B}}\n  @article{c, title={C}}\n@article{d, title={D}}`);
  assert.deepEqual(three.entries.map((e) => e.key), ["b", "c", "d"], "every entry after the broken one is read");
  assert.equal(three.problems.length, 1);
  const missing = parseBibtex(`@article{nokey_title, year={2001}}\n@article{bad key!, title={X}}`);
  assert.equal(missing.entries.length, 0);
  assert.equal(missing.problems.length, 2, JSON.stringify(missing.problems));
});

test("toBibtex writes an entry that reads back the same", () => {
  for (const entry of parseBibtex(scholar).entries) {
    const { bibtex: _source, line: _line, ...ref } = entry;
    const [back] = parseBibtex(toBibtex(ref)).entries;
    const { bibtex: _b, line: _l, ...again } = back;
    assert.deepEqual(again, ref, entry.key);
  }
});

test("hostile input is refused or reported quickly", () => {
  const shapes = [
    "{".repeat(1_000_000),
    `@article{k, title={${"{".repeat(200_000)}}}`,
    `@article{k, title={${"x".repeat(1_000_000)}}}`,
    "@".repeat(500_000),
    `@string{a = "x"}\n@article{k, title = ${"a # ".repeat(100_000)}a}`,
    `@article{k, author = {${"A and ".repeat(100_000)}B}}`,
    "\\".repeat(500_000),
    "@article{k, title={x\n".repeat(50_000),
    "@article{k, title=\n x y\n".repeat(50_000),
    "@article{k, title={A}}\n".repeat(40_000),
  ];
  for (const text of shapes) {
    const started = performance.now();
    parseBibtex(text);
    assert.ok(performance.now() - started < 300, `${text.slice(0, 20)}… took ${performance.now() - started} ms`);
  }
});
