import { test } from "node:test";
import assert from "node:assert/strict";
import { extractArticle } from "@/lib/clip";
import { AppError } from "@/lib/api-response";

const para = (words: string) => `<p>${words} ${"This paragraph carries enough ordinary prose for a reader view to treat the page as an article worth keeping. ".repeat(3)}</p>`;
const page = (body: string, title = "Gradient descent explained") => `<!doctype html><html><head><title>${title} | Example Blog</title></head><body>
<nav><a href="/">Home</a> | <a href="/about">About</a> | <a href="/login">Log in</a></nav>
<article><h1>${title}</h1>${body}</article>
<footer>© Example Blog · Cookie settings · Privacy</footer></body></html>`;
const url = new URL("https://example.com/posts/gradient-descent");

test("the article becomes Markdown with its structure, and the page's chrome is left behind", () => {
  const result = extractArticle(page(`
    ${para("Gradient descent minimises a loss.")}
    <h2>The learning rate</h2>
    ${para("The step size matters.")}
    <ul><li>Too large diverges</li><li>Too small crawls</li></ul>
    <table><thead><tr><th>Rate</th><th>Result</th></tr></thead><tbody><tr><td>0.1</td><td>fine</td></tr></tbody></table>
    <pre><code>w = w - lr * grad</code></pre>
    <p>Read <a href="/docs/next">the next part</a> or <a href="https://other.example/x">elsewhere</a>.</p>
    <p><img src="/img/loss.png" alt="Loss curve"></p>
  `), url);
  assert.ok(result);
  assert.equal(result.title, "Gradient descent explained");
  const md = result.markdown;
  assert.match(md, /## The learning rate/);
  assert.match(md, /[-*] Too large diverges/);
  assert.match(md, /\| Rate +\| Result +\|/);
  assert.match(md, /```[\s\S]*w = w - lr \* grad[\s\S]*```/);
  assert.match(md, /\[the next part\]\(https:\/\/example\.com\/docs\/next\)/, "relative links become absolute");
  assert.match(md, /\[elsewhere\]\(https:\/\/other\.example\/x\)/);
  assert.match(md, /!\[Loss curve\]\(https:\/\/example\.com\/img\/loss\.png\)/);
  for (const chrome of ["Cookie settings", "Log in", "About"]) assert.ok(!md.includes(chrome), chrome);
});

test("scripts, handlers, javascript: and data: links never reach the note", () => {
  const result = extractArticle(page(`
    ${para("Safe text stays.")}
    <script>alert("stolen")</script><style>body{display:none}</style>
    <p onclick="alert(1)">Click text stays as text. <a href="javascript:alert(2)">bad link</a> <a href="data:text/html,<script>alert(3)</script>">data link</a></p>
    <p><img src="data:image/png;base64,AAAA" alt="inline"><img src="javascript:alert(4)" alt="js"></p>
    <iframe src="https://evil.example/"></iframe>
    ${para("More safe text.")}
  `), url);
  assert.ok(result);
  const md = result.markdown;
  for (const bad of ["alert", "javascript:", "data:", "onclick", "<script", "<iframe", "evil.example", "display:none"]) assert.ok(!md.includes(bad), bad);
  assert.match(md, /bad link/, "the link's words stay, without the link");
  assert.match(md, /Click text stays as text/);
});

test("a page with no article gives nothing", () => {
  assert.equal(extractArticle(`<html><head><title>Sign in</title></head><body><form><input name="u"><button>Log in</button></form></body></html>`, url), null);
  assert.equal(extractArticle("", url), null);
  assert.equal(extractArticle("%PDF-1.7 binary", url), null);
  const short = `<html><head><title>Short</title></head><body><article><h1>Short</h1><p>A single sentence of about ninety characters is all this page has to say.</p></article></body></html>`;
  assert.equal(extractArticle(short, url), null, "under 200 characters of text is not an article");
});

test("HTML comments in the article do not reach the note", () => {
  const result = extractArticle(page(`${para("Visible text.")}<!-- tracking: secret-comment --><p>After the comment. ${"More words that belong to the article itself. ".repeat(3)}</p>`), url);
  assert.ok(result);
  assert.ok(!result.markdown.includes("secret-comment"), result.markdown);
  assert.ok(!result.markdown.includes("<!--"));
});

test("Turkish and Arabic text arrive intact, and the title is plain text", () => {
  const result = extractArticle(page(`${para("Öğrenme oranı çok önemli; ğüşıçö İ.")}${para("معدل التعلم مهم جدا.")}`, "Hello *world* [draft]"), url);
  assert.ok(result);
  assert.match(result.markdown, /Öğrenme oranı çok önemli; ğüşıçö İ\./);
  assert.match(result.markdown, /معدل التعلم مهم جدا\./);
  assert.equal(result.title, "Hello *world* [draft]");
});

test("a title is one line and at most 200 characters", () => {
  const result = extractArticle(page(para("Body text."), `${"Long ".repeat(80)}\n title`), url);
  assert.ok(result);
  assert.ok(result.title.length <= 200);
  assert.ok(!result.title.includes("\n"));
});

test("a page nested absurdly deep is refused at once, and ordinary nesting still clips", () => {
  const deep = (depth: number) => page(`${para("Visible text.")}${"<div>".repeat(depth)}x${"</div>".repeat(depth)}${para("Closing text.")}`);
  const started = performance.now();
  assert.throws(() => extractArticle(deep(100_000), url), (error: unknown) => error instanceof AppError && /nested too deeply/.test(error.message));
  assert.throws(() => extractArticle(page(`${para("Bold flood.")}${"<b><i>".repeat(50_000)}`), url), (error: unknown) => error instanceof AppError);
  assert.ok(performance.now() - started < 2_000, `${performance.now() - started} ms`);
  const fine = extractArticle(deep(50), url);
  assert.ok(fine && /Closing text/.test(fine.markdown));
});

test("a page with too many elements is refused before it is read", () => {
  const many = page(`${para("Visible text.")}${"<span>a</span>".repeat(60_000)}`);
  const started = performance.now();
  assert.throws(() => extractArticle(many, url), (error: unknown) => error instanceof AppError && /too large to clip/.test(error.message));
  assert.ok(performance.now() - started < 1_000, `${performance.now() - started} ms`);
  assert.ok(extractArticle(page(`${para("Visible text.")}${"<span>a</span>".repeat(20_000)}${para("End.")}`), url));
});

test("a page that leaves out <html>, <head> and <body> still clips, with its title", () => {
  const body = `<article><h1>Bare page</h1>${para("First.")}${para("Second.")}</article>`;
  for (const html of [`<!doctype html><title>Bare page</title>${body}`, body, `<!-- hi -->\n<TITLE>Bare page</TITLE>${body}`]) {
    const result = extractArticle(html, url);
    assert.ok(result, html.slice(0, 40));
    assert.equal(result.title, "Bare page");
    assert.match(result.markdown, /Second\./);
  }
});
