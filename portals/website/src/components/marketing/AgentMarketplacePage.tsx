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
import { Banner, Button, EmptyState, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  buildConsoleEntryUrl,
  buildConsoleSubscribeUrl,
} from "@/lib/console-entry";
import {
  fetchProductSubscriptions,
  type ProductSubscriptionState,
} from "@/api/subscription.api";
import {
  catalogDisplayName,
  marketingForLocale,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { productTypeIcon } from "./product-catalog-view";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";

type AgentCard = {
  code: string;
  name: string;
  /** per-agent 类型标签（marketing.tagline，缺省退回 kinds 映射）；null = 用通用「智能体」。 */
  type: string | null;
  icon: IconName;
  description: string;
  /** 业务价值（marketing.value）；无则不画。 */
  value: string | null;
  /** 能力亮点（marketing.highlights）。 */
  highlights: string[];
  /** 成熟度轴：ga=正式版 / beta=公测版 / developing=开发中。 */
  releaseStage: string;
  version: string | null;
};

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
          name: catalogDisplayName(agent),
          type: m?.tagline ?? agentKinds[agent.productType] ?? null,
          icon: productTypeIcon(agent.productType),
          description: agent.description ?? "",
          value: m?.value ?? null,
          highlights: m?.highlights ?? [],
          releaseStage: agent.releaseStage,
          version: agent.releaseVersion,
        };
      });
  }, [agents, agentKinds, locale]);

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
              {cards.map((agent) => {
                // 成熟度轴驱动三态:developing 不可订,ga/beta 可订。
                const developing = agent.releaseStage === "developing";
                const subState = subs.get(agent.code);
                const subscribed = !developing && subState?.subscribed === true;
                const tierLabel =
                  subscribed && subState?.tier
                    ? subState.tier.charAt(0).toUpperCase() +
                      subState.tier.slice(1)
                    : null;
                const stageBadge = subscribed
                  ? t("agents.badges.active")
                  : agent.releaseStage === "beta"
                    ? t("agents.badges.beta")
                    : t("agents.badges.stable");
                return (
                  <article
                    key={agent.code}
                    className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                          <Icon name={agent.icon} className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                            {agent.type ?? t("agents.type")}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                            {agent.name}
                          </h3>
                        </div>
                      </div>
                      {developing ? (
                        <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
                          {t("agents.badges.developing")}
                        </span>
                      ) : (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
                            {stageBadge}
                          </span>
                          {tierLabel ? (
                            <span className="rounded-full border border-vx-brand-200 bg-vx-brand-50 px-2.5 py-1 text-xs font-semibold text-vx-brand-700 dark:border-vx-brand-400/30 dark:bg-vx-brand-950/40 dark:text-vx-brand-200">
                              {tierLabel}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {agent.description ? (
                      <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                        {agent.description}
                      </p>
                    ) : null}
                    {/* 业务价值来自 DB marketing；没录入就不画空框 */}
                    {agent.value ? (
                      <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
                        <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                          {t("agents.valueLabel")}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
                          {agent.value}
                        </p>
                      </div>
                    ) : null}
                    {/* 能力亮点（marketing.highlights）——有就以标签排布 */}
                    {agent.highlights.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {agent.highlights.map((h) => (
                          <span
                            key={h}
                            className="rounded-full bg-vx-gray-100 px-2.5 py-0.5 text-xs font-normal text-vx-gray-600 dark:bg-vx-gray-800 dark:text-vx-gray-300"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* 底部操作区：左=版本 + 产品介绍，右=动作对；justify-between 留白分隔 */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <div className="flex items-center gap-2">
                        {agent.version ? (
                          <span className="text-xs font-normal text-vx-gray-400 dark:text-vx-gray-500">
                            {agent.version}
                          </span>
                        ) : null}
                        <Link
                          href={`/products/${agent.code}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 items-center text-xs font-normal text-vx-gray-400 underline-offset-4 transition hover:text-vx-gray-600 hover:underline dark:text-vx-gray-500 dark:hover:text-vx-gray-300"
                        >
                          {t("agents.actions.detail")}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2">
                        {developing ? (
                          <Button
                            variant="outline"
                            size="md"
                            disabled
                            className="h-10"
                          >
                            {t("agents.actions.coming")}
                          </Button>
                        ) : subscribed ? (
                          <>
                            <Button asChild variant="outline">
                              <a
                                href={buildConsoleSubscribeUrl(
                                  locale,
                                  agent.code,
                                  "upgrade",
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t("agents.actions.upgrade")}
                              </a>
                            </Button>
                            <Button asChild>
                              <a
                                href={consoleEntryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t("agents.actions.enter")}
                              </a>
                            </Button>
                          </>
                        ) : (
                          // 未订阅:先去官网定价页看价格+功能,登录后置(与平台级产品一致)。
                          <Button asChild>
                            <Link
                              href={`/pricing?product=${agent.code}`}
                              target="_blank"
                            >
                              {t("agents.actions.subscribe")}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
