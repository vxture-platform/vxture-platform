"use client";

/**
 * CatalogHero.tsx - 目录页 Hero（/products 产品矩阵 与 /appcenter 智能体广场共用）
 *
 * 2026-09-02 owner：两页 hero 原是动态点线 canvas 背景 + 各自一套按钮（appcenter 还有一排
 * 标签），改为「背景色 + 右侧整体渐变透明的大插画，左侧文字」，两页布局一致、插画按
 * 定位区分（智能体 = 协作网络；平台级 = 分层底座），底部按钮统一为
 * 「预约演示」（主）+「业务咨询」（辅），都落到 /contact 的对应板块。
 *
 * 插画是程序化 SVG（public/images/hero/catalog-hero-*.svg，透明底，各 ~5KB），用
 * CSS mask 向左渐隐，与背景色和文字自然融合；亮/暗色下都成立（插画只用品牌蓝/靛，
 * 背景层分别取浅蓝/深灰渐变）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { Button } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";

export type CatalogHeroIllustration = "agents" | "platforms";

const ILLUSTRATION_SRC: Record<CatalogHeroIllustration, string> = {
  agents: "/images/hero/catalog-hero-agents.svg",
  platforms: "/images/hero/catalog-hero-platforms.svg",
};

export function CatalogHero({
  eyebrow,
  title,
  description,
  illustration,
  primaryAction,
  secondaryAction,
}: {
  eyebrow: string;
  title: string;
  description: string;
  illustration: CatalogHeroIllustration;
  /** 「预约演示」（主）。 */
  primaryAction: string;
  /** 「业务咨询」（辅）。 */
  secondaryAction: string;
}) {
  return (
    <section className="vx-hero-section">
      {/* 背景：浅蓝→白渐变（暗色：深灰渐变），替代原动态点线 canvas。 */}
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-vx-brand-50 via-vx-white to-vx-info-50 dark:from-vx-gray-900 dark:via-vx-gray-900 dark:to-vx-gray-800"
        aria-hidden="true"
      />
      {/* 右侧整体插画：向左渐隐（mask），窄屏时淡化为衬底不抢文字。 */}
      <div
        className="vx-catalog-hero-art pointer-events-none absolute inset-y-0 right-0 w-full lg:w-3/5"
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 程序化 SVG 静态资源，不走 next/image 优化 */}
        <img
          src={ILLUSTRATION_SRC[illustration]}
          alt=""
          className="h-full w-full object-contain object-right-bottom opacity-40 lg:opacity-100"
          loading="eager"
          decoding="async"
        />
      </div>
      {/* 底部向下渐隐，与内容区平滑过渡。 */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-b from-transparent to-[var(--vx-page-bg)]"
        aria-hidden="true"
      />

      <div className="vx-hero-content">
        <div className="max-w-website-3xl lg:max-w-1/2">
          <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
            {eyebrow}
          </p>
          <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
              <Link href="/contact#support">{primaryAction}</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="xl"
              className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
            >
              <Link href="/contact#ecosystem">{secondaryAction}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
