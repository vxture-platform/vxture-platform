"use client";

/**
 * SubscriptionPage.tsx — 产品订阅总览（product_330 全面重构）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * **资产视图**:这一页只答一个问题——**我现在有什么、什么时候到期**。owner 2026-08-20
 * 设计稿 v8 起是三块,两次减法之后只剩一块:
 *   · 2026-09-06 **订单迁走** —— 订单是钱那条链的第一环,归费用中心(交易视图);
 *   · 2026-09-07 **新品推荐去掉** —— 「还没订的产品」是**选购**,不是资产。选购的去处
 *     是产品市场,页头右上角那个外链就是它;把推荐塞在自己的资产清单下面,等于在
 *     「我有什么」里混进「你还可以买什么」。
 *
 * 剩下的一块:我的订阅——整行铺开每行 3 卡，★ 收藏即排序优先，{服务中|全部} 筛选
 * （「全部」才显示已过期；未支付/未开通订单不在此板块——未生效）。待付订单只留一条
 * 横幅指向费用中心(拆页时补的连接点),不落台账。
 *
 * 概览指标：在订产品 / 即将到期——DS MetricGrid；板块标题走 PageSection 原生 icon
 * prop，全页只用 DS 组合件、不自造样式层（owner 2026-08-20 评审）。
 * 全页无 UUID（可视码原则）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import {
  Banner,
  Button,
  EmptyState,
  Icon,
  MetricGrid,
  SegmentedControl,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { MetricGridItem } from "@vxture/design-system";
import {
  executeSubscriptionAction,
  fetchMyOrders,
  fetchSubscribedProducts,
  setProductFavorite,
  setSubscriptionAutoRenew,
  ConsoleBffError,
  type MyOrder,
  type SubscribedProduct,
  fetchQuotaOverview,
  type ConsoleQuotaOverview,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection } from "@/layout/shell";
import { buildWebsiteProductsUrl } from "@/lib/website-entry";
import { SubscriptionProductCard } from "./components/hubCards";
import { daysLeft, fmtDate, fmtTime } from "./components/hubModel";

import { ResourcePacksSection } from "./components/ResourcePacksSection";
type SubFilter = "active" | "all";

export function SubscriptionPage() {
  const t = useTranslations("subscriptionHub");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useConsoleSession();
  const canManageBilling = hasCapability(
    session.capabilities,
    "tenant.billing.manage",
  );

  const [products, setProducts] = useState<SubscribedProduct[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [subFilter, setSubFilter] = useState<SubFilter>("active");
  const [favBusy, setFavBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // P0 订阅自助:退订确认弹窗目标 + 续费开关在途标记
  /* 只剩 setter：忙态现在由 DS 的确认件按 Promise 自己接管（「处理中…」与
     关闭时机都在件里），页面不再需要读它。 */
  const [, setSelfServiceBusy] = useState(false);
  /* 配额总览:只为「我的资源包」取。null = 没读到——与「读到了但没有池」
     是两件事,后者是合法空态。 */
  const [quota, setQuota] = useState<ConsoleQuotaOverview | null>(null);
  /* 资源包看的是**来源**,不分指标族,所以把存储与 Credits 两族的池并成一张表;
     过滤 subscription 那一类在组件里做(那是它的分组规则)。 */
  const resourcePools = useMemo(
    () => [...(quota?.storage.sources ?? []), ...(quota?.aiCredit.pools ?? [])],
    [quota],
  );

  const reloadSubs = useCallback(async () => {
    const [subs, ords, quota] = await Promise.all([
      fetchSubscribedProducts(),
      fetchMyOrders(),
      fetchQuotaOverview(),
    ]);
    setProducts(subs);
    setOrders(ords);
    setQuota(quota);
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
      fetchQuotaOverview(),
    ])
      .then(([subs, ords, quota]) => {
        if (!active) return;
        setProducts(subs);
        setOrders(ords);
        setQuota(quota);
      })
      .catch(() => {
        if (!active) return;
        setProducts([]);
        setOrders([]);
        setQuota(null);
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
          err instanceof ConsoleBffError && err.message
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
          err instanceof ConsoleBffError && err.message
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
      };
      apply(next);
      setProductFavorite(productCode, next)
        .catch((err) => {
          apply(!next);
          setError(
            err instanceof ConsoleBffError && err.message
              ? err.message
              : t("favorite.error"),
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

  /* 待付订单的**去处**(owner 2026-09-06 拆页):台账搬去费用中心了,这里只留一条
     提示——订完产品找不到付款入口是不行的。横幅比指标卡好:没有待付时它完全不出现,
     有待付时它带着「去支付」的按钮。倒计时也留在费用中心的订单表里,那边才动得了它,
     这里给绝对到期时刻就够,页面因此不必每秒重绘。 */
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.orderStatus === "pending_payment"),
    [orders],
  );
  const nextDeadline = useMemo(
    () =>
      pendingOrders
        .map((o) => o.expireAt)
        .filter((v): v is string => Boolean(v))
        .sort()[0],
    [pendingOrders],
  );

  // ── 概览指标（DS MetricGrid）───────────────────────────────────────────────
  const stats = useMemo<MetricGridItem[]>(() => {
    const inService = products.filter((p) => p.status !== "expired");
    const freeCount = inService.filter(
      (p) => p.kind === "free" || p.tier === "free",
    ).length;

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
  }, [products, t, loadFailed]);

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
      {/* 下单页深链里的产品 / 意图无法识别时带 ?notice=unknown-link 跳回来:说明理由,
          不再静默。 */}
      {searchParams.get("notice") === "unknown-link" ? (
        <Banner tone="info" title={t("unknownLink")} />
      ) : null}
      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      {/* 待付订单只提示、不落台账:台账在费用中心(owner 2026-09-06 拆页) */}
      {!loadFailed && pendingOrders.length > 0 ? (
        <Banner
          tone="warning"
          title={t("pendingBanner.title", { count: pendingOrders.length })}
          description={
            nextDeadline
              ? t("pendingBanner.deadline", {
                  time: `${fmtDate(nextDeadline)} ${fmtTime(nextDeadline)}`,
                })
              : t("pendingBanner.description")
          }
          action={
            <Button size="md" onClick={() => router.push("/billing")}>
              <Icon name="receipt" size="xs" fallback="placeholder" />
              <span>{t("pendingBanner.action")}</span>
            </Button>
          }
        />
      ) : null}

      {/* 本页业务 2 个指标 → columns=2（列数随业务定，不写死）。 */}
      <MetricGrid
        items={stats}
        columns={2}
        loading={loading}
        aria-label={t("stats.groupLabel")}
      />

      {/* ① 我的智能体 —— 订阅来的产品(pool_source='subscription' 那一类的来由) */}
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

      {/* ② 我的资源包(owner 2026-09-09)。
          分组规则直接落在库的 `pool_source` 上,不另立一张要人维护的清单:
            ws_base         默认自带 —— 生命周期随工作空间,显示「长期有效」
            addon_purchase  用户加购 —— 有到期时间,画周期进度、临期提醒
            manual_override 平台发放 —— 长期有效 / 周期有效两种都支持
          `subscription` 那一类不进这里:它的来由是上面 ① 的订阅,在这儿再列一遍
          等于同一件事说两处。

          与 /quotas 的分工(owner 裁定):**这里答「你有什么」——额度、来源、有效期;
          配额页答「用了多少、还剩多少」。**
          订阅管理**不出现费用**(owner 2026-09-09):它答的是权益结果,不是花了多少。 */}
      <ResourcePacksSection
        pools={resourcePools}
        loading={loading}
        loadFailed={loadFailed}
      />

      {/* 退订确认(危操作:立即终止、不退款,AlertDialog 强确认) */}
    </ViewLayout>
  );
}
