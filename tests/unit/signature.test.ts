import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readPng, signatureName, inkBounds, MAX_SIGNATURE_BYTES, MAX_SIGNATURE_WIDTH, MAX_SIGNATURE_HEIGHT, MAX_SIGNATURES } from "@/lib/signature";

function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
};
/** A real, valid RGBA PNG of the given size, fully transparent. */
function png(width: number, height: number, colorType = 6, bitDepth = 8): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = bitDepth; ihdr[9] = colorType;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

test("a real PNG is read for its size", () => {
  assert.deepEqual(readPng(png(300, 120)), { ok: true, width: 300, height: 120 });
});

test("a file that is not a PNG, or is cut short or oversized, is refused with a reason", () => {
  const good = png(10, 10);
  const cases: [string, Uint8Array][] = [
    ["empty", new Uint8Array()],
    ["text", new TextEncoder().encode("<svg onload=alert(1)>")],
    ["a jpeg header", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])],
    ["the signature only", good.slice(0, 8)],
    ["truncated before IEND", good.slice(0, good.length - 12)],
    ["a different first chunk", (() => { const b = Uint8Array.from(good); b[12] = 0x58; return b; })()],
    ["too wide", png(MAX_SIGNATURE_WIDTH + 1, 10)],
    ["too tall", png(10, MAX_SIGNATURE_HEIGHT + 1)],
    ["zero wide", png(0, 10)],
    ["not RGBA", png(10, 10, 2)],
    ["not 8-bit", png(10, 10, 6, 16)],
    ["too many bytes", new Uint8Array(MAX_SIGNATURE_BYTES + 1)],
    ["a valid PNG that is over the byte limit", (() => {
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(10, 0); ihdr.writeUInt32BE(10, 4); ihdr[8] = 8; ihdr[9] = 6;
      return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(MAX_SIGNATURE_BYTES)), chunk("IEND", Buffer.alloc(0))]));
    })()],
    ["the right shape but the wrong first eight bytes", (() => { const b = Uint8Array.from(good); b[1] = 0x41; return b; })()],
  ];
  for (const [label, bytes] of cases) assert.equal(readPng(bytes).ok, false, label);
});

test("a name is trimmed, collapsed and limited; an empty one becomes Signature", () => {
  assert.equal(signatureName("  My   everyday\tsignature "), "My everyday signature");
  assert.equal(signatureName(""), "Signature");
  assert.equal(signatureName("   "), "Signature");
  assert.equal(signatureName("x".repeat(100)).length, 60);
  assert.equal(signatureName("a\u0000b‮c"), "abc", "control and direction characters are removed");
  assert.equal(signatureName(42 as unknown as string), "Signature");
});

test("the ink's bounding box is found with a margin, clamped to the canvas, and an empty canvas has none", () => {
  const w = 20, h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  const ink = (x: number, y: number) => { data[(y * w + x) * 4 + 3] = 255; };
  assert.equal(inkBounds(data, w, h, 2), null);
  ink(5, 3); ink(12, 6);
  assert.deepEqual(inkBounds(data, w, h, 2), { x: 3, y: 1, width: 12, height: 8 });
  const edge = new Uint8ClampedArray(w * h * 4);
  edge[3] = 1; edge[(9 * w + 19) * 4 + 3] = 1;
  assert.deepEqual(inkBounds(edge, w, h, 5), { x: 0, y: 0, width: 20, height: 10 }, "never past the canvas");
});

test("the caps are what the page and the server share", () => {
  assert.ok(MAX_SIGNATURE_BYTES <= 1024 * 1024 && MAX_SIGNATURES >= 1 && MAX_SIGNATURES <= 50);
});
