import type { Locale } from "@vxture-platform/shared";

const CURRENCY_SYMBOL_BY_CODE: Record<string, string> = {
  CNY: "¥",
  USD: "$",
};

export function formatAdminCompactCurrency(
  amount: number,
  locale: Locale = "zh-CN",
  currency = "CNY",
) {
  const currencySymbol = CURRENCY_SYMBOL_BY_CODE[currency] ?? currency;
  const sign = amount < 0 ? "-" : "";
  const absoluteAmount = Math.abs(amount);

  if (locale === "zh-CN") {
    if (absoluteAmount >= 100_000) {
      return `${sign}${currencySymbol}${formatCompactUnit(absoluteAmount / 10_000, locale)}万`;
    }

    return `${sign}${currencySymbol}${Math.round(absoluteAmount).toLocaleString(locale)}`;
  }

  const englishUnits = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  const unit = englishUnits.find((item) => absoluteAmount >= item.threshold);

  if (unit) {
    return `${sign}${currencySymbol}${formatCompactUnit(absoluteAmount / unit.threshold, locale)}${unit.suffix}`;
  }

  return `${sign}${currencySymbol}${Math.round(absoluteAmount).toLocaleString(locale)}`;
}

export function formatAdminCompactCurrencyInput(
  value: string | undefined,
  locale: Locale = "zh-CN",
) {
  const parsed = parseCurrencyAmount(value);

  if (!parsed) return value?.trim() || "—";

  return formatAdminCompactCurrency(parsed.amount, locale, parsed.currency);
}

export function formatAdminCompactCurrencyDelta(
  value: string,
  locale: Locale = "zh-CN",
) {
  const trimmed = value.trim();
  const sign = trimmed.startsWith("+") ? "+" : "";
  const normalizedValue = sign ? trimmed.slice(1) : trimmed;

  return `${sign}${formatAdminCompactCurrencyInput(normalizedValue, locale)}`;
}

function formatCompactUnit(value: number, locale: Locale) {
  const maximumFractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function parseCurrencyAmount(value: string | undefined) {
  if (!value) return null;
  const match = value
    .trim()
    .match(/([+-])?\s*([¥$])?\s*([+-])?\s*([\d,.]+)\s*([kKmMbB万])?/);

  if (!match) return null;

  const sign = match[1] ?? match[3] ?? "";
  const symbol = match[2];
  const numeric = Number(match[4]!.replace(/,/g, ""));
  const unit = match[5];

  if (!Number.isFinite(numeric)) return null;

  const multiplier =
    unit?.toLowerCase() === "b"
      ? 1_000_000_000
      : unit?.toLowerCase() === "m"
        ? 1_000_000
        : unit?.toLowerCase() === "k"
          ? 1_000
          : unit === "万"
            ? 10_000
            : 1;
  const amount = numeric * multiplier * (sign === "-" ? -1 : 1);
  const currency = symbol === "$" ? "USD" : "CNY";

  return { amount, currency };
}
