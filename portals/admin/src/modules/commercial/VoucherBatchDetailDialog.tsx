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
import { useLocale, useTranslations } from "next-intl";
import { useVoucherLabels } from "@/modules/shared/enum-labels";
import { formatDateTime } from "@vxture-platform/shared";
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
function effectLabel(
  detail: VoucherBatchDetail,
  tShared: ReturnType<typeof useTranslations>,
) {
  const effect = detail.effect;
  if (detail.kind === "credit_voucher")
    return tShared("voucherManagement.detail.faceValue", {
      amount: (Number(effect.amount_cents ?? effect.amountCents) / 100).toFixed(
        2,
      ),
    });
  if (detail.kind === "discount")
    return effect.discount_type === "percent"
      ? tShared("voucherManagement.detail.percent", {
          percent: String(effect.value),
          cap: effect.max_off_cents
            ? tShared("voucherManagement.detail.cap", {
                amount: Number(effect.max_off_cents) / 100,
              })
            : "",
        })
      : tShared("voucherManagement.detail.fixed", {
          amount: Number(effect.value) / 100,
        });
  if (detail.kind === "invite")
    return tShared("voucherManagement.detail.unlockPlan", {
      plan: String(
        effect.plan_code ??
          effect.planCode ??
          effect.plan_version_id ??
          effect.planVersionId,
      ),
    });
  if (detail.kind === "extension")
    return tShared("voucherManagement.detail.extension", {
      days: String(effect.extend_days ?? "—"),
      products: Array.isArray(effect.applicable_product_codes)
        ? effect.applicable_product_codes.join(
            tShared("voucherManagement.common.separator"),
          )
        : tShared("voucherManagement.detail.allProducts"),
    });
  if (detail.kind === "redemption")
    return tShared("voucherManagement.detail.redemption", {
      days: String(effect.duration_days ?? "—"),
    });
  if (detail.kind === "recharge_card")
    return tShared("voucherManagement.detail.recharge", {
      principal: Number(effect.face_value_cents ?? 0) / 100,
      bonus: Number(effect.bonus_cents ?? 0) / 100,
    });
  return tShared("enums.voucherUnknown.kind");
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
  const tShared = useTranslations();
  return (
    <div className="flex items-center gap-3">
      <ActionButton
        icon="check"
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {tShared("voucherManagement.detail.previous")}
      </ActionButton>
      <span>
        {tShared("voucherManagement.detail.page", {
          page,
          pages: Math.max(1, Math.ceil(total / 20)),
          total,
        })}
      </span>
      <ActionButton
        icon="check"
        type="button"
        variant="outline"
        disabled={page * 20 >= total}
        onClick={() => onChange(page + 1)}
      >
        {tShared("voucherManagement.detail.next")}
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
  const locale = useLocale();
  const tShared = useTranslations();
  const labels = useVoucherLabels();
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
          setError(
            e instanceof Error
              ? e.message
              : tShared("voucherManagement.detail.loadFailed"),
          );
      });
    return () => {
      alive = false;
    };
  }, [id, page, eventPage, reload, tShared]);
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
          submitLabel: voucherId
            ? tShared("voucherManagement.detail.verifyRevoke")
            : tShared("voucherManagement.detail.verifyContinue"),
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
          e instanceof Error
            ? e.message
            : tShared("voucherManagement.detail.operationFailed"),
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
    setConfirmation({
      verb: labels.action(action),
      target: tShared("voucherManagement.detail.batchTarget", {
        name: detail?.name ?? id,
      }),
      consequence:
        action === "archive"
          ? tShared("voucherManagement.detail.archiveConsequence")
          : action === "pause"
            ? tShared("voucherManagement.detail.pauseConsequence")
            : tShared("voucherManagement.detail.actionConsequence", {
                action: labels.action(action),
                reason: reason.trim(),
              }),
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
        {
          danger: true,
          submitLabel: tShared("voucherManagement.detail.verifyIssue"),
        },
      );
      if (!live.current) return;
      setCredentials(result.replayed ? [] : result.credentials);
      setIssueNotice(
        result.replayed
          ? tShared("voucherManagement.detail.replayed")
          : tShared("voucherManagement.detail.credentialNotice"),
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
            : tShared("voucherManagement.detail.issueFailed"),
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
        title={detail?.name ?? tShared("voucherManagement.detail.title")}
        description={tShared("voucherManagement.detail.description")}
        submitLabel={tShared("voucherManagement.detail.close")}
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
            <p>{tShared("voucherManagement.detail.loading")}</p>
          ) : (
            <>
              <p>
                {labels.kind(detail.kind)} · {labels.batchStatus(detail.status)}{" "}
                · {effectLabel(detail, tShared)}
              </p>
              <p>
                {detail.tenantId
                  ? tShared("voucherManagement.detail.tenantScope", {
                      tenant: detail.tenantId,
                    })
                  : tShared("voucherManagement.detail.platformScope")}
              </p>
              <p>
                {tShared("voucherManagement.detail.counts", {
                  issued: detail.issuedCount,
                  total: detail.totalCount,
                  claimed: detail.claimedCount,
                  reserved: detail.reservedCount,
                  redeemed: detail.redeemedCount,
                  expired: detail.expiredCount,
                  revoked: detail.revokedCount,
                })}
              </p>
              <p>
                {tShared("voucherManagement.detail.validity", {
                  from: formatDateTime(detail.validFrom, locale),
                  until: formatDateTime(detail.validUntil, locale),
                })}
              </p>
              <p>
                {tShared("voucherManagement.detail.claimDeadline", {
                  until: formatDateTime(
                    detail.claimUntil ?? detail.validUntil,
                    locale,
                  ),
                  term: detail.useValidDays
                    ? tShared("voucherManagement.detail.days", {
                        days: detail.useValidDays,
                      })
                    : tShared("voucherManagement.detail.batchDeadline"),
                })}
              </p>
              <p>
                {tShared("voucherManagement.detail.limits", {
                  user: detail.perUserLimit ?? 1,
                  workspace:
                    detail.perWorkspaceLimit ??
                    tShared("voucherManagement.detail.unlimited"),
                  tenant:
                    detail.perTenantLimit ??
                    tShared("voucherManagement.detail.unlimited"),
                })}
              </p>
              <p>
                {tShared("voucherManagement.detail.returnPolicy", {
                  policy:
                    detail.returnPolicy === "full_reversal_only"
                      ? tShared("voucherManagement.detail.fullReturn")
                      : tShared("voucherManagement.detail.noReturn"),
                })}
              </p>
              <p>
                {tShared("voucherManagement.detail.review", {
                  review: detail.reviewedAt
                    ? detail.reviewedBy +
                      " · " +
                      formatDateTime(detail.reviewedAt, locale)
                    : detail.status === "draft"
                      ? tShared("voucherManagement.detail.awaitingReview")
                      : tShared("voucherManagement.detail.legacyActive"),
                  freeze: detail.frozenAt
                    ? tShared("voucherManagement.detail.frozen")
                    : tShared("voucherManagement.detail.notIssued"),
                })}
              </p>
              {canWrite && detail.status !== "archived" ? (
                <>
                  <Label htmlFor="vbd-reason">
                    {tShared("voucherManagement.detail.reason")}
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
                            {tShared("voucherManagement.detail.edit")}
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
                            {tShared("voucherManagement.detail.reviewActivate")}
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
                        {tShared("voucherManagement.detail.pause")}
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
                        {tShared("voucherManagement.detail.resume")}
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      icon="check"
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => act("archive")}
                    >
                      {tShared("voucherManagement.detail.archive")}
                    </ActionButton>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {tShared("voucherManagement.detail.reservationNotice")}
                  </p>
                  {detail.status !== "draft" ? (
                    <>
                      <Label htmlFor="vbd-budget">
                        {tShared("voucherManagement.detail.budgetLabel", {
                          total: detail.totalCount,
                        })}
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
                        {tShared("voucherManagement.detail.requestBudget")}
                      </ActionButton>
                      {detail.pendingBudgetRequests.map((item) => (
                        <div key={item.id}>
                          <p>
                            {tShared("voucherManagement.detail.budgetRequest", {
                              total: item.totalCount,
                              reason: item.reason,
                              operator: item.requestedBy,
                            })}
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
                            {tShared("voucherManagement.detail.approveOther")}
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
                      <Label htmlFor="vbd-card-source">
                        {tShared("voucherManagement.detail.confirmedReceipt")}
                      </Label>
                      <NativeSelect
                        id="vbd-card-source"
                        value={fundingPaymentId}
                        disabled={busy}
                        onChange={(e) => setFundingPaymentId(e.target.value)}
                      >
                        <option value="">
                          {tShared("voucherManagement.detail.selectReceipt")}
                        </option>
                        {fundingSources
                          ?.filter((p) => Number(p.availableAmount) > 0)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {tShared(
                                "voucherManagement.detail.receiptCapacity",
                                {
                                  payment: p.paymentNo,
                                  amount: p.availableAmount,
                                },
                              )}
                            </option>
                          ))}
                      </NativeSelect>
                      {fundingError ? (
                        <p role="alert">
                          {tShared("voucherManagement.detail.receiptFailed")}
                        </p>
                      ) : fundingSources?.length === 0 ? (
                        <p>{tShared("voucherManagement.detail.noReceipt")}</p>
                      ) : null}
                    </>
                  ) : null}
                  <Label htmlFor="vbd-issue-count">
                    {tShared("voucherManagement.detail.issueCount")}
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
                        verb: tShared("voucherManagement.detail.issue"),
                        target: tShared(
                          "voucherManagement.detail.batchTarget",
                          { name: detail.name },
                        ),
                        consequence: tShared(
                          "voucherManagement.detail.issueConsequence",
                          {
                            count: issueCount,
                            funding: paidCard
                              ? tShared(
                                  "voucherManagement.detail.selectedReceipt",
                                )
                              : "",
                          },
                        ),
                        execute: issue,
                      })
                    }
                  >
                    {tShared("voucherManagement.detail.issue")}
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
                          setError(
                            tShared("voucherManagement.detail.copyFailed"),
                          ),
                        )
                    }
                  >
                    {tShared("voucherManagement.detail.copy")}
                  </ActionButton>
                </div>
              ))}
              <h3 className="font-medium">
                {tShared("voucherManagement.detail.instances")}
              </h3>
              {instances?.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3 text-sm">
                  <p>
                    {item.code} · {labels.status(item.status)}
                    {item.status === "assigned" &&
                    Date.parse(item.expiresAt) <= Date.now()
                      ? tShared("voucherManagement.detail.pastExpiry")
                      : ""}
                  </p>
                  <p>
                    {tShared("voucherManagement.detail.instanceOwner", {
                      tenant:
                        item.tenantId ??
                        tShared("voucherManagement.detail.legacyUnbound"),
                      owner: item.userId
                        ? tShared("voucherManagement.detail.userOwner", {
                            user: item.userId,
                          })
                        : item.workspaceId
                          ? tShared("voucherManagement.detail.workspaceOwner", {
                              workspace: item.workspaceId,
                            })
                          : item.status === "issued"
                            ? tShared("voucherManagement.detail.awaitingClaim")
                            : tShared("voucherManagement.detail.tenantShared"),
                    })}
                  </p>
                  {item.reservedOrderId ? (
                    <a href={`/orders/${item.reservedOrderId}`}>
                      {tShared("voucherManagement.detail.reservedOrder")}
                    </a>
                  ) : null}
                  {item.redeemedOrderId ? (
                    <a href={`/orders/${item.redeemedOrderId}`}>
                      {tShared("voucherManagement.detail.redeemedOrder", {
                        number: item.redemptionNo ?? "—",
                      })}
                    </a>
                  ) : null}
                  {item.paymentId ? (
                    <p>
                      {tShared("voucherManagement.detail.voucherPayment", {
                        payment: item.paymentId,
                      })}
                    </p>
                  ) : null}
                  {item.subscriptionId ? (
                    <a href={`/subscriptions/${item.subscriptionId}`}>
                      {tShared("voucherManagement.detail.subscription")}
                      {!item.redeemedOrderId && item.redemptionNo
                        ? ` · ${item.redemptionNo}`
                        : ""}
                    </a>
                  ) : null}
                  {item.fundingPaymentNo ? (
                    <span>
                      {tShared("voucherManagement.detail.fundingReceipt", {
                        number: item.fundingPaymentNo,
                        status: labels.funding(item.fundingStatus ?? ""),
                      })}
                    </span>
                  ) : null}
                  {item.walletTransactions?.length ? (
                    <span>
                      {tShared("voucherManagement.detail.walletEntries", {
                        entries: item.walletTransactions.join(" · "),
                      })}
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
                          verb: tShared("voucherManagement.detail.revoke"),
                          target: tShared(
                            "voucherManagement.detail.voucherTarget",
                            { code: item.code },
                          ),
                          consequence: tShared(
                            "voucherManagement.detail.revokeConsequence",
                          ),
                          execute: () => run(payload, item.id),
                        });
                      }}
                    >
                      {tShared("voucherManagement.detail.revokeVoucher")}
                    </ActionButton>
                  ) : null}
                </div>
              ))}
              {instances ? (
                <Pager page={page} total={instances.total} onChange={setPage} />
              ) : null}
              <h3 className="font-medium">
                {tShared("voucherManagement.detail.history")}
              </h3>
              {events?.items.map((event) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <p>
                    {labels.event(event.eventType)} · {event.actorName} ·{" "}
                    {formatDateTime(event.createdAt, locale)}
                  </p>
                  <p>{event.reason ?? "—"}</p>
                  <p>
                    {tShared("voucherManagement.detail.operationNumber", {
                      number: event.operationId,
                    })}
                  </p>
                  {event.voucherId ? (
                    <p>
                      {tShared("voucherManagement.detail.eventVoucher", {
                        voucher: event.voucherId,
                      })}
                    </p>
                  ) : null}
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
