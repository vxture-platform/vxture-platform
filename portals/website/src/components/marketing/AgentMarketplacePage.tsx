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
import { Link } from "@/lib/i18n/navigation";
import { buildConsoleEntryUrl } from "@/lib/console-entry";
import {
  fetchProductSubscriptions,
  type ProductSubscriptionState,
} from "@/api/subscription.api";
import {
  catalogDisplayName,
  marketingForLocale,
  marketingRecommend,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { productTypeIcon } from "./product-catalog-view";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";
import {
  ProductCatalogCard,
  type ProductCatalogCardLabels,
  type ProductCatalogCardModel,
} from "./ProductCatalogCard";

/** 卡片数据形状与 /products 产品矩阵同源（ProductCatalogCardModel）。 */
type AgentCard = ProductCatalogCardModel;

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
  const highlights = t.raw("hero.highlights") as string[];
  // product_type → 类型标签（通用智能体 / 行业智能体）；无 marketing.tagline 时退回它。
  const agentKinds = t.raw("agents.kinds") as Record<string, string>;
  const hasTenantSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);

  // 卡片文案：键名与 /products 的 products.catalog.* 一一对应（两页同一形状）。
  const cardLabels = useMemo<ProductCatalogCardLabels>(
    () => ({
      valueLabel: t("agents.valueLabel"),
      recommended: t("agents.recommended"),
      badges: {
        stable: t("agents.badges.stable"),
        beta: t("agents.badges.beta"),
        active: t("agents.badges.active"),
        developing: t("agents.badges.developing"),
      },
      actions: {
        subscribe: t("agents.actions.subscribe"),
        upgrade: t("agents.actions.upgrade"),
        enter: t("agents.actions.enter"),
        noEntry: t("agents.actions.noEntry"),
        contact: t("agents.actions.contact"),
        detail: t("agents.actions.detail"),
        coming: t("agents.actions.coming"),
      },
    }),
    [t],
  );

  // 完整阵容全部来自 DB 目录；营销内容取 marketing jsonb。vxtpl 置顶，其余保持目录顺序。
  const cards = useMemo<AgentCard[] | null>(() => {
    if (agents === null) return null;
    return [...agents]
      .sort(
        (a, b) =>
          (a.productCode === "vxtpl" ? -1 : 0) -
          (b.productCode === "vxtpl" ? -1 : 0),
      )
      .map((agent) => {
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
          version: agent.releaseVersion,
          recommend: marketingRecommend(agent.marketing),
        };
      });
  }, [agents, agentKinds, locale, t]);

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
      <section className="vx-hero-section">
        <AnimatedHeroBg />
        <div className="vx-hero-content">
          <div className="max-w-website-3xl">
            <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("hero.eyebrow")}
            </p>
            <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
              {t("hero.description")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-vx-brand-100 bg-vx-white/70 px-3 py-1 text-sm font-medium text-vx-brand-700 shadow-sm shadow-vx-brand-900/5 backdrop-blur dark:border-vx-white/20 dark:bg-vx-white/10 dark:text-vx-gray-100"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {hasTenantSession ? (
                <Button
                  asChild
                  size="xl"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <a
                    href={consoleEntryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("hero.primaryAction")}
                  </a>
                </Button>
              ) : (
                <Button
                  asChild
                  size="xl"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <Link href="/signin">{t("hero.guestPrimaryAction")}</Link>
                </Button>
              )}
              <Button
                asChild
                variant="ghost"
                size="xl"
                className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
              >
                <a href="#agent-marketplace">{t("hero.secondaryAction")}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="agent-marketplace" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("agents.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("agents.title")}
              </h2>
            </div>
            <p className="max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("agents.description")}
            </p>
          </div>

          {cards === null ? (
            <Banner
              className="mt-10"
              tone="danger"
              title={t("agents.unavailable.title")}
              description={t("agents.unavailable.description")}
            />
          ) : cards.length === 0 ? (
            <EmptyState
              icon="agent"
              title={t("agents.empty.title")}
              description={t("agents.empty.description")}
              className="mx-auto mt-10 max-w-website-xl"
            />
          ) : (
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {/* 卡片本体与 /products 产品矩阵共用 ProductCatalogCard：布局 / 徽标 / 动作 / 跳转一处定。 */}
              {cards.map((agent) => (
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
