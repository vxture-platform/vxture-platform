/**
 * Presentation-only resource formatting, independent of portal APIs.
 * @package @vxture/platform-workspace-ui
 * @layer Infrastructure
 * @category utils
 * @author AI-Generated
 * @date 2026-11-05
 */

/**
 * Format a byte quota with binary scaling.
 * @param value - Finite byte count.
 * @returns An amount and display unit separated by one space.
 */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = Math.abs(value);
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${value < 0 ? "-" : ""}${amount.toFixed(amount >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Format a finite quota count with stable separators.
 * @param value - Resource count.
 * @returns A readable count.
 */
export function fmtCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
}
