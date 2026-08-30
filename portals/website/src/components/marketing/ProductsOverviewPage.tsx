"use client";

/**
 * ProductsOverviewPage — /products 产品中心总览（product_320 §4.5）。
 *
 * 卡片清单 = 公开产品目录里的平台级产品（products/page.tsx 在服务端取
 * `GET /api/products/catalog`、按 isPlatformProduct 分区后传入）。此前是 i18n 里写死的
 * 六张卡，其中 ontos / terra 在目录里根本不存在（规划产品，opera/40-product-registry.md
 * §5 D2）；2026-08-31 起目录说有什么这里就画什么：名 / 类型 / 描述 / 版本取目录真列，
 * 营销文案（品牌名、价值主张、图标、是否已可售）按 product_code 到 products.json
 * `catalog.items` 里找，找不到就退回目录里的名与描述、按「开发中」呈现。
 *
 * 卡片解剖借鉴智能体广场，去掉功能/特色，保留 logo + 类型 + 标题 + 概要 + 业务价值。
 * 定价/订阅移至独立通用订阅页 /pricing（ProductSubscribePage）；
 * 卡片「订阅」跳 /pricing?product=code，档位选定后由订阅页深链 console /subscribe。
 *
 * 订阅态（可试用|已开通、未订阅|已订阅）读 website-bff 的 product-subscriptions
 * 端点；未登录一律按「可试用」+ 订阅/申请演示/产品介绍呈现。
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
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";
import { productTypeIcon, productTypeKey } from "./product-catalog-view";

/** products.json `catalog.items` 里一条营销文案：按 code 挂到目录产品上，字段全部可缺。 */
type MarketingCopy = {
  code: string;
  name?: string;
  icon?: IconName;
  description?: string;
  value?: string;
  /** available = 官网已有可售内容（详情 / 套餐）；缺省按 coming 呈现 */
  status?: "available" | "coming";
  /**
   * 未登录时是否可见（可配置，默认 true=可见）。false → 未登录隐藏该卡；
   * 登录后一律可见。per-card 配置在 products.json 的对应 item 上设置。
   */
  loggedOutVisible?: boolean;
};

type ProductCard = {
  code: string;
  name: string;
  typeLabel: string;
  icon: IconName;
  description: string;
  value: string | null;
  status: "available" | "coming";
  loggedOutVisible: boolean;
  version: string | null;
};

interface ProductsOverviewPageProps {
  /** 目录里的平台级产品；null = 目录暂时读不到（与"目录为空"是两回事） */
  readonly products: ProductCatalogItem[] | null;
}

/**
 * 卡片可见/操作态（product_320 §4.5，per-card）：
 *  - 未登录：loggedOutVisible=false → 隐藏；否则按「未登录模式」（= 未订阅动作）呈现；
 *  - 登录后按订阅态分两态：
 *      未订阅 → [产品介绍] … {申请演示} {订阅}
 *      已订阅 → [产品介绍] … {升级} {进入}
 */

export default function ProductsOverviewPage({
  products,
}: ProductsOverviewPageProps) {
  const t = useTranslations("products");
  const locale = useLocale();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const hasSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);
  const copyItems = t.raw("catalog.items") as MarketingCopy[];

  // 目录产品 × 营销文案 → 卡片。目录是清单的唯一来源，文案只是按 code 挂上去的装饰。
  const cards = useMemo<ProductCard[]>(() => {
    const copyByCode = new Map(copyItems.map((item) => [item.code, item]));
    return (products ?? []).map((product) => {
      const copy = copyByCode.get(product.productCode);
      return {
        code: product.productCode,
        name: copy?.name ?? catalogDisplayName(product),
        typeLabel: t(`catalog.types.${productTypeKey(product.productType)}`),
        icon: copy?.icon ?? productTypeIcon(product.productType),
        description: copy?.description ?? product.description ?? "",
        value: copy?.value ?? null,
        status: copy?.status ?? "coming",
        loggedOutVisible: copy?.loggedOutVisible !== false,
        version: product.releaseVersion,
      };
    });
  }, [copyItems, products, t]);

  // 登录租户各产品订阅态（code → state）；未登录为空 → 卡片按未登录/未订阅呈现。
  const [subs, setSubs] = useState<Map<string, ProductSubscriptionState>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!hasSession) {
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
  }, [hasSession]);

  return (
    <div className="vx-page-surface">
      <section className="vx-hero-section">
        <AnimatedHeroBg />
        <div className="vx-hero-content">
          <div className="max-w-website-3xl">
            <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("catalog.eyebrow")}
            </p>
            <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("catalog.title")}
            </h1>
            <p className="mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
              {t("catalog.description")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="xl" className="px-5">
                <Link href="/pricing">{t("catalog.pricingCta")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="products" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          {products === null ? (
            <Banner
              tone="danger"
              title={t("catalog.unavailable.title")}
              description={t("catalog.unavailable.description")}
            />
          ) : cards.length === 0 ? (
            <EmptyState
              icon="package"
              title={t("catalog.empty.title")}
              description={t("catalog.empty.description")}
              className="mx-auto max-w-website-xl"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((product) => {
                const available = product.status === "available";
                // 未登录 + 配置为不可见 → 隐藏该卡（登录后一律可见）。
                if (!hasSession && !product.loggedOutVisible) return null;
                const subState = subs.get(product.code);
                const subscribed = available && subState?.subscribed === true;
                const tierLabel =
                  subscribed && subState?.tier
                    ? subState.tier.charAt(0).toUpperCase() +
                      subState.tier.slice(1)
                    : null;
                return (
                  <article
                    key={product.code}
                    className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                          <Icon name={product.icon} className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                            {product.typeLabel}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                            {product.name}
                          </h3>
                        </div>
                      </div>
                      {available ? (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
                            {subscribed
                              ? t("catalog.badges.active")
                              : t("catalog.badges.trial")}
                          </span>
                          {tierLabel ? (
                            <span className="rounded-full border border-vx-brand-200 bg-vx-brand-50 px-2.5 py-1 text-xs font-semibold text-vx-brand-700 dark:border-vx-brand-400/30 dark:bg-vx-brand-950/40 dark:text-vx-brand-200">
                              {tierLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
                          {t("catalog.badges.developing")}
                        </span>
                      )}
                    </div>

                    <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                      {product.description}
                    </p>
                    {/* 业务价值只有营销文案才有；目录里的产品没有这一段就不画空框 */}
                    {product.value ? (
                      <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
                        <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                          {t("catalog.valueLabel")}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
                          {product.value}
                        </p>
                      </div>
                    ) : null}

                    {/* 底部操作区：左=产品介绍，右=动作对；justify-between 留白分隔 */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <div className="flex items-center gap-2">
                        {product.version ? (
                          <span className="text-xs font-normal text-vx-gray-400 dark:text-vx-gray-500">
                            {product.version}
                          </span>
                        ) : null}
                        <Link
                          href={`/products/${product.code}`}
                          target="_blank"
                          className="inline-flex h-10 items-center text-xs font-normal text-vx-gray-400 underline-offset-4 transition hover:text-vx-gray-600 hover:underline dark:text-vx-gray-500 dark:hover:text-vx-gray-300"
                        >
                          {t("catalog.actions.detail")}
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
                            {t("catalog.actions.coming")}
                          </Button>
                        ) : subscribed ? (
                          <>
                            <Button asChild variant="outline">
                              <a
                                href={buildConsoleSubscribeUrl(
                                  locale,
                                  product.code,
                                  "upgrade",
                                )}
                              >
                                {t("catalog.actions.upgrade")}
                              </a>
                            </Button>
                            <Button asChild>
                              <a href={consoleEntryUrl}>
                                {t("catalog.actions.enter")}
                              </a>
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button asChild variant="outline">
                              <a
                                href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                                  `${product.name} ${t("catalog.actions.demo")}`,
                                )}`}
                              >
                                {t("catalog.actions.demo")}
                              </a>
                            </Button>
                            <Button asChild>
                              <Link
                                href={`/pricing?product=${product.code}`}
                                target="_blank"
                              >
                                {t("catalog.actions.subscribe")}
                              </Link>
                            </Button>
                          </>
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
