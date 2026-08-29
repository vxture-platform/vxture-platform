"use client";

/* 应用中心（2026-08-30 重写）。原件 1:1 转写自设计稿 main-template.jsx，靠一套
 * `.ac-*` 类排版——那套 CSS 随 shell-template 退役后全仓已无定义，卡片实际是
 * 裸的 <button>；数据则是 BFF 写死的四块目录。现在分两段：「已订阅产品」来自
 * BFF /api/me/apps（当前工作空间实际持有的产品），「控制台板块」来自门户自己的
 * 导航配置（config/navigation.ts）——它们是导航不是数据，不再假装是订阅来的。
 * 全 DS 件；入口网格与工作台（DashboardPage）同一套。 */

import type { MouseEvent } from "react";
import { useLocale } from "next-intl";
import {
  Button,
  EmptyState,
  EntryCard,
  Skeleton,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { getPathname } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import type { ProductAppTile } from "@/api/console-bff";

export interface AppCenterModuleEntry {
  id: string;
  icon: IconName;
  href: string;
  name: string;
  desc: string;
}

export interface AppCenterProps {
  /** null = 还没读到：加载中，或读取失败（由 productsFailed 区分）。空数组是真实的「没订阅任何产品」。 */
  products: ProductAppTile[] | null;
  productsFailed: boolean;
  modules: AppCenterModuleEntry[];
  /** 站内跳转（切回控制台视图 + 客户端路由）。登记了主页的产品不经这里，直接开新标签。 */
  onNavigate: (href: string) => void;
  labels: {
    title: string;
    desc: string;
    shortcutTag: string;
    productsTitle: string;
    productsDesc: string;
    productsEmpty: string;
    productsBrowse: string;
    productsUnavailable: string;
    trialing: string;
    modulesTitle: string;
    modulesDesc: string;
  };
}

/* 与工作台入口区（DashboardPage.quickActions）同一行网格：列数只在 DS 断点上定。 */
const ENTRY_GRID = "grid gap-md sm:grid-cols-2 xl:grid-cols-3";
/* 未登记主页的产品落到订阅页——那里能看到它的档位与到期，是离「打开」最近的一步。 */
const SUBSCRIPTION_HREF = "/subscription";

export function AppCenter({
  products,
  productsFailed,
  modules,
  onNavigate,
  labels,
}: AppCenterProps) {
  const locale = useLocale();
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

  return (
    <ViewLayout>
      <ViewHeader
        icon="squares-four"
        title={labels.title}
        description={labels.desc}
        action={<StatusBadge tone="neutral">{labels.shortcutTag}</StatusBadge>}
      />

      <PageSection
        icon="package"
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
            icon="package"
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
              const meta =
                product.status === "trialing"
                  ? labels.trialing
                  : product.planName;
              return product.homeUrl ? (
                <EntryCard
                  key={product.code}
                  icon="cube"
                  title={product.name}
                  description={product.nick}
                  meta={meta}
                  href={product.homeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ) : (
                <EntryCard
                  key={product.code}
                  icon="cube"
                  title={product.name}
                  description={product.nick}
                  meta={meta}
                  {...internalLink(SUBSCRIPTION_HREF)}
                />
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection
        icon="squares-four"
        level={2}
        title={labels.modulesTitle}
        description={labels.modulesDesc}
      >
        <div className={ENTRY_GRID}>
          {modules.map((entry) => (
            <EntryCard
              key={entry.id}
              icon={entry.icon}
              title={entry.name}
              description={entry.desc}
              {...internalLink(entry.href)}
            />
          ))}
        </div>
      </PageSection>
    </ViewLayout>
  );
}
