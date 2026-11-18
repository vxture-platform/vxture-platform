/**
 * Human-readable audit values without internal identifiers.
 * @package @vxture/console
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-19
 */
const INTERNAL_ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** @param value Untrusted record text. @returns Safe text or no display value. */
export function auditDisplayText(
  value: string | null | undefined,
): string | null {
  const text = value?.trim();
  return text && !INTERNAL_ID.test(text) ? text : null;
}

/** @param value Stored resource reference. @returns Only a recognized public business number. */
export function auditBusinessNo(value: string): string | null {
  return !INTERNAL_ID.test(value) &&
    /^(?:ORD|ADO|INV|BILL|PAY|REF|U|T|W)-[A-Z0-9-]+$/i.test(value)
    ? value
    : null;
}
