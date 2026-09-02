"use client";

/**
 * CatalogHero.tsx - 目录页 Hero（/products 产品矩阵 与 /appcenter 智能体广场共用）
 *
 * 2026-09-02 owner 两轮裁定：
 *   · 第一轮：两页 hero 布局一致，底部按钮统一为「预约演示」（主）+「业务咨询」（辅），
 *     appcenter 的标签行与旧按钮、products 的「查看套餐定价」全部移除。
 *   · 第二轮：右侧插画撤掉（不好看），**动态点线背景加回来**，但要淡、要疏、要慢；
 *     背景色不能太白（加一点蓝）；hero 压矮，四行文字（眉题 / 标题 / 描述 / 按钮）
 *     左对齐、靠上排（紧贴 header 下方开始）合理铺开，不再贴底。两页同一组件 → 高度天然一致。
 *
 * 点线走 AnimatedHeroBg 的淡化参数（density / speed / intensity），底色与底部渐隐
 * 由本组件铺；高度与内边距是 tokens-website.css 的 catalog-hero 令牌。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { Button } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import AnimatedHeroBg from "./AnimatedHeroBg";

export function CatalogHero({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** 「预约演示」（主）。 */
  primaryAction: string;
  /** 「业务咨询」（辅）。 */
  secondaryAction: string;
}) {
  return (
    <section className="vx-catalog-hero">
      {/* 底色：比原 hero 更蓝一档（brand-100 → brand-50 → info-100；暗色深灰渐变）。 */}
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-vx-brand-100 via-vx-brand-50 to-vx-info-100 dark:from-vx-gray-900 dark:via-vx-gray-900 dark:to-vx-gray-800"
        aria-hidden="true"
      />
      {/* 动态点线：稀疏（每 24000px² 一个节点）、慢（0.45×）、淡（0.5×），不画扫描线。 */}
      <AnimatedHeroBg
        density={24000}
        speed={0.45}
        intensity={0.5}
        linkDistance={170}
        layers={false}
      />
      {/* 底部向下渐隐，与内容区平滑过渡。 */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent to-[var(--vx-page-bg)]"
        aria-hidden="true"
      />

      <div className="vx-catalog-hero-content">
        <div className="max-w-website-3xl">
          <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
            {eyebrow}
          </p>
          <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
            {description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
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
