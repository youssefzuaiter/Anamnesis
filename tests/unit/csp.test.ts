/**
 * The Content-Security-Policy the app sends (ROADMAP item 30). The policy is a pure string; these tests pin the
 * rules that matter: scripts only with a per-request nonce, no inline scripts, and eval only in development.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSP_MODE, contentSecurityPolicy, cspHeaderName, newNonce } from "@/lib/csp";

/** A nonce of the shape newNonce() makes (16 bytes, base64). */
const NONCE = "q1w2e3r4t5y6u7i8o9p0aA==";
const OTHER = "zxcvbnmasdfghjklqwertY==";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
  ) as Record<string, string[]>;

test("a nonce is base64, at least 128 bits, and never repeats across requests", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const nonce = newNonce();
    assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.ok(Buffer.from(nonce, "base64").length >= 16, nonce);
    seen.add(nonce);
  }
  assert.equal(seen.size, 2000);
});

test("scripts run only with this request's nonce, or from the app's own origin under strict-dynamic", () => {
  const policy = contentSecurityPolicy({ nonce: NONCE, development: false });
  const d = directives(policy);
  assert.deepEqual(d["script-src"], ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  assert.ok(!policy.includes("'unsafe-inline'") || d["style-src-attr"]?.includes("'unsafe-inline'"), "no inline scripts");
  assert.ok(!d["script-src"].includes("'unsafe-inline'"));
});

test("eval is allowed only in development, where React needs it for its own error stacks", () => {
  assert.ok(!contentSecurityPolicy({ nonce: NONCE, development: false }).includes("'unsafe-eval'"));
  assert.ok(directives(contentSecurityPolicy({ nonce: NONCE, development: true }))["script-src"].includes("'unsafe-eval'"));
});

test("styles: elements need the nonce, and only style attributes may be inline (KaTeX writes them)", () => {
  const d = directives(contentSecurityPolicy({ nonce: OTHER, development: false }));
  assert.deepEqual(d["style-src"], ["'self'", `'nonce-${OTHER}'`]);
  assert.deepEqual(d["style-src-attr"], ["'unsafe-inline'"]);
});

test("in production no style element is inline; development allows them for the hot reload only", () => {
  const production = directives(contentSecurityPolicy({ nonce: NONCE, development: false }));
  assert.ok(!production["style-src"].includes("'unsafe-inline'"));
  const development = directives(contentSecurityPolicy({ nonce: NONCE, development: true }));
  assert.ok(development["style-src"].includes("'unsafe-inline'"));
  assert.ok(!development["script-src"].includes("'unsafe-inline'"), "scripts stay strict in development too");
});

test("the other directives that close common holes are set", () => {
  const d = directives(contentSecurityPolicy({ nonce: NONCE, development: false }));
  assert.deepEqual(d["default-src"], ["'self'"]);
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.deepEqual(d["form-action"], ["'self'"]);
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(d["font-src"], ["'self'"]);
  assert.deepEqual(d["img-src"], ["'self'", "blob:", "data:"]);
});

test("upgrade-insecure-requests is not sent: the local production server speaks plain http", () => {
  assert.ok(!contentSecurityPolicy({ nonce: NONCE, development: false }).includes("upgrade-insecure-requests"));
});

test("the header is one line with single spaces, safe to send as a header value", () => {
  const policy = contentSecurityPolicy({ nonce: NONCE, development: true });
  assert.ok(!/[\r\n]/.test(policy));
  assert.ok(!/ {2,}/.test(policy));
});

test("a nonce that is not base64 is refused, so nothing can be injected into the policy", () => {
  assert.throws(() => contentSecurityPolicy({ nonce: "a'b; script-src *", development: false }));
  assert.throws(() => contentSecurityPolicy({ nonce: "", development: false }));
});

test("the mode decides the header name: report-only while measuring, then enforcing", () => {
  assert.equal(cspHeaderName("report-only"), "Content-Security-Policy-Report-Only");
  assert.equal(cspHeaderName("enforce"), "Content-Security-Policy");
  assert.ok(CSP_MODE === "report-only" || CSP_MODE === "enforce");
});
