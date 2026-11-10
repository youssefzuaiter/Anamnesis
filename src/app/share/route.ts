import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { shareTarget, sharedLink } from "@/lib/share";

/*
 * Where a share lands: the manifest's share_target (Android, desktop Chrome) and the iOS Shortcut both
 * open /share?url=…&text=…. It only redirects, to the clip card with the link filled in, and through
 * sign-in first when needed. It never fetches the page and never writes: the person taps Clip page.
 */

/** A parameter given exactly once, as text; a repeated one counts as absent. */
function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = shareTarget(sharedLink({ url: single(params, "url"), text: single(params, "text") }));
  if (!(await getSessionUserId())) redirect(`/login?next=${encodeURIComponent(target)}`);
  redirect(target);
}
