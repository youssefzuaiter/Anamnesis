import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, readBody } from "@/lib/vault-upload";

const MB = 1024 * 1024;
const request = (query: string, headers: Record<string, string> = {}) => ({
  url: `http://localhost:3100/api/import/vault${query}`,
  headers: new Headers({ host: "localhost:3100", ...headers }),
});

test("the mode must be exactly preview or apply, once", () => {
  assert.deepEqual(checkUpload(request("?mode=preview"), 100 * MB), { ok: true, mode: "preview" });
  assert.deepEqual(checkUpload(request("?mode=apply"), 100 * MB), { ok: true, mode: "apply" });
  for (const query of ["", "?mode=", "?mode=x", "?mode=APPLY", "?mode=preview&mode=apply", "?other=preview"]) {
    const result = checkUpload(request(query), 100 * MB);
    assert.equal(result.ok, false, query);
    assert.equal(!result.ok && result.status, 400, query);
  }
});

test("a request from another site is refused, by Origin and by Fetch Metadata", () => {
  assert.equal(checkUpload(request("?mode=apply", { origin: "http://localhost:3100" }), MB).ok, true);
  assert.equal(checkUpload(request("?mode=apply"), MB).ok, true, "no Origin: a script or a tool, not a browser page");
  for (const origin of ["https://evil.example", "null", "not a url", "http://localhost:3101", "http://localhost.evil.example:3100"]) {
    const result = checkUpload(request("?mode=apply", { origin }), MB);
    assert.equal(!result.ok && result.status, 403, origin);
  }
  assert.equal(checkUpload(request("?mode=apply", { "sec-fetch-site": "same-origin" }), MB).ok, true);
  assert.equal(checkUpload(request("?mode=apply", { "sec-fetch-site": "none" }), MB).ok, true);
  for (const site of ["cross-site", "same-site"]) {
    const result = checkUpload(request("?mode=apply", { "sec-fetch-site": site }), MB);
    assert.equal(!result.ok && result.status, 403, site);
  }
});

test("behind a proxy the forwarded host is the one an Origin is compared with", () => {
  const behind = request("?mode=apply", { host: "internal:3100", "x-forwarded-host": "app.example.com", origin: "https://app.example.com" });
  assert.equal(checkUpload(behind, MB).ok, true);
  const wrong = request("?mode=apply", { host: "internal:3100", "x-forwarded-host": "app.example.com", origin: "https://internal:3100" });
  assert.equal(!checkUpload(wrong, MB).ok && 403, 403);
});

test("a declared length over the limit is refused before anything is read", () => {
  const over = checkUpload(request("?mode=apply", { "content-length": String(100 * MB + 1) }), 100 * MB);
  assert.equal(!over.ok && over.status, 413);
  assert.match(!over.ok ? over.message : "", /100 MB/);
  assert.equal(checkUpload(request("?mode=apply", { "content-length": String(100 * MB) }), 100 * MB).ok, true);
  for (const junk of ["abc", "-5", "", "1e99x"]) assert.equal(checkUpload(request("?mode=apply", { "content-length": junk }), 100 * MB).ok, true, junk);
});

const streamOf = (chunks: Uint8Array[], onPull?: () => void) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
};

test("a body is read whole when it fits, empty is empty, and nothing is empty", async () => {
  const chunks = [new Uint8Array(1000).fill(1), new Uint8Array(1000).fill(2)];
  const whole = await readBody(streamOf(chunks), 2000);
  assert.ok(whole.ok);
  assert.equal(whole.ok && whole.bytes.length, 2000);
  assert.deepEqual(await readBody(streamOf([]), 2000), { ok: false, reason: "empty" });
  assert.deepEqual(await readBody(streamOf([new Uint8Array(0)]), 2000), { ok: false, reason: "empty" });
  assert.deepEqual(await readBody(null, 2000), { ok: false, reason: "empty" });
});

test("a body over the limit is cancelled, so the sender is told to stop", async () => {
  let cancelled = false;
  let i = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1000));
      if (++i > 50) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.deepEqual(await readBody(source, 2500), { ok: false, reason: "too-large" });
  assert.equal(cancelled, true);
});

test("a body over the limit stops being read at the first chunk that passes it", async () => {
  let pulls = 0;
  const chunks = Array.from({ length: 100 }, () => new Uint8Array(1000));
  const result = await readBody(streamOf(chunks, () => pulls++), 2500);
  assert.deepEqual(result, { ok: false, reason: "too-large" });
  assert.ok(pulls <= 5, `read ${pulls} chunks of 100 after the limit was passed at the third`);
});
