/**
 * SolutionSection.tsx - 首页解决方案区块（重构版）
 *
 * 功能：展示首页 Solutions 区块 UI，支持吸附滚动、响应式布局、方案轮播
 *
 * @author vxture team
 * @created 2024-06-01
 * @lastModified 2026-03-19
 * @version 2.2.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Components - Home
 */
"use client";

import { useState, memo, useCallback } from "react";
import Image from "next/image";
import { Button, Icon } from "@vxture/design-system";
import { useTranslations } from "next-intl";
import { debugLog } from "@vxture-platform/shared";
import {
  SOLUTIONS_DATA,
  type SolutionItem,
} from "@/data/home/home.solutions.data";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 解决方案卡片 Props
 */
interface SolutionCardProps {
  readonly solution: SolutionItem;
  readonly idx: number;
  readonly uiTexts: {
    readonly viewDetails: string;
    readonly prev: string;
    readonly next: string;
  };
  readonly featuresTitle: string;
  readonly prev: () => void;
  readonly next: () => void;
}

/**
 * 解决方案区块主组件 Props
 */
interface SolutionSectionProps {
  readonly id: string;
  readonly name?: string;
}

// ============================================================================
// 子组件定义
// ============================================================================

/**
 * 解决方案卡片组件（性能优化：React.memo）
 *
 * 统一色值规范：
 *   light: 左侧白底，蓝色标题，灰色描述；右侧浅蓝渐变背景
 *   dark:  左侧 vx-gray-700，蓝色浅标题，vx-gray-300 描述；右侧 vx-gray-600 渐变背景
 */
const SolutionCard = memo(function SolutionCard({
  solution,
  idx,
  uiTexts,
  featuresTitle,
  prev,
  next,
}: SolutionCardProps) {
  const t = useTranslations("home.solutions");

  return (
    <div className="w-full transition-all duration-500">
      <div className="vx-solution-card-grid grid h-full overflow-hidden rounded-2xl shadow-lg">
        {/* 左侧文本内容 */}
        <div className="relative flex h-full items-center justify-start px-4 py-4 bg-vx-white dark:bg-vx-gray-700">
          <div className="relative w-full h-full flex flex-col gap-4 justify-items-start">
            {/* 标题与副标题 */}
            <div className="relative flex items-center h-20 min-h-20">
              {/* 背景数字 */}
              <span
                className="vx-solution-index absolute left-0 top-1/2 z-0 -translate-y-1/2 select-none font-semibold text-vx-brand-300 opacity-70 drop-shadow-lg pointer-events-none dark:text-vx-brand-500"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              {/* 标题内容 */}
              <div className="relative z-10 flex-1 flex flex-col items-start py-6 pl-12">
                <h3 className="text-xl font-bold text-vx-brand-700 dark:text-vx-brand-200 text-left">
                  {t(`items.${solution.id}.title`)}
                </h3>
                <p className="text-sm text-vx-gray-600 dark:text-vx-gray-300 mt-1 text-left">
                  {t(`items.${solution.id}.subtitle`)}
                </p>
              </div>
            </div>
            {/* 方案描述 */}
            <div className="items-center justify-left ml-12">
              <p className="text-base text-vx-gray-600 dark:text-vx-gray-300 leading-relaxed">
                {t(`items.${solution.id}.description`)}
              </p>
            </div>
            {/* 特色标签 */}
            <div className="items-center justify-left mt-4 ml-12">
              <h4 className="text-lg font-semibold text-vx-brand-700 dark:text-vx-brand-200">
                {featuresTitle}
              </h4>
              <div className="grid grid-cols-2 gap-3 justify-items-left my-2">
                {[
                  t(`items.${solution.id}.tags.0`),
                  t(`items.${solution.id}.tags.1`),
                  t(`items.${solution.id}.tags.2`),
                ].map(
                  (tag, tagIdx) =>
                    tag && (
                      <div
                        key={tagIdx}
                        className="flex items-center justify-start space-x-2"
                      >
                        <div className="w-2 h-2 rounded-full bg-linear-to-r from-vx-brand-500 to-vx-info-500"></div>
                        <span className="text-base text-vx-gray-600 dark:text-vx-gray-300">
                          {tag}
                        </span>
                      </div>
                    ),
                )}
              </div>
            </div>
            {/* 了解更多与导航按钮 */}
            <div className="flex flex-col gap-4 mt-auto mb-4">
              {/* 了解更多 */}
              <div className="flex justify-start items-center ml-12">
                <Button asChild variant="default" className="w-max px-5">
                  <a href={solution.cta.href}>{uiTexts.viewDetails}</a>
                </Button>
              </div>
              {/* 分割线 */}
              <div className="w-full h-px bg-vx-gray-200 dark:bg-vx-gray-600"></div>
              {/* 导航按钮 */}
              <div className="flex justify-center">
                <div className="flex gap-6">
                  <Button
                    variant="ghost"
                    size="md"
                    aria-label="Previous"
                    onClick={prev}
                    className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-vx-gray-100 dark:hover:bg-vx-gray-600 transition-all duration-300 hover:shadow-md"
                  >
                    <Icon
                      name="caret-left-bold"
                      className="w-4 h-4 text-vx-gray-400 dark:text-vx-gray-400"
                    />
                    <span className="text-vx-gray-400 dark:text-vx-gray-400 font-medium text-sm">
                      {uiTexts.prev}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    aria-label="Next"
                    onClick={next}
                    className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-vx-gray-100 dark:hover:bg-vx-gray-600 transition-all duration-300 hover:shadow-md"
                  >
                    <span className="text-vx-gray-400 dark:text-vx-gray-400 font-medium text-sm">
                      {uiTexts.next}
                    </span>
                    <Icon
                      name="caret-right-bold"
                      className="w-4 h-4 text-vx-gray-400 dark:text-vx-gray-400"
                    />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 右侧图片内容 */}
        <div className="bg-linear-to-r from-vx-brand-50 via-vx-brand-100 to-vx-brand-50 dark:from-vx-gray-600 dark:via-vx-gray-500 dark:to-vx-gray-600">
          <div className="relative flex items-center justify-center px-38">
            <div className="relative w-full max-w-website-2xl h-auto flex flex-col items-center justify-start hover:scale-105 transition-all duration-300 py-6">
              <div className="relative w-full pointer-events-none select-none">
                <div className="vx-solution-cover-frame absolute flex items-center justify-center">
                  <div className="w-full h-full overflow-hidden z-10">
                    <Image
                      src={solution.cover.url}
                      alt={t(`items.${solution.id}.cover.alt`)}
                      width={1}
                      height={1}
                      // Solutions is an below-the-fold section (3rd full-screen
                      // snap section) and a carousel that only mounts the active
                      // slide. Lazy-load it instead of preloading; and cap the
                      // requested variant to the real display width (max-w-website-2xl
                      // ≈ 672px) rather than the full viewport.
                      sizes="(max-width: 768px) 100vw, 672px"
                      loading="lazy"
                      className="w-full h-auto object-contain select-none pointer-events-none block"
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// 主组件实现
// ============================================================================

/**
 * 解决方案区块主组件
 *
 * 背景渐变：section 3（Solutions）
 *   light: from-vx-brand-50 to-vx-white   （上接 Features 浅蓝，向下过渡到白）
 *   dark:  from-vx-gray-700 to-vx-gray-800
 */
const SolutionSection = memo(function SolutionSection({
  id,
  name = "Solutions",
}: SolutionSectionProps) {
  const [current, setCurrent] = useState<number>(0);
  const t = useTranslations("home.solutions");

  debugLog("Solutions data:", SOLUTIONS_DATA);

  const total = SOLUTIONS_DATA.items.length;

  const prev = useCallback(() => {
    setCurrent((prev) => (prev - 1 + total) % total);
  }, [total]);

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % total);
  }, [total]);

  if (!SOLUTIONS_DATA.enabled) {
    return null;
  }

  const { items } = SOLUTIONS_DATA;
  const title = t(SOLUTIONS_DATA.titleKey);
  const subtitle = t(SOLUTIONS_DATA.subtitleKey);
  const tagline = t(SOLUTIONS_DATA.taglineKey);
  const featuresTitle = t(SOLUTIONS_DATA.featuresTitleKey);
  const uiTexts = {
    viewDetails: t(SOLUTIONS_DATA.ui.viewDetailsKey),
    prev: t(SOLUTIONS_DATA.ui.prevKey),
    next: t(SOLUTIONS_DATA.ui.nextKey),
  };

  return (
    <section
      id={id}
      data-name={name}
      className="vx-section-even relative snap-section min-h-screen flex flex-col"
    >
      <div className="w-full max-w-7xl xl:max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col h-full min-h-screen">
        {/* 1. 标题区 */}
        <div className="text-center pt-28">
          <h2 className="font-display text-3xl lg:text-4xl font-bold text-vx-brand-700 dark:text-vx-brand-200 mb-4">
            {title}
          </h2>
          <p className="text-lg text-vx-gray-600 dark:text-vx-gray-300 max-w-website-4xl mx-auto">
            {subtitle}
          </p>
        </div>

        {/* 2. 内容区 */}
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full">
            {/* 方案标题导航 */}
            <div className="flex justify-center mb-4">
              <div className="flex items-center gap-2 sm:gap-4">
                {items.map((solution, idx) => (
                  <Button
                    key={solution.id}
                    variant={idx === current ? "secondary" : "ghost"}
                    size="md"
                    onClick={() => setCurrent(idx)}
                    className={`text-xs sm:text-sm transition-all duration-300 px-2 sm:px-3 py-1 rounded-full ${
                      idx === current
                        ? "text-vx-brand-700 dark:text-vx-brand-200 font-semibold bg-vx-brand-100 dark:bg-vx-brand-800/40"
                        : "text-vx-gray-400 dark:text-vx-gray-400 hover:text-vx-gray-600 dark:hover:text-vx-gray-300"
                    }`}
                  >
                    {t(`items.${solution.id}.title`)}
                  </Button>
                ))}
              </div>
            </div>

            {/* 方案轮播区块 */}
            <div className="w-full flex justify-center">
              {items.map((solution, idx) => {
                if (idx !== current) return null;
                return (
                  <SolutionCard
                    key={solution.id}
                    solution={solution}
                    idx={idx}
                    uiTexts={uiTexts}
                    featuresTitle={featuresTitle}
                    prev={prev}
                    next={next}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. 底部 tagline */}
        {tagline && (
          <div className="text-center pb-12">
            <div className="inline-flex items-center space-x-2">
              <div className="w-8 h-0.5 bg-linear-to-r from-transparent to-vx-brand-200 dark:to-vx-brand-600"></div>
              <span className="text-sm font-medium text-vx-brand-500 dark:text-vx-brand-300">
                {tagline}
              </span>
              <div className="w-8 h-0.5 bg-linear-to-l from-transparent to-vx-brand-200 dark:to-vx-brand-600"></div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
});

export default SolutionSection;
