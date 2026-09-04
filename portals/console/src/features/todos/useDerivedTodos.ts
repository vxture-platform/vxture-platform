"use client";

/**
 * useDerivedTodos — 派生型待办(批 4b:从 TodosPage 抽出,供「待办与消息」页与壳层共用)。
 * @package @vxture/console
 * @layer Application
 * @category Feature
 *
 * 待办不建表、不落状态:从既有读端点现算「需要人处理的事」——待付订单(TTL 内去
 * 支付)/ 即将到期订阅(≤7 天续订)/ 配额吃紧(存储 <10% 或 credits 用尽 → 加油包)/
 * 待处理邀请(member.manage 持有者)/ 待申报加油包单。处理完自然消失,没有已读,
 * 未处理一直显示(owner 2026-09-04 裁定)。按能力码决定发哪几路读;allSettled,
 * 一路失败只丢它自己那一类,但 `partialFailed` 要告诉用户「列表可能不完整」。
 *
 * `refs` = 这条待办覆盖的业务对象(referenceType / referenceId),用来在「全部」视图里
 * 把同一件事的知情类消息去重(有待办就只显示待办那一条)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  fetchAddonOrders,
  fetchInvitations,
  fetchMyOrders,
  fetchQuotaOverview,
  fetchSubscribedProducts,
  type ConsoleAddonOrder,
  type ConsoleQuotaOverview,
  type MyOrder,
  type SubscribedProduct,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { daysLeft, fmtDate } from "@/modules/commerce/components/hubModel";

export type TodoKind = "payment" | "renewal" | "quota" | "invitation" | "addon";

export interface TodoRef {
  type: string;
  id: string;
}

export interface TodoItem {
  key: string;
  kind: TodoKind;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  refs: TodoRef[];
}

const RENEW_THRESHOLD_DAYS = 7;

interface Sources {
  orders: MyOrder[];
  subs: SubscribedProduct[];
  addonOrders: ConsoleAddonOrder[];
  quota: ConsoleQuotaOverview | null;
  pendingInvites: number;
}

const EMPTY_SOURCES: Sources = {
  orders: [],
  subs: [],
  addonOrders: [],
  quota: null,
  pendingInvites: 0,
};

export function useDerivedTodos(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const t = useTranslations("todosPage");
  const { session } = useConsoleSession();
  const canManageMembers = hasCapability(
    session.capabilities,
    "tenant.member.manage",
  );
  const canSeeCommerce = hasCapability(
    session.capabilities,
    "tenant.billing.read",
  );
  const canSeeQuota = hasCapability(session.capabilities, "tenant.quota.read");

  const [sources, setSources] = useState<Sources>(EMPTY_SOURCES);
  const [loading, setLoading] = useState(enabled);
  const [partialFailed, setPartialFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setPartialFailed(false);
    const skip = <T>(value: T) => Promise.resolve(value);
    Promise.allSettled([
      canSeeCommerce ? fetchMyOrders() : skip([] as MyOrder[]),
      canSeeCommerce
        ? fetchSubscribedProducts()
        : skip([] as SubscribedProduct[]),
      canSeeQuota ? fetchQuotaOverview() : skip(null),
      canManageMembers ? fetchInvitations() : skip([]),
      canSeeCommerce ? fetchAddonOrders() : skip([] as ConsoleAddonOrder[]),
    ])
      .then(([ords, products, quotaOverview, invites, addons]) => {
        if (!active) return;
        setSources({
          orders: ords.status === "fulfilled" ? ords.value : [],
          subs: products.status === "fulfilled" ? products.value : [],
          quota:
            quotaOverview.status === "fulfilled" ? quotaOverview.value : null,
          pendingInvites:
            invites.status === "fulfilled"
              ? invites.value.filter((i) => i.status === "pending").length
              : 0,
          addonOrders: addons.status === "fulfilled" ? addons.value : [],
        });
        setPartialFailed(
          [ords, products, quotaOverview, invites, addons].some(
            (r) => r.status === "rejected",
          ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    enabled,
    session.tenant?.id,
    canManageMembers,
    canSeeCommerce,
    canSeeQuota,
    reloadKey,
  ]);

  const todos = useMemo<TodoItem[]>(() => {
    const rows: TodoItem[] = [];
    for (const o of sources.orders) {
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
          refs: [{ type: "order", id: o.orderId }],
        });
      }
    }
    for (const s of sources.subs) {
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
          refs: [{ type: "subscription", id: s.subscriptionId }],
        });
      }
    }
    if (sources.quota) {
      const st = sources.quota.storage;
      if (st.limitBytes > 0 && st.remainingBytes < st.limitBytes * 0.1) {
        rows.push({
          key: "quota:storage",
          kind: "quota",
          title: t("items.storageTitle"),
          detail: t("items.storageDetail"),
          href: "/quotas",
          actionLabel: t("items.quotaAction"),
          refs: [],
        });
      }
      const cr = sources.quota.aiCredit;
      if (cr.limit > 0 && cr.remaining <= 0) {
        rows.push({
          key: "quota:credits",
          kind: "quota",
          title: t("items.creditsTitle"),
          detail: t("items.creditsDetail"),
          href: "/quotas",
          actionLabel: t("items.quotaAction"),
          refs: [],
        });
      }
    }
    if (sources.pendingInvites > 0) {
      rows.push({
        key: "invitations",
        kind: "invitation",
        title: t("items.invitesTitle", { count: sources.pendingInvites }),
        detail: t("items.invitesDetail"),
        href: "/invitations",
        actionLabel: t("items.invitesAction"),
        refs: [],
      });
    }
    for (const a of sources.addonOrders) {
      if (a.status === "pending_payment" && !a.paymentDeclared) {
        rows.push({
          key: `addon:${a.orderNo}`,
          kind: "addon",
          title: t("items.addonTitle", { pack: a.packName }),
          detail: a.expireAt
            ? t("items.addonDetail", { date: fmtDate(a.expireAt) })
            : t("items.payDetailNoTtl"),
          href: `/quotas/addon-pay/${a.orderNo}`,
          actionLabel: t("items.addonAction"),
          refs: [],
        });
      }
    }
    return rows;
  }, [sources, t]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { todos, loading, partialFailed, reload };
}

/** 知情类消息里与待办同一件事的模板;「全部」视图里有待办就不重复显示这条消息。 */
const ACTIONABLE_TEMPLATES = new Set([
  "subscription.expiring_soon",
  "order.renewal_created",
]);

/** 某条消息是否已被一条待办覆盖(同一 referenceType / referenceId)。 */
export function isCoveredByTodo(
  message: { templateCode: string; referenceType: string; referenceId: string },
  todos: readonly TodoItem[],
): boolean {
  if (!ACTIONABLE_TEMPLATES.has(message.templateCode)) return false;
  return todos.some((todo) =>
    todo.refs.some(
      (ref) =>
        ref.type === message.referenceType && ref.id === message.referenceId,
    ),
  );
}
