// A `Content-Disposition: attachment` header for a file name that came from outside. Pure.

const MAX_NAME_UNITS = 200;

/**
 * A header value is a byte string, so `filename="Şükrü.png"` makes `new Response(...)` throw (any
 * character above U+00FF does: Turkish ğ ş ı İ, CJK) and the download is a 500. So the plain
 * `filename` is an ASCII fallback, and the real name follows as RFC 5987 `filename*` in percent-
 * encoded UTF-8, which every browser reads. Quotes, backslashes and every control character
 * are gone from the fallback, so a name cannot end the quoted string or start another header.
 * The name is cut at 200 characters first: a header is not the place for 100,000.
 */
export function contentDisposition(filename: string): string {
  let name = filename.slice(0, MAX_NAME_UNITS);
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) name = name.slice(0, -1); // not half of a pair

  const ascii = name.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_").trim() || "download";
  const header = `attachment; filename="${ascii}"`;
  try {
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    return name === "" ? header : `${header}; filename*=UTF-8''${encoded}`;
  } catch {
    return header; // a lone surrogate cannot be encoded: the fallback alone is still a legal header
  }
}
