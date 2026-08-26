"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  EmptyState,
  Icon,
  MetricGrid,
} from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import {
  fetchBillingRecord,
  submitBillingBillAction,
  submitBillingInvoiceReceiptAction,
  syncOfflineInvoice,
} from "@/api/admin-bff";
import type {
  BillingBillAction,
  BillingBillStatus,
  BillingBillType,
  BillingDetailRecord,
  BillingInvoiceReceiptAction,
  BillingInvoiceReceiptRecord,
  BillingInvoiceTaxType,
  BillingInvoiceType,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import {
  canSyncOfflineInvoice,
  offlineInvoiceDisabledReason,
  OfflineInvoiceDialog,
} from "@/modules/billing/OfflineInvoiceDialog";
import {
  BillingBillActionDialog,
  billingBillActionDisabledReason,
  billingBillActionLabel,
  canRunBillingBillAction,
} from "@/modules/billing/BillingBillActionDialog";
import {
  canRunInvoiceReceiptAction,
  InvoiceReceiptActionDialog,
  invoiceReceiptActionDisabledReason,
  invoiceReceiptActionLabel,
} from "@/modules/billing/InvoiceReceiptActionDialog";
import {
  formatDate,
  formatQuantity,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function billStatusLabel(status: BillingBillStatus) {
  if (status === "paying") return "支付中";
  if (status === "paid") return "已结清";
  if (status === "partial") return "部分收款";
  if (status === "cancelled") return "已作废";
  if (status === "overdue") return "逾期";
  return "待收款";
}

function billTypeLabel(type: BillingBillType) {
  if (type === "adjust") return "调整单";
  if (type === "supplement") return "补录单";
  if (type === "prepaid") return "预付费";
  return "正常账单";
}

function invoiceTypeLabel(type: BillingInvoiceType) {
  if (type === "special_vat") return "增值税专票";
  if (type === "normal_vat") return "增值税普票";
  if (type === "electronic") return "电子发票";
  if (type === "paper") return "纸质发票";
  return "其他";
}

function taxTypeLabel(type: BillingInvoiceTaxType) {
  if (type === "enterprise") return "企业";
  if (type === "individual") return "个人";
  if (type === "government") return "政府/事业单位";
  return "其他";
}

function cycleLabel(cycle: string) {
  if (cycle === "yearly") return "年度";
  if (cycle === "monthly") return "月度";
  if (cycle === "once") return "一次性";
  return cycle || "未设置";
}

function paySourceLabel(source: string) {
  if (source === "offline") return "线下";
  if (source === "online") return "线上";
  return "未设置";
}

function paymentStatusLabel(status: string) {
  if (status === "paid") return "已支付";
  if (status === "pending_verify") return "线下待核";
  if (status === "failed") return "支付失败";
  if (status === "closed") return "已关闭";
  if (status === "refunding") return "退款中";
  return "支付中";
}

function BillingSummary({ bill }: { bill: BillingDetailRecord }) {
  const t = useTranslations();
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <section className="vx-product-capability-summary">
      <div className="vx-product-capability-summary__identity">
        <span
          className="vx-product-capability-summary__icon"
          aria-hidden="true"
        >
          <Icon name="key" size="lg" fallback="placeholder" />
        </span>
        <div>
          <h2>{bill.billNo}</h2>
          <p>
            {bill.tenantName} / {bill.tierName ?? "未关联套餐"}
          </p>
          <div className="vx-product-capability-summary__badges">
            <Badge
              className={`vx-tenant-pill vx-billing-pill--${bill.billStatus}`}
            >
              {billStatusLabel(bill.billStatus)}
            </Badge>
            <Badge
              className={`vx-tenant-pill vx-billing-pill--invoice-${bill.invoiceStatus}`}
            >
              {t(`status.invoice.${bill.invoiceStatus}`)}
            </Badge>
          </div>
        </div>
      </div>
      <MetricGrid
        items={[
          {
            id: "payable",
            help: "本期账单应收总额，按账单币种展示。",
            label: "账单应收",
            value: formatCurrency(bill.payableAmount, bill.currency),
            tags: [billTypeLabel(bill.billType)],
          },
          {
            id: "paid",
            help: "已核销到本账单的回款金额。",
            label: tShared("columns.receivedAmount"),
            value: formatCurrency(bill.paidAmount, bill.currency),
            tags: [bill.paymentMethod ?? "未收款"],
          },
          {
            id: "invoiced",
            help: "本账单已开具发票的金额，不等于已回款。",
            label: "已开票",
            value: formatCurrency(bill.invoicedAmount, bill.currency),
            tags: [bill.invoiceNo ?? t(`status.invoice.${bill.invoiceStatus}`)],
          },
          {
            id: "cycle",
            help: "账单所属计费周期的起止日期。",
            label: "账期",
            value: `${formatDate(bill.cycleStartDate, locale)} - ${formatDate(bill.cycleEndDate, locale)}`,
            tags: [cycleLabel(bill.billCycle)],
          },
        ]}
      />
    </section>
  );
}

function BillingDetails({
  bill,
  onReceiptAction,
}: {
  bill: BillingDetailRecord;
  onReceiptAction: (
    receipt: BillingInvoiceReceiptRecord,
    action: BillingInvoiceReceiptAction,
  ) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <section
      className="vx-product-capability-detail"
      aria-label={`${bill.billNo} 账单详情`}
    >
      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="key" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="账单编号">{orUnset(bill.billNo)}</DetailRow>
          <DetailRow label="账单状态">
            {orUnset(billStatusLabel(bill.billStatus))}
          </DetailRow>
          <DetailRow label="账单类型">
            {orUnset(billTypeLabel(bill.billType))}
          </DetailRow>
          <DetailRow label="账期类型">
            {orUnset(cycleLabel(bill.billCycle))}
          </DetailRow>
          <DetailRow label="账期开始">
            {orUnset(formatDate(bill.cycleStartDate, locale))}
          </DetailRow>
          <DetailRow label="账期结束">
            {orUnset(formatDate(bill.cycleEndDate, locale))}
          </DetailRow>
          <DetailRow label="生成时间">
            {orUnset(formatDate(bill.createdAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(bill.updatedAt, locale))}
          </DetailRow>
          <DetailRow label="经办人">{orUnset(bill.operatorName)}</DetailRow>
          <DetailRow label="运营备注">
            {orUnset(bill.operationRemark)}
          </DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="buildings" title="租户与订阅" />
        <DetailList columns={3}>
          <DetailRow label="租户">{orUnset(bill.tenantName)}</DetailRow>
          <DetailRow label={tShared("columns.tenantCode")}>
            {orUnset(bill.tenantCode)}
          </DetailRow>
          <DetailRow label={tShared("columns.tenantType")}>
            {orUnset(typeLabel(bill.tenantType))}
          </DetailRow>
          <DetailRow label="所属区域">{orUnset(bill.region)}</DetailRow>
          <DetailRow label="所属行业">{orUnset(bill.industry)}</DetailRow>
          <DetailRow label="服务套餐">
            {bill.servicePlanName || "未关联"}
          </DetailRow>
          <DetailRow label="套餐版本">{bill.tierName || "未关联"}</DetailRow>
          <DetailRow label="订单编号">{bill.orderNo || "未关联"}</DetailRow>
          <DetailRow label="订阅 ID">
            {bill.subscriptionId || "未关联"}
          </DetailRow>
        </DetailList>
        <div className="vx-product-capability-actions vx-subscription-detail-links">
          <Button asChild variant="outline">
            <Link href={`/tenants/${encodeURIComponent(bill.tenantId)}`}>
              <Icon name="buildings" size="xs" fallback="placeholder" />
              租户详情
            </Link>
          </Button>
          {bill.subscriptionId ? (
            <>
              <Button asChild variant="outline">
                <Link
                  href={`/subscriptions/${encodeURIComponent(bill.subscriptionId)}`}
                >
                  <Icon name="star" size="xs" fallback="placeholder" />
                  订阅详情
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  href={`/orders/${encodeURIComponent(bill.subscriptionId)}`}
                >
                  <Icon name="table" size="xs" fallback="placeholder" />
                  订单详情
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="chart-bar" title="收款信息" />
        <DetailList columns={3}>
          <DetailRow label="账单原价">
            {orUnset(formatCurrency(bill.totalAmount, bill.currency))}
          </DetailRow>
          <DetailRow label="优惠金额">
            {orUnset(formatCurrency(bill.discountAmount, bill.currency))}
          </DetailRow>
          <DetailRow label="应收金额">
            {orUnset(formatCurrency(bill.payableAmount, bill.currency))}
          </DetailRow>
          <DetailRow label={tShared("columns.receivedAmount")}>
            {orUnset(formatCurrency(bill.paidAmount, bill.currency))}
          </DetailRow>
          <DetailRow label="剩余应收">
            {orUnset(
              formatCurrency(
                Math.max(0, bill.payableAmount - bill.paidAmount),
                bill.currency,
              ),
            )}
          </DetailRow>
          <DetailRow label="收款时间">
            {orUnset(formatDate(bill.paidAt, locale))}
          </DetailRow>
          <DetailRow label="支付方式">{orUnset(bill.paymentMethod)}</DetailRow>
          <DetailRow label="交易流水">{orUnset(bill.transactionNo)}</DetailRow>
          <DetailRow label={tShared("columns.currency")}>
            {orUnset(bill.currency)}
          </DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="list" title="账单明细" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {bill.invoiceItems.map((item) => (
            <div key={item.id} className="vx-product-detail-list__row">
              <span>
                <Icon name="table" size="sm" fallback="placeholder" />
                <strong>{item.itemName}</strong>
              </span>
              <small>
                {item.itemType} | {formatQuantity(item.quantity)}{" "}
                {item.itemUnit ?? ""}
              </small>
              <em>{formatCurrency(item.totalAmount, bill.currency)}</em>
              <p>
                {item.remark ??
                  `单价 ${formatCurrency(item.unitPrice, bill.currency)}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="check" title="支付记录" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {bill.paymentRecords.length ? (
            bill.paymentRecords.map((payment) => (
              <div key={payment.id} className="vx-product-detail-list__row">
                <span>
                  <Icon name="check" size="sm" fallback="placeholder" />
                  <strong>{payment.paymentNo}</strong>
                </span>
                <small>
                  {paySourceLabel(payment.paySource)} |{" "}
                  {paymentStatusLabel(payment.paymentStatus)} |{" "}
                  {formatDate(payment.paidAt, locale)}
                </small>
                <em>{formatCurrency(payment.paidAmount, payment.currency)}</em>
                <p>{payment.remark ?? payment.operatorName}</p>
              </div>
            ))
          ) : (
            <div className="vx-product-detail-list__row">
              <span>
                <Icon name="clock" size="sm" fallback="placeholder" />
                <strong>暂无支付记录</strong>
              </span>
              <small>等待线上支付或运营确认线下收款</small>
              <em>未收款</em>
              <p>订单侧确认线下收款后会自动写入支付记录。</p>
            </div>
          )}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="key" title="发票登记" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {bill.invoiceReceipts.length ? (
            bill.invoiceReceipts.map((receipt) => (
              <div key={receipt.id} className="vx-product-detail-list__row">
                <span>
                  <Icon name="key" size="sm" fallback="placeholder" />
                  <strong>{receipt.invoiceNo}</strong>
                </span>
                <small>
                  {invoiceTypeLabel(receipt.invoiceType)} |{" "}
                  {taxTypeLabel(receipt.invoiceTaxType)} |{" "}
                  {t(`status.invoice.${receipt.invoiceStatus}`)}
                </small>
                <em>
                  {formatCurrency(receipt.invoiceAmount, receipt.currency)}
                </em>
                <p className="vx-billing-receipt-actions">
                  <span>
                    {receipt.invoiceFileUrl ? (
                      <a
                        href={receipt.invoiceFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看发票文件
                      </a>
                    ) : receipt.expressNo ? (
                      `${receipt.expressCompany ?? "快递"} ${receipt.expressNo}`
                    ) : (
                      (receipt.statusRemark ?? receipt.auditorName)
                    )}
                  </span>
                  {/* `red` 单独一支：DS 对 `variant="destructive"` 的类型义务
                      要求写出 `confirmExempt`，而展开传参（`{...(cond ? {} : {})}`）
                      判别不了——那正是它想拦的写法。 */}
                  {(["update_shipping", "finish", "red"] as const).map(
                    (action) =>
                      action === "red" ? (
                        <Button
                          key={action}
                          variant="destructive"
                          size="md"
                          /* 同 InvoicesPage：这个钮打开的是红冲登记表单，不直接
                           生效。落锤在表单提交，且那一步走 step-up。 */
                          confirmExempt="这个按钮只打开红冲登记表单，不直接生效；红冲发生在表单提交时，且那一步走 step-up 二次验证"
                          className="is-danger"
                          disabled={
                            !canRunInvoiceReceiptAction(action, receipt)
                          }
                          title={
                            invoiceReceiptActionDisabledReason(
                              action,
                              receipt,
                            ) ?? undefined
                          }
                          onClick={() => onReceiptAction(receipt, action)}
                        >
                          {invoiceReceiptActionLabel(action)}
                        </Button>
                      ) : (
                        <Button
                          key={action}
                          variant="outline"
                          size="md"
                          disabled={
                            !canRunInvoiceReceiptAction(action, receipt)
                          }
                          title={
                            invoiceReceiptActionDisabledReason(
                              action,
                              receipt,
                            ) ?? undefined
                          }
                          onClick={() => onReceiptAction(receipt, action)}
                        >
                          {invoiceReceiptActionLabel(action)}
                        </Button>
                      ),
                  )}
                </p>
              </div>
            ))
          ) : (
            <div className="vx-product-detail-list__row">
              <span>
                <Icon name="clock" size="sm" fallback="placeholder" />
                <strong>暂无发票登记</strong>
              </span>
              <small>当前未接入在线开票接口</small>
              <em>
                {formatCurrency(
                  Math.max(0, bill.payableAmount - bill.invoicedAmount),
                  bill.currency,
                )}
              </em>
              <p>财务线下开票完成后，由运营在此手动同步登记。</p>
            </div>
          )}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="clock" title="运营记录" />
        <div className="vx-subscription-timeline">
          {bill.operationTimeline.map((event) => (
            <article
              key={event.id}
              className={`vx-subscription-timeline__item vx-subscription-timeline__item--${event.tone}`}
            >
              <span aria-hidden="true">
                <Icon
                  name={
                    event.tone === "danger"
                      ? "warning"
                      : event.tone === "success"
                        ? "check"
                        : "info"
                  }
                  size="xs"
                  fallback="placeholder"
                />
              </span>
              <div>
                <strong>{event.title}</strong>
                <p>{event.description}</p>
                <small>
                  {event.actor} · {formatDate(event.at, locale)}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export function BillingDetailPage({ billId }: { billId: string }) {
  const t = useTranslations();
  const tShared = useTranslations();
  const router = useRouter();
  const { runWithStepUp } = useStepUp();
  const [bill, setBill] = useState<BillingDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [receiptActionTarget, setReceiptActionTarget] = useState<{
    receipt: BillingInvoiceReceiptRecord;
    action: BillingInvoiceReceiptAction;
  } | null>(null);
  const [submittingReceiptAction, setSubmittingReceiptAction] = useState(false);
  const [billActionTarget, setBillActionTarget] =
    useState<BillingBillAction | null>(null);
  const [submittingBillAction, setSubmittingBillAction] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchBillingRecord(billId)
      .then((record) => {
        if (active) setBill(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [billId]);

  async function handleSyncOfflineInvoice(
    payload: Parameters<typeof syncOfflineInvoice>[1],
  ) {
    if (!bill) return;

    setSubmittingInvoice(true);
    setOperationError(null);

    try {
      const updatedBill = await syncOfflineInvoice(bill.id, payload);
      setBill(updatedBill);
      setOperationFeedback("线下发票已完成同步登记。");
      setInvoiceDialogOpen(false);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "线下发票登记失败，请稍后重试。",
      );
    } finally {
      setSubmittingInvoice(false);
    }
  }

  function requestReceiptAction(
    receipt: BillingInvoiceReceiptRecord,
    action: BillingInvoiceReceiptAction,
  ) {
    setOperationError(null);
    setOperationFeedback(null);
    setReceiptActionTarget({ receipt, action });
  }

  async function handleSubmitReceiptAction(
    payload: Parameters<typeof submitBillingInvoiceReceiptAction>[2],
  ) {
    if (!bill || !receiptActionTarget) return;

    setSubmittingReceiptAction(true);
    setOperationError(null);

    try {
      const updatedBill = await runWithStepUp(() =>
        submitBillingInvoiceReceiptAction(
          bill.id,
          receiptActionTarget.receipt.id,
          payload,
        ),
      );
      setBill(updatedBill);
      setOperationFeedback(
        `${invoiceReceiptActionLabel(receiptActionTarget.action)}已同步登记。`,
      );
      setReceiptActionTarget(null);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : "发票后续动作登记失败，请稍后重试。",
      );
    } finally {
      setSubmittingReceiptAction(false);
    }
  }

  function requestBillAction(action: BillingBillAction) {
    setOperationError(null);
    setOperationFeedback(null);
    setBillActionTarget(action);
  }

  async function handleSubmitBillAction(
    payload: Parameters<typeof submitBillingBillAction>[1],
  ) {
    if (!bill || !billActionTarget) return;

    setSubmittingBillAction(true);
    setOperationError(null);

    try {
      const updatedBill = await runWithStepUp(() =>
        submitBillingBillAction(bill.id, payload),
      );
      const actionLabel = billingBillActionLabel(billActionTarget);
      setBill(updatedBill);
      setOperationFeedback(
        updatedBill.id === bill.id
          ? `${actionLabel}已完成。`
          : `${actionLabel}已完成，已跳转到新账单。`,
      );
      setBillActionTarget(null);

      if (updatedBill.id !== bill.id) {
        router.replace(`/billing/${encodeURIComponent(updatedBill.id)}`);
      }
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : "账单异常处理失败，请稍后重试。",
      );
    } finally {
      setSubmittingBillAction(false);
    }
  }

  if (!loading && !bill) {
    return (
      <DetailPageTemplate
        className="vx-product-capability-page"
        header={
          <PageHeader
            icon="key"
            title="账单详情"
            description="未找到对应的账单记录。"
            action={
              <Button asChild variant="outline">
                <Link href="/billing">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title="账单不存在"
          description="该账单可能已归档，或当前账号无权访问。"
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="vx-product-capability-page vx-billing-detail-page"
      header={
        <PageHeader
          icon="key"
          title={bill ? bill.billNo : "账单详情"}
          description={
            bill
              ? `${bill.tenantName} · ${bill.servicePlanName ?? t("common.noPlanLinked")} · ${t(`status.invoice.${bill.invoiceStatus}`)}`
              : "正在读取账单、收款和发票登记数据。"
          }
          action={
            <div className="vx-product-capability-actions">
              <Button asChild variant="outline">
                <Link href="/billing">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              {bill?.subscriptionId ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/orders/${encodeURIComponent(bill.subscriptionId)}`}
                  >
                    <Icon name="table" size="xs" fallback="placeholder" />
                    订单详情
                  </Link>
                </Button>
              ) : null}
              {bill ? (
                <>
                  {(
                    [
                      "mark_overdue",
                      "discount",
                      "create_adjustment",
                      "create_supplement",
                      "cancel",
                    ] as const
                  ).map((action) => (
                    <Button
                      key={action}
                      variant="outline"
                      className={
                        action === "cancel"
                          ? "vx-subscription-action-button--danger"
                          : undefined
                      }
                      onClick={() => requestBillAction(action)}
                      disabled={!canRunBillingBillAction(action, bill)}
                      title={
                        billingBillActionDisabledReason(action, bill) ??
                        undefined
                      }
                    >
                      <Icon
                        name={
                          action === "cancel"
                            ? "warning"
                            : action === "mark_overdue"
                              ? "clock"
                              : action === "discount"
                                ? "chart-bar"
                                : action === "create_adjustment"
                                  ? "edit"
                                  : "plus"
                        }
                        size="xs"
                        fallback="placeholder"
                      />
                      {billingBillActionLabel(action)}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOperationError(null);
                      setOperationFeedback(null);
                      setInvoiceDialogOpen(true);
                    }}
                    disabled={!canSyncOfflineInvoice(bill)}
                    title={offlineInvoiceDisabledReason(bill) ?? undefined}
                  >
                    <Icon name="key" size="xs" fallback="placeholder" />
                    登记发票
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
      }
    >
      {operationFeedback ? (
        <div className="vx-subscription-operation-feedback">
          {operationFeedback}
        </div>
      ) : null}

      {bill ? (
        <>
          <BillingSummary bill={bill} />
          <BillingDetails bill={bill} onReceiptAction={requestReceiptAction} />
        </>
      ) : (
        <section className="vx-tenant-directory__header">
          <span>{tShared("common.loading")}</span>
        </section>
      )}

      {bill && invoiceDialogOpen ? (
        <OfflineInvoiceDialog
          bill={bill}
          busy={submittingInvoice}
          error={operationError}
          onCancel={() => {
            if (!submittingInvoice) setInvoiceDialogOpen(false);
          }}
          onSubmit={handleSyncOfflineInvoice}
        />
      ) : null}

      {bill && receiptActionTarget ? (
        <InvoiceReceiptActionDialog
          receipt={receiptActionTarget.receipt}
          action={receiptActionTarget.action}
          busy={submittingReceiptAction}
          error={operationError}
          onCancel={() => {
            if (!submittingReceiptAction) setReceiptActionTarget(null);
          }}
          onSubmit={handleSubmitReceiptAction}
        />
      ) : null}

      {bill && billActionTarget ? (
        <BillingBillActionDialog
          bill={bill}
          action={billActionTarget}
          busy={submittingBillAction}
          error={operationError}
          onCancel={() => {
            if (!submittingBillAction) setBillActionTarget(null);
          }}
          onSubmit={handleSubmitBillAction}
        />
      ) : null}
    </DetailPageTemplate>
  );
}
