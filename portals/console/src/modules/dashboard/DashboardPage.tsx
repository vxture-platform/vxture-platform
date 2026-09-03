"use client";

import { useEffect, useState } from "react";
import { getPathname, useRouter } from "@/lib/i18n/navigation";
import {
  Button,
  DashboardTemplate,
  DataTable,
  EmptyState,
  EntryCard,
  Icon,
  ViewHeader,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import {
  fetchBillingInvoices,
  fetchMyOrders,
  fetchMySubscriptions,
  fetchQuotaUsage,
  type ConsoleInvoice,
  type ConsoleQuotaUsage,
  type ConsoleSubscription,
  type MyOrder,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useLocale, useTranslations } from "next-intl";
import { PageSection, SummaryStrip } from "@/layout/shell";

// ============================================================================
// 数据格式化工具
// ============================================================================

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言。这一处用的是
   `month: "short"`，中英差得更远——`8月18日` 对 `Aug 18, 2026`。 */
function formatDate(dateStr: string, locale: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatAmount(amount: number, currency = "CNY"): string {
  const n = Number(amount);
  const value = Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
  return currency === "CNY" ? `¥${value}` : `${currency} ${value}`;
}

/* 也收 `locale` 往下传：它自己是纯函数，但里头调的 `formatDate` 现在按语言排
   日期。这是「模块级辅助函数拿不到运行时上下文」的标准形态——上提到调用点
   由组件传，比在这里读一个全局状态可靠（服务端并发渲染会串）。 */
function buildInvoiceRows(
  invoices: ConsoleInvoice[],
  locale: string,
): string[][] {
  return invoices.map((inv) => [
    inv.invoiceNumber,
    formatDate(inv.dueDate, locale),
    inv.lineItems[0]?.description ?? "—",
    inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
    formatAmount(inv.totalAmount, inv.currency),
  ]);
}

function invoiceColumns(
  t: ReturnType<typeof useTranslations>,
): DataTableColumn<string[]>[] {
  return [
    {
      id: "invoice",
      header: t("invoices.headers.invoice"),
      cell: (row) => row[0],
    },
    { id: "date", header: t("invoices.headers.date"), cell: (row) => row[1] },
    { id: "scope", header: t("invoices.headers.scope"), cell: (row) => row[2] },
    {
      id: "status",
      header: t("invoices.headers.status"),
      cell: (row) => row[3],
    },
    {
      id: "amount",
      header: t("invoices.headers.amount"),
      cell: (row) => row[4],
      align: "right",
    },
  ];
}

// ============================================================================
// DashboardPage
// ============================================================================

export function DashboardPage() {
  const { session } = useConsoleSession();
  const t = useTranslations("dashboard");
  // localePrefix="always"：EntryCard 是个原生 <a>，不能套在 next-intl 的 Link
  // 里（<a> 嵌 <a> 非法），所以自己把 locale 前缀拼进 href。
  const locale = useLocale();
  const router = useRouter();
  const [invoices, setInvoices] = useState<ConsoleInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<ConsoleSubscription[]>([]);
  const [quota, setQuota] = useState<ConsoleQuotaUsage | null>(null);
  /* fetchQuotaUsage 是 strict 读（失败即 reject，2026-08-30）：把「读不到」和
   * 「还没读」分开——前者要在卡片上明说，不能和 0% 或 — 混在一起。 */
  const [quotaUnavailable, setQuotaUnavailable] = useState(false);
  const [orders, setOrders] = useState<MyOrder[]>([]);

  useEffect(() => {
    setInvoicesLoading(true);
    fetchBillingInvoices(5)
      .then(setInvoices)
      .finally(() => setInvoicesLoading(false));
  }, [session.tenant?.id]);

  /* The three summary tiles used to render i18n literals — "Growth", "78%",
   * "3" — presented as this tenant's own plan, quota and pending items. They
   * are computed from live reads now; allSettled so one failing endpoint
   * blanks only its own tile. */
  useEffect(() => {
    void Promise.allSettled([
      fetchMySubscriptions(),
      fetchQuotaUsage(),
      fetchMyOrders(),
    ]).then(([subs, q, ord]) => {
      if (subs.status === "fulfilled") setSubscriptions(subs.value);
      if (q.status === "fulfilled") {
        setQuota(q.value);
        setQuotaUnavailable(false);
      } else {
        setQuota(null);
        setQuotaUnavailable(true);
      }
      if (ord.status === "fulfilled") setOrders(ord.value);
    });
  }, [session.tenant?.id]);

  const activeSubscription =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];
  const aiCredit = quota?.aiCredit;
  const quotaPct =
    aiCredit && aiCredit.limit > 0
      ? `${Math.round((aiCredit.used / aiCredit.limit) * 100)}%`
      : null;
  const openItems =
    orders.filter((o) => o.orderStatus === "pending_payment").length +
    invoices.filter((i) => i.status === "pending").length;

  const quickActions = [
    { id: "addMember", href: "/members", icon: "users" },
    { id: "reviewSubscription", href: "/subscription", icon: "chart-bar" },
    { id: "adjustQuotas", href: "/quotas", icon: "database" },
  ] as const;

  /* Labels stay in i18n; values come from the reads above. No `hint` is
   * passed: the old hints were specific fabricated sentences ("renews on
   * 2026-05-18", "GPU fine-tuning is near its threshold") and there is no
   * endpoint that could produce a true equivalent — a bare true value beats a
   * plausible false sentence. `—` marks "not loaded / not applicable" rather
   * than inventing a number. */
  const summaryItems = [
    {
      label: t("stats.plan.label"),
      value: activeSubscription?.planName ?? "—",
      aside: <Icon name="medal" size="sm" fallback="info" />,
    },
    {
      label: t("stats.quota.label"),
      value:
        quotaPct ?? (quotaUnavailable ? t("stats.quota.unavailable") : "—"),
      aside: <Icon name="chart-bar" size="sm" fallback="info" />,
    },
    {
      label: t("stats.reminders.label"),
      value: String(openItems),
      aside: <Icon name="warning" size="sm" fallback="info" />,
    },
  ];

  const invoiceRows = buildInvoiceRows(invoices, locale);
  const invoiceTableColumns = invoiceColumns(t);

  return (
    /* DashboardTemplate 焊死工作台的阅读顺序：先看数（metrics）、再选路
     * （entries）、最后处理具体事项（children）。原实现把「快捷入口」和
     * 「信号」并排塞在同一层，入口卡因此沉在指标下方与正文同级——这里让它
     * 回到模板的 entries 槽。 */
    <DashboardTemplate
      header={
        <ViewHeader
          icon="home"
          title={t("title")}
          description={t("description")}
        />
      }
      metrics={<SummaryStrip items={summaryItems} />}
      entries={
        <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => (
            <EntryCard
              key={action.id}
              href={getPathname({ href: action.href, locale })}
              icon={action.icon as IconName}
              title={t(`quickActions.${action.id}.label`)}
              description={t(`quickActions.${action.id}.description`)}
            />
          ))}
        </div>
      }
    >
      <PageSection
        icon="receipt"
        level={2}
        title={t("invoices.title")}
        description={t("invoices.description")}
        action={
          /* Was inert. It is navigation, not a feature — point it at the
           * billing page instead of leaving a button that does nothing. */
          <Button
            size="md"
            variant="outline"
            onClick={() => router.push("/billing")}
          >
            <Icon name="arrow-right" size="xs" fallback="placeholder" />
            <span>{t("signals.billing.title")}</span>
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-sm">
          <span className="text-label-sm text-muted-foreground">
            {invoicesLoading
              ? t("invoices.loading")
              : t("invoices.count", { count: invoiceRows.length })}
          </span>
          <span className="text-label-sm text-muted-foreground">
            {t("invoices.headers.scope")}
          </span>
        </div>
        <DataTable
          columns={invoiceTableColumns}
          rows={invoiceRows}
          rowKey={(row, index) => row[0] ?? String(index)}
          loading={invoicesLoading}
          empty={<EmptyState title={t("invoices.empty")} />}
        />
      </PageSection>

      <PageSection
        icon="gauge"
        level={2}
        title={t("quotas.title")}
        description={t("quotas.description")}
      >
        <EmptyState
          icon="chart-bar"
          title={t("quotas.pendingTitle")}
          description={t("quotas.pendingDescription")}
        />
      </PageSection>
    </DashboardTemplate>
  );
}
