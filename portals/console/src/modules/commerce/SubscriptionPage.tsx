"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import {
  Banner,
  Button,
  Card,
  CardContent,
  DialogForm,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  DetailList,
  DetailRow,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  Icon,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  cancelSubscriptionOrder,
  executeSubscriptionAction,
  fetchBillingInvoices,
  fetchCredits,
  fetchEntitlements,
  fetchMyOrders,
  fetchMySubscriptions,
  ConsoleBffError,
  type ConsoleInvoice,
  type ConsoleSubscription,
  type MyOrder,
  type SubscriptionLifecycleAction,
  type WorkspaceEntitlement,
} from "@/api/console-bff";
import { PlannedBadge } from "@/components/planned";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SummaryStrip } from "@/layout/shell";
import type { ModuleCardStat } from "@/entities/console";

// ============================================================================
// 数据格式化工具
// ============================================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
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

function formatAmount(amount: number, currency = "CNY"): string {
  return currency === "CNY"
    ? `¥${amount.toLocaleString()}`
    : `${currency} ${amount.toLocaleString()}`;
}

function buildSummaryItems(
  subscriptions: ConsoleSubscription[],
): ModuleCardStat[] {
  const active =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];
  if (!active) {
    return [
      { label: "Plan", value: "—", hint: "No active subscription." },
      { label: "Renewal", value: "—", hint: "—" },
      { label: "Billing", value: "—", hint: "—" },
    ];
  }

  return [
    {
      label: "Plan",
      value: active.planName,
      hint: `${formatAmount(active.price, active.currency)} / ${active.cycle}`,
    },
    {
      label: "Renewal",
      value: formatDate(active.nextBillingDate),
      hint: active.autoRenew ? "Auto-renew enabled" : "Will not auto-renew",
    },
    {
      label: "Status",
      value: active.status.charAt(0).toUpperCase() + active.status.slice(1),
      hint: active.isTrial ? "Trial period active" : "Paid subscription",
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

function formatOrderAmount(amount: string, currency: string): string {
  const n = Number.parseFloat(amount);
  const value = Number.isFinite(n) ? n.toLocaleString() : amount;
  return currency === "CNY" ? `¥${value}` : `${currency} ${value}`;
}

// Six-state contract (product_321 P1); labels come from the orderPay i18n
// namespace at render time (this page's own copy stays the 320-era English
// placeholder debt — the ORDERS tab is the one surface localized here).
const ORDER_STATUS_TONES: Record<MyOrder["orderStatus"], StatusBadgeTone> = {
  pending_payment: "warning",
  paid_pending_verify: "info",
  activating: "info",
  completed: "success",
  cancelled: "neutral",
  expired: "neutral",
};

// C2 subscription-status six-value domain (@vxture/shared SUBSCRIPTION_STATUSES)
// + null = never subscribed (product_220 §3 — absence, not a status value).
const ENTITLEMENT_STATUS_TONES: Record<string, StatusBadgeTone> = {
  active: "success",
  trialing: "info",
  overdue: "warning",
  // A suspended entitlement is a hard stop (access is off), unlike `overdue`
  // which is a grace period — the two read as different severities.
  suspended: "danger",
  expired: "neutral",
  cancelled: "neutral",
};

/**
 * `status: null` means "no standalone (primary) subscription" — it does NOT
 * mean "no access" when `bundled` is true (product_220 §2/§3: a product can
 * carry real bundled-only coverage with no primary subscription of its own,
 * e.g. a raven-pro plan bundling arda). Labeling that combination "Not
 * subscribed" would read as an error to a workspace admin who does have
 * working access via the bundle, so the two facts are distinguished here.
 */
function formatEntitlementStatus(
  status: string | null,
  bundled: boolean,
): string {
  if (status === null) return bundled ? "Bundled access" : "Not subscribed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatTier(tier: string | null): string {
  if (tier === null) return "—";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatLimits(limits: Record<string, number>): string {
  const entries = Object.entries(limits);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => `${key}: ${value === -1 ? "unlimited" : value}`)
    .join(" · ");
}

// ============================================================================
// SubscriptionPage
// ============================================================================

export function SubscriptionPage() {
  const { session } = useConsoleSession();
  const tOrder = useTranslations("orderPay");
  const tManage = useTranslations("manageSubscription");
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "billing" | "orders">("overview");
  const [subscriptions, setSubscriptions] = useState<ConsoleSubscription[]>([]);
  const [invoices, setInvoices] = useState<ConsoleInvoice[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [credits, setCredits] = useState<{
    balance: string;
    currency: string;
  } | null>(null);
  const [entitlements, setEntitlements] = useState<WorkspaceEntitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  /* Subscription lifecycle dialog. `POST /api/subscription/actions` has been
   * live all along with nothing calling it; the header button was inert. Only
   * pause/resume/cancel land here — `upgrade` needs a planId, which is what
   * the /subscribe ladder is for. */
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAction, setManageAction] =
    useState<SubscriptionLifecycleAction>("pause");
  const [manageReason, setManageReason] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageMessage, setManageMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchMySubscriptions(),
      fetchBillingInvoices(10),
      fetchMyOrders(),
      fetchCredits(),
      fetchEntitlements(),
    ])
      .then(([subs, invs, ords, creditRecord, entitlementRecords]) => {
        setSubscriptions(subs);
        setInvoices(invs);
        setOrders(ords);
        setCredits(creditRecord);
        setEntitlements(entitlementRecords);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id]);

  async function handleCancelOrder(orderId: string) {
    setOrderError(null);
    setCancelingId(orderId);
    try {
      await cancelSubscriptionOrder(orderId);
      setOrders(await fetchMyOrders());
    } catch (err) {
      setOrderError(
        err instanceof ConsoleBffError
          ? err.message
          : "Failed to cancel order.",
      );
    } finally {
      setCancelingId(null);
    }
  }

  const summaryItems = buildSummaryItems(subscriptions);
  const invoiceRows = buildInvoiceRows(invoices);

  const activeSubscription =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];

  /** Offer resume for a suspended subscription, pause for a live one. */
  function openManage() {
    setManageAction(
      activeSubscription?.status === "suspended" ? "resume" : "pause",
    );
    setManageReason("");
    setManageError(null);
    setManageMessage(null);
    setManageOpen(true);
  }

  async function submitManage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSubscription) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await executeSubscriptionAction({
        subscriptionId: activeSubscription.id,
        action: manageAction,
        ...(manageReason.trim() ? { reason: manageReason.trim() } : {}),
      });
      setSubscriptions(await fetchMySubscriptions());
      setManageOpen(false);
      setManageMessage(
        manageAction === "pause"
          ? tManage("successPause")
          : manageAction === "resume"
            ? tManage("successResume")
            : tManage("successCancel"),
      );
    } catch (err) {
      setManageError(
        err instanceof ConsoleBffError ? err.message : tManage("error"),
      );
    } finally {
      setManageBusy(false);
    }
  }

  const entitlementColumns: DataTableColumn<WorkspaceEntitlement>[] = [
    { id: "product", header: "Product", cell: (e) => e.productCode },
    { id: "tier", header: "Tier", cell: (e) => formatTier(e.tier) },
    {
      id: "status",
      header: "Status",
      cell: (e) => (
        <StatusBadge
          tone={
            e.status
              ? (ENTITLEMENT_STATUS_TONES[e.status] ?? "neutral")
              : e.bundled
                ? "info"
                : "neutral"
          }
        >
          {formatEntitlementStatus(e.status, e.bundled)}
        </StatusBadge>
      ),
    },
    {
      id: "bundled",
      header: "Bundled",
      cell: (e) => (e.bundled ? "Yes" : "—"),
    },
    { id: "limits", header: "Limits", cell: (e) => formatLimits(e.limits) },
  ];

  // Invoice rows stay pre-formatted `string[]` (see `buildInvoiceRows`); the
  // columns below only carry the header copy that used to live in the hand
  // rolled table header row, in the same order.
  const invoiceColumns: DataTableColumn<string[]>[] = [
    { id: "invoice", header: "Invoice", cell: (row) => row[0] ?? "—" },
    { id: "date", header: "Date", cell: (row) => row[1] ?? "—" },
    { id: "scope", header: "Scope", cell: (row) => row[2] ?? "—" },
    { id: "status", header: "Status", cell: (row) => row[3] ?? "—" },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => row[4] ?? "—",
    },
  ];

  const orderColumns: DataTableColumn<MyOrder>[] = [
    { id: "orderNo", header: "Order no.", cell: (o) => o.orderNo },
    {
      id: "type",
      header: "Type",
      cell: () => tOrder("list.typeSubscription"),
    },
    {
      id: "plan",
      header: "Plan",
      cell: (o) => (o.tier ? `${o.planName} · ${o.tier}` : o.planName),
    },
    {
      id: "cycle",
      header: "Cycle",
      cell: (o) => (o.cycleUnit === "year" ? "Yearly" : "Monthly"),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (o) => (
        <span>
          {formatOrderAmount(o.amount, o.currency)}
          {Number(o.voucherOff) > 0 ? (
            <span className="text-body-sm text-muted-foreground">
              {" "}
              {tOrder("list.voucherOff", {
                amount: formatOrderAmount(o.voucherOff, o.currency),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (o) => (
        <StatusBadge tone={ORDER_STATUS_TONES[o.orderStatus]}>
          {tOrder(`status.${o.orderStatus}`)}
        </StatusBadge>
      ),
    },
    { id: "placed", header: "Placed", cell: (o) => formatDate(o.createdAt) },
    {
      id: "action",
      header: " ",
      align: "right",
      cell: (o) =>
        o.orderStatus === "pending_payment" ? (
          <span className="flex items-center justify-end gap-2xs">
            <Button
              size="md"
              onClick={() => router.push(`/subscribe/pay/${o.orderId}`)}
            >
              {tOrder("list.payNow")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={cancelingId === o.orderId || Number(o.paidAmount) > 0}
              onClick={() => handleCancelOrder(o.orderId)}
            >
              {cancelingId === o.orderId ? "Canceling…" : "Cancel"}
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="md"
            onClick={() => router.push(`/subscribe/pay/${o.orderId}`)}
          >
            {tOrder("list.view")}
          </Button>
        ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-bar"
        title="Subscription"
        description="Surface current plan, renewal timing, and pooled resource posture before dropping into billing records."
        action={
          <Button
            size="md"
            disabled={!activeSubscription}
            onClick={() => openManage()}
          >
            <Icon name="settings" size="xs" fallback="placeholder" />
            <span>{tManage("title")}</span>
          </Button>
        }
      />

      {manageMessage ? <Banner tone="success" title={manageMessage} /> : null}

      <SummaryStrip items={summaryItems} />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="flex flex-col gap-lg"
      >
        <TabsList aria-label="Subscription tabs" className="self-start">
          <TabsTrigger value="overview">Plan overview</TabsTrigger>
          <TabsTrigger value="billing">Recent billing</TabsTrigger>
          <TabsTrigger value="orders">My orders</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-xl">
          <PageSection
            icon="package"
            level={2}
            title="Current package"
            description="A modern SaaS billing page starts with the plan, not the table."
          >
            {loading ? (
              <EmptyState icon="clock" title="Loading subscription…" />
            ) : activeSubscription ? (
              <Card surface="soft">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <CardTitle>{activeSubscription.planName}</CardTitle>
                    <StatusBadge tone="success">
                      {activeSubscription.status}
                    </StatusBadge>
                  </div>
                </CardHeader>
                <CardContent>
                  <DetailList>
                    <DetailRow label="Renewal">
                      {formatDate(activeSubscription.nextBillingDate)}
                    </DetailRow>
                    <DetailRow label="Price">
                      {formatAmount(
                        activeSubscription.price,
                        activeSubscription.currency,
                      )}{" "}
                      / {activeSubscription.cycle}
                    </DetailRow>
                  </DetailList>
                </CardContent>
                <CardFooter className="flex-wrap">
                  {/* "Compare tiers" is just navigation — the plan ladder is
                   * the /subscribe page, so this now goes there instead of
                   * doing nothing. */}
                  <Button
                    size="md"
                    variant="outline"
                    onClick={() => router.push("/subscribe")}
                  >
                    <Icon name="chart-bar" size="xs" fallback="placeholder" />
                    <span>{tManage("goUpgrade")}</span>
                  </Button>
                  {/* Renewal preview has no endpoint; kept visible so the
                   * intent is legible, disabled so it cannot lie. */}
                  <Button size="md" variant="outline" disabled>
                    <Icon name="calendar" size="xs" fallback="placeholder" />
                    <span>Preview renewal</span>
                  </Button>
                  <PlannedBadge />
                </CardFooter>
              </Card>
            ) : (
              <EmptyState
                icon="package"
                title="No active subscription found."
              />
            )}
          </PageSection>

          <PageSection
            icon="seal-check"
            level={2}
            title="Current entitlements"
            description="Per-product tier, status, and pooled-resource ceilings resolved from the platform's commercial contract (product_220 §3)."
          >
            <DataTable
              columns={entitlementColumns}
              rows={entitlements}
              rowKey={(e) => e.productCode}
              loading={loading}
              empty={<EmptyState title="No product entitlements yet." />}
            />
          </PageSection>

          <PageSection
            icon="wallet"
            level={2}
            title={tOrder("list.creditsTitle")}
            description={tOrder("list.creditsNote")}
          >
            {/* Dormant wallet (product_321 P6): read-only balance, no top-up. */}
            <Card surface="soft">
              <CardContent>
                <strong className="text-title-lg text-foreground">
                  {formatOrderAmount(
                    credits?.balance ?? "0.00",
                    credits?.currency ?? "CNY",
                  )}
                </strong>
              </CardContent>
            </Card>
          </PageSection>
        </TabsContent>

        <TabsContent value="billing">
          <PageSection
            icon="receipt"
            level={2}
            title="Recent charges"
            description="Invoices and overage records remain secondary to the subscription overview."
          >
            <DataTable
              columns={invoiceColumns}
              rows={invoiceRows}
              rowKey={(row) => row[0] ?? ""}
              loading={loading}
              empty={<EmptyState title="No invoices found." />}
            />
          </PageSection>
        </TabsContent>

        <TabsContent value="orders">
          <PageSection
            icon="list-checks"
            level={2}
            title="My orders"
            description="Offline subscription orders you placed — track the order number, transfer status, and cancel one that is still awaiting confirmation."
          >
            {orderError ? <Banner tone="danger" title={orderError} /> : null}
            <DataTable
              columns={orderColumns}
              rows={orders}
              rowKey={(order) => order.orderId}
              loading={loading}
              empty={<EmptyState title="No orders yet." />}
            />
          </PageSection>
        </TabsContent>
      </Tabs>

      <DialogForm
        open={manageOpen}
        onOpenChange={(open) => {
          if (!open) setManageOpen(false);
        }}
        title={tManage("title")}
        description={tManage("description")}
        submitLabel={tManage("confirm")}
        cancelLabel={tManage("cancel")}
        danger={manageAction === "cancel"}
        submitting={manageBusy}
        submitDisabled={!activeSubscription}
        onSubmit={submitManage}
      >
        {manageError ? <Banner tone="danger" title={manageError} /> : null}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="manage-action">{tManage("title")}</FieldLabel>
            <NativeSelect
              id="manage-action"
              value={manageAction}
              onChange={(event) =>
                setManageAction(
                  event.target.value as SubscriptionLifecycleAction,
                )
              }
            >
              {/* Resume only makes sense for a suspended subscription, pause
               * only for a running one — the two are mutually exclusive. */}
              {activeSubscription?.status === "suspended" ? (
                <option value="resume">{tManage("actionResume")}</option>
              ) : (
                <option value="pause">{tManage("actionPause")}</option>
              )}
              <option value="cancel">{tManage("actionCancel")}</option>
            </NativeSelect>
            <FieldDescription>
              {manageAction === "pause"
                ? tManage("actionPauseHint")
                : manageAction === "resume"
                  ? tManage("actionResumeHint")
                  : tManage("actionCancelHint")}
            </FieldDescription>
          </Field>

          {manageAction !== "resume" ? (
            <Field>
              <FieldLabel htmlFor="manage-reason">
                {tManage("reasonLabel")}
              </FieldLabel>
              <Input
                id="manage-reason"
                value={manageReason}
                onChange={(event) => setManageReason(event.target.value)}
              />
            </Field>
          ) : null}

          <FieldDescription>{tManage("upgradeHint")}</FieldDescription>
        </FieldGroup>
      </DialogForm>
    </ViewLayout>
  );
}
