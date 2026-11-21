/**
 * batch-input.ts - Validated operator commands for the enabled voucher kinds.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category types
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException } from "@nestjs/common";

// ===========================================================================
// Public commands
// ===========================================================================
export interface OperatorCommand {
  idempotencyKey: string;
  reason: string;
}
export interface BatchConfiguration {
  kind:
    | "discount"
    | "credit_voucher"
    | "invite"
    | "redemption"
    | "extension"
    | "recharge_card";
  name: string;
  codePrefix?: string;
  effect: Record<string, unknown>;
  totalCount: number;
  perUserLimit?: number;
  perWorkspaceLimit?: number | null;
  perTenantLimit?: number | null;
  validFrom: string;
  validUntil: string;
  claimUntil?: string | null;
  useValidDays?: number | null;
  tenantId?: string | null;
  returnPolicy?: "none" | "full_reversal_only";
}
export interface CreateBatchCommand
  extends BatchConfiguration, OperatorCommand {}
export interface AssignVoucherCommand extends OperatorCommand {
  batchId: string;
  count: number;
  targetTenantId?: string;
  targetUserId?: string;
  targetWorkspaceId?: string;
}
export type BatchAction =
  | ({ action: "review"; expectedRevision: string } & OperatorCommand)
  | ({ action: "pause" | "resume" | "archive" } & OperatorCommand)
  | ({
      action: "configure";
      configuration: BatchConfiguration;
    } & OperatorCommand)
  | ({ action: "request_budget"; totalCount: number } & OperatorCommand)
  | ({
      action: "approve_budget";
      requestOperationId: string;
    } & OperatorCommand);

// ===========================================================================
// Input validation and normalization
// ===========================================================================
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Validate an internal identity. @returns The normalized UUID. @throws {BadRequestException} For malformed identities. */
export function identity(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new BadRequestException(`${field} 非法`);
  return value.toLowerCase();
}
/** Validate a bounded count. @returns The count. @throws {BadRequestException} For noninteger or out-of-range values. */
export function count(
  value: unknown,
  field: string,
  maximum = 100_000,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new BadRequestException(`${field} 取值 1-${maximum}`);
  return value;
}
function time(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new BadRequestException(`${field} 必须是合法时间`);
  return new Date(value).toISOString();
}
/** Normalize a complete draft configuration. @param body - Operator configuration. @returns A canonical storage shape. @throws {BadRequestException} For unsupported effects or invalid limits. */
export function normalizeBatch(body: BatchConfiguration) {
  if (
    !body ||
    ![
      "discount",
      "credit_voucher",
      "invite",
      "redemption",
      "extension",
      "recharge_card",
    ].includes(body.kind)
  )
    throw new BadRequestException(
      "kind 仅支持 discount / credit_voucher / invite / redemption / extension / recharge_card",
    );
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 128)
    throw new BadRequestException("name 长度 2-128");
  if (body.codePrefix != null && typeof body.codePrefix !== "string")
    throw new BadRequestException("codePrefix 必须是字符串");
  const codePrefix = body.codePrefix?.trim().toUpperCase() || null;
  if (codePrefix && !/^[A-Z0-9-]{2,16}$/.test(codePrefix))
    throw new BadRequestException(
      "codePrefix 仅限大写字母/数字/连字符，2-16 位",
    );
  const raw = body.effect;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestException("effect 必须是对象");
  for (const [snake, camel] of [
    ["plan_code", "planCode"],
    ["plan_version_id", "planVersionId"],
    ["discount_type", "discountType"],
    ["max_off_cents", "maxOffCents"],
    ["amount_cents", "amountCents"],
  ]) {
    if (
      raw[snake!] !== undefined &&
      raw[camel!] !== undefined &&
      raw[snake!] !== raw[camel!]
    )
      throw new BadRequestException("同一效果字段的两种命名不一致");
  }
  const common = ["effect_version", "currency"];
  const allowed =
    body.kind === "recharge_card"
      ? ["face_value_cents", "bonus_cents", "bonus_expires_in_days"]
      : body.kind === "extension"
        ? ["extend_days", "applicable_product_codes"]
        : body.kind === "redemption"
          ? ["plan_version_id", "duration_days", "funding_source"]
          : body.kind === "invite"
            ? [
                "plan_code",
                "planCode",
                "plan_version_id",
                "planVersionId",
                "note",
              ]
            : body.kind === "discount"
              ? [
                  "discount_type",
                  "discountType",
                  "value",
                  "max_off_cents",
                  "maxOffCents",
                ]
              : ["amount_cents", "amountCents"];
  for (const key of Object.keys(raw))
    if (![...common, ...allowed].includes(key))
      throw new BadRequestException(`${key} 未启用，禁止配置`);
  if (
    (raw.effect_version !== undefined && raw.effect_version !== 1) ||
    (raw.currency !== undefined && raw.currency !== "CNY")
  )
    throw new BadRequestException("仅支持 effect_version=1 / currency=CNY");
  let effect: Record<string, unknown> = { effect_version: 1, currency: "CNY" };
  if (body.kind === "recharge_card") {
    effect = { ...effect, ...parseRechargeEffect(raw) };
    if (Number(effect.face_value_cents) > 0 && !body.tenantId)
      throw new BadRequestException("本金充值卡必须绑定真实销售收款所属租户");
  } else if (body.kind === "extension") {
    effect = { ...effect, ...parseExtensionEffect(raw) };
  } else if (body.kind === "redemption") {
    effect = { ...effect, ...parseRedemptionEffect(raw) };
  } else if (body.kind === "invite") {
    const planCode = raw.plan_code ?? raw.planCode;
    const planVersionId = raw.plan_version_id ?? raw.planVersionId;
    if (!planCode && !planVersionId)
      throw new BadRequestException(
        "invite 的 effect 必须给 planCode 或 planVersionId 之一",
      );
    if (
      planCode !== undefined &&
      (typeof planCode !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(planCode))
    )
      throw new BadRequestException("plan_code 非法");
    if (planCode) effect.plan_code = planCode;
    if (planVersionId)
      effect.plan_version_id = identity(planVersionId, "plan_version_id");
    if (raw.note !== undefined) {
      if (typeof raw.note !== "string" || raw.note.length > 200)
        throw new BadRequestException("note 最长 200 字");
      effect.note = raw.note.trim();
    }
  } else if (body.kind === "discount") {
    const type = raw.discount_type ?? raw.discountType;
    const value = raw.value;
    if (
      !["fixed", "percent"].includes(String(type)) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (type === "percent"
        ? value > 100
        : !Number.isSafeInteger(value) || value > 999_999_999_999)
    )
      throw new BadRequestException(
        "discount_type / value 非法（金额整数分，比例 (0,100]）",
      );
    effect = { ...effect, discount_type: type, value };
    const maximum = raw.max_off_cents ?? raw.maxOffCents;
    if (maximum !== undefined)
      effect.max_off_cents = count(maximum, "max_off_cents", 999_999_999_999);
  } else
    effect.amount_cents = count(
      raw.amount_cents ?? raw.amountCents,
      "amount_cents",
      999_999_999_999,
    );
  const validFrom = time(body.validFrom, "validFrom"),
    validUntil = time(body.validUntil, "validUntil");
  const claimUntil =
    body.claimUntil == null ? null : time(body.claimUntil, "claimUntil");
  if (
    validFrom >= validUntil ||
    (claimUntil && (claimUntil <= validFrom || claimUntil > validUntil))
  )
    throw new BadRequestException("领用期限必须位于批次有效期内");
  const returnPolicy = body.returnPolicy ?? "none";
  if (
    !["none", "full_reversal_only"].includes(returnPolicy) ||
    (["invite", "redemption", "extension", "recharge_card"].includes(
      body.kind,
    ) &&
      returnPolicy !== "none")
  )
    throw new BadRequestException("返券政策不适用于此券型");
  return {
    kind: body.kind,
    name,
    codePrefix,
    effect,
    totalCount: count(body.totalCount, "totalCount"),
    perUserLimit: count(body.perUserLimit ?? 1, "perUserLimit", 100),
    perWorkspaceLimit:
      body.perWorkspaceLimit == null
        ? null
        : count(body.perWorkspaceLimit, "perWorkspaceLimit"),
    perTenantLimit:
      body.perTenantLimit == null
        ? null
        : count(body.perTenantLimit, "perTenantLimit"),
    useValidDays:
      body.useValidDays == null
        ? null
        : count(body.useValidDays, "useValidDays", 3650),
    validFrom,
    validUntil,
    claimUntil,
    tenantId: body.tenantId ? identity(body.tenantId, "tenantId") : null,
    returnPolicy,
  };
}

/** Validate separate cash and promotional value. @param raw - Frozen card terms. @returns Integer cents and optional bonus lifetime. @throws {BadRequestException} For unsupported terms or money. */
export function parseRechargeEffect(raw: Record<string, unknown>) {
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "effect_version",
          "currency",
          "face_value_cents",
          "bonus_cents",
          "bonus_expires_in_days",
        ].includes(key),
    ) ||
    (raw.effect_version !== undefined && raw.effect_version !== 1) ||
    (raw.currency !== undefined && raw.currency !== "CNY")
  )
    throw new BadRequestException("充值卡仅支持版本 1、CNY 和本金／赠额效果");
  const principal = raw.face_value_cents,
    bonus = raw.bonus_cents;
  if (
    typeof principal !== "number" ||
    typeof bonus !== "number" ||
    !Number.isSafeInteger(principal) ||
    !Number.isSafeInteger(bonus) ||
    principal < 0 ||
    bonus < 0 ||
    principal + bonus < 1 ||
    principal + bonus > 999_999_999_999
  )
    throw new BadRequestException(
      "本金和赠额必须是非负整数分，合计须大于零且在钱包金额上限内",
    );
  if (raw.bonus_expires_in_days !== undefined && bonus === 0)
    throw new BadRequestException("无赠额时不能配置赠额有效期");
  return {
    face_value_cents: principal,
    bonus_cents: bonus,
    ...(raw.bonus_expires_in_days === undefined
      ? {}
      : {
          bonus_expires_in_days: count(
            raw.bonus_expires_in_days,
            "bonus_expires_in_days",
            3650,
          ),
        }),
  };
}

/** Parse the enabled subscription grant model. @param raw - Immutable batch effect. @returns A fixed version and bounded term. @throws {BadRequestException} For legacy or unsupported funding and term models. */
export function parseRedemptionEffect(raw: Record<string, unknown>) {
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "effect_version",
          "currency",
          "plan_version_id",
          "duration_days",
          "funding_source",
        ].includes(key),
    ) ||
    (raw.effect_version !== undefined && raw.effect_version !== 1) ||
    (raw.currency !== undefined && raw.currency !== "CNY") ||
    raw.funding_source !== "operator_grant"
  )
    throw new BadRequestException(
      "兑换券仅支持已审核运营赠送；不接受手填收款凭据或未支持的资金来源",
    );
  return {
    plan_version_id: identity(raw.plan_version_id, "plan_version_id"),
    duration_days: count(raw.duration_days, "duration_days", 3650),
    funding_source: "operator_grant" as const,
  };
}

/** Parse a service-term extension. @param raw - Frozen batch effect. @returns Bounded days and an optional primary-product allowlist. @throws {BadRequestException} For unsupported terms or scopes. */
export function parseExtensionEffect(raw: Record<string, unknown>) {
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "effect_version",
          "currency",
          "extend_days",
          "applicable_product_codes",
        ].includes(key),
    ) ||
    (raw.effect_version !== undefined && raw.effect_version !== 1) ||
    (raw.currency !== undefined && raw.currency !== "CNY")
  )
    throw new BadRequestException("展期券包含未支持的效果或范围");
  const codes = raw.applicable_product_codes;
  if (
    codes !== undefined &&
    (!Array.isArray(codes) ||
      codes.length < 1 ||
      codes.length > 100 ||
      codes.some(
        (code) =>
          typeof code !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(code),
      ) ||
      new Set(codes).size !== codes.length)
  )
    throw new BadRequestException(
      "applicable_product_codes 必须为 1 至 100 个不重复的产品码",
    );
  return {
    extend_days: count(raw.extend_days, "extend_days", 3650),
    ...(codes === undefined
      ? {}
      : {
          // Preserve code-unit ordering across locales and historical snapshots.
          applicable_product_codes: [...(codes as string[])].sort(
            (left, right) => {
              if (left === right) return 0;
              return left < right ? -1 : 1;
            },
          ),
        }),
  };
}
