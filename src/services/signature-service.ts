import "server-only";
import { AppError } from "@/lib/api-response";
import { deleteAttachment, getAttachment, putAttachment } from "@/lib/attachment-store";
import { MAX_SIGNATURES, readPng, signatureName } from "@/lib/signature";
import * as repository from "@/repositories/signature-repository";

/*
 * Drawn signatures (ROADMAP 60). The bytes come from the browser, so the server reads the PNG header itself (`readPng`) and stores only a plain 8-bit RGBA
 * PNG, under a generated name, beside the attachments. A signature is private to the account and is never described as a legally binding electronic signature.
 */

export const listSignatures = repository.listSignatures;

export async function addSignature(userId: string, rawName: unknown, bytes: Uint8Array) {
  const info = readPng(bytes);
  if (!info.ok) throw new AppError("VALIDATION_ERROR", info.reason);
  if ((await repository.countSignatures(userId)) >= MAX_SIGNATURES) {
    throw new AppError("VALIDATION_ERROR", `You can keep ${MAX_SIGNATURES} signatures. Delete one to save another.`);
  }
  const storageKey = await putAttachment(bytes, "image/png");
  try {
    return await repository.createSignature(userId, { name: signatureName(rawName), storageKey, byteSize: bytes.length, width: info.width, height: info.height });
  } catch (error) {
    // A row that could not be written must not leave its file behind.
    await deleteAttachment(storageKey);
    throw error;
  }
}

export async function deleteSignature(userId: string, id: string): Promise<void> {
  const row = await repository.deleteSignature(userId, id);
  if (!row) throw new AppError("RESOURCE_NOT_FOUND", "That signature no longer exists.");
  await deleteAttachment(row.storageKey);
}

/** The caller's signature and its bytes, or null (another account's, a deleted one, a file gone from the disk). */
export async function readSignature(userId: string, id: string): Promise<{ name: string; bytes: Buffer } | null> {
  const row = await repository.getSignature(userId, id);
  if (!row) return null;
  try {
    return { name: row.name, bytes: await getAttachment(row.storageKey) };
  } catch {
    return null;
  }
}
