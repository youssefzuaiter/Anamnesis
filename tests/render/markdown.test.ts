import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown";

// These render through react-markdown to HTML, so they run apart from the unit
// tests: `pnpm test` runs those with the `react-server` condition, under which
// react-dom/server refuses to load.
function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins, rehypePlugins }, markdown),
  );
}

test("renders inline maths", () => {
  const html = render("The loss is $E = mc^2$ here.");
  assert.ok(html.includes('class="katex"'));
  assert.ok(html.includes("<math"));
  assert.ok(!html.includes("$E"));
});

test("renders block maths", () => {
  const html = render("$$\n\\frac{a}{b}\n$$");
  assert.ok(html.includes("katex-display"));
});

test("an invalid formula falls back to its source in the warning colour", () => {
  let html = "";
  assert.doesNotThrow(() => {
    html = render("$\\frac{1$");
  });
  assert.ok(html.includes("katex-error"));
  assert.ok(html.includes("\\frac{1"));
  assert.ok(html.includes("var(--warn)"));
});

test("a backslash-escaped dollar is text", () => {
  const html = render("It costs \\$5 and \\$10.");
  assert.ok(!html.includes("katex"));
  assert.ok(html.includes("$5 and $10"));
});

test("two bare dollar amounts are read as maths (documented trade-off)", () => {
  const html = render("It costs $5 and $10.");
  assert.ok(html.includes('class="katex"'));
});

test("named-language code is highlighted", () => {
  const html = render("```python\ndef f():\n    return 1\n```");
  assert.ok(html.includes("hljs-keyword"));
  assert.ok(html.includes("language-python"));
});

test("a fence with no language stays plain", () => {
  const html = render("```\ndef f():\n    return 1\n```");
  assert.ok(!html.includes("hljs-"));
});

test("an unregistered language does not throw and stays plain", () => {
  let html = "";
  assert.doesNotThrow(() => {
    html = render("```lean\ntheorem foo : 1 = 1 := rfl\n```");
  });
  assert.ok(html.includes("theorem foo"));
  assert.ok(!html.includes("hljs-"));
});

test("raw HTML stays escaped", () => {
  const html = render("<script>alert(1)</script>");
  assert.ok(!html.includes("<script"));
});

test("maths cannot smuggle a link", () => {
  const html = render("$\\href{javascript:alert(1)}{x}$");
  assert.ok(!html.includes("<a "));
  assert.ok(!html.includes("href="));
});

test("maths and code in one note both render", () => {
  const html = render(
    "Energy $E = mc^2$.\n\n```python\ndef f():\n    return 1\n```",
  );
  assert.ok(html.includes('class="katex"'));
  assert.ok(html.includes("hljs-keyword"));
});

test("an accented letter in a formula does not write a KaTeX warning to the console", () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    render("$é + 1$");
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});
