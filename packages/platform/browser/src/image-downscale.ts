/**
 * Browser image resizing shared by account portraits and organization logos.
 * @package @vxture/platform-browser
 * @layer Infrastructure
 * @category utils
 * @author AI-Generated
 * @date 2026-11-10
 */
export const MAX_EDGE = 256;
const QUALITY = 0.9;

// ============================================================================
// Size and format policy
// ============================================================================
/** @param type - Source MIME type. @returns Whether animation must be preserved. */
export function shouldSkipDownscale(type: string): boolean {
  return type === "image/gif";
}

/**
 * @param width - Decoded source width.
 * @param height - Decoded source height.
 * @param maxEdge - Longest permitted output edge.
 * @returns Proportional dimensions without upscaling or zero-sized edges.
 */
export function targetSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** @param inputType - Source MIME type. @returns A supported format preserving alpha where possible. */
export function pickOutputType(inputType: string): string {
  if (inputType === "image/png") return "image/png";
  if (inputType === "image/webp") return "image/webp";
  return "image/jpeg";
}

// ============================================================================
// Optional resizing; server validation remains authoritative.
// ============================================================================
/**
 * @param file - Original image selected in the browser.
 * @returns A smaller image with a 256px longest edge, or the original on failure.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  if (shouldSkipDownscale(file.type)) return file;
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const size = targetSize(bitmap.width, bitmap.height);
    if (size.width === bitmap.width && size.height === bitmap.height)
      return file;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, pickOutputType(file.type), QUALITY),
    );
    return !blob || blob.size >= file.size ? file : blob;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
