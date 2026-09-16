/**
 * image-sniff.ts — trust-the-bytes avatar image detection (identity-platform-account.md §6/§13).
 *
 * Canonical, shared by every avatar writer (auth-bff upload + social import,
 * console-bff upload) so a wrong/missing content-type header — from a client OR a
 * provider CDN — cannot defeat validation. The content-type is derived from magic
 * bytes, NEVER from a header; only raster PNG/JPEG/WEBP/GIF pass (SVG/text are
 * rejected → stored-XSS guard). Pure (no NestJS) for unit testing + reuse.
 */

export type AvatarMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

/** Max accepted avatar size (bytes). */
export const AVATAR_MAX_BYTES = 1 * 1024 * 1024;

/**
 * Detect a supported raster image from its leading bytes; null if unrecognized
 * (includes SVG/text, deliberately rejected).
 */
export function sniffImageType(buf: Buffer): AvatarMime | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // GIF: "GIF8" (87a / 89a)
  if (buf.toString("ascii", 0, 4) === "GIF8") {
    return "image/gif";
  }
  return null;
}
