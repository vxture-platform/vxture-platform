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
 * 2026-09-24 owner：「原来的这个 herosection 全面退役了，这个效果很不好」「点线动图效果
 * ——完全复用新款」「包括 herosection 的高度」。于是三个还在用旧壳（`.vx-hero-section`
 * ＋满强度 AnimatedHeroBg）的页面也改用本组件：
 *
 *   · AgentProductDetail    智能体详情页（/products/<code>）
 *   · ProductDetailPartOne  平台产品详情页
 *   · EmergencySolutionPage 应急方案页
 *
 * 那三页的内容比目录页多两样（标题上方的返回链接、描述下方的能力胶囊），按钮也各不相同
 * （详情页那颗是「订阅 / 敬请期待」，不是「预约演示」）。所以本组件收三个可选口子：
 * `above` / `highlights` / `actions`——**不是**把它们的内容削成目录页那两颗按钮。
 * 目录两页一个字都不用改：不传这三项时行为与之前完全一致。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import type { ReactNode } from "react";
import { Button } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import AnimatedHeroBg from "./AnimatedHeroBg";

/**
 * hero 里那颗辅助按钮的样式。四个消费方本来各抄一份同样的长串类名，抄漏一处不会
 * 报错、只会有一颗长得不一样的按钮——所以在这里定一次。
 */
export const catalogHeroGhostButtonClass =
  "border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10";

/** hero 里能力胶囊的样式（详情页与方案页共用）。 */
const chipClass =
  "rounded-full border border-vx-brand-100 bg-vx-white/70 px-3 py-1 text-sm font-medium text-vx-brand-700 shadow-sm shadow-vx-brand-900/5 backdrop-blur dark:border-vx-white/20 dark:bg-vx-white/10 dark:text-vx-gray-100";

export function CatalogHero({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  above,
  highlights,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
  /** 「预约演示」（主）。给了 `actions` 时忽略。 */
  primaryAction?: string | undefined;
  /** 「业务咨询」（辅）。给了 `actions` 时忽略。 */
  secondaryAction?: string | undefined;
  /** 眉题**上方**一行：详情页/方案页的「返回」链接。 */
  above?: ReactNode | undefined;
  /** 描述**下方**的能力胶囊行；空数组与不传一样不渲染。 */
  highlights?: readonly string[] | undefined;
  /** 整块替换默认的「预约演示 + 业务咨询」。详情页那两颗按钮语义完全不同。 */
  actions?: ReactNode | undefined;
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

      {/* 左对齐、靠上排；顶部留白大（padding 由令牌给），四行之间松散（mb-4 / mt-6 / mt-8），
          描述行加宽到 5xl（64rem）尽量一行显示（owner 2026-09-02）。 */}
      <div className="vx-catalog-hero-content">
        <div className="max-w-website-5xl">
          {above}
          <p className="vx-website-hero-eyebrow mb-4 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
            {eyebrow}
          </p>
          <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-5xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-6 max-w-website-5xl text-base leading-7 text-vx-gray-700 dark:text-vx-gray-200">
              {description}
            </p>
          ) : null}
          {highlights && highlights.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span key={item} className={chipClass}>
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {actions ?? (
              <>
                <Button
                  asChild
                  size="xl"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <Link href="/contact#support">{primaryAction}</Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="xl"
                  className={catalogHeroGhostButtonClass}
                >
                  <Link href="/contact#ecosystem">{secondaryAction}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
