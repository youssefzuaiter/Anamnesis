// The checks a vault upload gets before any of it is read, and the bounded read of its body. Pure:
// Web APIs only (Headers, ReadableStream), so they are tested without a server.

/** What a refusal for size says. */
export const tooLargeMessage = (maxBytes: number) => `That file is over ${Math.round(maxBytes / 1_048_576)} MB, the most a vault upload takes.`;

export type UploadCheck = { ok: true; mode: "preview" | "apply" } | { ok: false; status: 400 | 403 | 413; message: string };

/**
 * Whether a request may be read at all. A request from another site is refused (the session
 * cookie is `SameSite=Lax`, which already keeps it off a cross-site POST; this is the second
 * layer): `Sec-Fetch-Site` must be `same-origin` or `none` when a browser sends it, and an
 * `Origin` must be this host's, compared with the forwarded host when there is a proxy. The mode
 * is exactly `preview` or `apply`, given once. A declared length over the limit is refused here,
 * before a byte of the body is read; a missing or odd one is not trusted either way, and the
 * body is read with a running total regardless (`readBody`).
 */
export function checkUpload(request: { url: string; headers: Headers }, maxBytes: number): UploadCheck {
  const refuse = (status: 400 | 403 | 413, message: string): UploadCheck => ({ ok: false, status, message });

  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return refuse(403, "This request did not come from this app.");

  const origin = request.headers.get("origin");
  if (origin !== null) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* not a URL */
    }
    if (originHost === null || originHost !== host) return refuse(403, "This request did not come from this app.");
  }

  const modes = new URL(request.url).searchParams.getAll("mode");
  if (modes.length !== 1 || (modes[0] !== "preview" && modes[0] !== "apply")) {
    return refuse(400, "Say whether to check the file or to import it.");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return refuse(413, tooLargeMessage(maxBytes));
  }
  return { ok: true, mode: modes[0] };
}

/** The body as one buffer, read with a running total: a body that passes the limit is abandoned at once. */
export async function readBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: "too-large" | "empty" }> {
  if (body === null) return { ok: false, reason: "empty" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too-large" };
    }
    chunks.push(value);
  }
  return total === 0 ? { ok: false, reason: "empty" } : { ok: true, bytes: Buffer.concat(chunks) };
}
