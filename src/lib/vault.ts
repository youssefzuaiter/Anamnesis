// What a Markdown vault looks like on the way out: file names, the front matter of a note, the
// manifest. Pure: no Prisma, no filesystem. Reading one back is `lib/vault-import.ts`.

import { ATTACHMENT_TYPES, mimeForExtension } from "@/lib/attachment-types";

export const VAULT = {
  attachmentsDir: "attachments",
  manifestPath: ".anamnesis/manifest.json",
  /** The account's references as BibTeX, at the top so Zotero, Obsidian or LaTeX find it. */
  referencesPath: "references.bib",
  formatVersion: 1,
  /** Notes created by one import run; a second run carries on, because a run never duplicates. */
  maxImportNotes: 500,
  /** One `.md` entry, uncompressed: 100,000 characters at up to four bytes each, with room for front matter. */
  maxMdBytes: 524_288,
  maxAttachmentsPerNote: 20,
};

/** What a vault does not hold, said in the file itself (the way the JSON export says what it leaves out). */
export const VAULT_NOT_INCLUDED = [
  "Tasks, events, goals, projects and courses. A note's course (its code) and project (its title) are named in its front matter and nothing more.",
  "Flashcards, grades, calendar subscriptions and the audit trail.",
  "Earlier versions of a note, and everything in the trash.",
  "The search index: it is rebuilt from the notes.",
  "For everything above, use the JSON export or the backup.",
];

// --- file names ---------------------------------------------------------------------------------

/** What Obsidian cannot link (`[[a#b]]` is a heading, `|` an alias) or a disk will not take, plus line breaks and bidi controls. */
const UNLINKABLE = /[\\/:*?"<>|#^[\]\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
/** Windows treats these as devices, with or without an extension. */
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;
const NAME_MAX_BYTES = 200;

function trimTrailing(text: string): string {
  // By hand: `/[. ]+$/` is quadratic on a long run of dots.
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === " ")) end--;
  return text.slice(0, end);
}

/** At most `maxBytes` UTF-8 bytes, never splitting a character. */
function cutBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return text.slice(0, end);
}

/**
 * A title as a file name without its extension, so `[[Title]]` finds the file in Obsidian:
 * composed Unicode, nothing a disk or a link cannot hold, no device names, no leading dot,
 * no trailing dot or space, at most `maxBytes` of UTF-8 (a disk allows 255 bytes, and a Turkish
 * letter is two). The real title travels in the front matter, so nothing is lost here.
 */
export function safeStem(text: string, maxBytes = 180): string {
  let stem = text.normalize("NFC").replace(UNLINKABLE, "-").trim();
  let start = 0;
  while (start < stem.length && stem[start] === ".") start++;
  stem = trimTrailing(stem.slice(start)).replace(DEVICE, (name) => `${name}_`);
  stem = trimTrailing(cutBytes(stem, maxBytes));
  return /^[-\s]*$/.test(stem) ? "Untitled" : stem;
}

export type NameInput = { id: string; stem: string; ext: string; rank: Date };

/**
 * One unique file name for each item (notes and attachments together, since an attachment called
 * `Meeting.md` and a note called `Meeting` would be one name to Obsidian). Unique when lower-cased
 * and composed, because a Mac or Windows disk merges names that differ only in case. Where several
 * items want one name the newest `rank` keeps it (for notes that is the one the app's own link
 * resolution would pick), ties by id; the rest are numbered ` (2)`, ` (3)`, after every plain name
 * has been given out, so a number never takes a real note's name. A name stays within 200 bytes.
 */
export function allocateNames(items: NameInput[]): Map<string, string> {
  const fold = (text: string) => text.normalize("NFC").toLowerCase();
  const groups = new Map<string, NameInput[]>();
  for (const item of items) {
    const key = fold(item.stem + item.ext);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const names = new Map<string, string>();
  const taken = new Set<string>();
  const losers: { item: NameInput; key: string }[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => (b.rank.getTime() || 0) - (a.rank.getTime() || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    names.set(group[0].id, group[0].stem + group[0].ext);
    taken.add(key);
    for (const item of group.slice(1)) losers.push({ item, key });
  }

  // Each name remembers where its numbering stopped, so a thousand notes called "Untitled" do not
  // each count from 2 again.
  const next = new Map<string, number>();
  for (const { item, key } of losers) {
    let n = next.get(key) ?? 2;
    for (;; n++) {
      const suffix = ` (${n})`;
      const name = cutBytes(item.stem, NAME_MAX_BYTES - Buffer.byteLength(item.ext) - Buffer.byteLength(suffix)) + suffix + item.ext;
      const folded = fold(name);
      if (taken.has(folded)) continue;
      taken.add(folded);
      names.set(item.id, name);
      break;
    }
    next.set(key, n + 1);
  }
  return names;
}

/**
 * The stem and extension an attachment is written under: its own extension when that agrees with
 * its stored type, otherwise the type's. Null for a type that may not be attached.
 */
export function attachmentParts(filename: string, mime: string): { stem: string; ext: string } | null {
  const extension = ATTACHMENT_TYPES[mime];
  if (!extension) return null;
  const dot = filename.lastIndexOf(".");
  const own = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (own !== "" && mimeForExtension(own) === mime) return { stem: safeStem(filename.slice(0, dot)), ext: `.${own}` };
  return { stem: safeStem(filename), ext: `.${extension}` };
}

// --- the note file ------------------------------------------------------------------------------

/**
 * A value as one line of YAML: JSON is valid YAML for strings and lists, so Obsidian reads it and
 * the importer needs no YAML parser. JSON leaves U+2028, U+2029 and U+0085 raw, and YAML 1.1
 * reads those as line breaks; they are escaped.
 */
function yaml(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * One note as a file: a front matter block (a marker, the real title, tags, favourite, the
 * course code and project title if it has them, links to its attachments, two dates), a blank
 * line, then the text exactly as stored. No id and no owner: nothing in a vault is a key to
 * anything, so nothing is trusted on the way back.
 */
export function noteFile(
  note: { title: string; content: string; tags: string[]; isFavorite: boolean; createdAt: Date; updatedAt: Date },
  meta: { course: string | null; project: string | null; attachments: string[] },
): string {
  const lines = ["---", "anamnesis: 1", `title: ${yaml(note.title)}`];
  if (note.tags.length > 0) lines.push(`tags: ${yaml(note.tags)}`);
  if (note.isFavorite) lines.push("favorite: true");
  if (meta.course !== null) lines.push(`course: ${yaml(meta.course)}`);
  if (meta.project !== null) lines.push(`project: ${yaml(meta.project)}`);
  if (meta.attachments.length > 0) lines.push(`attachments: ${yaml(meta.attachments.map((name) => `[[${name}]]`))}`);
  lines.push(`created: ${yaml(note.createdAt.toISOString())}`, `updated: ${yaml(note.updatedAt.toISOString())}`, "---", "");
  return `${lines.join("\n")}\n${note.content}`;
}

export function manifestJson(facts: {
  exportedAt: Date;
  notes: number;
  attachments: number;
  missing: { note: string; name: string }[];
}): string {
  return `${JSON.stringify(
    {
      formatVersion: VAULT.formatVersion,
      exportedAt: facts.exportedAt.toISOString(),
      notes: facts.notes,
      attachments: facts.attachments,
      missing: facts.missing,
      notIncluded: VAULT_NOT_INCLUDED,
    },
    null,
    2,
  )}\n`;
}
