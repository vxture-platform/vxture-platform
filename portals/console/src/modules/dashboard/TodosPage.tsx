"use client";

/**
 * TodosPage.tsx — 待办事项(P1 占位页落地,owner 2026-08-21)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 派生型待办(不建表,不落状态):从既有读端点现算「需要人处理的事」——
 * 待付订单(TTL 内去支付)/ 即将到期订阅(≤7 天续订)/ 配额吃紧(存储
 * <10% 或 credits 用尽 → 加油包)/ 待处理邀请(组织租户,member.manage
 * 持有者)/ 待申报加油包单。处理完自然消失,不需要勾选完成。
 * spec 00-index 的 /todos 为「待确认」——本实现即其落地口径,与 admin
 * ops-todos 不共数据源(那是运营队列)。表格遵守默认结构。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import {
  fetchInvitations,
  fetchMyOrders,
  fetchQuotaOverview,
  fetchSubscribedProducts,
  type ConsoleQuotaOverview,
  type MyOrder,
  type SubscribedProduct,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { PageSection, SignalList } from "@/layout/shell";
import { daysLeft, fmtDate } from "@/modules/commerce/components/hubModel";

interface TodoRow {
  key: string;
  kind: "payment" | "renewal" | "quota" | "invitation" | "addon";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

const RENEW_THRESHOLD_DAYS = 7;

export function TodosPage() {
  const t = useTranslations("todosPage");
  const router = useRouter();
  const { session } = useConsoleSession();
  const canManageMembers = hasCapability(
    session.capabilities,
    "tenant.user.manage",
  );
  const canSeeCommerce = hasCapability(
    session.capabilities,
    "tenant.subscription.read",
  );

  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [subs, setSubs] = useState<SubscribedProduct[]>([]);
  const [quota, setQuota] = useState<ConsoleQuotaOverview | null>(null);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      canSeeCommerce ? fetchMyOrders() : Promise.resolve([]),
      canSeeCommerce ? fetchSubscribedProducts() : Promise.resolve([]),
      fetchQuotaOverview(),
      canManageMembers ? fetchInvitations() : Promise.resolve([]),
    ])
      .then(([ords, products, quotaOverview, invites]) => {
        setOrders(ords);
        setSubs(products);
        setQuota(quotaOverview);
        setPendingInvites(invites.filter((i) => i.status === "pending").length);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id, canManageMembers, canSeeCommerce]);

  const todos = useMemo<TodoRow[]>(() => {
    const rows: TodoRow[] = [];
    for (const o of orders) {
      if (o.orderStatus === "pending_payment") {
        rows.push({
          key: `pay:${o.orderNo}`,
          kind: "payment",
          title: t("items.payTitle", { product: o.productName ?? o.planName }),
          detail: o.expireAt
            ? t("items.payDetail", { date: fmtDate(o.expireAt) })
            : t("items.payDetailNoTtl"),
          href: `/subscribe/pay/${o.orderId}`,
          actionLabel: t("items.payAction"),
        });
      }
    }
    for (const s of subs) {
      const left = daysLeft(s.endAt);
      if (
        s.status !== "expired" &&
        left != null &&
        left <= RENEW_THRESHOLD_DAYS
      ) {
        rows.push({
          key: `renew:${s.subscriptionId}`,
          kind: "renewal",
          title: t("items.renewTitle", {
            product: s.productName ?? s.planName,
          }),
          detail: t("items.renewDetail", { days: left }),
          href: `/subscribe?product=${s.productCode ?? ""}&intent=renew`,
          actionLabel: t("items.renewAction"),
        });
      }
    }
    if (quota) {
      const st = quota.storage;
      if (st.limitBytes > 0 && st.remainingBytes < st.limitBytes * 0.1) {
        rows.push({
          key: "quota:storage",
          kind: "quota",
          title: t("items.storageTitle"),
          detail: t("items.storageDetail"),
          href: "/quotas",
          actionLabel: t("items.quotaAction"),
        });
      }
      const cr = quota.aiCredit;
      if (cr.limit > 0 && cr.remaining <= 0) {
        rows.push({
          key: "quota:credits",
          kind: "quota",
          title: t("items.creditsTitle"),
          detail: t("items.creditsDetail"),
          href: "/quotas",
          actionLabel: t("items.quotaAction"),
        });
      }
    }
    if (pendingInvites > 0) {
      rows.push({
        key: "invitations",
        kind: "invitation",
        title: t("items.invitesTitle", { count: pendingInvites }),
        detail: t("items.invitesDetail"),
        href: "/invitations",
        actionLabel: t("items.invitesAction"),
      });
    }
    return rows;
  }, [orders, subs, quota, pendingInvites, t]);

  const columns: DataTableColumn<TodoRow>[] = [
    {
      id: "kind",
      header: t("table.colKind"),
      align: "center",
      cell: (r) => <Badge variant="outline">{t(`kind.${r.kind}`)}</Badge>,
    },
    {
      id: "title",
      header: t("table.colTitle"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-foreground">{r.title}</span>
          <span className="text-body-sm text-muted-foreground">{r.detail}</span>
        </span>
      ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="list-checks"
        title={t("title")}
        description={t("description")}
      />

      <PageSection
        icon="list-checks"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <DataTable<TodoRow>
          columns={columns}
          rows={todos}
          rowKey={(r) => r.key}
          loading={loading}
          indexStart={1}
          rowActions={(r) => (
            <Button size="sm" onClick={() => router.push(r.href)}>
              {r.actionLabel}
            </Button>
          )}
          empty={
            <EmptyState
              title={t("table.empty")}
              description={t("table.emptyHint")}
            />
          }
        />
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            {
              title: t("notes.derivedTitle"),
              description: t("notes.derivedBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
