// A zip writer and a zip reader on node:zlib, with no dependency. Pure: no Prisma, no React, no
// filesystem. The reader is built for a file the person picked from somewhere else, so it decides
// what it will read *before* it inflates anything: every size is checked against a cap while the
// central directory is read, an entry is inflated into a buffer no larger than the size it
// declared, and what comes out must be exactly that size and match its CRC. zip32 only (no zip64),
// no encryption, methods 0 (stored) and 8 (deflate).

import { promisify } from "node:util";
import { crc32, deflateRaw, inflateRaw } from "node:zlib";

const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

/** What an uploaded zip may be. The numbers are judgements for a personal vault, not format limits. */
export const ZIP_LIMITS = {
  /** The zip as uploaded: 100 MiB. */
  maxZipBytes: 104_857_600,
  maxEntries: 20_000,
  /** One entry, uncompressed: the attachment limit, 10 MiB. */
  maxEntryBytes: 10_485_760,
  /** All readable entries together, as declared: 400 MiB. */
  maxTotalBytes: 419_430_400,
};
export type ZipLimits = { [K in keyof typeof ZIP_LIMITS]: number };

export class ZipError extends Error {
  readonly code: "too-large" | "invalid" | "unsupported" | "corrupt";
  constructor(code: ZipError["code"], message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const ZIP32_MAX = 0xffffffff;
const UTF8_FLAG = 0x0800;
/** "Made by" Unix, version 2.0; the file mode goes in the high half of the external attributes. */
const MADE_BY_UNIX = (3 << 8) | 20;
const REGULAR_FILE_MODE = (0o100644 << 16) >>> 0;

// --- writing ------------------------------------------------------------------------------------

function dosDateTime(date: Date): { time: number; day: number } {
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1980) return { time: 0, day: (1 << 5) | 1 }; // 1980-01-01 00:00:00
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, day: (127 << 9) | (12 << 5) | 31 }; // 2107-12-31 23:59:58
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/**
 * Writes a zip one entry at a time: `add` returns the bytes of one entry (its local header and its
 * data), so a caller can stream them and never hold the archive; `finish` returns the central
 * directory and the end record. Nothing is buffered beyond one entry and the directory records.
 * `maxOffset` is the most the whole archive may come to (zip32: 4 GiB less one byte); an entry or
 * a directory that would pass it is refused rather than wrapped, so what a stream stopped at
 * such a refusal has written has no end record and never opens.
 */
export class ZipWriter {
  private offset = 0;
  private count = 0;
  private readonly central: Buffer[] = [];
  private readonly maxOffset: number;

  constructor(options: { maxOffset?: number } = {}) {
    this.maxOffset = Math.min(options.maxOffset ?? ZIP32_MAX, ZIP32_MAX);
  }

  async add(entry: { name: string; data: Uint8Array; modified: Date; store?: boolean }): Promise<Buffer> {
    if (this.count >= 0xffff) throw new ZipError("too-large", "A zip holds at most 65,535 entries.");
    const name = Buffer.from(entry.name, "utf8");
    if (name.length > 0xffff) throw new ZipError("too-large", "A name in a zip is at most 65,535 bytes.");
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    if (data.length > ZIP32_MAX) throw new ZipError("too-large", "An entry in a zip is under 4 GiB.");

    // Deflate unless asked not to, and keep the original when deflate does not make it smaller
    // (an image or a PDF is already compressed).
    let method = 0;
    let body: Buffer = data;
    if (!entry.store && data.length > 0) {
      const packed = await deflateRawAsync(data, { level: 6 });
      if (packed.length < data.length) {
        method = 8;
        body = packed;
      }
    }

    const { time, day } = dosDateTime(entry.modified);
    const crc = crc32(data);
    const needed = method === 8 ? 20 : 10;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(needed, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, body]);

    if (this.offset + chunk.length > this.maxOffset) {
      throw new ZipError("too-large", "This archive would be over the size a zip can hold.");
    }

    const record = Buffer.alloc(46);
    record.writeUInt32LE(SIG_CENTRAL, 0);
    record.writeUInt16LE(MADE_BY_UNIX, 4);
    record.writeUInt16LE(needed, 6);
    record.writeUInt16LE(UTF8_FLAG, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(day, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(REGULAR_FILE_MODE, 38);
    record.writeUInt32LE(this.offset, 42);
    this.central.push(record, name);

    this.offset += chunk.length;
    this.count += 1;
    return chunk;
  }

  /** The central directory and the end record. Call once, after the last entry. */
  finish(): Buffer {
    const directory = Buffer.concat(this.central);
    if (this.offset + directory.length + 22 > this.maxOffset) {
      throw new ZipError("too-large", "This archive would be over the size a zip can hold.");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([directory, end]);
  }
}

// --- reading ------------------------------------------------------------------------------------

export type ZipEntry = {
  /** As stored, decoded as UTF-8. A name is data: nothing here has judged it. */
  name: string;
  /** Uncompressed size as the archive declares it. */
  size: number;
  compressedSize: number;
  crc: number;
  method: number;
  modified: Date;
  directory: boolean;
  symlink: boolean;
  /** Why this entry cannot be read (encrypted, an unknown method, too large), or null. */
  unsupported: string | null;
};

export type ZipArchive = {
  entries: ZipEntry[];
  /** The bytes of one entry, inflated and checked (exact size, CRC). */
  read(entry: ZipEntry): Promise<Buffer>;
};

const invalid = (message: string) => new ZipError("invalid", message);

function fromDos(time: number, day: number): Date {
  return new Date(
    Date.UTC(1980 + ((day >> 9) & 0x7f), ((day >> 5) & 0xf) - 1, day & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2),
  );
}

/**
 * Opens a zip held in memory. A structural problem throws a `ZipError` here, before any entry is
 * read; a problem with one entry is recorded on it (`unsupported`) and refused when it is read.
 */
export function openZip(input: Uint8Array, limits: Partial<ZipLimits> = {}): ZipArchive {
  const max: ZipLimits = { ...ZIP_LIMITS, ...limits };
  if (input.length > max.maxZipBytes) throw new ZipError("too-large", "That file is too big to read as a zip.");
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 22) throw invalid("That is not a zip file.");

  // The end record is the last 22 bytes plus a comment of up to 65,535, so it is searched for
  // only there, and only a signature whose comment length reaches exactly the end counts.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (bytes.readUInt32LE(at) === SIG_END && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw invalid("That is not a zip file, or it is cut short.");

  if (end >= 20 && bytes.readUInt32LE(end - 20) === SIG_ZIP64_LOCATOR) {
    throw new ZipError("unsupported", "Zip64 archives are not supported.");
  }
  const total = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) {
    throw new ZipError("unsupported", "A zip split over several files is not supported.");
  }
  if (total === 0xffff || directorySize === ZIP32_MAX || directoryOffset === ZIP32_MAX) {
    throw new ZipError("unsupported", "Zip64 archives are not supported.");
  }
  if (bytes.readUInt16LE(end + 8) !== total) throw invalid("That zip's directory does not add up.");
  // Before any record is read: a count is the cheapest thing to refuse.
  if (total > max.maxEntries) throw new ZipError("too-large", `That zip holds more than ${max.maxEntries.toLocaleString("en-US")} files.`);
  if (directoryOffset + directorySize > end) throw invalid("That zip's directory is outside the file.");

  const entries: ZipEntry[] = [];
  const locals = new WeakMap<ZipEntry, number>();
  let readable = 0;
  let at = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;
  for (let i = 0; i < total; i++) {
    if (at + 46 > directoryEnd || bytes.readUInt32LE(at) !== SIG_CENTRAL) throw invalid("That zip's directory is damaged.");
    const madeBy = bytes.readUInt16LE(at + 4);
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    if (next > directoryEnd) throw invalid("That zip's directory is damaged.");
    const external = bytes.readUInt32LE(at + 38);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const directory = name.endsWith("/");

    let unsupported: string | null = null;
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) unsupported = "It is encrypted.";
    else if (method !== 0 && method !== 8) unsupported = `It uses compression method ${method}, which is not supported.`;
    else if (size === ZIP32_MAX || compressedSize === ZIP32_MAX || localOffset === ZIP32_MAX) unsupported = "It needs zip64, which is not supported.";
    else if (size > max.maxEntryBytes) unsupported = `It is too large (over ${max.maxEntryBytes} bytes).`;

    const entry: ZipEntry = {
      name,
      size,
      compressedSize,
      crc,
      method,
      modified: fromDos(bytes.readUInt16LE(at + 12), bytes.readUInt16LE(at + 14)),
      directory,
      symlink: madeBy >> 8 === 3 && ((external >>> 16) & 0xf000) === 0xa000,
      unsupported,
    };
    locals.set(entry, localOffset);
    entries.push(entry);
    if (!directory && unsupported === null) readable += size;
    at = next;
  }
  if (readable > max.maxTotalBytes) throw new ZipError("too-large", "That zip would unpack to more than it is allowed to.");

  const corrupt = (message: string) => new ZipError("corrupt", message);

  return {
    entries,
    async read(entry) {
      const localOffset = locals.get(entry);
      if (localOffset === undefined) throw invalid("That entry is not from this zip.");
      if (entry.unsupported !== null) throw new ZipError("unsupported", entry.unsupported);
      if (entry.directory) return Buffer.alloc(0);

      if (localOffset + 30 > directoryOffset || bytes.readUInt32LE(localOffset) !== SIG_LOCAL) {
        throw corrupt(`The header of ${entry.name} is damaged.`);
      }
      const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      if (start + entry.compressedSize > directoryOffset) throw corrupt(`The data of ${entry.name} runs past where it should end.`);
      const stored = bytes.subarray(start, start + entry.compressedSize);

      let data: Buffer;
      if (entry.size === 0) {
        data = Buffer.alloc(0);
      } else if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) throw corrupt(`${entry.name} is stored with two different sizes.`);
        data = Buffer.from(stored);
      } else {
        try {
          // Never more than the entry said it holds: the inflate stops at the bound.
          data = await inflateRawAsync(stored, { maxOutputLength: entry.size });
        } catch {
          throw corrupt(`${entry.name} could not be unpacked, or holds more than it says.`);
        }
      }
      if (data.length !== entry.size) throw corrupt(`${entry.name} is not the size it says.`);
      if (crc32(data) !== entry.crc) throw corrupt(`${entry.name} does not match its checksum.`);
      return data;
    },
  };
}
