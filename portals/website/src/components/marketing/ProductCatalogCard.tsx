"use client";

/**
 * ProductCatalogCard.tsx - 产品目录卡（/products 产品矩阵 与 /appcenter 智能体广场共用）
 *
 * 2026-09-02 之前两页各画一份几乎相同的卡，动作区已经漂移：已订阅态的「升级」直跳
 * console 结账页（系统替客户挑"下一档"，客户没看过价格与功能；顶档也照样显示），
 * 「进入工作台」跳的是 console 首页而不是产品本身。owner 要求两页的布局 / 逻辑 /
 * 按钮 / 跳转目标 / 卡片信息完全一致——所以收成一个组件，两页只负责喂数据与文案。
 *
 * 动作区裁定（按成熟度 × 订阅态）：
 *   developing            → 「敬请期待」禁用；
 *   未登录 / 未订阅        → 「申请演示」（mailto）+ 「订阅」（官网 /pricing?product=，先看价再登录）；
 *   已订阅                → 「升级」（同一个 /pricing：登录后该页会标出当前档、只放行更高档；
 *                           只在 canUpgrade 时出现）+ 「进入」。
 *
 * 「进入」的目标是**产品本身**（product_webhooks.home_url，如 vxtpl.vxture.com），
 * 不是 console：console 是订阅管理台，从一个产品的卡片点进去落到管理台是错的落点
 * （owner 2026-09-02：「我从产品进入，为什么是工作台，不是产品本身」）。产品没登记
 * 入口就如实禁用「入口即将开放」，不偷偷改跳别处。
 * 徽标：developing「开发中」；否则 成熟度（正式版 / 公测版）+ 已订阅时「已开通」+ 档位。
 *
 * 所有指向产品站的链接 target=_blank + rel=noopener noreferrer（营销页不走掉）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import type { ProductSubscriptionState } from "@/api/subscription.api";

/** 卡片数据（两页各自从目录 + marketing jsonb 算好后传入）。 */
export interface ProductCatalogCardModel {
  code: string;
  name: string;
  /** 类型标签（/products 取 catalog.types；/appcenter 取 marketing.tagline 或 kinds）。 */
  typeLabel: string;
  icon: IconName;
  description: string;
  /** 业务价值（marketing.value）；无则不画。 */
  value: string | null;
  /** 能力亮点（marketing.highlights）。 */
  highlights: string[];
  /** 成熟度轴：ga / beta / developing。 */
  releaseStage: string;
  version: string | null;
}

/** 卡片文案——两页各自的命名空间里键名相同，形状在这里定死。 */
export interface ProductCatalogCardLabels {
  valueLabel: string;
  badges: {
    stable: string;
    beta: string;
    active: string;
    developing: string;
  };
  actions: {
    subscribe: string;
    upgrade: string;
    /** 「进入」——目标是产品自己的站点（home_url）。 */
    enter: string;
    /** 产品未登记入口时的禁用态文案。 */
    noEntry: string;
    demo: string;
    detail: string;
    coming: string;
  };
}

export function ProductCatalogCard({
  product,
  subscription,
  labels,
  demoSubject,
}: {
  product: ProductCatalogCardModel;
  /** 登录租户在该产品上的代表订阅态；未登录 / 未订阅为 undefined。 */
  subscription: ProductSubscriptionState | undefined;
  labels: ProductCatalogCardLabels;
  /** 「申请演示」邮件主题。 */
  demoSubject: string;
}) {
  const developing = product.releaseStage === "developing";
  const subscribed = !developing && subscription?.subscribed === true;
  const tierLabel =
    subscribed && subscription?.tier
      ? subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)
      : null;
  const stageBadge =
    product.releaseStage === "beta" ? labels.badges.beta : labels.badges.stable;
  const productHomeUrl = subscription?.homeUrl ?? null;
  const pricingHref = `/pricing?product=${product.code}`;

  return (
    <article className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30">
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
        {developing ? (
          <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
            {labels.badges.developing}
          </span>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
              {stageBadge}
            </span>
            {subscribed ? (
              <span className="rounded-full border border-vx-success-200 bg-vx-success-50 px-2.5 py-1 text-xs font-medium text-vx-success-600 dark:border-vx-success-300/30 dark:bg-vx-success-900/30 dark:text-vx-success-300">
                {labels.badges.active}
              </span>
            ) : null}
            {tierLabel ? (
              <span className="rounded-full border border-vx-brand-200 bg-vx-brand-50 px-2.5 py-1 text-xs font-semibold text-vx-brand-700 dark:border-vx-brand-400/30 dark:bg-vx-brand-950/40 dark:text-vx-brand-200">
                {tierLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {product.description ? (
        <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
          {product.description}
        </p>
      ) : null}
      {/* 业务价值来自 DB marketing；没录入就不画空框 */}
      {product.value ? (
        <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
          <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
            {labels.valueLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
            {product.value}
          </p>
        </div>
      ) : null}
      {/* 能力亮点（marketing.highlights）——有就以标签排布 */}
      {product.highlights.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.highlights.map((h) => (
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
          {product.version ? (
            <span className="text-xs font-normal text-vx-gray-400 dark:text-vx-gray-500">
              {product.version}
            </span>
          ) : null}
          <Link
            href={`/products/${product.code}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center text-xs font-normal text-vx-gray-400 underline-offset-4 transition hover:text-vx-gray-600 hover:underline dark:text-vx-gray-500 dark:hover:text-vx-gray-300"
          >
            {labels.actions.detail}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {developing ? (
            <Button variant="outline" size="md" disabled className="h-10">
              {labels.actions.coming}
            </Button>
          ) : subscribed ? (
            <>
              {subscription?.canUpgrade ? (
                <Button asChild variant="outline">
                  <Link href={pricingHref} target="_blank">
                    {labels.actions.upgrade}
                  </Link>
                </Button>
              ) : null}
              {productHomeUrl ? (
                <Button asChild>
                  <a
                    href={productHomeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {labels.actions.enter}
                  </a>
                </Button>
              ) : (
                <Button disabled title={labels.actions.noEntry}>
                  {labels.actions.noEntry}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button asChild variant="outline">
                <a
                  href={`mailto:sales@vxture.com?subject=${encodeURIComponent(demoSubject)}`}
                >
                  {labels.actions.demo}
                </a>
              </Button>
              {/* 未订阅：先去官网定价页看价格 + 功能，登录后置。 */}
              <Button asChild>
                <Link href={pricingHref} target="_blank">
                  {labels.actions.subscribe}
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
