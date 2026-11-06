// Reading a vault back in: which zip entries mean anything, what a note file says, whether an
// attachment is what its name claims, and what an import will do. Pure: no Prisma, no filesystem,
// no network. Everything here is given text and bytes from a file the person picked, so none of it
// is trusted: every scan is bounded and linear, and nothing in a file is an id, an owner or a path.

import { createHash } from "node:crypto";
import { mimeForExtension } from "@/lib/attachment-types";
import { normalizeLineBreaks } from "@/lib/note-text";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { VAULT } from "@/lib/vault";
import { normalizeTitle } from "@/lib/wiki-links";

const MAX_TITLE = 200;
const MAX_TAGS = 12;
const MAX_TAG = 50;
const FRONT_MATTER_MAX_LINES = 500;
const FRONT_MATTER_MAX_CHARS = 65_536;
/** Pieces of a tag list looked at: far more than the 12 that are kept, so a list of a hundred thousand commas costs nothing. */
const TAG_PIECES_SCANNED = 500;

// --- entries ------------------------------------------------------------------------------------

export type EntryKind =
  | { kind: "note" }
  | { kind: "attachment"; mime: string }
  | { kind: "ignored"; reason: string }
  | { kind: "unsafe" };

const METADATA_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * What one zip entry is, from its name alone. A name is never used to reach a file (attachments
 * are stored under a generated key and notes under the database), so "unsafe" is hygiene, not the
 * last defence: it names the entries that no honest tool writes (a climb, an absolute path, a
 * drive letter, a control character). Folders, macOS metadata, hidden folders such as
 * `.obsidian/` and `.trash/`, and everything that is not a note or an attachment are ignored,
 * with the reason.
 */
export function classifyEntry(name: string): EntryKind {
  if (/\p{Cc}/u.test(name)) return { kind: "unsafe" };
  const path = name.replaceAll("\\", "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return { kind: "unsafe" };
  const segments = path.split("/");
  if (segments.includes("..")) return { kind: "unsafe" };
  if (path.endsWith("/")) return { kind: "ignored", reason: "a folder" };

  const file = segments[segments.length - 1];
  if (segments[0] === "__MACOSX" || file.startsWith("._") || METADATA_FILES.has(file.toLowerCase())) {
    return { kind: "ignored", reason: "macOS or Windows metadata" };
  }
  if (segments.some((segment) => segment.startsWith(".") && segment !== ".")) {
    return { kind: "ignored", reason: "a hidden folder or file" };
  }

  const dot = file.lastIndexOf(".");
  const extension = dot > 0 ? file.slice(dot + 1) : "";
  if (segments.length > 1 && segments[0].toLowerCase() === VAULT.attachmentsDir) {
    const mime = mimeForExtension(extension);
    return mime ? { kind: "attachment", mime } : { kind: "ignored", reason: "not a type that can be attached" };
  }
  if (extension.toLowerCase() === "md") return { kind: "note" };
  return { kind: "ignored", reason: "not a Markdown note" };
}

// --- one note file ------------------------------------------------------------------------------

export type ParsedNote = {
  /** Where it was in the zip, only to say which file a message is about and to order the run. */
  path: string;
  title: string;
  content: string;
  tags: string[];
  favorite: boolean;
  /** The course code and the project title our own files name; matched by name later, never created. */
  course: string | null;
  project: string | null;
  /** Base names of the attachment files our own files list. */
  attachments: string[];
  /** Written by this app (it carries the `anamnesis` marker), as opposed to another tool's note. */
  ours: boolean;
  /** Front matter keys this app has no place for. */
  droppedProperties: string[];
};

type Value = string | boolean | string[];

function cutUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // not half of a pair
  return text.slice(0, end);
}

function cleanTitle(raw: string): string {
  return cutUnits(raw.normalize("NFC").replace(/\p{Cc}/gu, " ").trim(), MAX_TITLE).trimEnd();
}

/** The last part of a path, whichever way its separators lean (old Windows tools write backslashes). */
export const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

function scalar(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === "string") return value;
    } catch {
      /* not JSON: take it as written */
    }
    return text.slice(1, -1);
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  return text;
}

function flowList(raw: string): string[] {
  const text = raw.trim();
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : String(item)));
  } catch {
    /* not JSON: split it by hand */
  }
  let inner = text.startsWith("[") ? text.slice(1) : text;
  if (inner.endsWith("]")) inner = inner.slice(0, -1);
  return inner.split(",").map(scalar);
}

const KEY_LINE = /^([A-Za-z_][\w-]{0,63}):(?:[ \t]+([\s\S]*))?$/;
const BLOCK_ITEM = /^[ \t]*-[ \t]+([\s\S]*)$/;

/** The top-level `key: value` pairs of a block of YAML lines; anything nested or multi-line is ignored. */
function readFrontMatter(lines: string[]): Map<string, Value> {
  const found = new Map<string, Value>();
  for (let i = 0; i < lines.length; i++) {
    const line = KEY_LINE.exec(lines[i]);
    if (!line) continue;
    const key = line[1].toLowerCase();
    const rest = (line[2] ?? "").trim();
    let value: Value;
    if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const item = BLOCK_ITEM.exec(lines[j]);
        if (!item) break;
        items.push(scalar(item[1]));
      }
      if (items.length > 0) {
        value = items;
        i = j - 1;
      } else value = "";
    } else if (rest.startsWith("[")) value = flowList(rest);
    else if (rest.startsWith('"') || rest.startsWith("'")) value = scalar(rest);
    else if (/^(?:true|false)$/i.test(rest)) value = rest.toLowerCase() === "true";
    else value = rest;
    if (!found.has(key)) found.set(key, value);
  }
  return found;
}

function tagsOf(front: Map<string, Value>): string[] {
  const raw = front.get("tags") ?? front.get("tag");
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const tags = new Set<string>();
  let scanned = 0;
  for (const item of items) {
    for (const piece of item.split(",")) {
      if (++scanned > TAG_PIECES_SCANNED) return [...tags];
      if (piece === "") continue;
      const tag = piece.replace(/\p{Cc}/gu, " ").trim().replace(/^#+/, "").trim().toLowerCase();
      if (tag !== "") tags.add(cutUnits(tag, MAX_TAG));
      if (tags.size >= MAX_TAGS) return [...tags];
    }
  }
  return [...tags];
}

function attachmentNames(value: Value | undefined): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" && value !== "" ? [value] : [];
  const names: string[] = [];
  for (const item of items) {
    let text = item.trim();
    if (text.startsWith("!")) text = text.slice(1);
    if (text.startsWith("[[")) text = text.slice(2);
    if (text.endsWith("]]")) text = text.slice(0, -2);
    const bar = text.indexOf("|");
    if (bar >= 0) text = text.slice(0, bar);
    const name = baseName(text).trim();
    if (name !== "" && name.length <= 255 && !names.includes(name)) names.push(name);
    if (names.length >= VAULT.maxAttachmentsPerNote) break;
  }
  return names;
}

const text = (value: Value | undefined, max: number): string | null => {
  if (typeof value !== "string") return null;
  const clean = cutUnits(value.replace(/\p{Cc}/gu, " ").trim(), max);
  return clean === "" ? null : clean;
};

const OURS = new Set(["anamnesis", "title", "tags", "tag", "favorite", "course", "project", "attachments", "created", "updated"]);
const FOREIGN_KEPT = new Set(["tags", "tag"]);
const FENCE = /^---[ \t]*$/;
const FENCE_END = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * One `.md` entry as a note. Front matter is read only when the first line is `---`, a closing
 * `---` or `...` follows within 500 lines and 64 KiB, and what follows it is the text with one
 * leading line break removed (the exporter's separator). A file this app wrote (`anamnesis` in
 * its front matter) gives its title, favourite, course, project and attachments; any other
 * tool's note gives its tags, and is titled by its file name, because that is what a `[[link]]`
 * names. Properties with no place here are listed, not silently lost. Never throws; linear.
 */
export function parseNoteFile(path: string, raw: string): ParsedNote | { skip: string } {
  const source = normalizeLineBreaks(raw.startsWith("\ufeff") ? raw.slice(1) : raw);

  let front: string[] | null = null;
  let body = source;
  const firstEnd = source.indexOf("\n");
  if (firstEnd !== -1 && FENCE.test(source.slice(0, firstEnd))) {
    const lines: string[] = [];
    let at = firstEnd + 1;
    while (at < FRONT_MATTER_MAX_CHARS && lines.length < FRONT_MATTER_MAX_LINES) {
      const eol = source.indexOf("\n", at);
      const line = source.slice(at, eol === -1 ? source.length : eol);
      if (FENCE_END.test(line)) {
        front = lines;
        body = source.slice(eol === -1 ? source.length : eol + 1);
        if (body.startsWith("\n")) body = body.slice(1);
        break;
      }
      lines.push(line);
      if (eol === -1) break;
      at = eol + 1;
    }
  }
  const properties = front ? readFrontMatter(front) : new Map<string, Value>();
  const ours = properties.has("anamnesis");

  const fileName = baseName(path);
  const stem = fileName.toLowerCase().endsWith(".md") ? fileName.slice(0, -3) : fileName;
  const title = (ours && typeof properties.get("title") === "string" ? cleanTitle(properties.get("title") as string) : "") || cleanTitle(stem);
  if (title === "") return { skip: "It has no title." };
  if (body.length > MAX_NOTE_LENGTH) return { skip: `It is longer than ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.` };
  // Postgres text cannot hold U+0000: such a note would fail to save on every run, and say nothing useful.
  if (body.includes("\u0000")) return { skip: "It contains a NUL character, which a note cannot hold." };

  const known = ours ? OURS : FOREIGN_KEPT;
  return {
    path,
    title,
    content: body,
    tags: tagsOf(properties),
    favorite: ours && properties.get("favorite") === true,
    course: ours ? text(properties.get("course"), MAX_TITLE) : null,
    project: ours ? text(properties.get("project"), MAX_TITLE) : null,
    attachments: ours ? attachmentNames(properties.get("attachments")) : [],
    ours,
    droppedProperties: [...properties.keys()].filter((key) => !known.has(key)).slice(0, 20),
  };
}

// --- attachments --------------------------------------------------------------------------------

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((byte, i) => bytes[at + i] === byte);
const ascii = (bytes: Uint8Array, at: number, word: string) => startsWith(bytes, [...word].map((c) => c.charCodeAt(0)), at);

/**
 * The mime type of a file when its bytes are what its extension says, else null. The extension
 * alone is a claim from a file the person picked; this is what makes it a PNG before it is stored
 * and served as one. Text types must be valid UTF-8 without a NUL.
 */
export function sniffAttachment(fileName: string, bytes: Uint8Array): string | null {
  const dot = fileName.lastIndexOf(".");
  const mime = dot > 0 ? mimeForExtension(fileName.slice(dot + 1)) : null;
  if (!mime) return null;
  switch (mime) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? mime : null;
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? mime : null;
    case "image/gif":
      return ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a") ? mime : null;
    case "image/webp":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") ? mime : null;
    case "application/pdf":
      return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(1024, bytes.length)).includes("%PDF-") ? mime : null;
    default: {
      if (bytes.subarray(0, 8192).includes(0)) return null;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return mime;
      } catch {
        return null;
      }
    }
  }
}

// --- the plan -----------------------------------------------------------------------------------

/** SHA-256 of the text with every line break an LF: what "the same note" means. The database computes the same for notes already there. */
export function contentHash(content: string): string {
  return createHash("sha256").update(normalizeLineBreaks(content), "utf8").digest("hex");
}

export function importedTitle(title: string, n: number): string {
  const suffix = n <= 1 ? " (imported)" : ` (imported ${n})`;
  return cutUnits(title, MAX_TITLE - suffix.length).trimEnd() + suffix;
}

export type ExistingNote = { title: string; hash: string };
export type PlannedNote = ParsedNote & { finalTitle: string; renamed: boolean };
export type ImportPlan = { create: PlannedNote[]; present: ParsedNote[]; deferred: ParsedNote[] };

const IMPORTED_SUFFIX = / \(imported(?: \d+)?\)$/;
/** A note's title without the numbering an earlier import gave it, compared as a link is. */
const family = (title: string) => normalizeTitle(title.replace(IMPORTED_SUFFIX, ""));

/**
 * What an import does with the notes in a file, given what the account already holds (title and
 * content hash of each live note).
 *
 * A note is already there when the account has a note of the same title family with the same text
 * (or an earlier note in this run did), so running an import twice creates nothing the second
 * time. Otherwise, up to `limit` are created, in path order; the rest are deferred, and a later
 * run carries on because the created ones are then there. A new note whose title is the title of
 * a note already in the account is renamed `Title (imported)`, `Title (imported 2)`, …: link
 * resolution prefers the most recently updated note of a title, and a restored older draft must
 * not take `[[Title]]` away from the note being written. Two notes with one title inside the
 * file keep it, as the app allows. Nothing is overwritten or deleted.
 */
export function planImport(existing: ExistingNote[], incoming: ParsedNote[], limit: number): ImportPlan {
  const have = new Set(existing.map((note) => `${family(note.title)}\u0000${note.hash}`));
  const before = new Set(existing.map((note) => normalizeTitle(note.title)));
  const used = new Set(before);

  const plan: ImportPlan = { create: [], present: [], deferred: [] };
  const ordered = [...incoming].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const note of ordered) {
    const key = `${family(note.title)}\u0000${contentHash(note.content)}`;
    if (have.has(key)) {
      plan.present.push(note);
      continue;
    }
    if (plan.create.length >= limit) {
      plan.deferred.push(note);
      continue;
    }
    let finalTitle = note.title;
    const renamed = before.has(normalizeTitle(note.title));
    if (renamed) {
      for (let n = 1; ; n++) {
        const candidate = importedTitle(note.title, n);
        if (!used.has(normalizeTitle(candidate))) {
          finalTitle = candidate;
          break;
        }
      }
    }
    used.add(normalizeTitle(finalTitle));
    have.add(key);
    plan.create.push({ ...note, finalTitle, renamed });
  }
  return plan;
}
