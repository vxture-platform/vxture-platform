/**
 * voucher-display.ts - Localized voucher read-model presentation.
 * @package @vxture/admin
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-22
 */
import { useTranslations } from "next-intl";
import type { PromotionOperationRecord } from "@/entities/console";
import { visibleIdOr } from "@/lib/visible-id";
import { useVoucherLabels } from "@/modules/shared/enum-labels";

// ===========================================================================
// Presentation accepts structured data; legacy prose is never parsed as money.
// ===========================================================================
type Translator = ReturnType<typeof useTranslations>;
type VoucherBenefit = Pick<PromotionOperationRecord, "kind" | "effect">;

function integer(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

/**
 * Format a voucher effect without changing its business meaning.
 * @param voucher - Voucher kind and structured effect from the read model.
 * @param t - Translator for the current interface language.
 * @returns Localized benefit text or a neutral missing-data label.
 */
export function formatVoucherEffect(voucher: VoucherBenefit, t: Translator) {
  const missing = t("voucherManagement.promotions.benefitUnavailable");
  const effect = voucher.effect;
  if (!effect || typeof effect !== "object" || Array.isArray(effect))
    return missing;
  if (voucher.kind === "credit_voucher") {
    const cents =
      effect.amount_cents ?? effect.amountCents ?? effect.face_value_cents;
    return integer(cents, 1)
      ? t("voucherManagement.detail.faceValue", {
          amount: (cents / 100).toFixed(2),
        })
      : missing;
  }
  if (voucher.kind === "discount") {
    const value = effect.value;
    const cap = effect.max_off_cents;
    if (cap !== undefined && cap !== null && !integer(cap)) return missing;
    if (effect.discount_type === "percent")
      return typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= 100
        ? t("voucherManagement.detail.percent", {
            percent: String(value),
            cap: integer(cap, 1)
              ? t("voucherManagement.detail.cap", { amount: cap / 100 })
              : "",
          })
        : missing;
    return effect.discount_type === "fixed" && integer(value, 1)
      ? `${t("voucherManagement.detail.fixed", { amount: value / 100 })}${
          integer(cap, 1)
            ? t("voucherManagement.detail.cap", { amount: cap / 100 })
            : ""
        }`
      : missing;
  }
  if (voucher.kind === "invite") {
    const plan =
      effect.plan_code ??
      effect.planCode ??
      effect.plan_version_id ??
      effect.planVersionId;
    const name = visibleIdOr(typeof plan === "string" ? plan : null, "");
    return name
      ? t("voucherManagement.detail.unlockPlan", { plan: name })
      : typeof plan === "string" && plan.trim()
        ? t("voucherManagement.promotions.configuredPlan")
        : missing;
  }
  if (voucher.kind === "extension") {
    if (!integer(effect.extend_days, 1)) return missing;
    const codes = effect.applicable_product_codes;
    if (
      codes !== undefined &&
      (!Array.isArray(codes) ||
        codes.length === 0 ||
        codes.some(
          (code) => typeof code !== "string" || !visibleIdOr(code, ""),
        ))
    )
      return missing;
    return t("voucherManagement.detail.extension", {
      days: String(effect.extend_days),
      products:
        Array.isArray(codes) && codes.length
          ? codes.join(t("voucherManagement.common.separator"))
          : t("voucherManagement.detail.allProducts"),
    });
  }
  if (voucher.kind === "redemption")
    return integer(effect.duration_days, 1)
      ? t("voucherManagement.detail.redemption", {
          days: String(effect.duration_days),
        })
      : missing;
  if (voucher.kind === "recharge_card") {
    const principal = effect.face_value_cents;
    const bonus = effect.bonus_cents ?? 0;
    return integer(principal) &&
      integer(bonus) &&
      Number.isSafeInteger(principal + bonus) &&
      principal + bonus > 0
      ? t("voucherManagement.detail.recharge", {
          principal: principal / 100,
          bonus: bonus / 100,
        })
      : missing;
  }
  return t("enums.voucherUnknown.kind");
}

// ===========================================================================
// Lists, CSV and assignment descriptions share these language-aware labels.
// ===========================================================================
/**
 * Build consistent read-model labels without using them for authorization.
 * @returns Localized benefit, scope, issuance and explicit prefix formatters.
 */
export function useVoucherDisplay() {
  const t = useTranslations();
  const labels = useVoucherLabels();
  const benefit = (record: PromotionOperationRecord) =>
    `${labels.kind(record.kind)} · ${formatVoucherEffect(record, t)}`;
  return {
    benefit,
    scope: (record: PromotionOperationRecord) =>
      record.tenantId === null
        ? t("voucherManagement.common.platform")
        : typeof record.tenantId === "string" && record.tenantId.trim()
          ? t("voucherManagement.promotions.targetedTenant")
          : t("voucherManagement.common.unknown"),
    prefix: (record: PromotionOperationRecord) =>
      visibleIdOr(
        record.codePrefix === undefined
          ? record.promotionCode
          : record.codePrefix,
        t("voucherManagement.common.unavailable"),
      ),
    description: (record: PromotionOperationRecord) =>
      `${benefit(record)} · ${t("voucherManagement.promotions.issuedCount", {
        issued: integer(record.issuedCount)
          ? record.issuedCount
          : t("voucherManagement.common.unavailable"),
        total: integer(record.totalCount)
          ? record.totalCount
          : t("voucherManagement.common.unavailable"),
      })}`,
  };
}
