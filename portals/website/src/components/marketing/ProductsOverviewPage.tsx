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
import { Banner, EmptyState } from "@vxture/design-system";
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
import { useAuthStore } from "@/stores/auth.store";
import { CatalogHero } from "./CatalogHero";
import {
  ProductCatalogCard,
  type ProductCatalogCardLabels,
  type ProductCatalogCardModel,
} from "./ProductCatalogCard";
import { productTypeIcon, productTypeKey } from "./product-catalog-view";

/** 卡片数据形状与智能体广场同源（ProductCatalogCardModel）。 */
type ProductCard = ProductCatalogCardModel;

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

  // 卡片文案：键名与智能体广场的 appcenter.agents.* 一一对应（两页同一形状）。
  const cardLabels = useMemo<ProductCatalogCardLabels>(
    () => ({
      valueLabel: t("catalog.valueLabel"),
      recommended: t("catalog.recommended"),
      badges: {
        stable: t("catalog.badges.stable"),
        beta: t("catalog.badges.beta"),
        active: t("catalog.badges.active"),
        developing: t("catalog.badges.developing"),
      },
      actions: {
        subscribe: t("catalog.actions.subscribe"),
        upgrade: t("catalog.actions.upgrade"),
        enter: t("catalog.actions.enter"),
        noEntry: t("catalog.actions.noEntry"),
        contact: t("catalog.actions.contact"),
        detail: t("catalog.actions.detail"),
        coming: t("catalog.actions.coming"),
      },
    }),
    [t],
  );

  // 卡片全部来自 DB 目录;名/描述/版本取真列,营销内容取 marketing jsonb,三态由 release_stage 得。
  const cards = useMemo<ProductCard[]>(() => {
    return (products ?? []).map((product) => {
      const m = marketingForLocale(product.marketing, locale);
      return {
        code: product.productCode,
        name: catalogDisplayName(product, locale),
        typeLabel: t(`catalog.types.${productTypeKey(product.productType)}`),
        icon: productTypeIcon(product.productType),
        description: product.description ?? "",
        value: m?.value ?? null,
        highlights: m?.highlights ?? [],
        releaseStage: product.releaseStage,
        version: product.releaseVersion,
        recommend: marketingRecommend(product.marketing),
      };
    });
  }, [products, locale, t]);

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
      {/* hero 与 /appcenter 同一组件：背景色 + 右侧渐隐插画（平台级定位）+ 预约演示 / 业务咨询。 */}
      <CatalogHero
        eyebrow={t("catalog.eyebrow")}
        title={t("catalog.title")}
        description={t("catalog.description")}
        illustration="platforms"
        primaryAction={t("catalog.demoCta")}
        secondaryAction={t("catalog.consultCta")}
      />

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
              {/* 卡片本体与智能体广场共用 ProductCatalogCard：布局 / 徽标 / 动作 / 跳转一处定。 */}
              {cards.map((product) => (
                <ProductCatalogCard
                  key={product.code}
                  product={product}
                  subscription={subs.get(product.code)}
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
