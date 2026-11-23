"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import {
  putAttachment,
  deleteAttachment,
  isAllowedType,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachment-store";
import * as attachmentRepository from "@/repositories/attachment-repository";
import { getNote } from "@/repositories/note-repository";

export async function uploadAttachmentAction(
  noteId: string,
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  const parsedId = z.uuid().safeParse(noteId);
  if (!parsedId.success) return fail("VALIDATION_ERROR", "Unknown note.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("VALIDATION_ERROR", "Choose a file to attach.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return fail(
      "VALIDATION_ERROR",
      `That file is over the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.`,
    );
  }
  if (!isAllowedType(file.type)) {
    return fail(
      "VALIDATION_ERROR",
      "Images, PDFs and plain text files can be attached.",
    );
  }

  try {
    const userId = await requireUserId();
    // The note must be the caller's own — the id came from the browser.
    const note = await getNote(userId, parsedId.data);
    if (!note) return fail("RESOURCE_NOT_FOUND", "That note no longer exists.");
    // A file attached to a locked note would sit on the disk unencrypted beside a note that is not.
    if (note.locked) return fail("FORBIDDEN", "This note is locked, so files cannot be attached. Remove the lock first.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const storageKey = await putAttachment(bytes, file.type);

    await attachmentRepository.createAttachment(userId, {
      noteId: note.id,
      filename: file.name.slice(0, 200),
      mimeType: file.type,
      byteSize: file.size,
      storageKey,
    });
  } catch (error) {
    return toApiResponse(error);
  }

  revalidatePath(`/notes/${parsedId.data}`);
  return ok(null);
}

export async function deleteAttachmentAction(
  attachmentId: string,
): Promise<ApiResponse<null>> {
  const parsed = z.uuid().safeParse(attachmentId);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown attachment.");

  try {
    const userId = await requireUserId();
    const row = await attachmentRepository.deleteAttachmentRow(
      userId,
      parsed.data,
    );
    if (!row) return fail("RESOURCE_NOT_FOUND", "That attachment is gone.");

    // Row first, then bytes: an orphaned file wastes disk, an orphaned row
    // shows the user a download that 404s.
    await deleteAttachment(row.storageKey);
    revalidatePath(`/notes/${row.noteId}`);
  } catch (error) {
    return toApiResponse(error);
  }

  return ok(null);
}
