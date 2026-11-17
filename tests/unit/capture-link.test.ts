import { test } from "node:test";
import assert from "node:assert/strict";
import { captureText, captureTarget, MAX_CAPTURE } from "@/lib/capture-link";

test("the text of a capture link is one plain string, trimmed, and otherwise empty", () => {
  assert.equal(captureText("coffee with Ada friday 3pm"), "coffee with Ada friday 3pm");
  assert.equal(captureText("  buy milk  "), "buy milk");
  for (const bad of [undefined, null, 5, {}, ["a"], ["a", "b"], true]) assert.equal(captureText(bad), "", JSON.stringify(bad));
  assert.equal(captureText(""), "");
  assert.equal(captureText("   \n\t "), "");
});

test("line breaks and control characters become spaces, so the one-line box shows what was sent", () => {
  assert.equal(captureText("a\nb\r\nc\td"), "a b c d");
  assert.equal(captureText("a\u0000b\u001fc\u007fd"), "a b c d");
  assert.equal(captureText("a\u2028b\u2029c"), "a b c");
  assert.equal(captureText("  \n a \n\n b \n "), "a b");
});

test("the text is cut at the limit the parser accepts, 1000 characters", () => {
  assert.equal(MAX_CAPTURE, 1000);
  assert.equal(captureText("x".repeat(1000)).length, 1000);
  assert.equal(captureText("x".repeat(1001)).length, 1000);
  assert.equal(captureText("x".repeat(500_000)).length, 1000);
  assert.equal(captureText(`${" ".repeat(900)}${"y".repeat(500)}`).length, 500, "spaces are trimmed before the cut");
});

test("the address to open is /capture, with the text when there is some, and it is a safe same-site path", () => {
  assert.equal(captureTarget(""), "/capture");
  assert.equal(captureTarget("buy milk"), "/capture?text=buy%20milk");
  assert.equal(captureTarget("a&b=c#d"), "/capture?text=a%26b%3Dc%23d");
  const target = captureTarget("//evil.example/\\x");
  assert.ok(target.startsWith("/capture"));
  assert.ok(!target.includes("//evil"), "the text is encoded into the query, never into the path");
});

test("hostile text of 500,000 characters is fast", () => {
  const t = performance.now();
  captureText("\n".repeat(500_000));
  captureText("\u0000 ".repeat(250_000));
  captureText("x".repeat(500_000));
  assert.ok(performance.now() - t < 300);
});

test("only the first 8,000 characters are read, so a value that begins with more white space than that is empty", () => {
  assert.equal(captureText(`${" ".repeat(7_990)}hello`), "hello");
  assert.equal(captureText(`${" ".repeat(9_000)}hello`), "", "a bound on the work, not a promise to find text anywhere in a huge value");
});
