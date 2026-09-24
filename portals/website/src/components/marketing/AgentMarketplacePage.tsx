"use client";

/**
 * AgentMarketplacePage.tsx - /appcenter 智能体广场（营销页）
 *
 * 清单**全部来自 DB**：公开产品目录里 product_type ∈ 智能体家族的产品（appcenter/page.tsx
 * 服务端取 `GET /api/products/catalog`、按 isAgentProduct 分区后传入）。含开发中的——12 个
 * 开发中智能体已是真产品行（release_stage=developing）。名/描述/版本/图标取目录真列，
 * 营销内容（业务价值/能力亮点/类型标签）取目录 `marketing` jsonb（DB 权威源，官网不再写死）。
 *
 * 三态徽标 + 订阅按钮由 DB `release_stage` 驱动：
 *   - developing（开发中）：灰徽标 + 禁用「敬请期待」，不可订；
 *   - ga（正式版 / Stable）/ beta（公测版 / Beta）：可订——未订「订阅」、已订「已开通 + 档位 +
 *     升级 / 进入工作台」。
 * 订阅态读 website-bff 的 product-subscriptions；未登录一律按未订阅呈现。
 *
 * 所有指向 console（独立站）的链接都 target=_blank + rel=noopener noreferrer，不让营销页
 * 自身导航走掉。站内链接（/signin、/products/*）不受此约束。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-09-01
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, EmptyState } from "@vxture/design-system";
import {
  fetchProductSubscriptions,
  type ProductSubscriptionState,
} from "@/api/subscription.api";
import {
  catalogDisplayName,
  marketingForLocale,
  marketingExpectedReleaseAt,
  marketingRecommend,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { productTypeIcon } from "./product-catalog-view";
import { useAuthStore } from "@/stores/auth.store";
import { CatalogHero } from "./CatalogHero";
import {
  ProductCatalogCard,
  type ProductCatalogCardLabels,
  type ProductCatalogCardModel,
} from "./ProductCatalogCard";

/** 卡片数据形状与 /products 产品矩阵同源（ProductCatalogCardModel），外加筛选要用的行业。 */
type AgentCard = ProductCatalogCardModel & {
  /** 脱敏后的行业标签（marketing.<locale>.industries 去掉 INDUSTRY_DENYLIST）。 */
  readonly industries: readonly string[];
};

/**
 * 不对外呈现的行业标签（owner 2026-09-24：「要脱敏，国防 删除」）。
 *
 * 两个语言的值分别登记——`marketing.zh.industries` 与 `marketing.en.industries`
 * 是两份独立的数组，只挡中文那个等于在英文页面上照样露出来。
 *
 * **脱敏掉之后没有剩余行业的产品不另开「其他」桶。** 现在只有 wargaming 属于这种
 * （它唯一的标签就是国防）。给它开一桶的话，那一桶里只有它一个——谁点「其他」都只会
 * 看到它，等于换个名字继续暴露，与脱敏的用意相反。它只在「全部」下出现。
 */
const INDUSTRY_DENYLIST: ReadonlySet<string> = new Set(["国防", "defense"]);

/** 筛选按钮上限（owner 2026-09-24：「不超过 6+1 个」）。超出的行业折进「其他」。 */
const MAX_INDUSTRY_BUCKETS = 7;

/**
 * 筛选按钮只改圆角与内距，选中/未选交给 DS Button 的 default / outline 两个变体——
 * 颜色自己写一套会和 DS 漂开（ds/no-native-primitive 也正是为此拦下原生 <button>）。
 */
const FILTER_CHIP_CLASS = "rounded-full px-3";

interface AgentMarketplacePageProps {
  /** 目录里的智能体产品；null = 目录暂时读不到（与"目录里没有智能体"是两回事） */
  readonly agents: ProductCatalogItem[] | null;
}

export default function AgentMarketplacePage({
  agents,
}: AgentMarketplacePageProps) {
  const t = useTranslations("appcenter");
  const locale = useLocale();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  // product_type → 类型标签（通用智能体 / 行业智能体）；无 marketing.tagline 时退回它。
  const agentKinds = t.raw("agents.kinds") as Record<string, string>;
  /* 行业标签词表：DB 里存的是短值（zh 「通用」/ en 「general」），这里给它一个可读的
     显示名。没登记的值直接显示原值——新标签不会因为没配词条就变成空按钮。 */
  const industryLabels = t.raw("agents.filters.labels") as Record<
    string,
    string
  >;
  const hasTenantSession = isAuthenticated && Boolean(user);

  // 卡片文案：键名与 /products 的 products.catalog.* 一一对应（两页同一形状）。
  const cardLabels = useMemo<ProductCatalogCardLabels>(
    () => ({
      valueLabel: t("agents.valueLabel"),
      recommended: t("agents.recommended"),
      versionAt: t("agents.versionAt"),
      expectedRelease: t("agents.expectedRelease"),
      badges: {
        stable: t("agents.badges.stable"),
        beta: t("agents.badges.beta"),
        active: t("agents.badges.active"),
        preview: t("agents.badges.preview"),
        sunset: t("agents.badges.sunset"),
      },
      actions: {
        subscribe: t("agents.actions.subscribe"),
        inviteSubscribe: t("agents.actions.inviteSubscribe"),
        notForSale: t("agents.actions.notForSale"),
        upgrade: t("agents.actions.upgrade"),
        enter: t("agents.actions.enter"),
        noEntry: t("agents.actions.noEntry"),
        detail: t("agents.actions.detail"),
        coming: t("agents.actions.coming"),
      },
    }),
    [t],
  );

  /*
   * 完整阵容全部来自 DB 目录；营销内容取 marketing jsonb。**次序也来自目录**。
   *
   * 这里原本写死 `vxtpl` 置顶（`.sort((a,b) => (a.productCode === "vxtpl" ? -1 : 0) …)`）。
   * 2026-09-22 给产品目录加了次序调整（`products.sort`，admin 行操作里的上移/下移/
   * 置顶/置底）之后，这一行就成了插队的：运营把某个产品排到第一，页面上仍然是
   * vxtpl——「排了不生效」。所以拆掉，一律按目录给的顺序渲染。
   *
   * 要让 vxtpl 排第一，去 admin 把它移到顶部；那是个可改的决定，不该是段代码。
   */
  const cards = useMemo<AgentCard[] | null>(() => {
    if (agents === null) return null;
    return agents.map((agent) => {
      const m = marketingForLocale(agent.marketing, locale);
      return {
        code: agent.productCode,
        name: catalogDisplayName(agent, locale),
        // per-agent 类型标签（marketing.tagline），缺省退回 kinds 映射，再退回通用「智能体」。
        typeLabel:
          m?.tagline ?? agentKinds[agent.productType] ?? t("agents.type"),
        icon: productTypeIcon(agent.productType),
        description: agent.description ?? "",
        value: m?.value ?? null,
        highlights: m?.highlights ?? [],
        releaseStage: agent.releaseStage,
        /* 部署偏斜：旧 BFF 不回这一列，回落「已上线」（此前目录里只可能有 active）。 */
        status: agent.status ?? "active",
        version: agent.releaseVersion,
        releasedAt: agent.releasedAt,
        recommend: marketingRecommend(agent.marketing),
        subscribeAccess: agent.subscribeAccess,
        expectedReleaseAt: marketingExpectedReleaseAt(agent.marketing),
        industries: (m?.industries ?? []).filter(
          (i) => !INDUSTRY_DENYLIST.has(i),
        ),
      };
    });
  }, [agents, agentKinds, locale, t]);

  /*
   * 行业筛选桶：**全部来自 DB**（marketing.<locale>.industries），不写死一张清单——
   * 写死的清单会和运营录的标签各说各话，而症状是「点了筛不出东西」。
   *
   * 排序：票数降序，同票按**它在目录里第一次出现的次序**（目录次序由运营在 admin 里
   * 调，是个可改的决定）。纯按票数会在同票时给出不稳定的顺序。
   *
   * 上限 MAX_INDUSTRY_BUCKETS 颗；真超了就把尾部折进「其他」。现在 7 个行业刚好装下，
   * 「其他」不出现（见 INDUSTRY_DENYLIST 头注：脱敏产生的无分类不进「其他」）。
   */
  const buckets = useMemo(() => {
    if (cards === null) return [];
    const count = new Map<string, number>();
    const firstSeen = new Map<string, number>();
    for (const card of cards) {
      for (const industry of card.industries) {
        count.set(industry, (count.get(industry) ?? 0) + 1);
        if (!firstSeen.has(industry)) firstSeen.set(industry, firstSeen.size);
      }
    }
    const ranked = [...count.keys()].sort(
      (a, b) =>
        (count.get(b) ?? 0) - (count.get(a) ?? 0) ||
        (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0),
    );
    const folded = ranked.length > MAX_INDUSTRY_BUCKETS;
    const kept = folded ? ranked.slice(0, MAX_INDUSTRY_BUCKETS - 1) : ranked;
    const rest = folded ? ranked.slice(MAX_INDUSTRY_BUCKETS - 1) : [];
    const list = kept.map((key) => ({
      key,
      label: industryLabels[key] ?? key,
      values: [key],
      count: count.get(key) ?? 0,
    }));
    if (rest.length > 0) {
      list.push({
        key: "__other__",
        label: t("agents.filters.other"),
        values: rest,
        count: cards.filter((c) => c.industries.some((i) => rest.includes(i)))
          .length,
      });
    }
    return list;
  }, [cards, industryLabels, t]);

  /** 选中的桶（空 = 全部）。多选，取并集——「组合筛选」。 */
  const [picked, setPicked] = useState<readonly string[]>([]);

  const visible = useMemo(() => {
    if (cards === null) return null;
    if (picked.length === 0) return cards;
    const wanted = new Set(
      buckets.filter((b) => picked.includes(b.key)).flatMap((b) => b.values),
    );
    return cards.filter((c) => c.industries.some((i) => wanted.has(i)));
  }, [cards, picked, buckets]);

  // 登录租户各产品订阅态（code → state）；未登录为空 → 卡片按未订阅呈现。与 /products 同源。
  const [subs, setSubs] = useState<Map<string, ProductSubscriptionState>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!hasTenantSession) {
      setSubs(new Map());
      return;
    }
    let cancelled = false;
    void fetchProductSubscriptions()
      .then((list) => {
        if (cancelled) return;
        setSubs(new Map(list.map((s) => [s.productCode, s])));
      })
      .catch(() => {
        if (!cancelled) setSubs(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [hasTenantSession]);

  return (
    <div className="vx-page-surface">
      {/* hero 与 /products 同一组件：淡化点线背景 + 预约演示 / 业务咨询，两页同高。 */}
      <CatalogHero
        eyebrow={t("hero.eyebrow")}
        title={t("hero.title")}
        description={t("hero.description")}
        primaryAction={t("hero.primaryAction")}
        secondaryAction={t("hero.secondaryAction")}
      />

      <section id="agent-marketplace" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          {/*
           * 标题右侧原先是一段解释这份清单从哪来的说明文字。owner 2026-09-24：
           * 「这个完全不需要，删除」——那段话讲的是实现（清单来自产品目录），
           * 不是访客要知道的事。那个位置换成按大行业的组合筛选。
           */}
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("agents.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("agents.title")}
              </h2>
            </div>

            {/* 组合筛选：多选、取并集；一个都不选 = 全部。计数是各桶的总数，不随当前
                选择变化——那样数字会在点击时跳动，看着像 bug。 */}
            {buckets.length > 0 ? (
              <div
                className="flex flex-wrap gap-2 md:justify-end"
                role="group"
                aria-label={t("agents.filters.label")}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={picked.length === 0 ? "default" : "outline"}
                  onClick={() => setPicked([])}
                  aria-pressed={picked.length === 0}
                  className={FILTER_CHIP_CLASS}
                >
                  {t("agents.filters.all")}
                  <span className="ml-1 tabular-nums opacity-70">
                    {cards?.length ?? 0}
                  </span>
                </Button>
                {buckets.map((bucket) => {
                  const on = picked.includes(bucket.key);
                  return (
                    <Button
                      key={bucket.key}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        setPicked((prev) =>
                          prev.includes(bucket.key)
                            ? prev.filter((k) => k !== bucket.key)
                            : [...prev, bucket.key],
                        )
                      }
                      aria-pressed={on}
                      className={FILTER_CHIP_CLASS}
                    >
                      {bucket.label}
                      <span className="ml-1 tabular-nums opacity-70">
                        {bucket.count}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {visible === null ? (
            <Banner
              className="mt-10"
              tone="danger"
              title={t("agents.unavailable.title")}
              description={t("agents.unavailable.description")}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="agent"
              title={t("agents.empty.title")}
              description={t("agents.empty.description")}
              className="mx-auto mt-10 max-w-website-xl"
            />
          ) : (
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {/* 卡片本体与 /products 产品矩阵共用 ProductCatalogCard：布局 / 徽标 / 动作 / 跳转一处定。 */}
              {visible.map((agent) => (
                <ProductCatalogCard
                  key={agent.code}
                  product={agent}
                  subscription={subs.get(agent.code)}
                  labels={cardLabels}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
