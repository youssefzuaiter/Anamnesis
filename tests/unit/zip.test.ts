import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { ZIP_LIMITS, ZipError, ZipWriter, openZip, type ZipEntry } from "@/lib/zip";

// --- helpers ------------------------------------------------------------------------------------

const enc = new TextEncoder();
const at = new Date("2026-11-05T12:34:56Z");

async function build(files: { name: string; data: Uint8Array; store?: boolean }[]): Promise<Buffer> {
  const writer = new ZipWriter();
  const parts: Buffer[] = [];
  for (const f of files) parts.push(await writer.add({ ...f, modified: at }));
  parts.push(writer.finish());
  return Buffer.concat(parts);
}

type Raw = {
  name: string;
  /** The bytes as they sit in the archive (already deflated for method 8). */
  data: Uint8Array;
  method?: number;
  flags?: number;
  crc?: number;
  size?: number;
  compressedSize?: number;
  madeBy?: number;
  external?: number;
  localOffset?: number;
  localSig?: number;
};

/** A zip assembled by hand, so each field can be made to lie. */
function craft(
  entries: Raw[],
  end: Partial<{ total: number; thisDisk: number; cdOffset: number; cdSize: number; disk: number; cdDisk: number; comment: Buffer; commentLen: number }> = {},
): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const method = e.method ?? 0;
    const flags = e.flags ?? 0x0800;
    const compressedSize = e.compressedSize ?? e.data.length;
    const size = e.size ?? e.data.length;
    const crc = e.crc ?? 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(e.localSig ?? 0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(compressedSize, 18);
    head.writeUInt32LE(size, 22);
    head.writeUInt16LE(name.length, 26);
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(e.madeBy ?? 20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(flags, 8);
    rec.writeUInt16LE(method, 10);
    rec.writeUInt32LE(crc, 16);
    rec.writeUInt32LE(compressedSize, 20);
    rec.writeUInt32LE(size, 24);
    rec.writeUInt16LE(name.length, 28);
    rec.writeUInt32LE(e.external ?? 0, 38);
    rec.writeUInt32LE(e.localOffset ?? offset, 42);
    local.push(head, name, Buffer.from(e.data));
    central.push(rec, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const comment = end.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(end.disk ?? 0, 4);
  eocd.writeUInt16LE(end.cdDisk ?? 0, 6);
  eocd.writeUInt16LE(end.thisDisk ?? end.total ?? entries.length, 8);
  eocd.writeUInt16LE(end.total ?? entries.length, 10);
  eocd.writeUInt32LE(end.cdSize ?? cd.length, 12);
  eocd.writeUInt32LE(end.cdOffset ?? offset, 16);
  eocd.writeUInt16LE(end.commentLen ?? comment.length, 20);
  return Buffer.concat([...local, cd, eocd, comment]);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ZipError ? error.code : `not a ZipError: ${String(error)}`;
  }
  return undefined;
}

async function rejectsWith(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return error instanceof ZipError ? error.code : `not a ZipError: ${String(error)}`;
  }
  return undefined;
}

async function within<T>(ms: number, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const took = performance.now() - start;
  assert.ok(took < ms, `took ${took.toFixed(0)} ms, budget ${ms} ms`);
  return result;
}

const find = (entries: ZipEntry[], name: string): ZipEntry => {
  const entry = entries.find((e) => e.name === name);
  assert.ok(entry, `no entry ${name}`);
  return entry;
};

// --- writing and reading back -------------------------------------------------------------------

test("names and bytes survive a round trip, stored and deflated", async () => {
  const text = Buffer.from("The quick brown fox. ".repeat(150_000)); // about 3 MiB, compresses well
  const noise = randomBytes(3 * 1024 * 1024); // does not compress
  const files = [
    { name: "plain.md", data: enc.encode("hello") },
    { name: "Şükrü ğ ı İ.md", data: enc.encode("türkçe") },
    { name: "with space and (2).txt", data: enc.encode("x") },
    { name: `${"a".repeat(250)}.md`, data: enc.encode("long name") },
    { name: "empty.txt", data: new Uint8Array(0) },
    { name: "one.bin", data: new Uint8Array([7]) },
    { name: "text.txt", data: text },
    { name: "noise.bin", data: noise },
    { name: "forced-store.txt", data: enc.encode("stored ".repeat(100)), store: true },
  ];
  const zip = openZip(await build(files));
  assert.equal(zip.entries.length, files.length);
  for (const f of files) {
    const entry = find(zip.entries, f.name);
    assert.equal(entry.size, f.data.length);
    assert.deepEqual(await zip.read(entry), Buffer.from(f.data), f.name);
  }
  assert.equal(find(zip.entries, "text.txt").method, 8, "compressible text is deflated");
  assert.ok(find(zip.entries, "text.txt").compressedSize < text.length / 10);
  assert.equal(find(zip.entries, "noise.bin").method, 0, "noise is stored when deflate would not shrink it");
  assert.equal(find(zip.entries, "forced-store.txt").method, 0, "store: true is honoured");
});

test("the modified time keeps its two-second precision in UTC and is clamped to the DOS range", async () => {
  const w = new ZipWriter();
  const parts = [
    await w.add({ name: "a", data: enc.encode("a"), modified: new Date("2026-11-05T12:34:57Z") }),
    await w.add({ name: "old", data: enc.encode("a"), modified: new Date("1970-01-01T00:00:00Z") }),
    await w.add({ name: "far", data: enc.encode("a"), modified: new Date("2200-06-01T00:00:00Z") }),
    await w.add({ name: "bad", data: enc.encode("a"), modified: new Date(Number.NaN) }),
    w.finish(),
  ];
  const { entries } = openZip(Buffer.concat(parts));
  assert.equal(find(entries, "a").modified.toISOString(), "2026-11-05T12:34:56.000Z");
  assert.equal(find(entries, "old").modified.getUTCFullYear(), 1980);
  assert.equal(find(entries, "far").modified.getUTCFullYear(), 2107);
  assert.equal(find(entries, "bad").modified.getUTCFullYear(), 1980);
});

test("five thousand entries are written and read", async () => {
  const files = Array.from({ length: 5000 }, (_, i) => ({ name: `n${i}.md`, data: enc.encode(`note ${i}`) }));
  const zip = openZip(await build(files));
  assert.equal(zip.entries.length, 5000);
  assert.equal((await zip.read(zip.entries[4321])).toString(), "note 4321");
});

test("the unzip on this machine accepts what the writer makes", async (t) => {
  const probe = spawnSync("unzip", ["-v"], { encoding: "utf8" });
  if (probe.error) {
    t.skip("no unzip on the PATH");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "zip-interop-"));
  try {
    const file = path.join(dir, "out.zip");
    writeFileSync(
      file,
      await build([
        { name: "a.md", data: enc.encode("hello ".repeat(1000)) },
        { name: "Şükrü ğ.md", data: enc.encode("türkçe") },
        { name: "attachments/p.png", data: randomBytes(5000), store: true },
        { name: "empty.md", data: new Uint8Array(0) },
      ]),
    );
    const run = spawnSync("unzip", ["-tq", file], { encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- zips made by other tools -------------------------------------------------------------------

const fixture = (name: string) => Buffer.from(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"), "base64");

test("a zip made by macOS zip reads: UTF-8 names, directories, deflate and empty files", async () => {
  const zip = openZip(fixture("macos-zip.zip.b64"));
  assert.ok(find(zip.entries, "sub/").directory);
  assert.equal((await zip.read(find(zip.entries, "hello.txt"))).toString(), "Hello, vault\n");
  assert.equal((await zip.read(find(zip.entries, "sub/Şükrü ğ.md"))).toString(), "Merhaba dünya, şu ğ ı İ.\n");
  assert.equal(find(zip.entries, "empty.txt").size, 0);
  const long = find(zip.entries, "long.txt");
  assert.equal(long.method, 8);
  assert.equal((await zip.read(long)).length, 9001);
});

test("a zip made by ditto reads: data descriptors and AppleDouble files included", async () => {
  const zip = openZip(fixture("macos-ditto.zip.b64"));
  assert.equal((await zip.read(find(zip.entries, "hello.txt"))).toString(), "Hello, vault\n");
  assert.equal((await zip.read(find(zip.entries, "sub/Şükrü ğ.md"))).toString(), "Merhaba dünya, şu ğ ı İ.\n");
  assert.ok(zip.entries.some((e) => e.name.startsWith("._")), "the AppleDouble entries are listed, for the caller to ignore");
  for (const entry of zip.entries) {
    if (!entry.directory) await zip.read(entry); // every entry verifies its CRC
  }
});

// --- structural refusals ------------------------------------------------------------------------

test("what is not a zip is refused as invalid", async () => {
  await within(1000, () => {
    assert.equal(codeOf(() => openZip(new Uint8Array(0))), "invalid");
    assert.equal(codeOf(() => openZip(new Uint8Array(21))), "invalid");
    assert.equal(codeOf(() => openZip(randomBytes(100_000))), "invalid");
    assert.equal(codeOf(() => openZip(Buffer.from("PK\x05\x06".repeat(10_000)))), "invalid");
  });
});

test("a truncated zip is refused", async () => {
  const whole = await build([{ name: "a.md", data: enc.encode("hello") }, { name: "b.md", data: enc.encode("world") }]);
  for (const cut of [1, 10, 22, 30, 60]) {
    assert.equal(codeOf(() => openZip(whole.subarray(0, whole.length - cut))), "invalid", `cut ${cut}`);
  }
});

test("an end record whose comment length does not reach the end is refused", () => {
  assert.equal(codeOf(() => openZip(craft([{ name: "a", data: enc.encode("x") }], { commentLen: 5 }))), "invalid");
  assert.equal(codeOf(() => openZip(craft([{ name: "a", data: enc.encode("x") }], { comment: Buffer.from("hi"), commentLen: 0 }))), "invalid");
});

test("a zip with a real comment opens", async () => {
  const zip = openZip(craft([{ name: "a", data: enc.encode("x"), crc: crc32(enc.encode("x")) }], { comment: Buffer.from("made by hand") }));
  assert.equal((await zip.read(zip.entries[0])).toString(), "x");
});

test("a central directory outside the file or past the end record is refused", () => {
  const one = [{ name: "a", data: enc.encode("x") }];
  assert.equal(codeOf(() => openZip(craft(one, { cdOffset: 1_000_000 }))), "invalid");
  assert.equal(codeOf(() => openZip(craft(one, { cdSize: 1_000_000 }))), "invalid");
});

test("a bad central record signature or a record running off the directory is refused", () => {
  const good = craft([{ name: "abc", data: enc.encode("x") }]);
  const sigAt = good.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const badSig = Buffer.from(good);
  badSig[sigAt + 2] = 9;
  assert.equal(codeOf(() => openZip(badSig)), "invalid");
  const longName = Buffer.from(good);
  longName.writeUInt16LE(60_000, sigAt + 28);
  assert.equal(codeOf(() => openZip(longName)), "invalid");
});

test("more entries than the cap are refused before any record is read", () => {
  // Counts 20,001 while the directory is empty: only a count check can say "too large".
  assert.equal(codeOf(() => openZip(craft([], { total: 20_001, thisDisk: 20_001 }))), "too-large");
  const five = craft(Array.from({ length: 5 }, (_, i) => ({ name: `n${i}`, data: enc.encode("x") })));
  assert.equal(codeOf(() => openZip(five, { maxEntries: 4 })), "too-large");
  assert.doesNotThrow(() => openZip(five, { maxEntries: 5 }));
});

test("zip64 and multi-disk archives are refused as unsupported", () => {
  const one = [{ name: "a", data: enc.encode("x") }];
  assert.equal(codeOf(() => openZip(craft(one, { total: 0xffff, thisDisk: 0xffff }))), "unsupported");
  assert.equal(codeOf(() => openZip(craft(one, { cdOffset: 0xffffffff }))), "unsupported");
  assert.equal(codeOf(() => openZip(craft(one, { cdSize: 0xffffffff }))), "unsupported");
  assert.equal(codeOf(() => openZip(craft(one, { disk: 1 }))), "unsupported");
  assert.equal(codeOf(() => openZip(craft(one, { cdDisk: 1 }))), "unsupported");
  // A zip64 end-record locator sits 20 bytes before the end record.
  const plain = craft(one);
  const eocdAt = plain.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  const withLocator = Buffer.concat([plain.subarray(0, eocdAt), locator, plain.subarray(eocdAt)]);
  assert.equal(codeOf(() => openZip(withLocator)), "unsupported");
});

test("a body over the zip cap is refused", () => {
  assert.equal(codeOf(() => openZip(new Uint8Array(11), { maxZipBytes: 10 })), "too-large");
});

// --- per-entry limits ---------------------------------------------------------------------------

test("an encrypted entry, an unknown method and an oversize entry are flagged, and reading them is refused", async () => {
  const x = enc.encode("x");
  const zip = openZip(
    craft(
      [
        { name: "enc", data: x, flags: 0x0801 },
        { name: "m99", data: x, method: 99 },
        { name: "big", data: x, size: 11 },
        { name: "z64", data: x, size: 0xffffffff },
        { name: "ok", data: x, crc: crc32(x) },
      ],
      {},
    ),
    { maxEntryBytes: 10 },
  );
  const reasons = Object.fromEntries(zip.entries.map((e) => [e.name, e.unsupported]));
  assert.match(reasons.enc ?? "", /encrypt/i);
  assert.match(reasons.m99 ?? "", /method/i);
  assert.match(reasons.big ?? "", /large/i);
  assert.match(reasons.z64 ?? "", /zip64|large/i);
  assert.equal(reasons.ok, null);
  for (const name of ["enc", "m99", "big", "z64"]) {
    assert.equal(await rejectsWith(() => zip.read(find(zip.entries, name))), "unsupported", name);
  }
  assert.equal((await zip.read(find(zip.entries, "ok"))).toString(), "x");
});

test("a symlink is flagged, and a directory", () => {
  const zip = openZip(
    craft([
      { name: "link.md", data: enc.encode("../../etc/passwd"), madeBy: (3 << 8) | 20, external: (0o120777 << 16) >>> 0 },
      { name: "file.md", data: enc.encode("x"), madeBy: (3 << 8) | 20, external: (0o100644 << 16) >>> 0 },
      { name: "dir/", data: new Uint8Array(0) },
    ]),
  );
  assert.equal(find(zip.entries, "link.md").symlink, true);
  assert.equal(find(zip.entries, "file.md").symlink, false);
  assert.equal(find(zip.entries, "dir/").directory, true);
});

test("the declared sizes of the readable entries may not add up past the total cap", () => {
  const fake = (name: string) => ({ name, data: new Uint8Array(0), size: 60, compressedSize: 0 });
  assert.equal(codeOf(() => openZip(craft([fake("a"), fake("b")]), { maxTotalBytes: 100, maxEntryBytes: 100 })), "too-large");
  assert.doesNotThrow(() => openZip(craft([fake("a")]), { maxTotalBytes: 100, maxEntryBytes: 100 }));
  // Entries over the per-entry cap are not readable and do not count.
  assert.doesNotThrow(() => openZip(craft([fake("a"), fake("b")]), { maxTotalBytes: 100, maxEntryBytes: 50 }));
});

// --- reading lies -------------------------------------------------------------------------------

test("an entry that holds more than it declares is corrupt, and the inflate is bounded", async () => {
  const real = Buffer.alloc(8 * 1024 * 1024, 0x61);
  const zip = openZip(craft([{ name: "lie", data: deflateRawSync(real), method: 8, size: 10, crc: crc32(real) }]));
  assert.equal(await within(1000, () => rejectsWith(() => zip.read(zip.entries[0]))), "corrupt");
});

test("an entry that holds less than it declares is corrupt", async () => {
  const real = enc.encode("short");
  const zip = openZip(craft([{ name: "lie", data: deflateRawSync(real), method: 8, size: 1000, crc: crc32(real) }]));
  assert.equal(await rejectsWith(() => zip.read(zip.entries[0])), "corrupt");
});

test("a CRC that does not match is corrupt", async () => {
  const zip = openZip(craft([{ name: "a", data: enc.encode("hello"), crc: 12345 }]));
  assert.equal(await rejectsWith(() => zip.read(zip.entries[0])), "corrupt");
});

test("a local header outside the file or without its signature is corrupt", async () => {
  const x = enc.encode("x");
  const crc = crc32(x);
  const outside = openZip(craft([{ name: "a", data: x, crc, localOffset: 5_000_000 }]));
  assert.equal(await rejectsWith(() => outside.read(outside.entries[0])), "corrupt");
  const badSig = openZip(craft([{ name: "a", data: x, crc, localSig: 0x12345678 }]));
  assert.equal(await rejectsWith(() => badSig.read(badSig.entries[0])), "corrupt");
});

test("data that runs into the central directory or off the file is corrupt", async () => {
  const x = enc.encode("x");
  const zip = openZip(craft([{ name: "a", data: x, crc: crc32(x), compressedSize: 5_000, size: 5_000 }]));
  assert.equal(await rejectsWith(() => zip.read(zip.entries[0])), "corrupt");
});

test("a stored entry whose two sizes differ is corrupt", async () => {
  const zip = openZip(craft([{ name: "a", data: enc.encode("hello"), size: 3, crc: 0 }]));
  assert.equal(await rejectsWith(() => zip.read(zip.entries[0])), "corrupt");
});

test("a name with a NUL or a path escape is returned as it is: judging names is the caller's job", () => {
  const zip = openZip(craft([{ name: "a\u0000b.md", data: new Uint8Array(0) }, { name: "../../x.md", data: new Uint8Array(0) }]));
  assert.deepEqual(zip.entries.map((e) => e.name), ["a\u0000b.md", "../../x.md"]);
});

// --- bombs --------------------------------------------------------------------------------------

test("a thousand-to-one bomb is never inflated: honest it is oversize, dishonest it is corrupt", async () => {
  const zeros = Buffer.alloc(64 * 1024 * 1024);
  const packed = deflateRawSync(zeros);
  assert.ok(packed.length < zeros.length / 500, "the fixture really is a bomb");
  const honest = openZip(craft([{ name: "bomb", data: packed, method: 8, size: zeros.length, crc: crc32(zeros) }]));
  assert.match(honest.entries[0].unsupported ?? "", /large/i);
  assert.equal(await within(100, () => rejectsWith(() => honest.read(honest.entries[0]))), "unsupported");
  const liar = openZip(craft([{ name: "bomb", data: packed, method: 8, size: 10, crc: 0 }]));
  assert.equal(await within(1000, () => rejectsWith(() => liar.read(liar.entries[0]))), "corrupt");
});

test("a hundred entries each declared at the per-entry cap are refused at open", async () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ name: `e${i}`, data: new Uint8Array(0), size: ZIP_LIMITS.maxEntryBytes, compressedSize: 0 }));
  assert.equal(await within(1000, () => codeOf(() => openZip(craft(entries)))), "too-large");
});

// --- the writer's own limits --------------------------------------------------------------------

test("the writer refuses to pass its offset limit, and what it had written never opens", async () => {
  const w = new ZipWriter({ maxOffset: 400 });
  const parts = [await w.add({ name: "a.md", data: enc.encode("small"), modified: at })];
  assert.equal(await rejectsWith(() => w.add({ name: "b.bin", data: randomBytes(2000), modified: at })), "too-large");
  // The failed entry was not recorded: what is there so far is still a consistent zip when finished...
  parts.push(w.finish());
  assert.equal(openZip(Buffer.concat(parts)).entries.length, 1);
  // ...but a stream that stopped at the failure has no end record and never passes for one.
  assert.equal(codeOf(() => openZip(Buffer.concat(parts.slice(0, 1)))), "invalid");
});

test("the writer refuses a central directory that would not fit", async () => {
  // maxOffset is the most the whole archive may come to: one 35-byte entry, then 50 bytes of
  // directory and 22 of end record is 107.
  const w = new ZipWriter({ maxOffset: 80 });
  await w.add({ name: "a.md", data: enc.encode("x"), modified: at });
  assert.equal(codeOf(() => w.finish()), "too-large");
  const fits = new ZipWriter({ maxOffset: 107 });
  const first = await fits.add({ name: "a.md", data: enc.encode("x"), modified: at });
  assert.equal(openZip(Buffer.concat([first, fits.finish()])).entries.length, 1);
});

test("the writer refuses the 65,536th entry and a name over 65,535 bytes", async () => {
  const w = new ZipWriter();
  for (let i = 0; i < 65_535; i++) await w.add({ name: `n${i}`, data: new Uint8Array(0), modified: at, store: true });
  assert.equal(await rejectsWith(() => w.add({ name: "one-too-many", data: new Uint8Array(0), modified: at })), "too-large");
  assert.equal(await rejectsWith(() => new ZipWriter().add({ name: "x".repeat(65_536), data: new Uint8Array(0), modified: at })), "too-large");
});

// --- what only a mutation check asked for -------------------------------------------------------

test("the inflate stops at the declared size: a 400 MiB lie is refused at once, not unpacked first", async () => {
  const huge = Buffer.alloc(400 * 1024 * 1024);
  const packed = deflateRawSync(huge);
  huge.fill(0, 0, 0); // keep the buffer alive until here; the archive only needs `packed`
  const zip = openZip(craft([{ name: "lie", data: packed, method: 8, size: 10, crc: 0 }]));
  const code = await within(150, () => rejectsWith(() => zip.read(zip.entries[0])));
  assert.equal(code, "corrupt");
});

test("an entry cannot read into the central directory, even when the bytes there happen to add up", async () => {
  // Data "AB" with a declared size of 10: the other 8 bytes would be the start of the directory.
  const layout = (crc: number) => craft([{ name: "a", data: enc.encode("AB"), size: 10, compressedSize: 10, crc }]);
  const probe = layout(0);
  const overlapped = probe.subarray(31, 41); // where the entry's data would be read from
  const zip = openZip(layout(crc32(overlapped)));
  assert.equal(await rejectsWith(() => zip.read(zip.entries[0])), "corrupt");
});

test("every name the writer makes is flagged as UTF-8, in the local header and in the directory", async () => {
  const bytes = await build([{ name: "Şükrü ğ.md", data: enc.encode("x") }, { name: "plain.md", data: enc.encode("y") }]);
  assert.equal(bytes.readUInt16LE(6) & 0x0800, 0x0800, "local header");
  const at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(bytes.readUInt16LE(at + 8) & 0x0800, 0x0800, "directory record");
  const second = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4);
  assert.equal(bytes.readUInt16LE(second + 8) & 0x0800, 0x0800, "second directory record");
});
