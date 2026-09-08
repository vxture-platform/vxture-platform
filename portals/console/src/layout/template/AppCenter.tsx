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
 * ## 两张卡的排布规则——**照官网那张已定稿的卡**
 *
 * `/appcenter` 与 `/products` 共用的 `ProductCatalogCard`（website 侧，owner 2026-09-03
 * 定稿）早把这件事排好了；2026-09-07 owner 指出我自造了一套更丑的。现在对齐它：
 *
 *   · **右上角 = 这张卡的"一眼判断"**。已订阅看**状态**（服务中 / 试用中 / 已过期）：
 *     右对齐，一列卡扫下来状态在同一条竖线上；它标的是整张卡的性质，混进内容区就跟
 *     事实混成一片了。**推荐卡这一格是空的**——它的判断就是名字与简介本身
 *     （owner 2026-09-07：价格不在这里露），不为了对称硬塞。
 *   · **内容区 = 支撑那个判断的事实**。已订阅：档位 / 周期 + 有效期至；推荐：一句简介。
 *   · **卡底一行**：左边 `v 1.2.3 at 2026/9/12`，右边动作——「产品介绍」走**文字链**
 *     （官网也是链不是按钮，它是次要去处），主按钮在最右。版本行与动作**同一行**、
 *     不另起一行占高度，这正是我原来做错的地方。
 *
 * 文案模板沿用官网那份（`v {version} at {date}`），日期按 locale 数字格式（zh 不补零：
 * 2026/9/12）。样式仍走 DS 语义类——官网那张卡用的是 website 自己的 `vx-*` 营销层，
 * console 不抄那个（本门户禁自造样式层）。
 *
 * 「更新时间」取 `released_at`（这一版什么时候发出来的），**不是 `updated_at`**——那是
 * 行审计列，后台改一句描述也会变，对客户不构成"产品有更新"。两个字段本轮从 BFF 补出。
 *
 * **价格不出现在这一页**（owner 2026-09-07）：这里是引导，报价与档位是下单页与产品
 * 详情页的事。**更不把 0 元说成「免费」**——`0.00` 只是这一档现在的价格，不等于免费，
 * 更不等于永远免费；平台不替产品做没人授权的商业承诺（owner 2026-09-07：「不要你来
 * 承诺商业逻辑，除非我明确要求，0.00 不等于免费，别制造错觉」）。
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
import { getPathname } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import { buildWebsiteProductUrl } from "@/lib/website-entry";
import { fmtDate } from "@/modules/commerce/components/hubModel";
import type {
  ProductAppTile,
  RecommendedProduct,
  SubscribedProduct,
} from "@/api/console-bff";
import { formatDay } from "@vxture-platform/shared";

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
    /** 卡底版本行模板，沿用官网那份：`v {version} at {date}`。 */
    versionAt: string;
    recoTitle: string;
    recoDesc: string;
    recoLearnMore: string;
    recoSubscribe: string;
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

/**
 * 卡底左侧的版本行，形如 `v 1.2.3 at 2026/9/12`——与官网 `ProductCatalogCard` 同一模板。
 *
 * 没有版本就整段不出现（不画「— at —」凑版式）；有版本没发布时间就只出 `v 1.2.3`。
 * 日期按 locale 的数字格式，zh 下不补零。
 */
function ReleaseLine({
  version,
  releasedAt,
  versionAtLabel,
  locale,
}: {
  version: string | null;
  releasedAt: string | null;
  versionAtLabel: string;
  locale: string;
}) {
  if (!version) return null;
  const text = releasedAt
    ? versionAtLabel
        .replace("{version}", version)
        .replace("{date}", formatDay(releasedAt, locale))
    : "v " + version;
  return (
    <span className="truncate text-body-sm text-muted-foreground tabular-nums">
      {text}
    </span>
  );
}

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
              return (
                <Card key={product.code} surface="base" className="py-md">
                  <CardContent className="flex flex-col gap-sm">
                    {/* 身份在左，状态在右上角——一列卡扫下来状态在同一条竖线上。 */}
                    <div className="flex items-start gap-sm">
                      <ProductGlyph name={product.name} code={product.code} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-foreground">
                          {product.name}
                        </span>
                        <span className="block truncate text-body-sm text-muted-foreground">
                          {product.nick ?? product.planName}
                        </span>
                      </span>
                      <StatusBadge
                        tone={SUB_STATUS_TONES[status] ?? "neutral"}
                        className="shrink-0"
                      >
                        {status === "trialing"
                          ? labels.trialing
                          : tSub(`subStatus.${status}`)}
                      </StatusBadge>
                    </div>

                    {/* 内容区：支撑那个判断的事实——什么档、什么周期、到什么时候。 */}
                    <div className="flex flex-wrap items-center gap-xs">
                      {product.tier ? (
                        <Badge variant="secondary">
                          {tSub(`tier.${product.tier}`)}
                        </Badge>
                      ) : null}
                      {sub ? (
                        <Badge variant="outline">
                          {sub.cycleUnit === "year"
                            ? tSub("cycle.year")
                            : tSub("cycle.month")}
                        </Badge>
                      ) : null}
                      {sub ? (
                        <span className="text-body-sm text-muted-foreground tabular-nums">
                          {sub.endAt
                            ? tSub("term.until", { date: fmtDate(sub.endAt) })
                            : tSub("term.perpetual")}
                        </span>
                      ) : null}
                    </div>
                  </CardContent>

                  {/* 卡底一行：左 = v x.y.z at 日期，右 = 产品介绍(链) + 打开(按钮)。
                      与官网 ProductCatalogCard 同一骨架。 */}
                  <CardFooter className="justify-between gap-md text-body-sm">
                    <ReleaseLine
                      version={sub?.releaseVersion ?? null}
                      releasedAt={sub?.releasedAt ?? null}
                      versionAtLabel={labels.versionAt}
                      locale={locale}
                    />
                    <span className="flex shrink-0 items-center gap-sm">
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
                    </span>
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
            {recoRows.map((item) => (
              <Card key={item.productCode} surface="base" className="py-md">
                <CardContent className="flex flex-col gap-sm">
                  {/* 身份在左，价格在右上角——一行三张扫过去价格在同一条竖线上，可比。 */}
                  <div className="flex items-start gap-sm">
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

                  {/* 内容区：一句它是干什么的，再就是版本与发布时间。 */}
                  {item.description ? (
                    <p className="line-clamp-2 text-body-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </CardContent>

                {/* 卡底一行：左 = v x.y.z at 日期，右 = 产品介绍(链) + 订阅(按钮)。 */}
                <CardFooter className="justify-between gap-md text-body-sm">
                  <ReleaseLine
                    version={item.releaseVersion}
                    releasedAt={item.releasedAt}
                    versionAtLabel={labels.versionAt}
                    locale={locale}
                  />
                  <span className="flex shrink-0 items-center gap-sm">
                    <a
                      href={buildWebsiteProductUrl(locale, item.productCode)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-primary-text hover:underline"
                    >
                      {labels.recoLearnMore}
                    </a>
                    <Button
                      size="sm"
                      onClick={() =>
                        onNavigate(
                          "/subscribe?product=" +
                            encodeURIComponent(item.productCode) +
                            "&intent=subscribe",
                        )
                      }
                    >
                      {labels.recoSubscribe}
                    </Button>
                  </span>
                </CardFooter>
              </Card>
            ))}
          </div>
        </PageSection>
      ) : null}
    </ViewLayout>
  );
}
