// What a reference may hold, checked the same way for the form, an import and a stored row. Pure.

import { z } from "zod";
import { KEY_PATTERN, MAX_FIELD, MAX_KEY, MAX_NAMES, REFERENCE_TYPES, parseNames, type RefFields, type RefName } from "@/lib/bibtex";

const text = z.string().trim().min(1).max(MAX_FIELD);
const name = z.union([
  z.object({ literal: z.string().trim().min(1).max(300) }).strict(),
  z.object({ family: z.string().trim().min(1).max(300), given: z.string().trim().min(1).max(300).optional() }).strict(),
]);

export const referenceSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, "Give the reference a citation key.")
      .max(MAX_KEY, "A citation key is at most 100 characters.")
      .regex(KEY_PATTERN, "A citation key uses letters, digits and _ : . - / and starts and ends with a letter, digit or _."),
    type: z.enum(REFERENCE_TYPES, { error: "Choose a type from the list." }),
    title: z.string().trim().min(1, "Give the reference a title.").max(MAX_FIELD, "A title is at most 1,000 characters."),
    authors: z.array(name).max(MAX_NAMES),
    year: z
      .number({ error: "Use a year between 1000 and 2100." })
      .int("Use a year between 1000 and 2100.")
      .min(1000, "Use a year between 1000 and 2100.")
      .max(2100, "Use a year between 1000 and 2100.")
      .nullable(),
    container: text.optional(),
    volume: text.optional(),
    issue: text.optional(),
    pages: text.optional(),
    publisher: text.optional(),
    edition: text.optional(),
    editors: z.array(name).max(MAX_NAMES).optional(),
    institution: text.optional(),
    number: text.optional(),
    doi: text.optional(),
    url: z
      .string()
      .trim()
      .max(MAX_FIELD)
      .refine((value) => /^https?:\/\//i.test(value), "A link starts with http:// or https://.")
      .optional(),
    degree: z.enum(["doctoral", "masters"]).optional(),
  })
  .strict();

/** The fields stored outside the main columns, as the `details` JSON holds them. */
export const DETAIL_FIELDS = ["container", "volume", "issue", "pages", "publisher", "edition", "editors", "institution", "number", "doi", "url", "degree"] as const;

/** One name per line: "Family, Given", "Given Family", or "{Organisation}" in braces. */
export function namesFromLines(text: string): RefName[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => parseNames(line).slice(0, 1));
}

export function namesToLines(names: RefName[] | undefined): string {
  return (names ?? []).map((name) => ("literal" in name ? `{${name.literal}}` : name.given ? `${name.family}, ${name.given}` : name.family)).join("\n");
}

/** The add/edit form as fields, before validation: empty inputs are absent, the year a number. */
export function referenceFromForm(form: FormData): unknown {
  const value = (field: string) => {
    const raw = form.get(field);
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
  };
  const year = value("year");
  const fields: Record<string, unknown> = {
    key: value("key") ?? "",
    type: value("type") ?? "other",
    title: value("title") ?? "",
    authors: namesFromLines(value("authors") ?? ""),
    // Anything but plain digits is not a year; NaN lets the schema say so in its own words.
    year: year === undefined ? null : /^\d{1,5}$/.test(year) ? Number(year) : Number.NaN,
  };
  for (const field of DETAIL_FIELDS) {
    if (field === "editors") {
      const editors = namesFromLines(value("editors") ?? "");
      if (editors.length) fields.editors = editors;
    } else if (value(field) !== undefined) {
      fields[field] = value(field);
    }
  }
  if (fields.type !== "thesis") delete fields.degree;
  return fields;
}

/** A stable form of a reference's content, to tell an unchanged import from a different one. */
export function sameContent(a: RefFields, b: RefFields): boolean {
  const canonical = (ref: RefFields) =>
    JSON.stringify(
      Object.entries(ref)
        .filter(([field, value]) => field !== "key" && value !== undefined && !(Array.isArray(value) && value.length === 0))
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return canonical(a) === canonical(b);
}
