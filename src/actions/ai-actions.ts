"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse } from "@/lib/api-response";
import { pendingProposalSchema } from "@/lib/ai-tools";
import {
  executeProposal,
  recordDeclined,
} from "@/services/action-service";

/**
 * The confirmation step the spec requires before any AI-proposed mutation. The
 * payload has been through the browser, so it is re-validated in full here
 * rather than trusted because the assistant produced it.
 */
export async function confirmProposalAction(
  raw: unknown,
): Promise<ApiResponse<{ href: string; replayed: boolean }>> {
  const parsed = pendingProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "That proposal is no longer valid.");
  }

  try {
    const userId = await requireUserId();
    const result = await executeProposal(
      userId,
      parsed.data.proposalId,
      parsed.data.proposal,
      "assistant",
    );

    revalidatePath("/");
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    revalidatePath("/notes");
    revalidatePath("/goals");

    return ok({ href: result.href, replayed: result.replayed });
  } catch (error) {
    return toApiResponse(error);
  }
}

export async function declineProposalAction(
  proposalId: string,
): Promise<ApiResponse<null>> {
  const parsed = pendingProposalSchema.shape.proposalId.safeParse(proposalId);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown proposal.");

  try {
    await recordDeclined(await requireUserId(), parsed.data);
    return ok(null);
  } catch (error) {
    return toApiResponse(error);
  }
}
