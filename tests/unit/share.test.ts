import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext, sharedLink, shareTarget } from "@/lib/share";

test("the shared link is the url, else the first http(s) address in the text", () => {
  assert.equal(sharedLink({ url: "https://example.com/a?b=1" }), "https://example.com/a?b=1");
  assert.equal(sharedLink({ url: "  https://example.com/a  " }), "https://example.com/a");
  assert.equal(sharedLink({ text: "Great read https://blog.example.com/post/1 via @someone" }), "https://blog.example.com/post/1");
  assert.equal(sharedLink({ text: "Two: http://a.example/x and https://b.example/y" }), "http://a.example/x");
  assert.equal(sharedLink({ url: "", text: "see https://example.com/z" }), "https://example.com/z", "an empty url falls back to the text");
  assert.equal(sharedLink({ url: "not a link", text: "https://example.com/t" }), "https://example.com/t");
});

test("punctuation after a link in prose is not part of it, but a closing bracket that is part of it stays", () => {
  assert.equal(sharedLink({ text: "Read this: https://example.com/a." }), "https://example.com/a");
  assert.equal(sharedLink({ text: "(https://example.com/a)," }), "https://example.com/a");
  assert.equal(sharedLink({ text: "\"https://example.com/a?x=1\"!" }), "https://example.com/a?x=1");
  assert.equal(sharedLink({ text: "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture) is good" }), "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)");
});

test("no link, another scheme, a non-string or an over-long one gives nothing", () => {
  for (const params of [{}, { text: "no link here" }, { url: "ftp://example.com/x" }, { text: "javascript:alert(1)" }, { url: ["https://a.example/"] }, { url: 5 }, { text: { toString: () => "https://x.example" } }, { url: `https://example.com/${"a".repeat(2_000)}` }]) {
    assert.equal(sharedLink(params as { url?: unknown; text?: unknown }), null, JSON.stringify(params).slice(0, 60));
  }
});

test("a long text with no link is read quickly", () => {
  const started = performance.now();
  assert.equal(sharedLink({ text: "h".repeat(200_000) + "ttp:" + "/".repeat(100_000) }), null);
  assert.equal(sharedLink({ text: "https://" + "a".repeat(200_000) }), null, "over the length limit");
  assert.ok(performance.now() - started < 200, `${performance.now() - started} ms`);
});

test("a link over the limit is refused, never cut short into another link", () => {
  const head = `https://example.com/${"a".repeat(1_980)}`;
  assert.equal(head.length, 2_000);
  assert.equal(sharedLink({ text: `${head} and more` }), head, "exactly at the limit is kept");
  assert.equal(sharedLink({ text: `See ${head}. Then more.` }), head, "a link at the limit, ending a sentence, is kept");
  assert.equal(sharedLink({ text: `${head}${".".repeat(150)}b` }), null, "trimming must not turn the start of a longer link into a link");
  assert.equal(sharedLink({ text: `${head}x.` }), null, "one character over, after trimming, is refused");
});

test("the import address carries the link, encoded", () => {
  assert.equal(shareTarget("https://example.com/a?b=1&c=2#x"), "/notes/import?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2%23x");
  assert.equal(shareTarget(null), "/notes/import");
});

test("only a local path is accepted as where to go after sign-in", () => {
  for (const ok of ["/", "/notes/import?url=https%3A%2F%2Fexample.com", "/tasks#today", "/notes/abc"]) assert.equal(safeNext(ok), ok, ok);
  for (const bad of [
    "//evil.example", "/\\evil.example", "/\\/evil.example", "https://evil.example", "evil.example", "javascript:alert(1)",
    "/\tevil", "/ok\n", "", "/" + "a".repeat(2_500), ["/"], null, undefined, 7, "\\/evil.example", "/%2F%2Fevil.example/../",
  ]) {
    const result = safeNext(bad);
    if (bad === "/%2F%2Fevil.example/../") {
      // Encoded slashes stay encoded in a path, so this is a local (if odd) path, never another host.
      assert.ok(result === null || new URL(result, "https://app.example").host === "app.example");
      continue;
    }
    assert.equal(result, null, String(JSON.stringify(bad)).slice(0, 40));
  }
});
