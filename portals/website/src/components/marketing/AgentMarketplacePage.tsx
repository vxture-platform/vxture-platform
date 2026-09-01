"use client";

/**
 * AgentMarketplacePage.tsx - /appcenter 智能体广场（营销页）
 *
 * 清单 = 公开产品目录里 product_type='agent' 的产品（appcenter/page.tsx 在服务端取
 * `GET /api/products/catalog`、按 isAgentProduct 分区后传入，不按可售态过滤 → 上线的和
 * 开发中的都在）。营销页要展示完整阵容：名 / 描述 / 版本取目录真列，是否已可售（available /
 * coming）按 product_code 到 appcenter.json `agents.items` 里找营销文案，找不到就退回目录
 * 里的名与描述、按「开发中」呈现。
 *
 * 2026-09-01：卡片对齐 /products 平台级产品卡（ProductsOverviewPage）的全谱三态 ——
 *   1. developing（copy status ≠ available）：灰徽标「开发中」+ 禁用的「敬请期待」按钮；
 *   2. available 未订阅：右上角徽标「正式版 / Stable」+ 底部「订阅」（直接下单 free 档，
 *      去掉了「试用」概念）；
 *   3. available 已订阅：徽标「已开通」+ 档位 + 底部「升级 / 进入工作台」。
 * available / developing 与 /products 同源、同判据（不是 DB 字段，是营销文案 status），
 * 随真实上线把对应 item 的 status 从 coming 翻成 available 即可逐个转正。
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
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { productTypeIcon } from "./product-catalog-view";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";

/** appcenter.json `agents.items` 里一条营销文案：按 code 挂到目录智能体上，字段全部可缺。 */
type MarketingCopy = {
  code: string;
  name?: string;
  icon?: IconName;
  description?: string;
  value?: string;
  /** available = 已上线可售（正式版）；缺省按 coming（开发中）呈现 */
  status?: "available" | "coming";
};

type AgentCard = {
  code: string;
  name: string;
  icon: IconName;
  description: string;
  value: string | null;
  status: "available" | "coming";
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
  const copyItems = t.raw("agents.items") as MarketingCopy[];
  const hasTenantSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);

  // 目录智能体 × 营销文案 → 卡片；vxtpl 置顶（首个上线的智能体），其余保持目录顺序。
  // 目录是清单唯一来源，文案只是按 code 挂上去的装饰（含是否可售）。
  const cards = useMemo<AgentCard[] | null>(() => {
    if (agents === null) return null;
    const copyByCode = new Map(copyItems.map((item) => [item.code, item]));
    return [...agents]
      .sort(
        (a, b) =>
          (a.productCode === "vxtpl" ? -1 : 0) -
          (b.productCode === "vxtpl" ? -1 : 0),
      )
      .map((agent) => {
        const copy = copyByCode.get(agent.productCode);
        return {
          code: agent.productCode,
          name: copy?.name ?? catalogDisplayName(agent),
          icon: copy?.icon ?? productTypeIcon(agent.productType),
          description: copy?.description ?? agent.description ?? "",
          value: copy?.value ?? null,
          status: copy?.status ?? "coming",
          version: agent.releaseVersion,
        };
      });
  }, [agents, copyItems]);

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
                const available = agent.status === "available";
                const subState = subs.get(agent.code);
                const subscribed = available && subState?.subscribed === true;
                const tierLabel =
                  subscribed && subState?.tier
                    ? subState.tier.charAt(0).toUpperCase() +
                      subState.tier.slice(1)
                    : null;
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
                            {t("agents.type")}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                            {agent.name}
                          </h3>
                        </div>
                      </div>
                      {available ? (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
                            {subscribed
                              ? t("agents.badges.active")
                              : t("agents.badges.stable")}
                          </span>
                          {tierLabel ? (
                            <span className="rounded-full border border-vx-brand-200 bg-vx-brand-50 px-2.5 py-1 text-xs font-semibold text-vx-brand-700 dark:border-vx-brand-400/30 dark:bg-vx-brand-950/40 dark:text-vx-brand-200">
                              {tierLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
                          {t("agents.badges.developing")}
                        </span>
                      )}
                    </div>

                    {agent.description ? (
                      <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                        {agent.description}
                      </p>
                    ) : null}
                    {/* 业务价值只有营销文案才有；目录里的智能体没有这一段就不画空框 */}
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
                        {!available ? (
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
                          <Button asChild>
                            <a
                              href={buildConsoleSubscribeUrl(
                                locale,
                                agent.code,
                                "subscribe",
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("agents.actions.subscribe")}
                            </a>
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
