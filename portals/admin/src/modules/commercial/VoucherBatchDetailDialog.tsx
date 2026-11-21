"use client";
/**
 * VoucherBatchDetailDialog.tsx - Review, budget, lifecycle and instance audit.
 * @package @vxture/admin
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-20
 */
import { useEffect, useRef, useState } from "react";
import {
  ActionButton,
  ConfirmDestructive,
  DialogForm,
  Input,
  Label,
  NativeSelect,
} from "@vxture/design-system";
import {
  fetchVoucherBatch,
  fetchVoucherEvents,
  fetchVoucherInstances,
  manageVoucherBatch,
  revokeVoucher,
  issueVoucherCredentials,
  fetchCardFundingSources,
} from "@/api/admin-bff";
import type {
  VoucherBatchAction,
  VoucherBatchDetail,
  VoucherBatchConfiguration,
  VoucherPage,
  VoucherInstance,
  VoucherAuditEvent,
} from "@/api/voucher-management.types";
import {
  useStepUp,
  isStepUpCancelled,
  StepUpCancelledError,
} from "@/providers/StepUpProvider";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import {
  CreateVoucherBatchDialog,
  type CreateBatchPayload,
} from "./VoucherBatchDialogs";

// ===========================================================================
// Human-readable lifecycle and audit labels
// ===========================================================================
const labels: Record<string, string> = {
  draft: "待审核",
  active: "已启用",
  paused: "已暂停",
  archived: "已归档",
  issued: "待领取",
  assigned: "已发放",
  reserved: "已占用",
  redeemed: "已核销",
  expired: "已过期",
  revoked: "已撤回",
  discount: "折扣券",
  credit_voucher: "代金券",
  invite: "邀请券",
  redemption: "订阅兑换券",
  extension: "展期券",
  recharge_card: "充值卡",
  batch_created: "创建草稿",
  batch_configure: "修改草稿",
  batch_review: "审核启用",
  batch_pause: "暂停批次",
  batch_resume: "恢复批次",
  batch_archive: "归档批次",
  batch_request_budget: "申请增额",
  batch_approve_budget: "批准增额",
  voucher_assigned: "定向发放",
  voucher_issued: "生成领取凭证",
  voucher_claimed: "客户领取",
  voucher_revoked: "撤回券",
  refund_replacement: "退款返券",
  compensation_batch_prepared: "准备补偿批次",
};
function effectLabel(detail: VoucherBatchDetail) {
  const effect = detail.effect;
  if (detail.kind === "credit_voucher")
    return `面额 ¥${(Number(effect.amount_cents ?? effect.amountCents) / 100).toFixed(2)}`;
  if (detail.kind === "discount")
    return effect.discount_type === "percent"
      ? `立减 ${effect.value}%${effect.max_off_cents ? `，封顶 ¥${Number(effect.max_off_cents) / 100}` : ""}`
      : `立减 ¥${Number(effect.value) / 100}`;
  if (detail.kind === "invite")
    return `解锁套餐 ${effect.plan_code ?? effect.planCode ?? effect.plan_version_id ?? effect.planVersionId}`;
  if (detail.kind === "extension")
    return `从原到期日延长 ${effect.extend_days ?? "—"} 天 · 主产品：${Array.isArray(effect.applicable_product_codes) ? effect.applicable_product_codes.join("、") : "全部合格产品"} · 不重置配额`;
  if (detail.kind === "redemption")
    return `运营赠送 · 兑换 ${effect.duration_days ?? "—"} 天新订阅`;
  return `充值本金 ¥${Number(effect.face_value_cents ?? 0) / 100}，赠额 ¥${Number(effect.bonus_cents ?? 0) / 100} · 本金须有真实收款；赠额单独入账`;
}
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <ActionButton
        icon="check"
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </ActionButton>
      <span>
        {page} / {Math.max(1, Math.ceil(total / 20))} 页 · 共 {total} 条
      </span>
      <ActionButton
        icon="check"
        type="button"
        variant="outline"
        disabled={page * 20 >= total}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </ActionButton>
    </div>
  );
}

// ===========================================================================
// Detail loads from read pools; all writes retain their key across retries.
// ===========================================================================
function VoucherBatchDetailContent({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useAdminSession();
  const { runWithStepUp } = useStepUp();
  const [detail, setDetail] = useState<VoucherBatchDetail | null>(null);
  const [instances, setInstances] =
    useState<VoucherPage<VoucherInstance> | null>(null);
  const [events, setEvents] = useState<VoucherPage<VoucherAuditEvent> | null>(
    null,
  );
  const [page, setPage] = useState(1),
    [eventPage, setEventPage] = useState(1),
    [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(""),
    [total, setTotal] = useState("");
  const [fundingPaymentId, setFundingPaymentId] = useState("");
  const [fundingSources, setFundingSources] = useState<Array<{
    id: string;
    paymentNo: string;
    availableAmount: string;
  }> | null>(null);
  const [fundingError, setFundingError] = useState(false);
  const canWrite =
    session.isAuthenticated &&
    session.capabilities.includes("promotion:campaign.manage") &&
    !detail?.compensationBatch;
  const live = useRef(true);
  const running = useRef(false);
  const [confirmation, setConfirmation] = useState<{
    verb: string;
    target: string;
    consequence: string;
    execute: () => Promise<void>;
  } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const paidCard =
    detail?.kind === "recharge_card" &&
    Number(detail.effect.face_value_cents) > 0;
  useEffect(() => {
    if (!paidCard || !canWrite) return;
    let alive = true;
    setFundingSources(null);
    setFundingError(false);
    void fetchCardFundingSources(id)
      .then((rows) => {
        if (alive) setFundingSources(rows);
      })
      .catch(() => {
        if (alive) setFundingError(true);
      });
    return () => {
      alive = false;
    };
  }, [id, paidCard, reload, canWrite]);
  const [issueCount, setIssueCount] = useState("1");
  const [credentials, setCredentials] = useState<
    Array<{ code: string; secret: string }>
  >([]);
  const [issueNotice, setIssueNotice] = useState("");
  const key = useRef({ signature: "", value: "" });
  const creator = session.user?.id === detail?.createdBy;
  useEffect(() => {
    let alive = true;
    setError(null);
    void Promise.all([
      fetchVoucherBatch(id),
      fetchVoucherInstances(id, page),
      fetchVoucherEvents(id, eventPage),
    ])
      .then(([batch, vouchers, history]) => {
        if (alive) {
          setDetail(batch);
          setInstances(vouchers);
          setEvents(history);
        }
      })
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : "批次详情读取失败");
      });
    return () => {
      alive = false;
    };
  }, [id, page, eventPage, reload]);
  function requestKey(payload: object) {
    const signature = JSON.stringify(payload);
    if (key.current.signature !== signature)
      key.current = { signature, value: crypto.randomUUID() };
    return key.current.value;
  }
  async function run(
    payload:
      | Omit<VoucherBatchAction, "idempotencyKey">
      | CreateBatchPayload
      | { reason: string },
    voucherId?: string,
  ) {
    if (running.current || !live.current || !canWrite) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const command = {
        ...payload,
        reason: payload.reason.trim(),
        idempotencyKey: requestKey({ payload, voucherId }),
      };
      await runWithStepUp(
        async () => {
          if (!live.current) throw new StepUpCancelledError();
          if (voucherId) await revokeVoucher(voucherId, command);
          else await manageVoucherBatch(id, command as VoucherBatchAction);
        },
        {
          danger:
            !!voucherId ||
            ("action" in payload &&
              ["pause", "archive"].includes(payload.action)),
          submitLabel: voucherId ? "验证并撤回" : "验证并继续",
        },
      );
      if (!live.current) return;
      key.current = { signature: "", value: "" };
      setReason("");
      setEditing(false);
      setReload((n) => n + 1);
      onChanged();
    } catch (e) {
      if (live.current && !isStepUpCancelled(e))
        setError(
          e instanceof Error ? e.message : "操作失败，请使用相同参数重试。",
        );
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  }
  function act(action: VoucherBatchAction["action"], extra: object = {}) {
    const payload = {
      action,
      reason,
      ...(action === "review" ? { expectedRevision: detail?.revision } : {}),
      ...extra,
    } as Omit<VoucherBatchAction, "idempotencyKey">;
    const verbs: Record<string, string> = {
      review: "审核启用",
      pause: "暂停",
      resume: "恢复",
      archive: "归档停用",
      request_budget: "申请增额",
      approve_budget: "批准增额",
    };
    setConfirmation({
      verb: verbs[action] ?? "确认操作",
      target: `批次 ${detail?.name ?? id}`,
      consequence:
        action === "archive"
          ? "此批次将停止新发放和使用，已占用订单保留原有快照。归档后不能恢复。"
          : action === "pause"
            ? "此批次将暂停新发放和使用，已占用订单保留原有快照。"
            : `将按当前参数执行${verbs[action]}，理由：${reason.trim()}。`,
      execute: () => run(payload),
    });
  }
  async function issue() {
    if (running.current || !live.current || !canWrite) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const command = {
        count: Number(issueCount),
        ...(paidCard ? { fundingPaymentId } : {}),
        reason: reason.trim(),
        idempotencyKey: requestKey({
          action: "issue",
          ...(paidCard ? { fundingPaymentId } : {}),
          id,
          count: Number(issueCount),
          reason: reason.trim(),
        }),
      };
      const result = await runWithStepUp(
        () => {
          if (!live.current) throw new StepUpCancelledError();
          return issueVoucherCredentials(id, command);
        },
        { danger: true, submitLabel: "验证并发行" },
      );
      if (!live.current) return;
      setCredentials(result.replayed ? [] : result.credentials);
      setIssueNotice(
        result.replayed
          ? "本请求已成功发行；领取凭证不会重复返回。若首次响应遗失，请撤回对应实例后重新发行。"
          : "请立即复制并妥善交付领取凭证。关闭此窗口后无法再次查看；普通列表、导出及操作历史均不包含领取凭证。",
      );
      key.current = { signature: "", value: "" };
      setReason("");
      setReload((n) => n + 1);
      onChanged();
    } catch (e) {
      if (live.current && !isStepUpCancelled(e))
        setError(
          e instanceof Error
            ? e.message
            : "领取凭证生成失败，请使用相同参数重试。",
        );
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  }
  const close = () => {
    if (running.current) return;
    setCredentials([]);
    setIssueNotice("");
    onClose();
  };
  const disabled = busy || confirmation !== null || !reason.trim();
  const expired = detail ? Date.parse(detail.validUntil) <= Date.now() : true;
  if (
    editing &&
    detail &&
    [
      "discount",
      "credit_voucher",
      "invite",
      "redemption",
      "extension",
      "recharge_card",
    ].includes(detail.kind)
  ) {
    const configuration: VoucherBatchConfiguration = {
      kind: detail.kind as VoucherBatchConfiguration["kind"],
      name: detail.name,
      effect: detail.effect,
      totalCount: detail.totalCount,
      ...(detail.codePrefix ? { codePrefix: detail.codePrefix } : {}),
      tenantId: detail.tenantId ?? null,
      perUserLimit: detail.perUserLimit ?? 1,
      perWorkspaceLimit: detail.perWorkspaceLimit ?? null,
      perTenantLimit: detail.perTenantLimit ?? null,
      validFrom: detail.validFrom,
      validUntil: detail.validUntil,
      claimUntil: detail.claimUntil ?? null,
      useValidDays: detail.useValidDays ?? null,
      returnPolicy: detail.returnPolicy ?? "none",
    };
    return (
      <CreateVoucherBatchDialog
        initial={configuration}
        busy={busy}
        error={error}
        onClose={() => setEditing(false)}
        onSubmit={(payload) =>
          void run({
            action: "configure",
            configuration: payload,
            reason: payload.reason,
          } as Omit<VoucherBatchAction, "idempotencyKey">)
        }
      />
    );
  }
  return (
    <>
      <DialogForm
        open
        size="lg"
        title={detail?.name ?? "批次详情"}
        description="审核、发行预算、实例去向与操作历史"
        submitLabel="关闭"
        submitting={busy}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <fieldset disabled={busy || confirmation !== null} className="contents">
          {error ? (
            <p role="alert" className="text-sm text-vx-danger">
              {error}
            </p>
          ) : null}
          {!detail ? (
            <p>正在读取批次…</p>
          ) : (
            <>
              <p>
                {labels[detail.kind] ?? detail.kind} · {labels[detail.status]} ·{" "}
                {effectLabel(detail)}
              </p>
              <p>
                {detail.tenantId
                  ? `限定租户 ${detail.tenantId}`
                  : "平台批次，发放时绑定目标租户"}
              </p>
              <p>
                已发行 {detail.issuedCount} / {detail.totalCount} · 已领{" "}
                {detail.claimedCount} · 占用 {detail.reservedCount} · 核销{" "}
                {detail.redeemedCount} · 过期 {detail.expiredCount} · 撤回{" "}
                {detail.revokedCount}
              </p>
              <p>
                有效期：{new Date(detail.validFrom).toLocaleString()} —{" "}
                {new Date(detail.validUntil).toLocaleString()}
              </p>
              <p>
                领取截止：
                {new Date(
                  detail.claimUntil ?? detail.validUntil,
                ).toLocaleString()}{" "}
                · 领取后期限：
                {detail.useValidDays
                  ? `${detail.useValidDays} 天`
                  : "沿用批次截止"}
              </p>
              <p>
                累计上限：每用户 {detail.perUserLimit} / 每工作空间{" "}
                {detail.perWorkspaceLimit ?? "不限"} / 每租户{" "}
                {detail.perTenantLimit ?? "不限"}
              </p>
              <p>
                返券政策：
                {detail.returnPolicy === "full_reversal_only"
                  ? "完整撤销后恢复剩余价值，沿用原有效期"
                  : "不自动返券"}
              </p>
              <p>
                审核：
                {detail.reviewedAt
                  ? `${detail.reviewedBy} · ${new Date(detail.reviewedAt).toLocaleString()}`
                  : detail.status === "draft"
                    ? "等待另一位运营审核"
                    : "历史启用批次"}{" "}
                · {detail.frozenAt ? "首次发行后经济配置已冻结" : "尚未发行"}
              </p>
              {canWrite && detail.status !== "archived" ? (
                <>
                  <Label htmlFor="vbd-reason">
                    操作理由（审核、状态、增额、撤券共用）
                  </Label>
                  <Input
                    id="vbd-reason"
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {detail.status === "draft" ? (
                      <>
                        {creator && !detail.frozenAt ? (
                          <ActionButton
                            variant="outline"
                            icon="check"
                            type="button"
                            disabled={busy}
                            onClick={() => setEditing(true)}
                          >
                            修改草稿
                          </ActionButton>
                        ) : (
                          <ActionButton
                            variant="outline"
                            icon="check"
                            type="button"
                            disabled={
                              disabled ||
                              expired ||
                              !!detail.frozenAt ||
                              creator
                            }
                            onClick={() => act("review")}
                          >
                            审核启用
                          </ActionButton>
                        )}
                      </>
                    ) : null}
                    {detail.status === "active" ? (
                      <ActionButton
                        variant="outline"
                        icon="check"
                        type="button"
                        disabled={disabled}
                        onClick={() => act("pause")}
                      >
                        暂停新发放与使用
                      </ActionButton>
                    ) : null}
                    {detail.status === "paused" ? (
                      <ActionButton
                        variant="outline"
                        icon="check"
                        type="button"
                        disabled={disabled || expired}
                        onClick={() => act("resume")}
                      >
                        恢复批次
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      icon="check"
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => act("archive")}
                    >
                      归档停用
                    </ActionButton>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    暂停和归档保留原有占用，已申报订单仍按快照确认；撤回占用券请先处理订单。
                  </p>
                  {detail.status !== "draft" ? (
                    <>
                      <Label htmlFor="vbd-budget">
                        申请增加发行总量（当前 {detail.totalCount}）
                      </Label>
                      <Input
                        id="vbd-budget"
                        value={total}
                        inputMode="numeric"
                        onChange={(e) => setTotal(e.target.value)}
                      />
                      <ActionButton
                        variant="outline"
                        icon="check"
                        type="button"
                        disabled={
                          disabled ||
                          !Number.isSafeInteger(Number(total)) ||
                          Number(total) <= detail.totalCount
                        }
                        onClick={() =>
                          act("request_budget", { totalCount: Number(total) })
                        }
                      >
                        提交增额申请
                      </ActionButton>
                      {detail.pendingBudgetRequests.map((item) => (
                        <div key={item.id}>
                          <p>
                            申请总量 {item.totalCount} · {item.reason} · 申请人{" "}
                            {item.requestedBy}
                          </p>
                          <ActionButton
                            variant="outline"
                            icon="check"
                            type="button"
                            disabled={
                              disabled || item.requestedBy === session.user?.id
                            }
                            onClick={() =>
                              act("approve_budget", {
                                requestOperationId: item.id,
                              })
                            }
                          >
                            由其他运营批准
                          </ActionButton>
                        </div>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
              {canWrite && detail.status === "active" && !expired ? (
                <>
                  {paidCard ? (
                    <>
                      <Label htmlFor="vbd-card-source">已确认销售收款</Label>
                      <NativeSelect
                        id="vbd-card-source"
                        value={fundingPaymentId}
                        disabled={busy}
                        onChange={(e) => setFundingPaymentId(e.target.value)}
                      >
                        <option value="">请选择真实收款</option>
                        {fundingSources
                          ?.filter((p) => Number(p.availableAmount) > 0)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.paymentNo} · 可分配 ¥{p.availableAmount}
                            </option>
                          ))}
                      </NativeSelect>
                      {fundingError ? (
                        <p role="alert">
                          收款来源读取失败，请重新打开详情重试。
                        </p>
                      ) : fundingSources?.length === 0 ? (
                        <p>暂无合格独立销售收款，请先完成销售收款确认。</p>
                      ) : null}
                    </>
                  ) : null}
                  <Label htmlFor="vbd-issue-count">
                    生成待领取券数量（最多 200，占用发行额度）
                  </Label>
                  <Input
                    id="vbd-issue-count"
                    value={issueCount}
                    inputMode="numeric"
                    onChange={(e) => setIssueCount(e.target.value)}
                  />
                  <ActionButton
                    type="button"
                    variant="outline"
                    icon="ticket"
                    disabled={
                      disabled ||
                      credentials.length > 0 ||
                      (paidCard &&
                        (!fundingPaymentId ||
                          !fundingSources?.some(
                            (p) =>
                              p.id === fundingPaymentId &&
                              Math.round(Number(p.availableAmount) * 100) >=
                                Number(detail.effect.face_value_cents) *
                                  Number(issueCount),
                          ))) ||
                      !Number.isInteger(Number(issueCount)) ||
                      Number(issueCount) < 1 ||
                      Number(issueCount) > 200 ||
                      Number(issueCount) >
                        detail.totalCount - detail.issuedCount
                    }
                    onClick={() =>
                      setConfirmation({
                        verb: "生成领取凭证",
                        target: `批次 ${detail.name}`,
                        consequence: `将发行 ${issueCount} 张券并占用额度${paidCard ? "及已选销售收款" : ""}。凭据仅本次展示，请立即妥善交付。`,
                        execute: issue,
                      })
                    }
                  >
                    生成领取凭证
                  </ActionButton>
                </>
              ) : null}
              {issueNotice ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {issueNotice}
                </p>
              ) : null}
              {credentials.map((item) => (
                <div key={item.code} className="rounded-md border p-3 text-sm">
                  <p>{item.code}</p>
                  <p className="break-all font-mono select-all">
                    {item.secret}
                  </p>
                  <ActionButton
                    type="button"
                    variant="outline"
                    icon="copy"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(item.secret)
                        .catch(() =>
                          setError("复制失败，请手动选中领取凭证复制。"),
                        )
                    }
                  >
                    复制领取凭证
                  </ActionButton>
                </div>
              ))}
              <h3 className="font-medium">券实例</h3>
              {instances?.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3 text-sm">
                  <p>
                    {item.code} · {labels[item.status] ?? item.status}
                    {item.status === "assigned" &&
                    Date.parse(item.expiresAt) <= Date.now()
                      ? "（已过有效期）"
                      : ""}
                  </p>
                  <p>
                    租户 {item.tenantId ?? "历史未绑定"} ·{" "}
                    {item.userId
                      ? `用户 ${item.userId}`
                      : item.workspaceId
                        ? `工作空间 ${item.workspaceId}`
                        : item.status === "issued"
                          ? "等待客户领取"
                          : "租户共享"}
                  </p>
                  {item.reservedOrderId ? (
                    <a href={`/orders/${item.reservedOrderId}`}>查看占用订单</a>
                  ) : null}
                  {item.redeemedOrderId ? (
                    <a href={`/orders/${item.redeemedOrderId}`}>
                      查看核销订单 · {item.redemptionNo}
                    </a>
                  ) : null}
                  {item.paymentId ? <p>券支付记录 {item.paymentId}</p> : null}
                  {item.subscriptionId ? (
                    <a href={`/subscriptions/${item.subscriptionId}`}>
                      查看订阅
                      {!item.redeemedOrderId && item.redemptionNo
                        ? ` · ${item.redemptionNo}`
                        : ""}
                    </a>
                  ) : null}
                  {item.fundingPaymentNo ? (
                    <span>
                      {" "}
                      · 销售收款 {item.fundingPaymentNo}（
                      {item.fundingStatus === "transferred"
                        ? "已入钱包"
                        : item.fundingStatus === "released"
                          ? "已释放"
                          : "已冻结"}
                      ）
                    </span>
                  ) : null}
                  {item.walletTransactions?.length ? (
                    <span>
                      {" "}
                      · 钱包流水 {item.walletTransactions.join(" · ")}
                    </span>
                  ) : null}
                  {canWrite &&
                  ["issued", "assigned", "expired"].includes(item.status) ? (
                    <ActionButton
                      icon="check"
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => {
                        const payload = { reason };
                        setConfirmation({
                          verb: "撤回",
                          target: `券 ${item.code}`,
                          consequence:
                            "撤回后客户不能再领取或使用此券，已过期和撤回不恢复累计限额。",
                          execute: () => run(payload, item.id),
                        });
                      }}
                    >
                      撤回此券
                    </ActionButton>
                  ) : null}
                </div>
              ))}
              {instances ? (
                <Pager page={page} total={instances.total} onChange={setPage} />
              ) : null}
              <h3 className="font-medium">操作历史</h3>
              {events?.items.map((event) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <p>
                    {labels[event.eventType] ?? event.eventType} ·{" "}
                    {event.actorName} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                  <p>{event.reason ?? "—"}</p>
                  <p>操作编号 {event.operationId}</p>
                  {event.voucherId ? <p>券实例 {event.voucherId}</p> : null}
                </div>
              ))}
              {events ? (
                <Pager
                  page={eventPage}
                  total={events.total}
                  onChange={setEventPage}
                />
              ) : null}
            </>
          )}
        </fieldset>
      </DialogForm>
      {confirmation ? (
        <ConfirmDestructive
          open
          verb={confirmation.verb}
          target={confirmation.target}
          consequence={confirmation.consequence}
          onOpenChange={(open) => {
            if (!open && !running.current) setConfirmation(null);
          }}
          onConfirm={async () => {
            await confirmation.execute();
            if (live.current) setConfirmation(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Reset sensitive local state whenever the batch, operator or permissions change. */
export function VoucherBatchDetailDialog(props: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useAdminSession();
  const identity = JSON.stringify([
    props.id,
    session.isAuthenticated,
    session.user?.id,
    [...session.capabilities].sort(),
  ]);
  return <VoucherBatchDetailContent key={identity} {...props} />;
}
