import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api-response";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/attachment-types";

/**
 * Attachment bytes live on disk, not in Postgres: a database is a poor blob
 * store, and keeping files out of it keeps the JSON export and any dump small.
 */
const ROOT = path.join(process.cwd(), "data", "attachments");

export { MAX_ATTACHMENT_BYTES };

/**
 * What may be stored and, just as importantly, served back: the table in
 * `lib/attachment-types.ts`, which the vault shares. Anything that the browser could execute in
 * this origin — HTML, SVG, scripts — is excluded, so a stored file can never become script
 * running as the signed-in user.
 */
const ALLOWED = ATTACHMENT_TYPES;

export function isAllowedType(mimeType: string): boolean {
  return mimeType in ALLOWED;
}

export function allowedTypeList(): string[] {
  return Object.keys(ALLOWED);
}

/**
 * The stored name is generated, never derived from the upload. A filename from
 * a browser is attacker-controlled text; building a path from it is how
 * "../../.env" becomes a write primitive.
 */
export async function putAttachment(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const extension = ALLOWED[mimeType];
  if (!extension) {
    throw new AppError("VALIDATION_ERROR", "That file type is not supported.");
  }

  const key = `${randomUUID()}.${extension}`;
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, key), bytes);
  return key;
}

/** Reads a stored file. The key is checked against its generated shape rather
 *  than trusted, so a crafted value cannot escape the directory. */
export async function getAttachment(key: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\.[a-z]{2,4}$/.test(key)) {
    throw new AppError("RESOURCE_NOT_FOUND", "No such attachment.");
  }
  return readFile(path.join(ROOT, key));
}

export async function deleteAttachment(key: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\.[a-z]{2,4}$/.test(key)) return;
  await unlink(path.join(ROOT, key)).catch(() => {});
}
