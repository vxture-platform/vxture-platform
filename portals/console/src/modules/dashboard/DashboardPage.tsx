"use client";

/**
 * DashboardPage.tsx — 工作台首页(批 4 收口)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 三格摘要(套餐 / 配额健康度 / 待处理)+ 三张入口卡 + 最近账单 + 配额态势。
 * 此前「最近发票」读的是待退役的 /api/billing/invoices 透传(字段名与账单页对不上,
 * 状态列还是英文首字母大写),「配额态势」是一块永久占位——批 4:账单读同一份
 * /api/billing/bills 的最近 5 张,配额画真实读数(与租户面板同源 /quota-usage)。
 * 读全部 allSettled:一路失败只让它自己那块显影为「—」/ 读取失败,并给一次重试。
 * 各块按能力码显隐(billing.read / quota.read),没码的人不发那一路读。
 */

import { useEffect, useMemo, useState } from "react";
import { getPathname, useRouter } from "@/lib/i18n/navigation";
import {
  Button,
  DashboardTemplate,
  DataTable,
  EmptyState,
  EntryCard,
  Icon,
  Progress,
  StatusBadge,
  ViewHeader,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  IconName,
  StatusBadgeTone,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  fetchBillingSummary,
  fetchBills,
  fetchMyOrders,
  fetchMySubscriptions,
  fetchQuotaUsage,
  type ConsoleBill,
  type ConsoleBillingSummary,
  type ConsoleQuotaUsage,
  type ConsoleSubscription,
  type MyOrder,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useLocale, useTranslations } from "next-intl";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection, SummaryStrip } from "@/layout/shell";
import { fmtDate } from "@/modules/commerce/components/hubModel";
import { fmtCount, formatBytes } from "@/lib/format-metrics";

const RECENT_BILLS = 5;

/** bill_status 六值域 → 徽章语气(与账单页同一张表)。 */
const BILL_STATUS_TONES: Record<string, StatusBadgeTone> = {
  unpaid: "warning",
  paying: "info",
  partial: "info",
  paid: "success",
  overdue: "warning",
  cancelled: "neutral",
};
const KNOWN_BILL_STATUSES = new Set(Object.keys(BILL_STATUS_TONES));

type QuotaRow = {
  key: "storage" | "aiCredit";
  used: number;
  limit: number;
};

export function DashboardPage() {
  const { session } = useConsoleSession();
  const t = useTranslations("dashboard");
  const tBilling = useTranslations("billingPage");
  // localePrefix="always":EntryCard 是个原生 <a>,不能套在 next-intl 的 Link
  // 里(<a> 嵌 <a> 非法),所以自己把 locale 前缀拼进 href。
  const locale = useLocale();
  const router = useRouter();

  const canSeeBilling = hasCapability(
    session.capabilities,
    "tenant.billing.read",
  );
  const canSeeQuota = hasCapability(session.capabilities, "tenant.quota.read");

  const [bills, setBills] = useState<ConsoleBill[]>([]);
  const [summary, setSummary] = useState<ConsoleBillingSummary | null>(null);
  const [subscriptions, setSubscriptions] = useState<ConsoleSubscription[]>([]);
  const [quota, setQuota] = useState<ConsoleQuotaUsage | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<{
    bills: boolean;
    summary: boolean;
    quota: boolean;
    any: boolean;
  }>({ bills: false, summary: false, quota: false, any: false });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const skip = <T,>(value: T) => Promise.resolve(value);
    void Promise.allSettled([
      canSeeBilling ? fetchBills(1, RECENT_BILLS) : skip(null),
      canSeeBilling ? fetchBillingSummary() : skip(null),
      canSeeBilling ? fetchMySubscriptions() : skip([]),
      canSeeQuota ? fetchQuotaUsage() : skip(null),
      canSeeBilling ? fetchMyOrders() : skip([]),
    ])
      .then(([billsRes, summaryRes, subsRes, quotaRes, ordersRes]) => {
        if (!active) return;
        setBills(
          billsRes.status === "fulfilled" ? (billsRes.value?.items ?? []) : [],
        );
        setSummary(summaryRes.status === "fulfilled" ? summaryRes.value : null);
        setSubscriptions(subsRes.status === "fulfilled" ? subsRes.value : []);
        setQuota(quotaRes.status === "fulfilled" ? quotaRes.value : null);
        setOrders(ordersRes.status === "fulfilled" ? ordersRes.value : []);
        const f = {
          bills: billsRes.status === "rejected",
          summary: summaryRes.status === "rejected",
          quota: quotaRes.status === "rejected",
          any: false,
        };
        f.any =
          f.bills ||
          f.summary ||
          f.quota ||
          subsRes.status === "rejected" ||
          ordersRes.status === "rejected";
        setFailed(f);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, canSeeBilling, canSeeQuota, reloadKey]);

  const money = (v: string, currency: string) =>
    formatCurrency(Number.parseFloat(v || "0"), locale as Locale, currency);

  const activeSubscription =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];
  const aiCredit = quota?.aiCredit;
  const quotaPct =
    aiCredit && aiCredit.limit > 0
      ? `${Math.round((aiCredit.used / aiCredit.limit) * 100)}%`
      : null;
  /* 待处理 = 待付订单 + 待收款账单(概览的 unpaid + overdue,库内计数,不再只数
   * 最近 5 张)。读不到就是「—」,不是 0。 */
  const openItems =
    summary === null && failed.summary
      ? null
      : orders.filter((o) => o.orderStatus === "pending_payment").length +
        (summary ? summary.unpaid + summary.overdue : 0);

  const quickActions = [
    { id: "addMember", href: "/members", icon: "users" },
    { id: "reviewSubscription", href: "/subscription", icon: "chart-bar" },
    { id: "adjustQuotas", href: "/quotas", icon: "database" },
  ] as const;

  /* Labels stay in i18n; values come from the reads above. No `hint` is
   * passed: the old hints were specific fabricated sentences and there is no
   * endpoint that could produce a true equivalent — a bare true value beats a
   * plausible false sentence. `—` marks "not loaded / not applicable". */
  const summaryItems = [
    {
      label: t("stats.plan.label"),
      value: activeSubscription?.planName ?? "—",
      aside: <Icon name="medal" size="sm" fallback="info" />,
    },
    {
      label: t("stats.quota.label"),
      value: quotaPct ?? (failed.quota ? t("stats.quota.unavailable") : "—"),
      aside: <Icon name="chart-bar" size="sm" fallback="info" />,
    },
    {
      label: t("stats.reminders.label"),
      value: openItems === null ? "—" : String(openItems),
      aside: <Icon name="warning" size="sm" fallback="info" />,
    },
  ];

  const billColumns: DataTableColumn<ConsoleBill>[] = [
    {
      id: "billNo",
      header: t("bills.headers.billNo"),
      cell: (b) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {b.billNo}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {fmtDate(b.createdAt)}
          </span>
        </span>
      ),
    },
    {
      id: "cycle",
      header: t("bills.headers.cycle"),
      cell: (b) =>
        b.cycleStartDate && b.cycleEndDate ? (
          <span className="tabular-nums">
            {fmtDate(b.cycleStartDate)} ~ {fmtDate(b.cycleEndDate)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: t("bills.headers.status"),
      align: "center",
      cell: (b) => (
        <StatusBadge tone={BILL_STATUS_TONES[b.billStatus] ?? "neutral"}>
          {KNOWN_BILL_STATUSES.has(b.billStatus)
            ? tBilling(`status.${b.billStatus}`)
            : b.billStatus}
        </StatusBadge>
      ),
    },
    {
      id: "amount",
      header: t("bills.headers.amount"),
      align: "right",
      cell: (b) => (
        <span className="tabular-nums font-semibold text-foreground">
          {money(b.payableAmount, b.currency)}
        </span>
      ),
    },
  ];

  const quotaRows = useMemo<QuotaRow[]>(
    () =>
      quota
        ? [
            {
              key: "storage",
              used: quota.storage.used,
              limit: quota.storage.limit,
            },
            {
              key: "aiCredit",
              used: quota.aiCredit.used,
              limit: quota.aiCredit.limit,
            },
          ]
        : [],
    [quota],
  );
  const quotaValue = (row: QuotaRow, v: number) =>
    row.key === "storage" ? formatBytes(v) : fmtCount(v);
  const quotaColumns: DataTableColumn<QuotaRow>[] = [
    {
      id: "pool",
      header: t("quotas.headers.pool"),
      cell: (r) => t(`quotas.rows.${r.key}`),
    },
    {
      id: "usage",
      header: t("quotas.headers.usage"),
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-baseline gap-xs tabular-nums">
          <span className="text-info-text">{quotaValue(r, r.used)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground">{quotaValue(r, r.limit)}</span>
        </span>
      ),
    },
    {
      id: "share",
      header: t("quotas.headers.share"),
      width: "md",
      cell: (r) => (
        <Progress
          value={
            r.limit > 0
              ? Math.min(100, Math.round((r.used / r.limit) * 100))
              : 0
          }
          aria-label={t("quotas.headers.share")}
        />
      ),
    },
    {
      id: "status",
      header: t("quotas.headers.status"),
      align: "center",
      cell: (r) => {
        const tight = r.limit > 0 && r.limit - r.used < r.limit * 0.1;
        return (
          <StatusBadge tone={tight ? "warning" : "success"}>
            {tight ? t("quotas.status.tight") : t("quotas.status.ok")}
          </StatusBadge>
        );
      },
    },
  ];

  return (
    /* DashboardTemplate 焊死工作台的阅读顺序:先看数(metrics)、再选路
     * (entries)、最后处理具体事项(children)。 */
    <DashboardTemplate
      header={
        <ViewHeader
          icon="home"
          title={t("title")}
          description={t("description")}
        />
      }
      metrics={
        <div className="flex flex-col gap-md">
          {failed.any ? (
            <LoadFailedBanner
              onRetry={() => setReloadKey((k) => k + 1)}
              retrying={loading}
            />
          ) : null}
          <SummaryStrip items={summaryItems} />
        </div>
      }
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
      {canSeeBilling ? (
        <PageSection
          icon="receipt"
          level={2}
          title={t("bills.title")}
          description={t("bills.description")}
          action={
            <Button
              size="md"
              variant="outline"
              onClick={() => router.push("/billing")}
            >
              <Icon name="arrow-right" size="xs" fallback="placeholder" />
              <span>{t("bills.viewAll")}</span>
            </Button>
          }
        >
          <DataTable<ConsoleBill>
            columns={billColumns}
            rows={bills}
            rowKey={(b) => b.id}
            loading={loading}
            empty={
              failed.bills ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState title={t("bills.empty")} />
              )
            }
            footer={
              <span className="text-body-sm text-muted-foreground tabular-nums">
                {loading || failed.bills
                  ? "—"
                  : t("bills.count", { count: bills.length })}
              </span>
            }
          />
        </PageSection>
      ) : null}

      {canSeeQuota ? (
        <PageSection
          icon="gauge"
          level={2}
          title={t("quotas.title")}
          description={t("quotas.description")}
          action={
            <Button
              size="md"
              variant="outline"
              onClick={() => router.push("/quotas")}
            >
              <Icon name="arrow-right" size="xs" fallback="placeholder" />
              <span>{t("quotas.viewAll")}</span>
            </Button>
          }
        >
          <DataTable<QuotaRow>
            columns={quotaColumns}
            rows={quotaRows}
            rowKey={(r) => r.key}
            loading={loading}
            empty={
              failed.quota ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState title={t("quotas.empty")} />
              )
            }
          />
        </PageSection>
      ) : null}
    </DashboardTemplate>
  );
}
