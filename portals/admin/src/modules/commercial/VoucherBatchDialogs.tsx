"use client";

/**
 * VoucherBatchDialogs.tsx - 发券弹窗（批次创建 / 定向发放，product_321 §4.2）。
 * @package @vxture/admin
 * @layer Application
 * @category Module
 *
 * 两个写动作都是危码 promotion:campaign.manage + step-up：父页用 runWithStepUp
 * 包裹提交（OrderOfflinePaymentDialog 同款落位模式）。门槛字段由服务端显式拒绝。
 *
 * ── 三型 ──
 *   discount        折扣券：购买时减价
 *   credit_voucher  代金券：结算时抵扣应付
 *   invite          邀请券：**解锁「能买」，不改变「要付钱」**——非公开套餐默认不
 *                   进客户的套餐阶梯，持券的人才看得见、买得到，照常下单照常付款
 *
 * ── 邀请型为什么用下拉而不是手打套餐码 ──
 * 服务端只接受「真存在、且真非公开」的套餐（`assertInvitablePlan`）。手打的话，
 * 打错与「打对了但那个套餐是公开的」都要提交一次才知道；而判据在数据里摆着——
 * 所以下拉只列可邀请的套餐。一个都没有时不给空下拉，直接说去哪儿设置。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DialogForm, Input, Label, NativeSelect } from "@vxture/design-system";
import { fetchProductPlans } from "@/api/admin-bff";
import type {
  ProductPlanRecord,
  PromotionOperationRecord,
} from "@/entities/console";

type VoucherKind = "discount" | "credit_voucher" | "invite";

export interface CreateBatchPayload {
  kind: VoucherKind;
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
  const [kind, setKind] = useState<VoucherKind>("discount");
  const [planCode, setPlanCode] = useState("");
  /**
   * 可邀请的套餐 = 非公开且在用的。null = 还在读；[] = 一个都没有。
   * 两者要分开：读的时候说「读取中」，真没有的时候说「去哪儿设置」——都画成
   * 空下拉的话，运营会以为是坏了。
   */
  const [invitable, setInvitable] = useState<ProductPlanRecord[] | null>(null);

  useEffect(() => {
    if (kind !== "invite" || invitable !== null) return;
    let alive = true;
    void fetchProductPlans().then((plans) => {
      if (!alive) return;
      const list = plans.filter((x) => !x.isPublic && x.isActive);
      setInvitable(list);
      setPlanCode((cur) => cur || (list[0]?.planCode ?? ""));
    });
    return () => {
      alive = false;
    };
  }, [kind, invitable]);
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

  const kindReady =
    kind === "discount"
      ? Number(value) > 0
      : kind === "credit_voucher"
        ? Number(amountYuan) > 0
        : planCode.trim().length > 0;
  const canSubmit =
    name.trim().length >= 2 &&
    Number(totalCount) >= 1 &&
    validFrom.length > 0 &&
    validUntil.length > 0 &&
    kindReady;

  function buildPayload(): CreateBatchPayload {
    let effect: Record<string, unknown>;
    if (kind === "discount") {
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
      effect = { planCode: planCode.trim() };
    }
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
      size="lg"
      title="新建优惠批次"
      description={
        kind === "invite"
          ? "邀请券解锁的是「能买」：非公开套餐平时不出现在客户的套餐列表里，持券的人才看得见、买得到，价格照原价、照常付款。"
          : "折扣券在计价时减免、代金券在结算时抵扣；发放后客户在付款页可勾选使用。"
      }
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
        <option value="invite">邀请券（解锁非公开套餐）</option>
      </NativeSelect>

      <Label htmlFor="vb-name">批次名称</Label>
      <Input
        id="vb-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="如：2026 新客 8 折"
      />

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
              {invitable.map((plan) => (
                <option key={plan.planCode} value={plan.planCode}>
                  {plan.planName}（{plan.planCode}）
                </option>
              ))}
            </NativeSelect>
          )}
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
  /*
   * 邀请券不许发给「租户全员」：那样两个 assigned_* 列都是 NULL，而客户侧的邀请
   * 判据认的正是这两列——发得出去、用不了，界面还回「发放成功」带着券码。
   * 服务端也拒（那是权威判据），这里只是不让人先走进死路。
   */
  const inviteKind = batch.kind === "invite";
  const tenantWideAllowed = !platformScoped && !inviteKind;
  const canSubmit =
    Number(count) >= 1 &&
    (targetKind === "tenant" ? tenantWideAllowed : targetId.trim().length > 0);

  return (
    <DialogForm
      open
      size="sm"
      title="发放券码"
      description={
        inviteKind
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
