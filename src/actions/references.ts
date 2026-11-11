"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, fail, ok, toApiResponse } from "@/lib/api-response";
import { referenceFromForm } from "@/lib/reference-input";
import * as referenceService from "@/services/reference-service";
import type { ImportPreview } from "@/services/reference-service";

const MAX_BIB_BYTES = 1_000_000;

function refresh(id?: string) {
  revalidatePath("/references");
  if (id) revalidatePath(`/references/${id}`);
  // Notes render citations from the references, so a note page may now read differently.
  revalidatePath("/notes", "layout");
}

export async function createReferenceAction(_prev: ApiResponse<null> | null, form: FormData): Promise<ApiResponse<null>> {
  let id: string;
  try {
    const userId = await requireUserId();
    id = (await referenceService.createReference(userId, referenceFromForm(form))).id;
  } catch (error) {
    return toApiResponse(error);
  }
  refresh(id);
  redirect(`/references/${id}`);
}

export async function updateReferenceAction(id: string, _prev: ApiResponse<null> | null, form: FormData): Promise<ApiResponse<null>> {
  try {
    const userId = await requireUserId();
    await referenceService.updateReference(userId, id, referenceFromForm(form));
  } catch (error) {
    return toApiResponse(error);
  }
  refresh(id);
  redirect(`/references/${id}`);
}

/** For ConfirmDeleteButton: a refusal (not yours, already gone) shows the error page, as for an event. */
export async function deleteReferenceAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await referenceService.deleteReference(userId, id);
  refresh();
  redirect("/references");
}

/** The BibTeX of an import: a chosen .bib file, else the pasted text. */
async function bibText(form: FormData): Promise<string> {
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BIB_BYTES) throw Object.assign(new Error("too large"), { tooLarge: true });
    return file.text();
  }
  const text = form.get("bibtex");
  return typeof text === "string" ? text : "";
}

export type ImportState = { preview: ImportPreview; text: string } | { added: number } | null;

export async function previewImportAction(_prev: ApiResponse<ImportState> | null, form: FormData): Promise<ApiResponse<ImportState>> {
  try {
    const userId = await requireUserId();
    const text = await bibText(form);
    if (!text.trim()) return fail("VALIDATION_ERROR", "Paste some BibTeX or choose a .bib file.");
    return ok({ preview: await referenceService.previewImport(userId, text), text });
  } catch (error) {
    if ((error as { tooLarge?: boolean }).tooLarge) return fail("VALIDATION_ERROR", "That BibTeX is larger than 1 MB. Split it and import the parts.");
    return toApiResponse(error);
  }
}

/** Adds what the preview showed. The text is read again here: nothing from the preview is trusted. */
export async function applyImportAction(_prev: ApiResponse<ImportState> | null, form: FormData): Promise<ApiResponse<ImportState>> {
  try {
    const userId = await requireUserId();
    const text = form.get("bibtex");
    if (typeof text !== "string" || !text.trim()) return fail("VALIDATION_ERROR", "Paste some BibTeX or choose a .bib file.");
    const result = await referenceService.applyImport(userId, text);
    refresh();
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}
