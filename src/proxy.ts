import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, cspHeaderName, newNonce } from "@/lib/csp";

/**
 * Sends the Content-Security-Policy with every page (ROADMAP item 30). A fresh nonce for each request: the
 * layout reads it from `x-nonce` and applies it to its inline script, and Next applies it to its own. The
 * header is set on the response only; a client cannot choose the nonce, because this always overwrites it.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = contentSecurityPolicy({ nonce, development: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(cspHeaderName(), policy);
  return response;
}

// Pages only. The API routes return data, not documents; static files and prefetches do not render a page.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
