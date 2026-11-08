/**
 * Validated application return links for account-center pages.
 * @package @vxture/accounts
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-07
 */

/**
 * Restrict optional return links to platform origins.
 * @param raw - Untrusted query parameter.
 * @returns An allowed URL, or undefined.
 */
export function safeAccountReturn(
  raw: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const allowed =
      (url.protocol === "https:" &&
        (url.hostname === "vxture.com" ||
          url.hostname.endsWith(".vxture.com"))) ||
      (process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname));
    return allowed && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
