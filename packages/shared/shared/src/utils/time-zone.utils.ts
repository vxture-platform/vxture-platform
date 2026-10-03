/**
 * time-zone.utils.ts - IANA time zone validation and civil-date projection
 * @package  @vxture-platform/shared
 * @layer    Shared
 * @category utils
 * @description
 *   Two zone primitives that both ends of the platform need and that must agree
 *   (owner ruling 4, 2026-10-04: usage day buckets default to UTC+0, and follow
 *   the user's configured zone when one is set):
 *
 *   - the profile write path (@vxture/service-account via @vxture/core-utils)
 *     rejects what `isIanaTimeZone` rejects, so a zone can only be stored if the
 *     read side will be able to re-bucket through it;
 *   - the usage read side (@vxture/service-subscription) re-buckets hour rows
 *     into the user's local days only through a zone that passed the same
 *     predicate (plus PostgreSQL's own pg_timezone_names check, the DB half).
 *
 *   `civilDateInZone` is the one place that asks Intl "what calendar date is
 *   this instant in that zone". The usage trend period keys are DATA keys
 *   (`YYYY-MM-DD`), not rendered dates, which is why this lives in the shared
 *   package rather than next to its callers: lint:datetime-discipline treats
 *   every `new Intl.DateTimeFormat` outside the shared component as a hand-
 *   rolled date format, and a per-caller exemption list is exactly the kind of
 *   list that grows until the rule means nothing.
 */

/**
 * Days back from "today" within which the usage day view can be re-bucketed into
 * a user's zone from the hour table. It equals the window the rollup recomputes
 * the day table from (hours → days, `date - N`): both describe how many days of
 * the hour table count as a reliable source. One constant, three readers — the
 * subscription service's period keys and rollup, and the console usage page copy
 * ("windows longer than N days are shown in UTC days").
 */
export const USAGE_REBUCKET_HORIZON_DAYS = 35;

/**
 * The shape of an IANA name: segments split by "/", each starting with an upper-
 * case letter or digit (`Asia/Shanghai`, `America/Argentina/Buenos_Aires`,
 * `Etc/GMT+8`, `EST5EDT`, `W-SU`, `UTC`). It exists to reject what Intl would
 * otherwise accept: lowercase variants (`asia/shanghai`, `utc` — Intl is
 * case-insensitive) and bare offsets (`+08:00` — modern V8 accepts them as
 * offset time zones, PostgreSQL's pg_timezone_names does not know them).
 */
const IANA_SHAPE = /^[A-Z][A-Za-z0-9_+\-]*(?:\/[A-Z0-9][A-Za-z0-9_+\-]*)*$/;

/**
 * Is `zone` an IANA time zone name this runtime can work with?
 *
 * Deliberately NOT a membership test against `Intl.supportedValuesOf("timeZone")`.
 * That list is CLDR's canonical spelling, not IANA's, and it differs by ICU
 * version: Node 24.14 lists `Asia/Calcutta` but not `Asia/Kolkata`, and does not
 * list `UTC` at all, while a browser's picker (same API, different ICU) may offer
 * the other spelling. A membership test would reject a value the picker itself
 * produced, and the rejection would depend on which machine ran the check.
 *
 * So: the IANA shape above, plus "Intl can construct a formatter for it"
 * (RangeError otherwise). Aliases pass on both sides (`Asia/Kolkata` and
 * `Asia/Calcutta` are both known to Intl and to pg_timezone_names). Known
 * imperfection: an upper-cased segment like `Asia/SHANGHAI` passes too — Intl and
 * PostgreSQL both resolve it, the picker never produces it, it is only displayed
 * as typed.
 */
export function isIanaTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !IANA_SHAPE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date of an instant as seen in `zone`. */
export interface CivilDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

/**
 * The civil (calendar) date of `at` in `zone`. Pure projection, no stepping:
 * callers that need "N days earlier" do the arithmetic with `Date.UTC(...)` on
 * the returned parts, which never crosses a 23- or 25-hour DST day.
 *
 * Throws RangeError for a zone Intl does not know — validate with
 * {@link isIanaTimeZone} first; this function does not swallow the error
 * because a silent fallback here would hand the caller UTC dates labelled as
 * the user's own.
 */
export function civilDateInZone(at: Date, zone: string): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}
