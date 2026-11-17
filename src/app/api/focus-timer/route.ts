import { requireUserId } from "@/lib/session";
import { ok, toApiResponse } from "@/lib/api-response";
import { getTimer } from "@/services/focus-timer-service";

/**
 * The focus timer as it is now, finished first if it ran out. A plain GET so that looking (on every page, every half minute and when a
 * tab returns) is not a server action: a server action is a POST, and a page that watches for POSTs should only see real changes.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    return Response.json(ok(await getTimer(userId)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const body = toApiResponse(error);
    return Response.json(body, { status: body.error?.code === "AUTH_REQUIRED" ? 401 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
