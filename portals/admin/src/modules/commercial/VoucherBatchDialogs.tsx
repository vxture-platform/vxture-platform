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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
                  label: `${plan.planName}（${plan.planCode}）· V${v.versionNo}`,
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
  }, [kind]);

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
      title={initial ? "修改批次草稿" : "新建优惠批次"}
      description={
        kind === "recharge_card"
          ? "本金与赠额分别进入租户钱包；本金卡发行须绑定真实销售收款，赠额可设置核销后的有效期限。"
          : kind === "extension"
            ? "仅从合格订阅原到期日延长整数天；不改档位、不重置配额、不增加可退现金，核销后不自动返券。"
            : kind === "redemption"
              ? "运营赠送固定版本、固定天数的新订阅；不产生收款记录，不支持续订、升级或已订阅产品。"
              : kind === "invite"
                ? "邀请券解锁的是「能买」：非公开套餐平时不出现在客户的套餐列表里，持券的人才看得见、买得到，价格照原价、照常付款。"
                : "折扣券在计价时减免、代金券在结算时抵扣；发放后客户在付款页可勾选使用。"
      }
      submitLabel={initial ? "保存草稿" : "创建草稿"}
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
        <Label htmlFor="vb-kind">券型</Label>
        <NativeSelect
          id="vb-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="discount">折扣券（购买减价）</option>
          <option value="credit_voucher">代金券（抵扣应付）</option>
          <option value="invite">邀请券（解锁非公开套餐）</option>
          <option value="redemption">订阅兑换券（运营赠送）</option>
          <option value="recharge_card">充值卡（本金与赠额分账）</option>
          <option value="extension">展期券（延长已有订阅）</option>
        </NativeSelect>

        <Label htmlFor="vb-name">批次名称</Label>
        <Input
          id="vb-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：2026 新客 8 折"
        />

        {kind === "redemption" ? (
          <>
            <Label htmlFor="vb-version">兑换哪个已发布套餐版本</Label>
            {redemptionVersions === null ? (
              <p>读取已发布版本…</p>
            ) : (
              <NativeSelect
                id="vb-version"
                value={planVersionId}
                onChange={(e) => setPlanVersionId(e.target.value)}
              >
                <option value="">请选择已发布且冻结的版本</option>
                {planVersionId &&
                !redemptionVersions.some((v) => v.id === planVersionId) ? (
                  <option value={planVersionId}>
                    当前绑定版本（请核对目录状态与权限）
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
              <p>
                没有可选版本；请先在产品套餐中发布并冻结版本，并确认目录读取权限。
              </p>
            ) : null}
          </>
        ) : kind === "invite" ? (
          <>
            <Label htmlFor="vb-version">
              精确套餐版本 ID（选填；填写后仅适用于此版本）
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
            <Label htmlFor="vb-plan">解锁哪个套餐</Label>
            {invitable === null ? (
              <p className="text-sm text-muted-foreground">读取套餐清单…</p>
            ) : invitable.length === 0 ? (
              /* 空下拉会被当成「坏了」。没有可邀请的套餐是个确定的状态，
               直接说清楚去哪儿改——这个开关在产品套餐页的套餐卡菜单里。 */
              <p className="text-sm text-muted-foreground">
                目前没有邀请订阅的套餐。先在「产品套餐 → 选产品」里把某一档改为
                邀请订阅，再回来发券。
              </p>
            ) : (
              <NativeSelect
                id="vb-plan"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
              >
                <option value="">仅按精确版本定位</option>
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
              每张本金（元；无收款赠送请填 0）
            </Label>
            <Input
              id="vb-principal"
              value={principalYuan}
              inputMode="decimal"
              onChange={(e) => setPrincipalYuan(e.target.value)}
            />
            <Label htmlFor="vb-bonus">每张赠额（元）</Label>
            <Input
              id="vb-bonus"
              value={bonusYuan}
              inputMode="decimal"
              onChange={(e) => setBonusYuan(e.target.value)}
            />
            <Label htmlFor="vb-bonus-days">
              赠额有效天数（从核销起；留空为长期）
            </Label>
            <Input
              id="vb-bonus-days"
              value={bonusDays}
              inputMode="numeric"
              onChange={(e) => setBonusDays(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              本金卡必须绑定销售租户，发行时选择该租户真实已结清的独立销售收款。本金与赠额分别进入租户钱包。
            </p>
          </>
        ) : kind === "extension" ? (
          <>
            <Label htmlFor="vb-days">展期天数（1–3650）</Label>
            <Input
              id="vb-days"
              type="number"
              min={1}
              max={3650}
              step={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
            <Label htmlFor="vb-products">适用主产品码（选填，逗号分隔）</Label>
            <Input
              id="vb-products"
              value={productCodes}
              onChange={(e) => setProductCodes(e.target.value)}
              placeholder="arda, karda"
            />
            <p className="text-sm text-muted-foreground">
              留空适用于全部合格主产品；按订阅的主产品匹配，不按附赠组件匹配。仅支持有到期日的在用、临期、宽限中订阅；试用、暂停、已到期终止和永久订阅不可使用，有在途订单时须先处理订单。
            </p>
          </>
        ) : kind === "redemption" ? (
          <>
            <Label htmlFor="vb-days">订阅有效天数（1–3650）</Label>
            <Input
              id="vb-days"
              type="number"
              min={1}
              max={3650}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              资金来源：运营赠送。领取凭证有效期与兑换后的订阅服务期分别计算；服务期从兑换成功时开始，自动续费关闭。
            </p>
          </>
        ) : kind === "discount" ? (
          <>
            <Label htmlFor="vb-dtype">折扣方式</Label>
            <NativeSelect
              id="vb-dtype"
              value={discountType}
              onChange={(e) =>
                setDiscountType(e.target.value as typeof discountType)
              }
            >
              <option value="percent">按比例（%）</option>
              <option value="fixed">按金额（元）</option>
            </NativeSelect>
            <Label htmlFor="vb-value">
              {discountType === "percent" ? "立减比例（%）" : "立减金额（元）"}
            </Label>
            <Input
              id="vb-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
            />
            <Label htmlFor="vb-maxoff">封顶金额（元，选填）</Label>
            <Input
              id="vb-maxoff"
              value={maxOffYuan}
              onChange={(e) => setMaxOffYuan(e.target.value)}
              inputMode="decimal"
              placeholder="不填 = 不封顶"
            />
          </>
        ) : (
          <>
            <Label htmlFor="vb-amount">面额（元）</Label>
            <Input
              id="vb-amount"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              inputMode="decimal"
            />
          </>
        )}

        <Label htmlFor="vb-total">
          {kind === "invite" ? "邀请份数" : "发行量"}
        </Label>
        <Input
          id="vb-total"
          value={totalCount}
          onChange={(e) => setTotalCount(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-limit">每用户上限</Label>
        <Input
          id="vb-limit"
          value={perUserLimit}
          onChange={(e) => setPerUserLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-from">生效日期</Label>
        <Input
          id="vb-from"
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
        />
        <Label htmlFor="vb-until">失效日期</Label>
        <Input
          id="vb-until"
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
        <Label htmlFor="vb-prefix">券码前缀（选填，大写/数字）</Label>
        <Input
          id="vb-prefix"
          value={codePrefix}
          onChange={(e) => setCodePrefix(e.target.value.toUpperCase())}
          placeholder="如 VX26-"
        />
        <Label htmlFor="vb-tenant">
          {kind === "recharge_card" && Number(principalYuan) > 0
            ? "本金卡销售租户 ID（必填）"
            : "定向租户 ID（选填；不填 = 平台级）"}
        </Label>
        <Input
          id="vb-tenant"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="tenant uuid"
        />
        <Label htmlFor="vb-ws-limit">每工作空间累计上限（选填）</Label>
        <Input
          id="vb-ws-limit"
          value={perWorkspaceLimit}
          onChange={(e) => setPerWorkspaceLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-tenant-limit">每租户累计上限（选填）</Label>
        <Input
          id="vb-tenant-limit"
          value={perTenantLimit}
          onChange={(e) => setPerTenantLimit(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="vb-claim">发放 / 领取截止日（选填）</Label>
        <Input
          id="vb-claim"
          type="date"
          value={claimUntil}
          onChange={(e) => setClaimUntil(e.target.value)}
        />
        <Label htmlFor="vb-use-days">
          领取后有效天数（选填，不超过批次截止日）
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
            <Label htmlFor="vb-return">退款返券政策</Label>
            <NativeSelect
              id="vb-return"
              value={returnPolicy}
              onChange={(e) =>
                setReturnPolicy(e.target.value as typeof returnPolicy)
              }
            >
              <option value="none">不自动返券</option>
              <option value="full_reversal_only">
                服务完整撤销并退足政策可退现金后，返还剩余券价值
              </option>
            </NativeSelect>
          </>
        ) : null}
        <Label htmlFor="vb-reason">配置理由</Label>
        <Input
          id="vb-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <p className="text-sm text-muted-foreground">
          保存后由另一位运营审核启用；首次发行后经济配置冻结。撤销和过期不恢复累计限额。
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
  const requestKey = useCommandIdentity();
  const submitting = useRef(false);
  const [reason, setReason] = useState("");
  const [targetTenantId, setTargetTenantId] = useState(batch.tenantId ?? "");
  const [count, setCount] = useState("1");
  const [targetKind, setTargetKind] = useState<"user" | "workspace" | "tenant">(
    "user",
  );
  const [targetId, setTargetId] = useState("");

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
      title="发放券码"
      description={
        batch.requiresCashFunding
          ? "本金充值卡请在批次详情中选择真实已确认销售收款，生成领取凭证后交付客户。"
          : inviteKind
            ? `批次：${batch.promotionName}（${batch.discountLabel}）。邀请券必须定向到具体用户或工作空间——收到的人才能在订阅页看到这一档并自助下单，价格照原价。`
            : `批次：${batch.promotionName}（${batch.discountLabel}）。平台级批次必须定向到用户或工作空间；租户批次可选「租户全员」。`
      }
      submitLabel="发放"
      cancelLabel="关闭"
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
        <Label htmlFor="va-count">发放数量</Label>
        <Input
          id="va-count"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputMode="numeric"
        />
        <Label htmlFor="va-target-kind">发放目标</Label>
        <NativeSelect
          id="va-target-kind"
          value={targetKind}
          onChange={(e) => setTargetKind(e.target.value as typeof targetKind)}
        >
          <option value="user">指定用户</option>
          <option value="workspace">指定工作空间</option>
          <option value="tenant" disabled={!tenantWideAllowed}>
            {inviteKind ? "租户全员（邀请券不适用）" : "租户全员（仅租户批次）"}
          </option>
        </NativeSelect>
        {targetKind !== "tenant" ? (
          <>
            <Label htmlFor="va-target">
              {targetKind === "user" ? "用户 ID" : "工作空间 ID"}
            </Label>
            <Input
              id="va-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="uuid"
            />
          </>
        ) : null}
        {platformScoped ? (
          <>
            <Label htmlFor="va-tenant">
              目标租户 ID（用户券必填，工作空间券可自动确定）
            </Label>
            <Input
              id="va-tenant"
              value={targetTenantId}
              onChange={(e) => setTargetTenantId(e.target.value)}
            />
          </>
        ) : null}
        <Label htmlFor="va-reason">发放理由</Label>
        <Input
          id="va-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        {assignedCodes ? (
          <>
            <Label>已发放券码（请复制留存）</Label>
            <p className="text-sm">{assignedCodes.join("、")}</p>
          </>
        ) : null}
        {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
      </fieldset>
    </DialogForm>
  );
}
