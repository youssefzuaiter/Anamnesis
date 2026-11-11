import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { parseBibtex, type Problem, type RefFields } from "@/lib/bibtex";
import { citedKeys } from "@/lib/citations";
import { DETAIL_FIELDS, referenceSchema, sameContent } from "@/lib/reference-input";
import * as repo from "@/repositories/reference-repository";
import type { Reference } from "@/generated/prisma/client";

/*
 * A reference is a work a note cites with [@key] (ROADMAP 22). The service checks every input with one
 * schema, keeps a key unique per account, and imports BibTeX by preview then apply: the apply reads the
 * text again rather than trusting a list from the browser, and adds only keys the account does not have.
 */

export type StoredReference = RefFields & { id: string; bibtex: string | null; createdAt: Date; updatedAt: Date };

const MAX_IMPORT_CHARS = 1_000_000;
const MAX_IMPORT_ENTRIES = 2_000;
const NOT_FOUND = "That reference does not exist.";

const authorsSchema = referenceSchema.shape.authors;
const detailsSchema = referenceSchema.pick(Object.fromEntries(DETAIL_FIELDS.map((f) => [f, true])) as { [K in (typeof DETAIL_FIELDS)[number]]: true });

/** A stored row as fields. JSON written by an older release, or by hand, is checked again and dropped if odd. */
function fromRow(row: Reference): StoredReference {
  const authors = authorsSchema.safeParse(row.authors);
  const details = detailsSchema.safeParse(row.details);
  const type = referenceSchema.shape.type.safeParse(row.type);
  return {
    id: row.id,
    key: row.key,
    type: type.success ? type.data : "other",
    title: row.title,
    authors: authors.success ? authors.data : [],
    year: row.year,
    ...(details.success ? details.data : {}),
    bibtex: row.bibtex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(fields: RefFields, bibtex: string | null): repo.ReferenceData {
  const details = Object.fromEntries(DETAIL_FIELDS.filter((f) => fields[f] !== undefined).map((f) => [f, fields[f]]));
  return { key: fields.key, type: fields.type, title: fields.title, authors: fields.authors, year: fields.year, details, bibtex };
}

function validated(input: unknown): RefFields {
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the reference and try again.");
  return parsed.data as RefFields;
}

const duplicate = (key: string) => new AppError("VALIDATION_ERROR", `You already have a reference with the key "${key}".`);
const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "P2002";

export async function listReferences(userId: string): Promise<StoredReference[]> {
  return (await repo.listReferences(userId)).map(fromRow);
}

export async function getReference(userId: string, id: string): Promise<StoredReference> {
  const row = z.uuid().safeParse(id).success ? await repo.getReference(userId, id) : null;
  if (!row) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
  return fromRow(row);
}

export async function referencesByKeys(userId: string, keys: string[]): Promise<StoredReference[]> {
  return (await repo.referencesByKeys(userId, [...new Set(keys)].slice(0, 500))).map(fromRow);
}

export async function createReference(userId: string, input: unknown): Promise<StoredReference> {
  const fields = validated(input);
  try {
    return fromRow(await repo.createReference(userId, toRow(fields, null)));
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate(fields.key);
    throw error;
  }
}

/** Replaces the reference's fields. The imported BibTeX no longer describes it, so it is dropped. */
export async function updateReference(userId: string, id: string, input: unknown): Promise<StoredReference> {
  const fields = validated(stripStored(input));
  if (!z.uuid().safeParse(id).success) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
  let found: boolean;
  try {
    found = await repo.updateReference(userId, id, toRow(fields, null));
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate(fields.key);
    throw error;
  }
  if (!found) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
  return getReference(userId, id);
}

/** A stored reference passed back in as input: only its fields count. */
function stripStored(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const stored = new Set(["id", "bibtex", "createdAt", "updatedAt"]);
  return Object.fromEntries(Object.entries(input).filter(([field]) => !stored.has(field)));
}

export async function deleteReference(userId: string, id: string): Promise<void> {
  const deleted = z.uuid().safeParse(id).success && (await repo.deleteReference(userId, id));
  if (!deleted) throw new AppError("RESOURCE_NOT_FOUND", NOT_FOUND);
}

export type ImportPreview = {
  added: { key: string; title: string }[];
  differing: { key: string; title: string }[];
  unchanged: number;
  problems: Problem[];
};

/** Reads the text, checks each entry, and sorts them against what the account already has. */
async function readImport(userId: string, text: string) {
  if (text.length > MAX_IMPORT_CHARS) throw new AppError("VALIDATION_ERROR", "That BibTeX is larger than 1 MB. Split it and import the parts.");
  const { entries, problems } = parseBibtex(text);
  if (entries.length > MAX_IMPORT_ENTRIES) {
    throw new AppError("VALIDATION_ERROR", `That file has more than ${MAX_IMPORT_ENTRIES.toLocaleString("en")} entries. Split it and import the parts.`);
  }
  const fresh: { fields: RefFields; bibtex: string }[] = [];
  const allProblems = [...problems];
  for (const { bibtex, line, ...entry } of entries) {
    const parsed = referenceSchema.safeParse(entry);
    if (parsed.success) fresh.push({ fields: parsed.data as RefFields, bibtex });
    else allProblems.push({ line, message: `"${entry.key}": ${parsed.error.issues[0]?.message ?? "not a valid reference"}` });
  }
  const existing = new Map((await referencesByKeys(userId, fresh.map((e) => e.fields.key))).map((r) => [r.key, r]));
  return { fresh, existing, problems: allProblems };
}

export async function previewImport(userId: string, text: string): Promise<ImportPreview> {
  const { fresh, existing, problems } = await readImport(userId, text);
  const preview: ImportPreview = { added: [], differing: [], unchanged: 0, problems };
  for (const { fields } of fresh) {
    const mine = existing.get(fields.key);
    if (!mine) preview.added.push({ key: fields.key, title: fields.title });
    else if (sameContent(stripStored(mine) as RefFields, fields)) preview.unchanged++;
    else preview.differing.push({ key: fields.key, title: fields.title });
  }
  return preview;
}

/** Adds the entries whose keys the account does not have; yours are kept. Safe to run twice. */
export async function applyImport(userId: string, text: string): Promise<{ added: number }> {
  const { fresh, existing } = await readImport(userId, text);
  const rows = fresh.filter(({ fields }) => !existing.has(fields.key)).map(({ fields, bibtex }) => toRow(fields, bibtex));
  if (rows.length === 0) return { added: 0 };
  const { count } = await repo.createReferences(userId, rows);
  return { added: count };
}

/** The caller's live notes that cite `key` (in a bracket or as a bare @key), outside code, newest 50. */
export async function notesCiting(userId: string, key: string): Promise<{ id: string; title: string }[]> {
  const candidates = await repo.notesContaining(userId, `@${key}`, 200);
  return candidates
    .filter((note) => citedKeys(note.content).includes(key))
    .slice(0, 50)
    .map(({ id, title }) => ({ id, title }));
}
