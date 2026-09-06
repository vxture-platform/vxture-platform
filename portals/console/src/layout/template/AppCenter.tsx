"use client";

/* 智能体（2026-08-30 重写；2026-09-07 owner 重定内容）。
 *
 * 原件 1:1 转写自设计稿 main-template.jsx，靠一套 `.ac-*` 类排版——那套 CSS 随
 * shell-template 退役后全仓已无定义，卡片实际是裸的 <button>；数据则是 BFF 写死的
 * 四块目录。2026-08-30 改成两段真数据/真配置。
 *
 * **2026-09-07 owner 裁定**：这一页只装两块——
 *   ① 已订阅产品：展示 + 入口（点开就用）；
 *   ② 热门推荐：还没订的产品，两个按钮把人送去「先看介绍」或「直接订阅」。
 *
 * 原来的「控制台板块」去掉了：那三个入口（工作空间 / 成员管理 / 账单）是**控制台的
 * 内容**，控制台视图的侧栏里本来就有；摆在智能体页等于把另一个域的导航搬过来，
 * 域切换就失去意义（owner：「这个错乱了」）。
 *
 * 页头名字从「应用中心」改成「智能体」——切换器里一直叫智能体，页面却自称应用中心，
 * 同一个东西两个名字。
 *
 * 两张卡都是**为这里新写的**，不是把订阅页那两张搬过来：
 *   · 已订阅卡——**借订阅卡的信息、去掉它的管理操作**（owner 2026-09-07）。留档位 /
 *     周期 / 状态 / 有效期这些"这个智能体现在是什么状况"，去掉收藏★、自动续费开关、
 *     退订菜单、升级续费按钮、进度条与版本号。这一页的动作只有一个:**打开它**。
 *   · 推荐卡——这里是引导不是目录，砍掉收藏★、标签行、两行描述与版本号，只留购买判断
 *     真正要看的价格，高度从五段降到两段（owner：「相比订阅高度也降低，信息减少一些」）。
 *
 * 档位 / 周期 / 状态这些词读 `subscriptionHub.*`：那是**订阅这个域**的词典，
 * OrdersSection / hubCards / 付款页早就在共用；把二十个词当 props 一路传进来，等于在
 * 这一页再抄一份同样的词典。本页自己的文案仍走 `labels`。
 *
 * 全 DS 件；入口网格与工作台（DashboardPage）同一套。
 */

import type { MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  EmptyState,
  Icon,
  Skeleton,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import { getPathname } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import { buildWebsiteProductUrl } from "@/lib/website-entry";
import { fmtDate } from "@/modules/commerce/components/hubModel";
import type {
  ProductAppTile,
  RecommendedProduct,
  SubscribedProduct,
} from "@/api/console-bff";

export interface AppCenterProps {
  /** null = 还没读到：加载中，或读取失败（由 productsFailed 区分）。空数组是真实的「没订阅任何产品」。 */
  products: ProductAppTile[] | null;
  productsFailed: boolean;
  /**
   * 生效订阅。用来给磁贴补上档位 / 周期 / 状态 / 有效期——`/api/me/apps` 有入口
   * (home_url)没有这些，`/api/subscription/products` 有这些没有入口，按产品码合并。
   * null = 还没读到或读失败：卡片退回只有名字与入口的形态，不画空档位。
   */
  subscriptions: SubscribedProduct[] | null;
  /** 热门推荐（未订阅的产品）。null = 还没读到；读失败时整块不出现——引导位读不到就别占地方。 */
  recommended: RecommendedProduct[] | null;
  /** 站内跳转（切回控制台视图 + 客户端路由）。登记了主页的产品不经这里，直接开新标签。 */
  onNavigate: (href: string) => void;
  labels: {
    title: string;
    desc: string;
    productsTitle: string;
    productsDesc: string;
    productsEmpty: string;
    productsBrowse: string;
    productsUnavailable: string;
    trialing: string;
    open: string;
    productDetail: string;
    recoTitle: string;
    recoDesc: string;
    recoLearnMore: string;
    recoSubscribe: string;
    recoFree: string;
    recoFrom: string;
  };
}

/* 与工作台入口区（DashboardPage.quickActions）同一行网格：列数只在 DS 断点上定。 */
const ENTRY_GRID = "grid gap-md sm:grid-cols-2 xl:grid-cols-3";
/* 未登记主页的产品落到订阅页——那里能看到它的档位与到期，是离「打开」最近的一步。 */
const SUBSCRIPTION_HREF = "/subscription";
/** 推荐位最多摆一行（3 张）：这是引导不是目录，目录在产品市场。 */
const RECO_LIMIT = 3;

/** 订阅态 → 徽章语气。本地一份三行，不为它从 commerce 模块跨层引一个常量。 */
const SUB_STATUS_TONES: Readonly<Record<string, StatusBadgeTone>> = {
  active: "success",
  trialing: "info",
  expired: "neutral",
};

/** 产品字母牌（icon_url 未接入前的缺省底板；同 hubCards 的 ProductGlyph 规格）。 */
function ProductGlyph({ name, code }: { name: string; code: string }) {
  const source = (name || code || "").trim();
  const initials = source.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex size-control-md shrink-0 items-center justify-center rounded-lg bg-primary-muted-hover text-label-sm font-semibold text-primary-hover"
    >
      {initials}
    </span>
  );
}

export function AppCenter({
  products,
  productsFailed,
  subscriptions,
  recommended,
  onNavigate,
  labels,
}: AppCenterProps) {
  const locale = useLocale();
  const appLocale = locale as Locale;
  /* 订阅这个域的词典(档位/周期/状态/期限),与 hubCards、OrdersSection、付款页共用。 */
  const tSub = useTranslations("subscriptionHub");

  /** 按产品码把订阅信息挂到磁贴上：磁贴有入口没档位，订阅有档位没入口。 */
  const subByCode = new Map(
    (subscriptions ?? [])
      .filter((s): s is SubscribedProduct & { productCode: string } =>
        Boolean(s.productCode),
      )
      .map((s) => [s.productCode, s]),
  );

  /* EntryCard 是原生 <a>：href 留给中键/新标签/无障碍，左键拦下来走客户端路由，
   * 不整页刷新（locale 前缀的来由见 DashboardPage 的 localePrefix 注释）。 */
  const internalLink = (href: string) => ({
    href: getPathname({ href, locale }),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      onNavigate(href);
    },
  });

  const recoRows = recommended?.slice(0, RECO_LIMIT) ?? [];

  return (
    <ViewLayout>
      <ViewHeader icon="agent" title={labels.title} description={labels.desc} />

      {/* ① 已订阅产品——展示 + 入口 */}
      <PageSection
        icon="cube"
        level={2}
        title={labels.productsTitle}
        description={labels.productsDesc}
      >
        {products === null ? (
          productsFailed ? (
            <EmptyState icon="warning" title={labels.productsUnavailable} />
          ) : (
            <div className={ENTRY_GRID}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-media-lg w-full" />
              ))}
            </div>
          )
        ) : products.length === 0 ? (
          <EmptyState
            icon="cube"
            title={labels.productsEmpty}
            action={
              <Button
                variant="outline"
                size="md"
                onClick={() => onNavigate(SUBSCRIPTION_HREF)}
              >
                {labels.productsBrowse}
              </Button>
            }
          />
        ) : (
          <div className={ENTRY_GRID}>
            {products.map((product) => {
              const sub = subByCode.get(product.code);
              const status = sub?.status ?? product.status;
              const isFree = sub?.kind === "free" || sub?.tier === "free";
              return (
                <Card key={product.code} surface="base" className="py-md">
                  <CardContent className="flex flex-col gap-sm">
                    <div className="flex items-center gap-sm">
                      <ProductGlyph name={product.name} code={product.code} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-foreground">
                          {product.name}
                        </span>
                        <span className="block truncate text-body-sm text-muted-foreground">
                          {product.nick ?? product.planName}
                        </span>
                      </span>
                    </div>

                    {/* 档位 / 周期 / 状态——「这个智能体现在是什么状况」。 */}
                    <div className="flex flex-wrap items-center gap-xs">
                      {product.tier ? (
                        <Badge variant="secondary">
                          {tSub(`tier.${product.tier}`)}
                        </Badge>
                      ) : null}
                      {sub ? (
                        <Badge variant="outline">
                          {isFree
                            ? tSub("cycle.free")
                            : sub.cycleUnit === "year"
                              ? tSub("cycle.year")
                              : tSub("cycle.month")}
                        </Badge>
                      ) : null}
                      <StatusBadge tone={SUB_STATUS_TONES[status] ?? "neutral"}>
                        {status === "trialing"
                          ? labels.trialing
                          : tSub(`subStatus.${status}`)}
                      </StatusBadge>
                    </div>

                    {/* 有效期:到期那一天最要紧,起始日期与进度条留给订阅页。 */}
                    {sub ? (
                      <span className="text-body-sm text-muted-foreground tabular-nums">
                        {sub.endAt
                          ? tSub("term.until", { date: fmtDate(sub.endAt) })
                          : tSub("term.perpetual")}
                      </span>
                    ) : null}
                  </CardContent>

                  {/* 卡底:一条外链看介绍,一个按钮打开它——这一页的动作只有这一个。 */}
                  <CardFooter className="justify-between gap-md text-body-sm">
                    <a
                      href={buildWebsiteProductUrl(locale, product.code)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-primary-text hover:underline"
                    >
                      {labels.productDetail}
                    </a>
                    {product.homeUrl ? (
                      <Button asChild size="sm">
                        <a
                          href={product.homeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {labels.open}
                          <Icon name="external-link" size="xs" aria-hidden />
                        </a>
                      </Button>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <a {...internalLink(SUBSCRIPTION_HREF)}>
                          {labels.productsBrowse}
                        </a>
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      {/* ② 热门推荐——两个按钮:先看介绍 / 直接订阅。读不到或没有可推荐的就整块不出现。 */}
      {recoRows.length > 0 ? (
        <PageSection
          icon="sparkles"
          level={2}
          title={labels.recoTitle}
          description={labels.recoDesc}
        >
          <div className={ENTRY_GRID}>
            {recoRows.map((item) => {
              const free = Number.parseFloat(item.minPrice) === 0;
              return (
                <Card key={item.productCode} surface="base" className="py-md">
                  <CardContent className="flex flex-col gap-sm">
                    <div className="flex items-center gap-sm">
                      <ProductGlyph
                        name={item.productName}
                        code={item.productCode}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-foreground">
                          {item.productName}
                        </span>
                        <span className="block truncate text-body-sm text-muted-foreground">
                          {item.productNick ?? item.productCode}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-sm">
                      <span className="text-body-sm text-muted-foreground tabular-nums">
                        {free
                          ? labels.recoFree
                          : `${formatCurrency(
                              Number.parseFloat(item.minPrice),
                              appLocale,
                              item.currency,
                            )} ${labels.recoFrom}`}
                      </span>
                      <span className="flex items-center gap-xs">
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={buildWebsiteProductUrl(
                              locale,
                              item.productCode,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {labels.recoLearnMore}
                            <Icon name="external-link" size="xs" aria-hidden />
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            onNavigate(
                              `/subscribe?product=${encodeURIComponent(
                                item.productCode,
                              )}&intent=subscribe`,
                            )
                          }
                        >
                          {labels.recoSubscribe}
                        </Button>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </PageSection>
      ) : null}
    </ViewLayout>
  );
}
