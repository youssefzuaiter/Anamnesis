"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { MAX_SIGNATURE_BYTES } from "@/lib/signature";
import * as signatureService from "@/services/signature-service";

/** Saves a drawn signature. The file and its name come from the browser: the server reads the PNG itself and the owner is always the session's. */
export async function saveSignatureAction(formData: FormData): Promise<ApiResponse<{ id: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("VALIDATION_ERROR", "Draw a signature first.");
  if (file.size > MAX_SIGNATURE_BYTES) return fail("VALIDATION_ERROR", `A signature can be at most ${MAX_SIGNATURE_BYTES / 1024} KB.`);
  const name = formData.get("name");
  try {
    const userId = await requireUserId();
    const row = await signatureService.addSignature(userId, typeof name === "string" ? name : "", new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/signature");
    return ok({ id: row.id });
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function deleteSignatureAction(id: string): Promise<ApiResponse<{ deleted: true }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown signature.");
  try {
    const userId = await requireUserId();
    await signatureService.deleteSignature(userId, parsed.data);
    revalidatePath("/signature");
    return ok({ deleted: true });
  } catch (error) {
    return toApiResponse(error);
  }
}
