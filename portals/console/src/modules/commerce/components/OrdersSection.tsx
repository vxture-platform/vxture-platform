"use client";

/**
 * OrdersSection.tsx — 我的订单(费用中心的第一块)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-06 裁定:订单从「产品订阅」迁到「费用中心」。判据是**订单是钱这条链
 * 的第一环**——下单 → 出账 → 付款 → 开票,后三环本来就在这一页,唯独第一环在产品
 * 订阅页,一笔交易出了问题人要在两页之间来回跳。两页各答一个问题:产品订阅是
 * **资产视图**(我现在有什么、什么时候到期),费用中心是**交易视图**(这笔钱是怎么
 * 回事)。行业也是这么分的(阿里云/腾讯云/AWS 的费用中心一律收订单+账单+发票)。
 *
 * 迁过来时删掉两个动作,不是漏了:
 *   · **退订**——那是订阅动作不是交易动作,它在订阅卡上;这里改给「查看订阅」跳过去;
 *   · **申请发票**——它在账单行上(对已结清账单开票),订单行上那个只是深链到本页,
 *     两个入口同一件事,并页之后收敛成一个。
 *
 * 文案仍读 `subscriptionHub.*`:那是**订单与订阅这个域**的词典,不是某一页的——
 * OrderDetailPanel / OrderPayPage / AddonPayPage / hubCards 早就在共用它。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Button,
  DataTable,
  EmptyState,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { ActionMenuItem, DataTableColumn } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  cancelSubscriptionOrder,
  fetchMyOrders,
  ConsoleBffError,
  type MyOrder,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useConfirmLabels } from "@/lib/destructive";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import { useRouter } from "@/lib/i18n/navigation";
import { Banner } from "@vxture/design-system";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection } from "@/layout/shell";
import { ListPagination } from "@/components/pagination";
import { OrderDetailPanel } from "./OrderDetailPanel";
import { useOrderPolling } from "./pay/useOrderPolling";
import { PAY_AXIS, SVC_AXIS, fmtDate, fmtTime, formatRemain } from "./hubModel";

const ORDERS_PAGE_SIZE = 10;

export function OrdersSection() {
  const t = useTranslations("subscriptionHub");
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const locale = useLocale();
  const appLocale = locale as Locale;
  const router = useRouter();
  const { session } = useConsoleSession();
  const canManageBilling = hasCapability(
    session.capabilities,
    "tenant.billing.manage",
  );

  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ORDERS_PAGE_SIZE);

  const reload = useCallback(async () => {
    setOrders(await fetchMyOrders());
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchMyOrders()
      .then((rows) => {
        if (active) setOrders(rows);
      })
      .catch(() => {
        if (!active) return;
        setOrders([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  // 待付款单存在时每秒走时(表格里的倒计时)。
  const hasPending = orders.some(
    (o) => o.orderStatus === "pending_payment" && o.expireAt,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  /* 倒计时归零 → 重取一次,让服务端的超时关闭显影(此前订单行停在「去支付 00:00」)。
     每张单只触发一次。 */
  const expiredReloaded = useRef<Set<string>>(new Set());
  useEffect(() => {
    const dueIds = orders
      .filter(
        (o) =>
          o.orderStatus === "pending_payment" &&
          o.expireAt &&
          new Date(o.expireAt).getTime() <= now &&
          !expiredReloaded.current.has(o.orderId),
      )
      .map((o) => o.orderId);
    if (dueIds.length === 0) return;
    for (const id of dueIds) expiredReloaded.current.add(id);
    void reload();
  }, [orders, now, reload]);

  /* 已申报待确认 / 开通中的单要自动前进(此前只能手动刷新)。 */
  const hasInFlight = orders.some(
    (o) =>
      o.orderStatus === "paid_pending_verify" || o.orderStatus === "activating",
  );
  useOrderPolling(hasInFlight, reload, 15_000);

  /* 取消订单后列表变短,当前页可能落空——夹回最后一页。 */
  useEffect(() => {
    const count = Math.max(1, Math.ceil(orders.length / pageSize));
    setPage((p) => Math.min(p, count));
  }, [orders.length, pageSize]);

  const money = useCallback(
    (v: string, currency: string) =>
      formatCurrency(Number.parseFloat(v || "0"), appLocale, currency),
    [appLocale],
  );

  const pageCount = Math.max(1, Math.ceil(orders.length / pageSize));
  /* 排序在分页之前：只排当前页等于只排看得见的那几条。 */
  const sortAccessors = useMemo(
    () => ({
      order: (o: MyOrder) => o.tenantName ?? "",
      amount: (o: MyOrder) => Number.parseFloat(o.amount || "0"),
      placed: (o: MyOrder) => new Date(o.createdAt).getTime(),
    }),
    [],
  );
  const {
    sort,
    onSortChange,
    rows: sortedOrders,
  } = useTableSort(orders, sortAccessors);
  const pagedOrders = useMemo(
    () => sortedOrders.slice((page - 1) * pageSize, page * pageSize),
    [sortedOrders, page, pageSize],
  );

  const toggleExpanded = useCallback((orderId: string) => {
    setExpandedKeys((keys) =>
      keys.includes(orderId)
        ? keys.filter((k) => k !== orderId)
        : [...keys, orderId],
    );
  }, []);

  /* 深链接 `?order=ORD-…`:卡券页反查出挂单后要把人送到**那一张**单上,
     光跳到本页会落在第一页、还得自己找。按可视码定位 → 翻到它所在的页 → 展开。
     只在单号变化时跑一次,免得用户手动收起后又被拽开。 */
  const deepLinkOrderNo = useSearchParams().get("order");
  const deepLinked = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkOrderNo || orders.length === 0) return;
    if (deepLinked.current === deepLinkOrderNo) return;
    const index = orders.findIndex((o) => o.orderNo === deepLinkOrderNo);
    if (index < 0) return;
    deepLinked.current = deepLinkOrderNo;
    const target = orders[index];
    if (!target) return;
    setPage(Math.floor(index / pageSize) + 1);
    setExpandedKeys((keys) =>
      keys.includes(target.orderId) ? keys : [...keys, target.orderId],
    );
  }, [deepLinkOrderNo, orders, pageSize]);

  async function handleCancelOrder(orderId: string) {
    setError(null);
    setCancelingId(orderId);
    try {
      await cancelSubscriptionOrder(orderId);
      await reload();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("orders.cancelError"),
      );
      /* 重新抛出:DS 的确认件按 rejected 决定关不关框。理由已落在 `error` 横幅上,
         但框不能关——用户得看见自己按的那一下没成。 */
      throw err;
    } finally {
      setCancelingId(null);
    }
  }

  const orderColumns: DataTableColumn<MyOrder>[] = [
    {
      id: "order",
      sortable: true,
      header: t("orders.colOrder"),
      cell: (o) => (
        <TableTitleCell
          title={
            <>
              {o.tenantName ?? "—"}
              {o.workspaceName ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {o.workspaceName}
                </span>
              ) : null}
            </>
          }
          description={<span className="font-mono">{o.orderNo}</span>}
        />
      ),
    },
    {
      id: "product",
      header: t("orders.colProduct"),
      cell: (o) => (
        <span className="flex flex-col">
          <span className="text-label-md text-foreground">
            {o.productName ?? o.planName}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {o.tier ? t(`tier.${o.tier}`) : o.planName}
          </span>
        </span>
      ),
    },
    {
      id: "cycle",
      header: t("orders.colCycle"),
      width: "sm",
      align: "center",
      cell: (o) =>
        Number.parseFloat(o.amount) === 0
          ? "—"
          : o.cycleUnit === "year"
            ? t("cycle.year")
            : t("cycle.month"),
    },
    {
      id: "amount",
      sortable: true,
      header: t("orders.colAmount"),
      align: "money",
      cell: (o) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="font-semibold text-foreground">
            {money(o.amount, o.currency)}
          </span>
          {Number.parseFloat(o.voucherOff) > 0 ? (
            <span className="text-body-sm text-muted-foreground">
              {t("orders.voucherOff", {
                amount: money(o.voucherOff, o.currency),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "payStatus",
      header: t("orders.colPayStatus"),
      align: "center",
      cell: (o) => {
        const zeroSettled =
          o.orderStatus === "completed" && Number.parseFloat(o.amount) === 0;
        const axis = PAY_AXIS[o.orderStatus];
        return (
          <StatusBadge tone={axis.tone}>
            {zeroSettled ? t("payAxis.settledZero") : t(`payAxis.${axis.key}`)}
            {o.orderStatus === "pending_payment" && o.expireAt ? (
              <span className="tabular-nums">
                {" "}
                {formatRemain(o.expireAt, now)}
              </span>
            ) : null}
          </StatusBadge>
        );
      },
    },
    {
      id: "svcStatus",
      header: t("orders.colSvcStatus"),
      align: "center",
      cell: (o) => {
        const axis = SVC_AXIS[o.orderStatus];
        return (
          <StatusBadge tone={axis.tone}>{t(`svcAxis.${axis.key}`)}</StatusBadge>
        );
      },
    },
    {
      id: "placed",
      sortable: true,
      header: t("orders.colPlaced"),
      align: "center",
      cell: (o) => (
        <span className="flex flex-col items-center tabular-nums">
          <span className="text-foreground">{fmtDate(o.createdAt)}</span>
          <span className="text-body-sm text-muted-foreground">
            {fmtTime(o.createdAt)}
          </span>
        </span>
      ),
    },
  ];

  function orderMenuItems(o: MyOrder): ActionMenuItem[] {
    const cancellable =
      o.orderStatus === "pending_payment" &&
      Number.parseFloat(o.paidAmount) === 0;
    return [
      {
        id: "detail",
        label: t("orders.menuDetail"),
        icon: "list-checks",
        onSelect: () => toggleExpanded(o.orderId),
      },
      /* 拆页后的去处:订单履约后挂上的那条订阅在产品订阅页。退订、到期不续这些
         订阅动作都在那边的产品卡上,这里只负责把人送过去。 */
      {
        id: "subscription",
        label: t("orders.menuSubscription"),
        icon: "package",
        disabled: o.orderStatus !== "completed" || !o.subscriptionId,
        ...(o.orderStatus !== "completed" || !o.subscriptionId
          ? { hint: t("orders.menuSubscriptionHint") }
          : {}),
        onSelect: () => router.push("/subscription"),
      },
      // 取消订单 = tenant.billing.manage(与 BFF 守卫同码);无码的人只看到详情与去处。
      ...(canManageBilling
        ? [
            {
              id: "cancel",
              label:
                cancelingId === o.orderId
                  ? t("orders.menuCancelBusy")
                  : t("orders.menuCancel"),
              icon: "x" as const,
              danger: true as const,
              disabled: !cancellable || cancelingId === o.orderId,
              hint: cancellable ? undefined : t("orders.menuCancelHint"),
              confirm: withLabels({
                verb: t("orders.cancelVerb"),
                target: o.orderNo,
                consequence: t("orders.cancelConsequence"),
                onConfirm: () => handleCancelOrder(o.orderId),
              }),
            },
          ]
        : []),
    ];
  }

  return (
    <PageSection
      icon="receipt"
      level={2}
      title={t("orders.title")}
      description={t("orders.description")}
    >
      <div className="flex flex-col gap-md">
        {loadFailed ? (
          <LoadFailedBanner
            onRetry={() => setReloadKey((k) => k + 1)}
            retrying={loading}
          />
        ) : null}
        {error ? <Banner tone="danger" title={error} /> : null}

        <DataTable<MyOrder>
          labels={tableLabels}
          columns={orderColumns}
          rows={pagedOrders}
          {...(sort ? { sort } : {})}
          onSortChange={onSortChange}
          rowKey={(o) => o.orderId}
          loading={loading}
          indexStart={(page - 1) * pageSize + 1}
          expandedContent={(o) => (
            <OrderDetailPanel
              order={o}
              countdown={
                o.orderStatus === "pending_payment" && o.expireAt
                  ? t("detail.payRemain", {
                      time: formatRemain(o.expireAt, now),
                    })
                  : null
              }
              fmtLocale={appLocale}
            />
          )}
          expandedKeys={expandedKeys}
          onExpandedChange={setExpandedKeys}
          rowActions={(o) => (
            // 单操作列:主操作 + 菜单同格,操作列 min 64 自适应。
            <span className="inline-flex items-center justify-center gap-xs">
              {o.orderStatus === "pending_payment" ? (
                <Button
                  size="sm"
                  onClick={() => router.push(`/subscribe/pay/${o.orderId}`)}
                >
                  {t("orders.payNow")}
                </Button>
              ) : null}
              <ActionMenu
                label={t("orders.menuLabel")}
                items={orderMenuItems(o)}
              />
            </span>
          )}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("orders.empty")} />
            )
          }
          footer={
            <ListPagination
              page={page}
              pageCount={pageCount}
              total={loadFailed ? 0 : orders.length}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              onPageChange={setPage}
            />
          }
        />
      </div>
    </PageSection>
  );
}
