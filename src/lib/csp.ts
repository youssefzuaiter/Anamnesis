/**
 * The Content-Security-Policy the app sends with every page (ROADMAP item 30). Pure: no request, no environment
 * read beyond what the caller passes in, so the rules are unit-tested. The proxy (src/proxy.ts) calls this with a
 * fresh nonce for each request.
 *
 * Measured, then enforced: "report-only" tells the browser to report what the policy would block and block nothing,
 * which is how the rules were checked against the real pages (tests/e2e/csp.spec.ts) before they were enforced.
 */

/** Change to "enforce" once the browser suite shows no violations under report-only. */
export const CSP_MODE: "report-only" | "enforce" = "enforce";

export function cspHeaderName(mode: "report-only" | "enforce" = CSP_MODE): string {
  return mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** 128 random bits, base64. Generated fresh for every request, so a nonce is never shared between two responses. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const NONCE = /^[A-Za-z0-9+/]{22}==$/;

export function contentSecurityPolicy({ nonce, development }: { nonce: string; development: boolean }): string {
  // The nonce goes into the policy text, so it must be exactly the shape newNonce makes: nothing that could end a
  // directive and add one of its own.
  if (!NONCE.test(nonce)) throw new Error("the CSP nonce must be a base64 string made by newNonce()");
  const scriptSource = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])];
  // Development only: the dev server's hot reload injects CSS as <style> elements at runtime, which no nonce can
  // cover. Production has no such elements; its styles need the nonce like its scripts.
  const styleSource = development ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSource.join(" ")}`,
    `style-src ${styleSource}`,
    // Style attributes only: KaTeX writes style="…" into the server HTML. A style element still needs the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
