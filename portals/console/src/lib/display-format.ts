/**
 * Business dates and timezones.
 * @package @vxture/console
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-11
 */
import { formatDay } from "@vxture-platform/shared";
function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    // fall through to the curated list
  }
  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
  ];
}

export function formatTimezone(
  value: string | null | undefined,
  fallback: string,
) {
  const tz = value?.trim();
  if (!tz) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "UTC");
    return offset ? `${offset} ${tz}` : tz;
  } catch {
    return tz;
  }
}

export function formatBusinessDay(
  value: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDay(date, locale, fallback);
}
export const TIMEZONE_OPTIONS = listTimeZones();
