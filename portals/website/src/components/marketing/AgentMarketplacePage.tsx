"use client";

/**
 * AgentMarketplacePage.tsx - /appcenter 智能体广场
 *
 * 清单 = 公开产品目录里 product_type='agent' 的产品（appcenter/page.tsx 在服务端取
 * `GET /api/products/catalog`、按 isAgentProduct 分区后传入）。此前这一页渲染 i18n 里
 * 12 个虚构智能体与 9 个行业筛选，看上去像一个在营业的市场；2026-08-31 起只展示目录里
 * 真有的东西——名 / 描述 / 版本全取目录真列，目录里没有智能体就是诚实的空态，不补假卡。
 * 筛选条随虚构的行业标签一起去掉：目录没有行业这一列，造一个就是又一份假数据。
 * 英雄区文案、「进入工作台」深链与试用 CTA 不变。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-31
 */

import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, EmptyState, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { buildConsoleEntryUrl } from "@/lib/console-entry";
import {
  catalogDisplayName,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";

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
  const hasTenantSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);

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
                  <a href={consoleEntryUrl}>{t("hero.primaryAction")}</a>
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

          {agents === null ? (
            <Banner
              className="mt-10"
              tone="danger"
              title={t("agents.unavailable.title")}
              description={t("agents.unavailable.description")}
            />
          ) : agents.length === 0 ? (
            <EmptyState
              icon="agent"
              title={t("agents.empty.title")}
              description={t("agents.empty.description")}
              className="mx-auto mt-10 max-w-website-xl"
            />
          ) : (
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => (
                <article
                  key={agent.productCode}
                  className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                        <Icon name="agent" className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                          {t("agents.type")}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                          {catalogDisplayName(agent)}
                        </h3>
                      </div>
                    </div>
                    {agent.releaseVersion ? (
                      <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
                        {agent.releaseVersion}
                      </span>
                    ) : null}
                  </div>

                  {agent.description ? (
                    <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                      {agent.description}
                    </p>
                  ) : null}

                  <div className="mt-auto pt-5">
                    {hasTenantSession ? (
                      <Button asChild className="w-full">
                        <a href={consoleEntryUrl}>{t("hero.primaryAction")}</a>
                      </Button>
                    ) : (
                      <Button asChild className="w-full">
                        <Link href="/signin">{t("agents.action")}</Link>
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
