/**
 * Literal Atlas request failure fields; never guess a business error from status.
 * @package @vxture/opera
 * @layer Presentation
 * @category utility
 * @author AI-Generated
 * @date 2026-10-20
 */

/**
 * @param error - Optional upstream request error record.
 * @returns Code and raw message as text, preserving vendor formatting.
 */
export function atlasLogError(error: Record<string, unknown> | null): {
  code: string;
  message: string;
} {
  return {
    code: typeof error?.errorCode === "string" ? error.errorCode : "—",
    message: typeof error?.errorMessage === "string" ? error.errorMessage : "—",
  };
}
