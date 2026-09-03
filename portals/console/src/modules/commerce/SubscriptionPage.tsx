"use client";

/**
 * SubscriptionPage.tsx — 产品订阅总览（product_330 全面重构）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 多产品订阅中枢，三个板块（owner 2026-08-20 设计稿 v8 定稿）：
 *   ① 我的订阅——整行铺开每行 3 卡，★ 收藏即排序优先，{服务中|全部} 筛选
 *      （「全部」才显示已过期；未支付/未开通订单不在此板块——未生效）；
 *   ② 我的订单——展开式表格：首列展开箭头，订单列 = 租户(主)·工作区(辅) +
 *      订单号辅行，六态投影为付费/服务两轴，操作 = 去支付(主) + ⋯ 菜单；
 *   ③ 新品推荐——未订阅产品卡，外链 website 产品详情页承接订阅。
 * 概览指标：在订产品 / 待付订单(TTL 倒计时) / 即将到期——DS MetricGrid，
 * 与 /billing 完全同款；板块标题走 PageSection 原生 icon prop，全页只用
 * DS 组合件、不自造样式层（owner 2026-08-20 评审）。全页无 UUID（可视码原则）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  MetricGridItem,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  cancelSubscriptionOrder,
  executeSubscriptionAction,
  fetchMyOrders,
  fetchRecommendedProducts,
  fetchSubscribedProducts,
  setProductFavorite,
  setSubscriptionAutoRenew,
  ConsoleBffError,
  type MyOrder,
  type RecommendedProduct,
  type SubscribedProduct,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection } from "@/layout/shell";
import { buildWebsiteProductsUrl } from "@/lib/website-entry";
import {
  RecommendedProductCard,
  SubscriptionProductCard,
} from "./components/hubCards";
import { OrderDetailPanel } from "./components/OrderDetailPanel";
import { useConfirmLabels } from "@/lib/destructive";
import {
  PAY_AXIS,
  SVC_AXIS,
  daysLeft,
  fmtDate,
  fmtTime,
  formatRemain,
} from "./components/hubModel";

const ORDERS_PAGE_SIZE = 8;

type SubFilter = "active" | "all";

export function SubscriptionPage() {
  const t = useTranslations("subscriptionHub");
  const withLabels = useConfirmLabels();
  const locale = useLocale();
  const appLocale = locale as Locale;
  const router = useRouter();
  const { session } = useConsoleSession();
  const canManageBilling = hasCapability(
    session.capabilities,
    "tenant.billing.manage",
  );

  const [products, setProducts] = useState<SubscribedProduct[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [recommended, setRecommended] = useState<RecommendedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [subFilter, setSubFilter] = useState<SubFilter>("active");
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);
  const [favBusy, setFavBusy] = useState<ReadonlySet<string>>(new Set());
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // P0 订阅自助:退订确认弹窗目标 + 续费开关在途标记
  /* 只剩 setter：忙态现在由 DS 的确认件按 Promise 自己接管（「处理中…」与
     关闭时机都在件里），页面不再需要读它。 */
  const [, setSelfServiceBusy] = useState(false);

  const reloadSubs = useCallback(async () => {
    const [subs, ords] = await Promise.all([
      fetchSubscribedProducts(),
      fetchMyOrders(),
    ]);
    setProducts(subs);
    setOrders(ords);
  }, []);

  /* 读失败显影(批 0b):三路读全是 strict,任一失败置 loadFailed——指标画「—」、
   * 订阅区与订单表画「读取失败」,不再把回落的 [] 画成「没有订阅」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([
      fetchSubscribedProducts(),
      fetchMyOrders(),
      fetchRecommendedProducts(),
    ])
      .then(([subs, ords, recos]) => {
        if (!active) return;
        setProducts(subs);
        setOrders(ords);
        setRecommended(recos);
      })
      .catch(() => {
        if (!active) return;
        setProducts([]);
        setOrders([]);
        setRecommended([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  // ── P0 订阅自助:到期不续/恢复续费 + 立即退订 ────────────────────────────
  const handleSetAutoRenew = useCallback(
    async (item: SubscribedProduct, enabled: boolean) => {
      setError(null);
      setSelfServiceBusy(true);
      try {
        await setSubscriptionAutoRenew(item.subscriptionId, enabled);
        await reloadSubs();
      } catch (err) {
        setError(
          err instanceof ConsoleBffError
            ? err.message
            : t("subs.autoRenewError"),
        );
      } finally {
        setSelfServiceBusy(false);
      }
    },
    [reloadSubs, t],
  );

  /**
   * 退订的落锤。**只负责做这件事**——"问一句"归 `hubCards` 里的菜单项
   * （DS 的 `confirm`），本页不再持有 `unsubTarget` 与那个 AlertDialog。
   *
   * 失败重新抛出：确认件按 Promise 的结局决定关不关框，吞掉异常会让一次失败的
   * 退订看起来成功了。理由仍落在 `error` 横幅上。
   */
  const handleUnsubscribe = useCallback(
    async (target: SubscribedProduct) => {
      setError(null);
      setSelfServiceBusy(true);
      try {
        await executeSubscriptionAction({
          subscriptionId: target.subscriptionId,
          action: "cancel",
        });
        await reloadSubs();
      } catch (err) {
        setError(
          err instanceof ConsoleBffError
            ? err.message
            : t("subs.unsubscribeError"),
        );
        throw err;
      } finally {
        setSelfServiceBusy(false);
      }
    },
    [reloadSubs, t],
  );

  // 待付款单存在时每秒走时（表格倒计时 + 概览条 TTL）。
  const hasPending = orders.some(
    (o) => o.orderStatus === "pending_payment" && o.expireAt,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasPending]);

  const money = useCallback(
    (v: string, currency: string) =>
      formatCurrency(Number.parseFloat(v || "0"), appLocale, currency),
    [appLocale],
  );

  // ── 收藏开关（乐观更新，失败回滚）────────────────────────────────────────
  const toggleFavorite = useCallback(
    (productCode: string, next: boolean) => {
      if (!productCode) return;
      setError(null);
      setFavBusy((prev) => new Set(prev).add(productCode));
      const apply = (fav: boolean) => {
        setProducts((list) =>
          list.map((p) =>
            p.productCode === productCode ? { ...p, favorite: fav } : p,
          ),
        );
        setRecommended((list) =>
          list.map((p) =>
            p.productCode === productCode ? { ...p, favorite: fav } : p,
          ),
        );
      };
      apply(next);
      setProductFavorite(productCode, next)
        .catch((err) => {
          apply(!next);
          setError(
            err instanceof ConsoleBffError ? err.message : t("favorite.error"),
          );
        })
        .finally(() =>
          setFavBusy((prev) => {
            const copy = new Set(prev);
            copy.delete(productCode);
            return copy;
          }),
        );
    },
    [t],
  );

  // ── 我的订阅：筛选（服务中|全部）+ 收藏优先排序 ──────────────────────────
  const visibleProducts = useMemo(() => {
    const filtered =
      subFilter === "all"
        ? products
        : products.filter((p) => p.status !== "expired");
    // 收藏优先；组内保持服务端「最近开通」序（sort 稳定）。
    return [...filtered].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite),
    );
  }, [products, subFilter]);

  // ── 概览指标（DS MetricGrid，同 /billing 的统计卡）─────────────────────────
  const stats = useMemo<MetricGridItem[]>(() => {
    const inService = products.filter((p) => p.status !== "expired");
    const freeCount = inService.filter(
      (p) => p.kind === "free" || p.tier === "free",
    ).length;

    const pending = orders.filter((o) => o.orderStatus === "pending_payment");
    const nextDeadline = pending
      .map((o) => o.expireAt)
      .filter((v): v is string => Boolean(v))
      .sort()[0];

    const expiring = inService
      .filter((p) => p.endAt)
      .sort((a, b) => (a.endAt ?? "").localeCompare(b.endAt ?? ""))[0];
    const expiringLeft = expiring ? daysLeft(expiring.endAt) : null;

    // 没读到就是「—」:读失败时的 0 不是没有订阅,是没有数据。
    return [
      {
        id: "products",
        icon: "package",
        label: t("stats.products"),
        value: loadFailed ? "—" : String(inService.length),
        trend: loadFailed
          ? ""
          : freeCount > 0
            ? t("stats.productsHint", { free: freeCount })
            : t("stats.productsHintNoFree"),
      },
      {
        id: "pending",
        icon: "receipt",
        label: t("stats.pendingOrders"),
        value: loadFailed ? "—" : String(pending.length),
        ...(pending.length > 0 ? { tone: "warning" as const } : {}),
        trend: nextDeadline
          ? `${t("stats.pendingHint", { total: orders.length })} · ${t(
              "stats.pendingRemain",
              { time: formatRemain(nextDeadline, now) },
            )}`
          : t("stats.pendingHint", { total: orders.length }),
        ...(nextDeadline ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "expiring",
        icon: "clock",
        label: t("stats.expiring"),
        value: expiring?.endAt ? fmtDate(expiring.endAt).slice(5) : "—",
        trend: expiring
          ? t("stats.expiringHint", {
              product: expiring.productName ?? expiring.planName,
              cycle:
                expiring.cycleUnit === "year"
                  ? t("cycle.year")
                  : t("cycle.month"),
              days: expiringLeft ?? 0,
            })
          : t("stats.expiringNone"),
      },
    ];
  }, [products, orders, now, t, loadFailed]);

  // ── 我的订单 ──────────────────────────────────────────────────────────────
  async function handleCancelOrder(orderId: string) {
    setError(null);
    setCancelingId(orderId);
    try {
      await cancelSubscriptionOrder(orderId);
      setOrders(await fetchMyOrders());
    } catch (err) {
      setError(
        err instanceof ConsoleBffError ? err.message : t("orders.cancelError"),
      );
      /* 重新抛出：DS 的确认件按 rejected 决定关不关框。理由已落在 `error`
         横幅上，但框不能关——用户得看见自己按的那一下没成。 */
      throw err;
    } finally {
      setCancelingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(orders.length / ORDERS_PAGE_SIZE));
  const pagedOrders = useMemo(
    () => orders.slice((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE),
    [orders, page],
  );

  const toggleExpanded = useCallback((orderId: string) => {
    setExpandedKeys((keys) =>
      keys.includes(orderId)
        ? keys.filter((k) => k !== orderId)
        : [...keys, orderId],
    );
  }, []);

  const orderColumns: DataTableColumn<MyOrder>[] = [
    {
      id: "order",
      header: t("orders.colOrder"),
      cell: (o) => (
        <span className="flex flex-col">
          <span className="text-label-md text-foreground">
            {o.tenantName ?? "—"}
            {o.workspaceName ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {o.workspaceName}
              </span>
            ) : null}
          </span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {o.orderNo}
          </span>
        </span>
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
      cell: (o) =>
        Number.parseFloat(o.amount) === 0
          ? "—"
          : o.cycleUnit === "year"
            ? t("cycle.year")
            : t("cycle.month"),
    },
    {
      id: "amount",
      header: t("orders.colAmount"),
      align: "right",
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
      header: t("orders.colPlaced"),
      cell: (o) => (
        <span className="flex flex-col tabular-nums">
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
      // 取消订单 / 退订 = tenant.billing.manage(与 BFF 守卫同码);无码的人只看到详情与开票入口。
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
            {
              // 退订自助上线(P0):completed 单的 orderId 即订阅 id,弹确认后立即退订
              id: "unsubscribe",
              label: t("orders.menuUnsubscribe"),
              danger: true as const,
              disabled: o.orderStatus !== "completed",
              ...(o.orderStatus !== "completed"
                ? { hint: t("orders.menuUnsubscribeHint") }
                : {}),
              /* 与产品卡上的退订是同一件事、同一份后果——所以用同一份文案与同一个
           落锤，而不是各写一遍。找不到订阅行时用订单信息兜底（completed 单的
           orderId 即订阅 id）。 */
              confirm: withLabels({
                verb: t("subs.card.unsubscribeVerb"),
                target: o.productName ?? "",
                consequence: t("subs.card.unsubscribeConsequence"),
                cancelLabel: t("subs.card.unsubscribeKeep"),
                onConfirm: () =>
                  handleUnsubscribe(
                    products.find((p) => p.subscriptionId === o.orderId) ??
                      ({
                        subscriptionId: o.orderId,
                        productName: o.productName,
                      } as SubscribedProduct),
                  ),
              }),
            },
          ]
        : []),
      {
        // 申请发票已上线(owner 2026-08-21 归集账单管理):深链到账单管理页,
        // 对已结清账单行内点「申请发票」。
        id: "invoice",
        label: t("orders.menuInvoice"),
        onSelect: () => router.push("/billing"),
      },
    ];
  }

  return (
    <ViewLayout>
      <ViewHeader
        icon="package"
        title={t("title")}
        description={t("description")}
        action={
          <Button asChild variant="outline" size="md">
            <a
              href={buildWebsiteProductsUrl(locale)}
              target="_blank"
              rel="noreferrer"
            >
              {t("browseMarket")}
              <Icon name="external-link" size="xs" aria-hidden />
            </a>
          </Button>
        }
      />

      {error ? <Banner tone="danger" title={error} /> : null}
      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      {/* 本页业务 3 个指标 → columns=3 铺满一行（列数随业务定，不写死）。 */}
      <MetricGrid
        items={stats}
        columns={3}
        loading={loading}
        aria-label={t("stats.groupLabel")}
      />

      {/* ① 我的订阅 */}
      <PageSection
        icon="package"
        level={2}
        title={t("subs.title")}
        description={t("subs.description")}
        action={
          <SegmentedControl<SubFilter>
            ariaLabel={t("subs.filterLabel")}
            value={subFilter}
            onChange={setSubFilter}
            items={[
              { value: "active", label: t("subs.filterActive") },
              { value: "all", label: t("subs.filterAll") },
            ]}
          />
        }
      >
        {loading ? (
          <EmptyState icon="clock" title={t("loading")} />
        ) : loadFailed ? (
          <LoadFailedEmpty />
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            icon="package"
            title={t("subs.emptyTitle")}
            description={t("subs.emptyDescription")}
          />
        ) : (
          <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map((item) => (
              <SubscriptionProductCard
                key={item.subscriptionId}
                item={item}
                favoriteBusy={
                  !!item.productCode && favBusy.has(item.productCode)
                }
                onToggleFavorite={toggleFavorite}
                onSetAutoRenew={(target, enabled) =>
                  void handleSetAutoRenew(target, enabled)
                }
                onUnsubscribe={handleUnsubscribe}
                canManage={canManageBilling}
              />
            ))}
          </div>
        )}
      </PageSection>

      {/* ② 我的订单 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("orders.title")}
        description={t("orders.description")}
      >
        <DataTable<MyOrder>
          columns={orderColumns}
          rows={pagedOrders}
          rowKey={(o) => o.orderId}
          loading={loading}
          indexStart={(page - 1) * ORDERS_PAGE_SIZE + 1}
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
            // 单操作列(2026-08-21 owner 整改:此前 去支付 独占一根内容列,
            // 与 ⋯ 菜单成了两根操作列):主操作 + 菜单同格,操作列 min 64 自适应。
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
            <div className="flex w-full items-center justify-between gap-md text-body-sm text-muted-foreground">
              <span className="tabular-nums">
                {loadFailed ? "—" : t("orders.total", { count: orders.length })}
              </span>
              {pageCount > 1 ? (
                <span className="flex items-center gap-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("orders.prevPage")}
                  </Button>
                  <span className="tabular-nums">
                    {page} / {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    {t("orders.nextPage")}
                  </Button>
                </span>
              ) : null}
            </div>
          }
        />
      </PageSection>

      {/* ③ 新品推荐 */}
      {!loading && recommended.length > 0 ? (
        <PageSection
          icon="sparkles"
          level={2}
          title={t("reco.title")}
          description={t("reco.description")}
        >
          <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
            {recommended.map((item) => (
              <RecommendedProductCard
                key={item.productId}
                item={item}
                favoriteBusy={favBusy.has(item.productCode)}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </PageSection>
      ) : null}
      {/* 退订确认(危操作:立即终止、不退款,AlertDialog 强确认) */}
    </ViewLayout>
  );
}
