"use client";

/**
 * VoucherBatchDialogs.tsx - 发券弹窗（批次创建 / 定向发放，product_321 §4.2）。
 * @package @vxture/admin
 * @layer Application
 * @category Module
 *
 * 两个写动作都是危码 promotion:campaign.manage + step-up：父页用 runWithStepUp
 * 包裹提交（OrderOfflinePaymentDialog 同款落位模式）。V1 只放行 discount /
 * credit_voucher 两型；门槛字段由服务端显式拒绝。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DialogForm, Input, Label, NativeSelect } from "@vxture/design-system";
import type { PromotionOperationRecord } from "@/entities/console";

export interface CreateBatchPayload {
  kind: "discount" | "credit_voucher";
  name: string;
  codePrefix?: string;
  effect: Record<string, unknown>;
  totalCount: number;
  perUserLimit?: number;
  validFrom: string;
  validUntil: string;
  tenantId?: string;
}

export function CreateVoucherBatchDialog({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: CreateBatchPayload) => void;
}) {
  const tShared = useTranslations();
  const [kind, setKind] = useState<"discount" | "credit_voucher">("discount");
  const [name, setName] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    "percent",
  );
  const [value, setValue] = useState("20");
  const [maxOffYuan, setMaxOffYuan] = useState("");
  const [amountYuan, setAmountYuan] = useState("100");
  const [totalCount, setTotalCount] = useState("100");
  const [perUserLimit, setPerUserLimit] = useState("1");
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState("");
  const [tenantId, setTenantId] = useState("");

  const canSubmit =
    name.trim().length >= 2 &&
    Number(totalCount) >= 1 &&
    validFrom.length > 0 &&
    validUntil.length > 0 &&
    (kind === "discount" ? Number(value) > 0 : Number(amountYuan) > 0);

  function buildPayload(): CreateBatchPayload {
    const effect: Record<string, unknown> =
      kind === "discount"
        ? {
            discount_type: discountType,
            value:
              discountType === "percent"
                ? Number(value)
                : Math.round(Number(value) * 100),
            ...(maxOffYuan.trim()
              ? { max_off_cents: Math.round(Number(maxOffYuan) * 100) }
              : {}),
          }
        : { amount_cents: Math.round(Number(amountYuan) * 100) };
    return {
      kind,
      name: name.trim(),
      ...(codePrefix.trim() ? { codePrefix: codePrefix.trim() } : {}),
      effect,
      totalCount: Number(totalCount),
      perUserLimit: Number(perUserLimit) || 1,
      validFrom: new Date(`${validFrom}T00:00:00`).toISOString(),
      validUntil: new Date(`${validUntil}T23:59:59`).toISOString(),
      ...(tenantId.trim() ? { tenantId: tenantId.trim() } : {}),
    };
  }

  return (
    <DialogForm
      open
      title="新建优惠批次"
      description="V1 支持折扣券（计价减免）与代金券（结算抵扣）；发放后客户在付款页可勾选使用。"
      submitLabel="创建批次"
      cancelLabel={tShared("actions.cancel")}
      submitting={busy}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(buildPayload());
      }}
    >
      <Label htmlFor="vb-kind">券型</Label>
      <NativeSelect
        id="vb-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        <option value="discount">折扣券（购买减价）</option>
        <option value="credit_voucher">代金券（抵扣应付）</option>
      </NativeSelect>

      <Label htmlFor="vb-name">批次名称</Label>
      <Input
        id="vb-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="如：2026 新客 8 折"
      />

      {kind === "discount" ? (
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

      <Label htmlFor="vb-total">发行量</Label>
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
      <Label htmlFor="vb-tenant">定向租户 ID（选填；不填 = 平台级）</Label>
      <Input
        id="vb-tenant"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
        placeholder="tenant uuid"
      />
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
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
    batchId: string;
    count: number;
    targetUserId?: string;
    targetWorkspaceId?: string;
  }) => void;
}) {
  const [count, setCount] = useState("1");
  const [targetKind, setTargetKind] = useState<"user" | "workspace" | "tenant">(
    "user",
  );
  const [targetId, setTargetId] = useState("");

  const platformScoped = batch.scopeLabel === "平台级";
  const canSubmit =
    Number(count) >= 1 &&
    (targetKind === "tenant" ? !platformScoped : targetId.trim().length > 0);

  return (
    <DialogForm
      open
      title="发放券码"
      description={`批次：${batch.promotionName}（${batch.discountLabel}）。平台级批次必须定向到用户或工作空间；租户批次可选「租户全员」。`}
      submitLabel="发放"
      cancelLabel="关闭"
      submitting={busy}
      submitDisabled={!canSubmit || assignedCodes !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          batchId: batch.id,
          count: Number(count),
          ...(targetKind === "user" && targetId.trim()
            ? { targetUserId: targetId.trim() }
            : {}),
          ...(targetKind === "workspace" && targetId.trim()
            ? { targetWorkspaceId: targetId.trim() }
            : {}),
        });
      }}
    >
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
        <option value="tenant" disabled={platformScoped}>
          租户全员（仅租户批次）
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
      {assignedCodes ? (
        <>
          <Label>已发放券码（请复制留存）</Label>
          <p className="text-sm">{assignedCodes.join("、")}</p>
        </>
      ) : null}
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
    </DialogForm>
  );
}
