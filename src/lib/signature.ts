// Drawn signatures (ROADMAP item 60): the rules that are not the page. Pure.
//
// A signature is drawn on a canvas, trimmed to its ink, and saved as a transparent PNG. The browser's bytes are untrusted, so the server reads the PNG
// header itself rather than believing the file's name or type. Nothing here claims a drawn image is a legally binding electronic signature.

export const MAX_SIGNATURES = 10;
export const MAX_SIGNATURE_BYTES = 512 * 1024;
export const MAX_SIGNATURE_WIDTH = 2000;
export const MAX_SIGNATURE_HEIGHT = 1000;
const MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

export type PngInfo = { ok: true; width: number; height: number } | { ok: false; reason: string };

/**
 * Accepts only a plain 8-bit RGBA PNG (what a canvas makes) of a sensible size: the 8-byte signature, an IHDR chunk first, an IEND chunk last, and nothing else
 * is decoded. A different colour type or depth is refused so the stored file is exactly what the page makes.
 */
export function readPng(bytes: Uint8Array): PngInfo {
  if (bytes.length > MAX_SIGNATURE_BYTES) return { ok: false, reason: `A signature can be at most ${MAX_SIGNATURE_BYTES / 1024} KB.` };
  if (bytes.length < 8 + 25 + 12 || MAGIC.some((b, i) => bytes[i] !== b)) return { ok: false, reason: "That is not a PNG image." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (view.getUint32(8) !== 13 || type(12) !== "IHDR") return { ok: false, reason: "That is not a PNG image." };
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_SIGNATURE_WIDTH || height > MAX_SIGNATURE_HEIGHT) {
    return { ok: false, reason: `A signature must be at most ${MAX_SIGNATURE_WIDTH} by ${MAX_SIGNATURE_HEIGHT} pixels.` };
  }
  if (bytes[24] !== 8 || bytes[25] !== 6) return { ok: false, reason: "The image must be an 8-bit PNG with transparency." };
  const end = bytes.length - 12;
  if (view.getUint32(end) !== 0 || type(end + 4) !== "IEND") return { ok: false, reason: "That PNG is cut short." };
  return { ok: true, width, height };
}

/** A name for the list: trimmed, spaces collapsed, control and direction characters removed, 60 characters, "Signature" when nothing is left. */
export function signatureName(raw: unknown): string {
  if (typeof raw !== "string") return "Signature";
  const cleaned = raw.replace(/\s+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 60).trim();
  return cleaned === "" ? "Signature" : cleaned;
}

/** The box around every pixel that has any ink (alpha above 0), grown by `margin` and kept inside the canvas; null when nothing was drawn. */
export function inkBounds(rgba: Uint8ClampedArray, width: number, height: number, margin: number): { x: number; y: number; width: number; height: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  return { x, y, width: Math.min(width, maxX + margin + 1) - x, height: Math.min(height, maxY + margin + 1) - y };
}
