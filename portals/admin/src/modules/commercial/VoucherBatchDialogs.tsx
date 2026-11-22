"use client";

/**
 * VoucherBatchDialogs.tsx - Draft configuration and tenant-bound assignment.
 * @package @vxture/admin
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-19
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useVoucherDisplay } from "./voucher-display";
import { DialogForm, Input, Label, NativeSelect } from "@vxture/design-system";
import { fetchProductPlans, fetchPlanVersions } from "@/api/admin-bff";
import type {
  ProductPlanRecord,
  PromotionOperationRecord,
} from "@/entities/console";

import type {
  VoucherBatchConfiguration,
  VoucherOperatorCommand,
} from "@/api/voucher-management.types";

// ===========================================================================
// Configuration and stable request identities
// ===========================================================================
type VoucherKind = VoucherBatchConfiguration["kind"];

export type CreateBatchPayload = VoucherBatchConfiguration &
  VoucherOperatorCommand;

function localDate(value: string) {
  const date = new Date(value);
  // Date inputs need a machine value in the browser zone, never a display string.
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function useCommandIdentity() {
  const request = useRef({ signature: "", key: "" });
  return (payload: object) => {
    const signature = JSON.stringify(payload);
    if (request.current.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  };
}

function positiveInteger(value: string, max = 100000) {
  return (
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= max
  );
}
function money(value: string, allowZero = false) {
  return (
    /^\d+(?:\.\d{1,2})?$/.test(value) &&
    Number.isSafeInteger(Math.round(Number(value) * 100)) &&
    Math.round(Number(value) * 100) <= 999999999999 &&
    (allowZero ? Number(value) >= 0 : Number(value) > 0)
  );
}
function day(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function CreateVoucherBatchDialog({
  busy,
  error,
  onClose,
  onSubmit,
  initial,
}: {
  initial?: VoucherBatchConfiguration;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: CreateBatchPayload) => void;
}) {
  const tShared = useTranslations();
  const [kind, setKind] = useState<VoucherKind>(initial?.kind ?? "discount");
  const [planCode, setPlanCode] = useState(
    String(initial?.effect.plan_code ?? initial?.effect.planCode ?? ""),
  );
  /**
   * 可邀请的套餐 = 非公开且在用的。null = 还在读；[] = 一个都没有。
   * 两者要分开：读的时候说「读取中」，真没有的时候说「去哪儿设置」——都画成
   * 空下拉的话，运营会以为是坏了。
   */
  const [invitable, setInvitable] = useState<ProductPlanRecord[] | null>(null);
  const [redemptionVersions, setRedemptionVersions] = useState<
    { id: string; label: string }[] | null
  >(null);

  useEffect(() => {
    if (kind !== "redemption") return;
    let alive = true;
    void fetchProductPlans()
      .then(async (plans) => {
        const groups = await Promise.all(
          plans
            .filter((p) => p.isActive)
            .map(async (plan) =>
              (await fetchPlanVersions(plan.id))
                .filter((v) => v.status === "published" && v.isLocked)
                .map((v) => ({
                  id: v.id,
                  label: tShared("voucherManagement.draft.planVersionLabel", {
                    name: plan.planName,
                    code: plan.planCode,
                    version: v.versionNo,
                  }),
                })),
            ),
        );
        if (alive) setRedemptionVersions(groups.flat());
      })
      .catch(() => {
        if (alive) setRedemptionVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [kind, tShared]);

  useEffect(() => {
    if (kind !== "invite" || invitable !== null) return;
    let alive = true;
    void fetchProductPlans()
      .then((plans) => {
        if (!alive) return;
        const list = plans.filter((x) => !x.isPublic && x.isActive);
        setInvitable(list);
        setPlanCode(
          (cur) =>
            cur ||
            (initial?.effect.plan_version_id || initial?.effect.planVersionId
              ? ""
              : (list[0]?.planCode ?? "")),
        );
      })
      .catch(() => {
        if (alive) setInvitable([]);
      });
    return () => {
      alive = false;
    };
  }, [
    kind,
    invitable,
    initial?.effect.plan_version_id,
    initial?.effect.planVersionId,
  ]);
  const [planVersionId, setPlanVersionId] = useState(
    String(
      initial?.effect.plan_version_id ?? initial?.effect.planVersionId ?? "",
    ),
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [durationDays, setDurationDays] = useState(
    String(initial?.effect.duration_days ?? initial?.effect.extend_days ?? 30),
  );
  const [productCodes, setProductCodes] = useState(
    Array.isArray(initial?.effect.applicable_product_codes)
      ? initial.effect.applicable_product_codes.join(", ")
      : "",
  );
  const [codePrefix, setCodePrefix] = useState(initial?.codePrefix ?? "");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    initial?.effect.discount_type === "fixed" ? "fixed" : "percent",
  );
  const [value, setValue] = useState(
    String(
      initial?.effect.discount_type === "fixed"
        ? Number(initial.effect.value) / 100
        : (initial?.effect.value ?? 20),
    ),
  );
  const [maxOffYuan, setMaxOffYuan] = useState(
    initial?.effect.max_off_cents
      ? String(Number(initial.effect.max_off_cents) / 100)
      : "",
  );
  const [amountYuan, setAmountYuan] = useState(
    String(Number(initial?.effect.amount_cents ?? 10000) / 100),
  );
  const [principalYuan, setPrincipalYuan] = useState(
    String(Number(initial?.effect.face_value_cents ?? 0) / 100),
  );
  const [bonusYuan, setBonusYuan] = useState(
    String(Number(initial?.effect.bonus_cents ?? 1000) / 100),
  );
  const [bonusDays, setBonusDays] = useState(
    String(initial?.effect.bonus_expires_in_days ?? ""),
  );
  const [totalCount, setTotalCount] = useState(
    String(initial?.totalCount ?? 100),
  );
  const [perUserLimit, setPerUserLimit] = useState(
    String(initial?.perUserLimit ?? 1),
  );
  const [validFrom, setValidFrom] = useState(
    initial?.validFrom
      ? localDate(initial.validFrom)
      : localDate(new Date().toISOString()),
  );
  const [validUntil, setValidUntil] = useState(
    initial?.validUntil ? localDate(initial.validUntil) : "",
  );
  const [tenantId, setTenantId] = useState(initial?.tenantId ?? "");
  const [perWorkspaceLimit, setPerWorkspaceLimit] = useState(
    String(initial?.perWorkspaceLimit ?? ""),
  );
  const [perTenantLimit, setPerTenantLimit] = useState(
    String(initial?.perTenantLimit ?? ""),
  );
  const [claimUntil, setClaimUntil] = useState(
    initial?.claimUntil ? localDate(initial.claimUntil) : "",
  );
  const [useValidDays, setUseValidDays] = useState(
    String(initial?.useValidDays ?? ""),
  );
  const [returnPolicy, setReturnPolicy] = useState(
    initial?.returnPolicy ?? "none",
  );
  const [reason, setReason] = useState("");
  const requestKey = useCommandIdentity();
  const submitting = useRef(false);

  const kindReady =
    kind === "recharge_card"
      ? money(principalYuan, true) &&
        money(bonusYuan, true) &&
        Number(principalYuan) + Number(bonusYuan) > 0 &&
        (Number(principalYuan) === 0 || tenantId.trim().length > 0) &&
        (!bonusDays ||
          (Number(bonusYuan) > 0 &&
            Number.isInteger(Number(bonusDays)) &&
            Number(bonusDays) >= 1 &&
            Number(bonusDays) <= 3650))
      : kind === "extension"
        ? Number.isInteger(Number(durationDays)) &&
          Number(durationDays) >= 1 &&
          Number(durationDays) <= 3650
        : kind === "redemption"
          ? !!redemptionVersions?.some((v) => v.id === planVersionId) &&
            Number.isInteger(Number(durationDays)) &&
            Number(durationDays) >= 1 &&
            Number(durationDays) <= 3650
          : kind === "discount"
            ? (discountType === "percent"
                ? Number.isFinite(Number(value)) &&
                  Number(value) > 0 &&
                  Number(value) <= 100
                : money(value)) &&
              (!maxOffYuan || money(maxOffYuan))
            : kind === "credit_voucher"
              ? money(amountYuan)
              : !!invitable?.some((p) => p.planCode === planCode) ||
                !!(initial && planVersionId.trim());
  const canSubmit =
    name.trim().length >= 2 &&
    positiveInteger(totalCount) &&
    positiveInteger(perUserLimit, 100) &&
    (!perWorkspaceLimit || positiveInteger(perWorkspaceLimit)) &&
    (!perTenantLimit || positiveInteger(perTenantLimit)) &&
    (!useValidDays || positiveInteger(useValidDays, 3650)) &&
    day(validFrom) &&
    day(validUntil) &&
    validUntil >= validFrom &&
    (!claimUntil ||
      (day(claimUntil) &&
        claimUntil >= validFrom &&
        claimUntil <= validUntil)) &&
    kindReady &&
    reason.trim().length > 0;

  function buildPayload(): CreateBatchPayload {
    let effect: Record<string, unknown>;
    if (kind === "recharge_card") {
      effect = {
        face_value_cents: Math.round(Number(principalYuan) * 100),
        bonus_cents: Math.round(Number(bonusYuan) * 100),
        ...(bonusDays ? { bonus_expires_in_days: Number(bonusDays) } : {}),
      };
    } else if (kind === "extension") {
      effect = {
        extend_days: Number(durationDays),
        ...(productCodes.trim()
          ? { applicable_product_codes: productCodes.trim().split(/[\s,，]+/) }
          : {}),
      };
    } else if (kind === "redemption") {
      effect = {
        plan_version_id: planVersionId.trim(),
        duration_days: Number(durationDays),
        funding_source: "operator_grant",
      };
    } else if (kind === "discount") {
      effect = {
        discount_type: discountType,
        value:
          discountType === "percent"
            ? Number(value)
            : Math.round(Number(value) * 100),
        ...(maxOffYuan.trim()
          ? { max_off_cents: Math.round(Number(maxOffYuan) * 100) }
          : {}),
      };
    } else if (kind === "credit_voucher") {
      effect = { amount_cents: Math.round(Number(amountYuan) * 100) };
    } else {
      /* 邀请型只装「解锁哪个套餐」——服务端也只收这一个键。 */
      effect = {
        ...(planCode.trim() ? { plan_code: planCode.trim() } : {}),
        ...(planVersionId.trim()
          ? { plan_version_id: planVersionId.trim() }
          : {}),
      };
    }
    const configuration = {
      kind,
      name: name.trim(),
      ...(codePrefix.trim() ? { codePrefix: codePrefix.trim() } : {}),
      effect,
      totalCount: Number(totalCount),
      perUserLimit: Number(perUserLimit) || 1,
      validFrom:
        initial && validFrom === localDate(initial.validFrom)
          ? initial.validFrom
          : new Date(`${validFrom}T00:00:00`).toISOString(),
      validUntil:
        initial && validUntil === localDate(initial.validUntil)
          ? initial.validUntil
          : new Date(`${validUntil}T23:59:59`).toISOString(),
      ...(tenantId.trim() ? { tenantId: tenantId.trim() } : {}),
      perWorkspaceLimit: perWorkspaceLimit ? Number(perWorkspaceLimit) : null,
      perTenantLimit: perTenantLimit ? Number(perTenantLimit) : null,
      claimUntil: claimUntil
        ? initial?.claimUntil && claimUntil === localDate(initial.claimUntil)
          ? initial.claimUntil
          : new Date(`${claimUntil}T23:59:59`).toISOString()
        : null,
      useValidDays: useValidDays ? Number(useValidDays) : null,
      returnPolicy: [
        "invite",
        "redemption",
        "extension",
        "recharge_card",
      ].includes(kind)
        ? ("none" as const)
        : returnPolicy,
      reason: reason.trim(),
    };
    return { ...configuration, idempotencyKey: requestKey(configuration) };
  }

  return (
    <DialogForm
      open
      size="lg"
      title={
        initial
          ? tShared("voucherManagement.draft.editTitle")
          : tShared("voucherManagement.draft.createTitle")
      }
      description={
        kind === "recharge_card"
          ? tShared("voucherManagement.draft.rechargeDescription")
          : kind === "extension"
            ? tShared("voucherManagement.draft.extensionDescription")
            : kind === "redemption"
              ? tShared("voucherManagement.draft.redemptionDescription")
              : kind === "invite"
                ? tShared("voucherManagement.draft.inviteDescription")
                : tShared("voucherManagement.draft.discountDescription")
      }
      submitLabel={
        initial
          ? tShared("voucherManagement.draft.save")
          : tShared("voucherManagement.draft.create")
      }
      cancelLabel={tShared("actions.cancel")}
      submitting={busy}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || busy || submitting.current) return;
        submitting.current = true;
        queueMicrotask(() => {
          submitting.current = false;
        });
        onSubmit(buildPayload());
      }}
    >
      <fieldset disabled={busy} className="contents">
        <Label htmlFor="vb-kind">
          {tShared("voucherManagement.draft.kind")}
        </Label>
        <NativeSelect
          id="vb-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="discount">
            {tShared("voucherManagement.draft.discountKind")}
          </option>
          <option value="credit_voucher">
            {tShared("voucherManagement.draft.creditKind")}
          </option>
          <option value="invite">
            {tShared("voucherManagement.draft.inviteKind")}
          </option>
          <option value="redemption">
            {tShared("voucherManagement.draft.redemptionKind")}
          </option>
          <option value="recharge_card">
            {tShared("voucherManagement.draft.rechargeKind")}
          </option>
          <option value="extension">
            {tShared("voucherManagement.draft.extensionKind")}
          </option>
        </NativeSelect>

        <Label htmlFor="vb-name">
          {tShared("voucherManagement.draft.name")}
        </Label>
        <Input
          id="vb-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tShared("voucherManagement.draft.namePlaceholder")}
        />

        {kind === "redemption" ? (
          <>
            <Label htmlFor="vb-version">
              {tShared("voucherManagement.draft.version")}
            </Label>
            {redemptionVersions === null ? (
              <p>{tShared("voucherManagement.draft.loadingVersions")}</p>
            ) : (
              <NativeSelect
                id="vb-version"
                value={planVersionId}
                onChange={(e) => setPlanVersionId(e.target.value)}
              >
                <option value="">
                  {tShared("voucherManagement.draft.selectVersion")}
                </option>
                {planVersionId &&
                !redemptionVersions.some((v) => v.id === planVersionId) ? (
                  <option value={planVersionId}>
                    {tShared("voucherManagement.draft.currentVersion")}
                  </option>
                ) : null}
                {redemptionVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            )}
            {redemptionVersions?.length === 0 ? (
              <p>{tShared("voucherManagement.draft.noVersions")}</p>
            ) : null}
          </>
        ) : kind === "invite" ? (
          <>
            <Label htmlFor="vb-version">
              {tShared("voucherManagement.draft.exactVersion")}
            </Label>
            <Input
              id="vb-version"
              value={planVersionId}
              onChange={(e) => setPlanVersionId(e.target.value)}
              placeholder="plan version uuid"
            />
          </>
        ) : null}
        {kind === "invite" ? (
          <>
            <Label htmlFor="vb-plan">
              {tShared("voucherManagement.draft.plan")}
            </Label>
            {invitable === null ? (
              <p className="text-sm text-muted-foreground">
                {tShared("voucherManagement.draft.loadingPlans")}
              </p>
            ) : invitable.length === 0 ? (
              /* 空下拉会被当成「坏了」。没有可邀请的套餐是个确定的状态，
               直接说清楚去哪儿改——这个开关在产品套餐页的套餐卡菜单里。 */
              <p className="text-sm text-muted-foreground">
                {tShared("voucherManagement.draft.noPlans")}
              </p>
            ) : (
              <NativeSelect
                id="vb-plan"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
              >
                <option value="">
                  {tShared("voucherManagement.draft.exactOnly")}
                </option>
                {invitable.map((plan) => (
                  <option key={plan.planCode} value={plan.planCode}>
                    {plan.planName}（{plan.planCode}）
                  </option>
                ))}
              </NativeSelect>
            )}
          </>
        ) : kind === "recharge_card" ? (
          <>
            <Label htmlFor="vb-principal">
              {tShared("voucherManagement.draft.principal")}
            </Label>
            <Input
              id="vb-principal"
              value={principalYuan}
              inputMode="decimal"
              onChange={(e) => setPrincipalYuan(e.target.value)}
            />
            <Label htmlFor="vb-bonus">
              {tShared("voucherManagement.draft.bonus")}
            </Label>
            <Input
              id="vb-bonus"
              value={bonusYuan}
              inputMode="decimal"
              onChange={(e) => setBonusYuan(e.target.value)}
            />
            <Label htmlFor="vb-bonus-days">
              {tShared("voucherManagement.draft.bonusDays")}
            </Label>
            <Input
              id="vb-bonus-days"
              value={bonusDays}
              inputMode="numeric"
              onChange={(e) => setBonusDays(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {tShared("voucherManagement.draft.fundingNotice")}
            </p>
          </>
        ) : kind === "extension" ? (
          <>
            <Label htmlFor="vb-days">
              {tShared("voucherManagement.draft.extendDays")}
            </Label>
            <Input
              id="vb-days"
              type="number"
              min={1}
              max={3650}
              step={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
            <Label htmlFor="vb-products">
              {tShared("voucherManagement.draft.products")}
            </Label>
            <Input
              id="vb-products"
              value={productCodes}
              onChange={(e) => setProductCodes(e.target.value)}
              placeholder="arda, karda"
            />
            <p className="text-sm text-muted-foreground">
              {tShared("voucherManagement.draft.extensionNotice")}
            </p>
          </>
        ) : kind === "redemption" ? (
          <>
            <Label htmlFor="vb-days">
              {tShared("voucherManagement.draft.subscriptionDays")}
            </Label>
            <Input
              id="vb-days"
              type="number"
              min={1}
              max={3650}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {tShared("voucherManagement.draft.grantNotice")}
            </p>
          </>
        ) : kind === "discount" ? (
          <>
            <Label htmlFor="vb-dtype">
              {tShared("voucherManagement.draft.discountMode")}
            </Label>
            <NativeSelect
              id="vb-dtype"
              value={discountType}
              onChange={(e) =>
                setDiscountType(e.target.value as typeof discountType)
              }
            >
              <option value="percent">
                {tShared("voucherManagement.draft.percentMode")}
              </option>
              <option value="fixed">
                {tShared("voucherManagement.draft.fixedMode")}
              </option>
            </NativeSelect>
            <Label htmlFor="vb-value">
              {discountType === "percent"
                ? tShared("voucherManagement.draft.percent")
                : tShared("voucherManagement.draft.fixed")}
            </Label>
            <Input
              id="vb-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
            />
            <Label htmlFor="vb-maxoff">
              {tShared("voucherManagement.draft.cap")}
            </Label>
            <Input
              id="vb-maxoff"
              value={maxOffYuan}
              onChange={(e) => setMaxOffYuan(e.target.value)}
              inputMode="decimal"
              placeholder={tShared("voucherManagement.draft.noCap")}
            />
          </>
        ) : (
          <>
            <Label htmlFor="vb-amount">
              {tShared("voucherManagement.draft.faceValue")}
            </Label>
            <Input
              id="vb-amount"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              inputMode="decimal"
            />
          </>
        )}

        <Label htmlFor="vb-total">
          {kind === "invite"
            ? tShared("voucherManagement.draft.invitationCount")
            : tShared("voucherManagement.draft.total")}
        </Label>
        <Input
          id="vb-total"
          value={totalCount}
          onChange={(e) => setTotalCount(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-limit">
          {tShared("voucherManagement.draft.perUser")}
        </Label>
        <Input
          id="vb-limit"
          value={perUserLimit}
          onChange={(e) => setPerUserLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-from">
          {tShared("voucherManagement.draft.validFrom")}
        </Label>
        <Input
          id="vb-from"
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
        <Label htmlFor="vb-until">
          {tShared("voucherManagement.draft.validUntil")}
        </Label>
        <Input
          id="vb-until"
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
        <Label htmlFor="vb-prefix">
          {tShared("voucherManagement.draft.prefix")}
        </Label>
        <Input
          id="vb-prefix"
          value={codePrefix}
          onChange={(e) => setCodePrefix(e.target.value.toUpperCase())}
          placeholder={tShared("voucherManagement.draft.prefixPlaceholder")}
        />
        <Label htmlFor="vb-tenant">
          {kind === "recharge_card" && Number(principalYuan) > 0
            ? tShared("voucherManagement.draft.salesTenant")
            : tShared("voucherManagement.draft.tenant")}
        </Label>
        <Input
          id="vb-tenant"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder={tShared("voucherManagement.draft.tenantPlaceholder")}
        />
        <Label htmlFor="vb-ws-limit">
          {tShared("voucherManagement.draft.workspaceLimit")}
        </Label>
        <Input
          id="vb-ws-limit"
          value={perWorkspaceLimit}
          onChange={(e) => setPerWorkspaceLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-tenant-limit">
          {tShared("voucherManagement.draft.tenantLimit")}
        </Label>
        <Input
          id="vb-tenant-limit"
          value={perTenantLimit}
          onChange={(e) => setPerTenantLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-claim">
          {tShared("voucherManagement.draft.claimUntil")}
        </Label>
        <Input
          id="vb-claim"
          type="date"
          value={claimUntil}
          onChange={(e) => setClaimUntil(e.target.value)}
        />
        <Label htmlFor="vb-use-days">
          {tShared("voucherManagement.draft.useDays")}
        </Label>
        <Input
          id="vb-use-days"
          value={useValidDays}
          onChange={(e) => setUseValidDays(e.target.value)}
          inputMode="numeric"
        />
        {!["invite", "redemption", "extension", "recharge_card"].includes(
          kind,
        ) ? (
          <>
            <Label htmlFor="vb-return">
              {tShared("voucherManagement.draft.returnPolicy")}
            </Label>
            <NativeSelect
              id="vb-return"
              value={returnPolicy}
              onChange={(e) =>
                setReturnPolicy(e.target.value as typeof returnPolicy)
              }
            >
              <option value="none">
                {tShared("voucherManagement.draft.noReturn")}
              </option>
              <option value="full_reversal_only">
                {tShared("voucherManagement.draft.fullReturn")}
              </option>
            </NativeSelect>
          </>
        ) : null}
        <Label htmlFor="vb-reason">
          {tShared("voucherManagement.draft.reason")}
        </Label>
        <Input
          id="vb-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <p className="text-sm text-muted-foreground">
          {tShared("voucherManagement.draft.reviewNotice")}
        </p>
        {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
      </fieldset>
    </DialogForm>
  );
}

export function AssignVouchersDialog({
  batch,
  busy,
  error,
  assignedCodes,
  onClose,
  onSubmit,
}: {
  batch: PromotionOperationRecord;
  busy: boolean;
  error: string | null;
  assignedCodes: string[] | null;
  onClose: () => void;
  onSubmit: (payload: {
    idempotencyKey: string;
    reason: string;
    targetTenantId?: string;
    batchId: string;
    count: number;
    targetUserId?: string;
    targetWorkspaceId?: string;
  }) => void;
}) {
  const display = useVoucherDisplay();
  const tShared = useTranslations();
  const requestKey = useCommandIdentity();
  const submitting = useRef(false);
  const [reason, setReason] = useState("");
  const [targetTenantId, setTargetTenantId] = useState(batch.tenantId ?? "");
  const [count, setCount] = useState("1");
  const [targetKind, setTargetKind] = useState<"user" | "workspace" | "tenant">(
    "user",
  );
  const [targetId, setTargetId] = useState("");

  // Preserve the server read-model marker; translated labels never decide eligibility.
  const platformScoped = batch.scopeLabel === "平台级";
  /*
   * 邀请券不许发给「租户全员」：那样两个 assigned_* 列都是 NULL，而客户侧的邀请
   * 判据认的正是这两列——发得出去、用不了，界面还回「发放成功」带着券码。
   * 服务端也拒（那是权威判据），这里只是不让人先走进死路。
   */
  const inviteKind = batch.kind === "invite";
  const tenantWideAllowed = !platformScoped && !inviteKind;
  const canSubmit =
    !batch.requiresCashFunding &&
    reason.trim().length > 0 &&
    positiveInteger(count, 200) &&
    (targetKind !== "user" || !platformScoped || !!targetTenantId.trim()) &&
    (targetKind === "tenant" ? tenantWideAllowed : targetId.trim().length > 0);

  return (
    <DialogForm
      open
      size="sm"
      title={tShared("voucherManagement.draft.assignTitle")}
      description={
        batch.requiresCashFunding
          ? tShared("voucherManagement.draft.assignFunding")
          : inviteKind
            ? tShared("voucherManagement.draft.assignInvite", {
                name: batch.promotionName,
                benefit: display.benefit(batch),
              })
            : tShared("voucherManagement.draft.assignDescription", {
                name: batch.promotionName,
                benefit: display.benefit(batch),
              })
      }
      submitLabel={tShared("voucherManagement.draft.assign")}
      cancelLabel={tShared("voucherManagement.draft.close")}
      submitting={busy}
      submitDisabled={!canSubmit || assignedCodes !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || busy || submitting.current || assignedCodes !== null)
          return;
        submitting.current = true;
        queueMicrotask(() => {
          submitting.current = false;
        });
        const payload = {
          reason: reason.trim(),
          ...(targetTenantId.trim()
            ? { targetTenantId: targetTenantId.trim() }
            : {}),
          batchId: batch.id,
          count: Number(count),
          ...(targetKind === "user" && targetId.trim()
            ? { targetUserId: targetId.trim() }
            : {}),
          ...(targetKind === "workspace" && targetId.trim()
            ? { targetWorkspaceId: targetId.trim() }
            : {}),
        };
        onSubmit({ ...payload, idempotencyKey: requestKey(payload) });
      }}
    >
      <fieldset disabled={busy} className="contents">
        <Label htmlFor="va-count">
          {tShared("voucherManagement.draft.count")}
        </Label>
        <Input
          id="va-count"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="va-target-kind">
          {tShared("voucherManagement.draft.target")}
        </Label>
        <NativeSelect
          id="va-target-kind"
          value={targetKind}
          onChange={(e) => setTargetKind(e.target.value as typeof targetKind)}
        >
          <option value="user">
            {tShared("voucherManagement.draft.user")}
          </option>
          <option value="workspace">
            {tShared("voucherManagement.draft.workspace")}
          </option>
          <option value="tenant" disabled={!tenantWideAllowed}>
            {inviteKind
              ? tShared("voucherManagement.draft.noTenantInvite")
              : tShared("voucherManagement.draft.allTenant")}
          </option>
        </NativeSelect>
        {targetKind !== "tenant" ? (
          <>
            <Label htmlFor="va-target">
              {targetKind === "user"
                ? tShared("voucherManagement.draft.userId")
                : tShared("voucherManagement.draft.workspaceId")}
            </Label>
            <Input
              id="va-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder={tShared(
                "voucherManagement.draft.identifierPlaceholder",
              )}
            />
          </>
        ) : null}
        {platformScoped ? (
          <>
            <Label htmlFor="va-tenant">
              {tShared("voucherManagement.draft.targetTenant")}
            </Label>
            <Input
              id="va-tenant"
              value={targetTenantId}
              onChange={(e) => setTargetTenantId(e.target.value)}
            />
          </>
        ) : null}
        <Label htmlFor="va-reason">
          {tShared("voucherManagement.draft.assignReason")}
        </Label>
        <Input
          id="va-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        {assignedCodes ? (
          <>
            <Label>{tShared("voucherManagement.draft.codes")}</Label>
            <p className="text-sm">
              {assignedCodes.join(
                tShared("voucherManagement.common.separator"),
              )}
            </p>
          </>
        ) : null}
        {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
      </fieldset>
    </DialogForm>
  );
}
