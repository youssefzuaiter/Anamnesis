"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, fail, toApiResponse } from "@/lib/api-response";
import { clipUrl } from "@/services/clip-service";

// A link is all the browser sends; the server decides what may be fetched (lib/safe-fetch.ts).
const clipSchema = z.object({
  url: z.string().trim().min(1, "Paste a link to clip.").max(2_000, "That link is too long."),
});

export async function clipUrlAction(
  _prevState: ApiResponse<null> | null,
  formData: FormData,
): Promise<ApiResponse<null>> {
  let noteId: string;
  try {
    const userId = await requireUserId();
    const parsed = clipSchema.safeParse({ url: formData.get("url") });
    if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0].message);
    ({ noteId } = await clipUrl(userId, parsed.data.url));
  } catch (error) {
    return toApiResponse(error);
  }

  revalidatePath("/notes");
  revalidatePath("/");
  redirect(`/notes/${noteId}`);
}
