"use client";

/**
 * SolutionsHeroSection.tsx - 解决方案页 Hero（solution-section-hero）
 *
 * Full-viewport snap section: gradient ground + engineering grid + oversized
 * geometric mark on the right, copy and the four industry cards on the left.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  SOLUTIONS_HERO_ID,
  SOLUTION_INDUSTRIES,
  solutionSectionId,
} from "@/data/solutions/solutions.data";
import SolutionsHeroPattern from "./SolutionsHeroPattern";

export default function SolutionsHeroSection() {
  const t = useTranslations("solutions");
  const firstIndustry = SOLUTION_INDUSTRIES[0];

  return (
    <section
      id={SOLUTIONS_HERO_ID}
      data-name="SolutionsHero"
      className="vx-solutions-hero snap-section flex min-h-screen items-center"
    >
      <div className="vx-solutions-grid-layer" aria-hidden="true" />

      {/* 大型几何图案：靠右，随断点放大，窄屏隐藏以免压住文案 */}
      <div
        className="vx-solutions-hero-pattern hidden lg:block"
        aria-hidden="true"
      >
        <SolutionsHeroPattern />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
        <div className="max-w-website-4xl">
          <p className="vx-website-hero-eyebrow text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
            {t("hero.eyebrow")}
          </p>
          <h1 className="font-brand mt-4 text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
            {t("hero.title")}
            <span className="block bg-linear-to-r from-vx-brand-600 to-vx-info-500 bg-clip-text text-transparent dark:from-vx-brand-300 dark:to-vx-info-300">
              {t("hero.titleHighlight")}
            </span>
          </h1>
          <p className="mt-6 max-w-website-3xl text-base leading-7 text-vx-gray-700 dark:text-vx-gray-200">
            {t("hero.description")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
              <Link href="/contact">{t("hero.primaryAction")}</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="xl"
              className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
            >
              <a href={`#${solutionSectionId(firstIndustry?.slug ?? "")}`}>
                {t("hero.secondaryAction")}
              </a>
            </Button>
          </div>
        </div>

        {/* 行业轻量卡片：点击直接吸附到对应行业分节 */}
        <div className="mt-12 lg:mt-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-vx-gray-500 dark:text-vx-gray-400">
            {t("hero.industriesLabel")}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:max-w-website-5xl lg:grid-cols-4">
            {SOLUTION_INDUSTRIES.map((industry) => (
              <a
                key={industry.id}
                href={`#${solutionSectionId(industry.slug)}`}
                className={`vx-solutions-hero-card vx-solutions-panel vx-solutions-industry--${industry.accent} flex flex-col rounded-xl p-4 transition-transform duration-300 hover:-translate-y-1`}
              >
                <span className="vx-solutions-accent-soft flex h-9 w-9 items-center justify-center rounded-md">
                  <Icon name={industry.icon} className="h-5 w-5" />
                </span>
                <span className="mt-4 block text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {t(`industries.${industry.id}.name`)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-vx-gray-600 dark:text-vx-gray-300">
                  {t(`industries.${industry.id}.summary`)}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="vx-solutions-hero-fade" aria-hidden="true" />
    </section>
  );
}
