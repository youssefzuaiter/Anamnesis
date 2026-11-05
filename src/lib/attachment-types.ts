// What may be attached, as one table that the upload, the download and the vault share. Pure: no
// Prisma, no filesystem, no `server-only`, so client code and unit tests can read it.

/**
 * Mime type to the extension a stored file gets. Anything the browser could execute in this
 * origin (HTML, SVG, scripts) is deliberately absent, so a stored file can never become script
 * running as the signed-in user. The object has no prototype: the type of an upload comes from
 * the browser, which sends any string, and `"toString" in {}` is true.
 */
export const ATTACHMENT_TYPES: Record<string, string> = Object.assign(Object.create(null), {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
});

const BY_EXTENSION = new Map<string, string>(Object.entries(ATTACHMENT_TYPES).map(([mime, ext]) => [ext, mime]));
BY_EXTENSION.set("jpeg", "image/jpeg");

/** The mime type for a file extension (with or without the dot, any case), or null if it may not be attached. */
export function mimeForExtension(ext: string): string | null {
  return BY_EXTENSION.get(ext.replace(/^\./, "").toLowerCase()) ?? null;
}
