/**
 * format.ts — 账号信息页的展示格式化(手机号 / 时区 / 日期 / UA / 打码)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 批 5a:从 2030 行的 ProfilePage 里抽出来,五张卡共用一份。纯函数,无样式。
 */

/** Canonical IANA timezone list, with a curated fallback for older runtimes. */
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
export const TIMEZONE_OPTIONS = listTimeZones();

export function displayValue(
  value: string | null | undefined,
  fallback: string,
) {
  return value?.trim() || fallback;
}

/** Common international dialing codes, longest-first for greedy-safe matching. */
const DIALING_CODES = [
  "+852",
  "+853",
  "+886",
  "+86",
  "+1",
  "+44",
  "+81",
  "+82",
  "+65",
  "+91",
  "+61",
  "+49",
  "+33",
];

/** Separate the dialing code from the national number, e.g. "+86 18092907523". */
export function formatPhone(
  value: string | null | undefined,
  fallback: string,
) {
  const phone = value?.trim();
  if (!phone) return fallback;
  if (!phone.startsWith("+")) return phone;
  for (const code of DIALING_CODES) {
    if (phone.startsWith(code) && phone.length > code.length) {
      return `${code} ${phone.slice(code.length)}`;
    }
  }
  return phone;
}

/** Prefix an IANA zone with its current UTC offset, e.g. "UTC+08:00 Asia/Shanghai". */
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

export function formatProfileDate(
  value: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** 只要日期(注册时间、加入时间这类不需要时分的场合)。 */
export function formatProfileDay(
  value: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function parseOS(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "";
}

export function parseBrowser(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/MicroMessenger/i.test(userAgent)) return "WeChat";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "";
}

export function maskConnectedAccountId(value: string | null) {
  if (!value) return null;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
