/**
 * Drawn signatures (ROADMAP item 60) against a real Postgres and the real file store. What matters: only a plain RGBA PNG is stored, the file is a generated
 * name under the attachments directory, nothing is readable or deletable across accounts, the per-account cap holds, and a delete removes the file too.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { MAX_SIGNATURES } from "@/lib/signature";
import { addSignature, deleteSignature, listSignatures, readSignature } from "@/services/signature-service";

const made: string[] = [];
const keys: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `sig-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  const rows = await prisma.signature.findMany({ where: { userId: { in: made } } });
  for (const row of rows) keys.push(row.storageKey);
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  const { unlink } = await import("node:fs/promises");
  await Promise.all(keys.map((key) => unlink(path.join(process.cwd(), "data", "attachments", key)).catch(() => {})));
  await prisma.$disconnect();
});

function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
};
const png = (width = 40, height = 20, colorType = 6): Uint8Array => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk("IEND", Buffer.alloc(0))]));
};
const code = (e: unknown) => (e instanceof AppError ? e.code : "other");
const onDisk = (key: string) => access(path.join(process.cwd(), "data", "attachments", key)).then(() => true, () => false);

test("a valid PNG is stored under a generated name with a cleaned name, and read back byte for byte", async () => {
  const me = await newUser();
  const bytes = png(120, 50);
  const row = await addSignature(me, "  My   signature ", bytes);
  keys.push(row.storageKey);
  assert.deepEqual([row.name, row.width, row.height, row.byteSize], ["My signature", 120, 50, bytes.length]);
  assert.match(row.storageKey, /^[0-9a-f-]{36}\.png$/);
  assert.ok(await onDisk(row.storageKey));
  const back = await readSignature(me, row.id);
  assert.deepEqual(new Uint8Array(back!.bytes), bytes);
  assert.equal((await listSignatures(me)).length, 1);
});

test("anything that is not a plain RGBA PNG is refused, and nothing is written", async () => {
  const me = await newUser();
  const hostile: [string, Uint8Array][] = [
    ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
    ["html", new TextEncoder().encode("<script>alert(1)</script>")],
    ["empty", new Uint8Array()],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    ["rgb, not rgba", png(10, 10, 2)],
    ["too big", png(2001, 10)],
    ["png with a script after it", new Uint8Array([...png(10, 10), ...new TextEncoder().encode("<script>")])],
  ];
  for (const [label, bytes] of hostile) await assert.rejects(addSignature(me, "x", bytes), (e) => code(e) === "VALIDATION_ERROR", label);
  assert.equal(await prisma.signature.count({ where: { userId: me } }), 0);
});

test("an account keeps at most the cap, and deleting one makes room", async () => {
  const me = await newUser();
  const ids: string[] = [];
  for (let i = 0; i < MAX_SIGNATURES; i += 1) { const r = await addSignature(me, `s${i}`, png(20 + i, 10)); keys.push(r.storageKey); ids.push(r.id); }
  await assert.rejects(addSignature(me, "one more", png()), (e) => code(e) === "VALIDATION_ERROR");
  await deleteSignature(me, ids[0]);
  const again = await addSignature(me, "fits now", png());
  keys.push(again.storageKey);
  assert.equal(await prisma.signature.count({ where: { userId: me } }), MAX_SIGNATURES);
});

test("another account can neither read, delete nor list a signature", async () => {
  const me = await newUser();
  const stranger = await newUser();
  const row = await addSignature(me, "private", png());
  keys.push(row.storageKey);
  assert.equal(await readSignature(stranger, row.id), null);
  await assert.rejects(deleteSignature(stranger, row.id), (e) => code(e) === "RESOURCE_NOT_FOUND");
  assert.deepEqual(await listSignatures(stranger), []);
  assert.ok(await onDisk(row.storageKey), "the owner's file is untouched");
  assert.ok(await readSignature(me, row.id));
});

test("deleting a signature removes its file; deleting twice is the same refusal", async () => {
  const me = await newUser();
  const row = await addSignature(me, "gone", png());
  assert.ok(await onDisk(row.storageKey));
  await deleteSignature(me, row.id);
  assert.equal(await onDisk(row.storageKey), false);
  assert.equal(await readSignature(me, row.id), null);
  await assert.rejects(deleteSignature(me, row.id), (e) => code(e) === "RESOURCE_NOT_FOUND");
});

test("a row whose file is gone reads as missing, not as an error", async () => {
  const me = await newUser();
  const row = await addSignature(me, "lost file", png());
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(process.cwd(), "data", "attachments", row.storageKey));
  assert.equal(await readSignature(me, row.id), null);
});
