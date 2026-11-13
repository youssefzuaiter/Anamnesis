import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLabel } from "@/lib/device-label";

const cases: [string, string][] = [
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome on macOS"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari on macOS"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1", "Chrome on iPhone"],
  ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iPad"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge on Windows"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Windows"],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0", "Opera on Linux"],
  ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome on ChromeOS"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36", "Chrome on macOS"],
  ["curl/8.7.1", "Unknown device"],
  ["", "Unknown device"],
];
for (const [ua, label] of cases) test(`${label}: ${ua.slice(0, 50)}`, () => assert.equal(deviceLabel(ua), label));

test("missing, odd and hostile input is a label, never a throw, and is cheap", () => {
  for (const bad of [null, undefined, 5 as unknown as string, {} as unknown as string]) assert.equal(deviceLabel(bad), "Unknown device");
  const started = performance.now();
  for (const hostile of ["(".repeat(1_000_000), "Chrome/".repeat(200_000), "\u0000".repeat(500_000), "A".repeat(10_000_000)]) {
    assert.ok(deviceLabel(hostile).length <= 40);
  }
  assert.ok(performance.now() - started < 200, "the user agent is cut before any matching");
});
test("only the first 300 characters of a user agent are read", () => {
  assert.equal(deviceLabel(`${"x".repeat(290)} Firefox/1`), "Firefox");
  assert.equal(deviceLabel(`${"x".repeat(400)} Firefox/1`), "Unknown device");
});
test("the label never carries any of the user agent's own text", () => {
  assert.equal(deviceLabel("<script>alert(1)</script> Firefox/1 Windows NT"), "Firefox on Windows");
});
