"use client";

/**
 * ProductsOverviewPage — /products 产品中心总览（product_320 §4.5）。
 * 六产品卡片（L1 Atlas/Ontos/Runos + L2 Arda/Karda/Terra）。
 * 卡片解剖借鉴智能体广场，去掉功能/特色，保留 logo + 类型 + 标题 + 概要 + 业务价值。
 * 定价/订阅移至独立通用订阅页 /pricing（ProductSubscribePage）；
 * 卡片「订阅」跳 /pricing?product=code，档位选定后由订阅页深链 console /subscribe。
 *
 * 订阅态（可试用|已开通、未订阅|已订阅）需 website-bff 的 product-subscriptions
 * 端点，作为后续项；本版卡片统一呈现「可试用」+ 订阅/申请演示/产品介绍。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
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
import { fetchProductCatalog } from "@/api/product-catalog.api";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";

type ProductCard = {
  code: string;
  name: string;
  type: string;
  icon: IconName;
  description: string;
  value: string;
  status: "available" | "coming";
  /**
   * 未登录时是否可见（可配置，默认 true=可见）。false → 未登录隐藏该卡；
   * 登录后一律可见。per-card 配置在 products.json 的对应 item 上设置。
   */
  loggedOutVisible?: boolean;
};

/**
 * 卡片可见/操作态（product_320 §4.5，per-card）：
 *  - 未登录：loggedOutVisible=false → 隐藏；否则按「未登录模式」（= 未订阅动作）呈现；
 *  - 登录后按订阅态分两态：
 *      未订阅 → [产品介绍] … {申请演示} {订阅}
 *      已订阅 → [产品介绍] … {升级} {进入}
 * 订阅态 subscribed 需 website-bff /api/me/product-subscriptions（后续项）；暂缺 → false。
 */

export default function ProductsOverviewPage() {
  const t = useTranslations("products");
  const locale = useLocale();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const hasSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);
  const products = t.raw("catalog.items") as ProductCard[];
  // 登录租户各产品订阅态（code → state）；未登录为空 → 卡片按未登录/未订阅呈现。
  const [subs, setSubs] = useState<Map<string, ProductSubscriptionState>>(
    () => new Map(),
  );
  // 产品版本单一真源在 DB（product.products.release_version），公开端点，匿名亦读。
  const [versions, setVersions] = useState<Map<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void fetchProductCatalog()
      .then((list) => {
        if (cancelled) return;
        setVersions(
          new Map(
            list
              .filter((p) => p.releaseVersion)
              .map((p) => [p.productCode, p.releaseVersion as string]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setVersions(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const available = product.status === "available";
              const loggedOutVisible = product.loggedOutVisible !== false;
              // 未登录 + 配置为不可见 → 隐藏该卡（登录后一律可见）。
              if (!hasSession && !loggedOutVisible) return null;
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
                          {product.type}
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
                  <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
                    <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                      {t("catalog.valueLabel")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
                      {product.value}
                    </p>
                  </div>

                  {/* 底部操作区：左=产品介绍，右=动作对；justify-between 留白分隔 */}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                    <div className="flex items-center gap-2">
                      {versions.get(product.code) ? (
                        <span className="text-xs font-normal text-vx-gray-400 dark:text-vx-gray-500">
                          {versions.get(product.code)}
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
        </div>
      </section>
    </div>
  );
}
