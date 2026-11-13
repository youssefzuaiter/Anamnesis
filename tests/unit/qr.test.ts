import { test } from "node:test";
import assert from "node:assert/strict";
import { qrSvg } from "@/lib/qr";

test("a setup address becomes a self-contained SVG with a light quiet zone, whatever the page theme", () => {
  const svg = qrSvg("otpauth://totp/Anamnesis:me%40test.local?secret=JBSWY3DPEHPK3PXP&issuer=Anamnesis", "Setup code for the authenticator app");
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /role="img" aria-label="Setup code for the authenticator app"/);
  assert.match(svg, /<rect [^>]*fill="#ffffff"/);
  assert.match(svg, /<path [^>]*fill="#000000"/);
  assert.ok(!/<script|onload|href=/i.test(svg));
  assert.ok(svg.length > 1000 && svg.length < 20000, String(svg.length));
});
test("the label is escaped", () => {
  assert.ok(!qrSvg("x", `a"><script>`).includes("<script>"));
});
