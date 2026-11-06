import { test } from "node:test";
import assert from "node:assert/strict";
import { contentDisposition } from "@/lib/content-disposition";

/** A header value is a ByteString: building a Response with it is the real test that it is legal. */
const legal = (value: string) => new Response("x", { headers: { "Content-Disposition": value } }).headers.get("content-disposition");

test("a plain name is the attachment header it always was", () => {
  assert.equal(contentDisposition("diagram.png"), `attachment; filename="diagram.png"; filename*=UTF-8''diagram.png`);
});

test("letters beyond Latin-1 (Turkish, CJK) make a legal header: an ASCII fallback and the real name encoded", () => {
  for (const name of ["Şükrü.png", "ğ ı İ ş.pdf", "日本語.png", "café.png", "emoji 😀.png"]) {
    const header = contentDisposition(name);
    assert.ok(legal(header), name);
    assert.ok([...header].every((ch) => ch.charCodeAt(0) <= 0xff), `${name}: every character of the header fits a byte`);
  }
  assert.match(contentDisposition("Şükrü.png"), /filename\*=UTF-8''%C5%9E%C3%BCkr%C3%BC\.png$/);
  assert.match(contentDisposition("Şükrü.png"), /^attachment; filename="_+kr_+\.png"; /);
  assert.equal(decodeURIComponent(contentDisposition("Şükrü ğ.png").split("filename*=UTF-8''")[1]), "Şükrü ğ.png");
});

test("characters RFC 5987 does not allow in the encoded name are percent-escaped, even those encodeURIComponent leaves alone", () => {
  const header = contentDisposition("it's (v2) *final*.png");
  const encoded = header.split("filename*=UTF-8''")[1];
  assert.equal(encoded, "it%27s%20%28v2%29%20%2Afinal%2A.png");
  assert.equal(decodeURIComponent(encoded), "it's (v2) *final*.png");
});

test("quotes, backslashes, line breaks and other controls cannot break out of the header", () => {
  const header = contentDisposition('a"b\\c\r\nSet-Cookie: x=1\u0000.png');
  assert.ok(legal(header));
  assert.ok(!/[\r\n\u0000]/.test(header));
  const quoted = header.slice(header.indexOf('filename="') + 10, header.indexOf('"; filename*'));
  assert.ok(!quoted.includes('"') && !quoted.includes("\\"));
  assert.ok(!header.includes("; Set-Cookie"), "no second header is smuggled in");
});

test("a name the encoder cannot take (a lone surrogate) and an empty name still give a legal header", () => {
  assert.ok(legal(contentDisposition("a\ud800b.png")));
  assert.ok(legal(contentDisposition("")));
  assert.match(contentDisposition(""), /filename="download"/);
});

test("a hundred thousand characters are handled in milliseconds, and the header stays small", () => {
  for (const name of ["ş".repeat(100_000), "\"".repeat(100_000), "😀".repeat(100_000), "a".repeat(100_000)]) {
    const start = performance.now();
    const header = contentDisposition(name);
    assert.ok(performance.now() - start < 50, "slow");
    assert.ok(header.length < 2000, `${header.length} bytes of header`);
    assert.ok(legal(header));
  }
});
