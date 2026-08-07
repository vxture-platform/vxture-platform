"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import {
  fetchBillingInvoices,
  fetchBillingOverview,
  type ConsoleBillingOverview,
  type ConsoleInvoice,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PlannedBadge } from "@/components/planned";
import { PageSection, SignalList } from "@/layout/shell";
import type { SummaryMetric } from "@/entities/console";

// ============================================================================
// 数据格式化工具
// ============================================================================

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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function buildBillingMetrics(
  overview: ConsoleBillingOverview | null,
): SummaryMetric[] {
  if (!overview) {
    return [
      {
        id: "outstanding",
        label: "Outstanding",
        value: "—",
        trend: "No data",
        tone: "neutral",
      },
      {
        id: "paid-this-cycle",
        label: "Paid this cycle",
        value: "—",
        trend: "—",
        tone: "neutral",
      },
      {
        id: "active-subscriptions",
        label: "Active subscriptions",
        value: "—",
        trend: "—",
        tone: "neutral",
      },
    ];
  }

  const overdueLabel =
    overview.overdueInvoices > 0
      ? `${overview.overdueInvoices} overdue`
      : "All paid";

  return [
    {
      id: "pending-invoices",
      label: "Pending invoices",
      value: String(overview.pendingInvoices),
      trend: overdueLabel,
      tone: overview.overdueInvoices > 0 ? "warning" : "success",
    },
    {
      id: "total-paid",
      label: "Total paid",
      value: formatAmount(overview.totalRevenue),
      trend: `${overview.paidInvoices} invoices paid`,
      tone: "success",
    },
    {
      id: "active-subscriptions",
      label: "Active subscriptions",
      value: String(overview.activeSubscriptions),
      trend: `${overview.totalInvoices} invoices total`,
      tone: "neutral",
    },
  ];
}

function buildInvoiceRows(invoices: ConsoleInvoice[]): string[][] {
  return invoices.map((inv) => [
    inv.invoiceNumber,
    formatDate(inv.dueDate),
    inv.lineItems[0]?.description ?? "—",
    inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
    formatAmount(inv.totalAmount, inv.currency),
  ]);
}

const invoiceColumns: DataTableColumn<string[]>[] = [
  { id: "invoice", header: "Invoice", cell: (row) => row[0] },
  { id: "date", header: "Date", cell: (row) => row[1] },
  { id: "scope", header: "Scope", cell: (row) => row[2] },
  { id: "status", header: "Status", cell: (row) => row[3] },
  { id: "amount", header: "Amount", cell: (row) => row[4], align: "right" },
];

// ============================================================================
// BillingPage
// ============================================================================

export function BillingPage() {
  const { session } = useConsoleSession();
  const [overview, setOverview] = useState<ConsoleBillingOverview | null>(null);
  const [invoices, setInvoices] = useState<ConsoleInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchBillingOverview(), fetchBillingInvoices(10)])
      .then(([ov, invs]) => {
        setOverview(ov);
        setInvoices(invs);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id]);

  const billingMetrics = buildBillingMetrics(loading ? null : overview);
  const invoiceRows = buildInvoiceRows(invoices);

  const healthSignals = [
    {
      title: "Billing health",
      description: loading
        ? "Loading billing status…"
        : overview
          ? `${overview.paidInvoices} invoices paid, ${overview.pendingInvoices} pending, ${overview.overdueInvoices} overdue.`
          : "No billing data available.",
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="calendar"
        title="Billing"
        description="Invoices, payment instruments, and charge visibility in a layout that feels like SaaS operations rather than ERP."
        secondary={<PlannedBadge />}
        action={
          /* No statement-export endpoint exists. Kept visible so the intent is
           * legible, disabled so it cannot pretend to work. */
          <Button size="md" disabled>
            <Icon name="arrow-down" size="xs" fallback="placeholder" />
            <span>Download statement</span>
          </Button>
        }
      />

      <MetricGrid items={billingMetrics} />

      <PageSection
        icon="gauge"
        level={2}
        title="Billing health"
        description="Lead with due-state context before expanding into invoice history."
      >
        <SignalList items={healthSignals} />
      </PageSection>

      <PageSection
        icon="receipt"
        level={2}
        title="Recent invoices"
        description="Keep the table focused on the most recent invoice and overage records."
      >
        <DataTable
          columns={invoiceColumns}
          rows={invoiceRows}
          rowKey={(row, index) => row[0] ?? String(index)}
          loading={loading}
          empty={<EmptyState title="No invoices found." />}
        />
      </PageSection>
    </ViewLayout>
  );
}
