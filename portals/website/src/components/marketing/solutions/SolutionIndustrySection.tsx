"use client";

/**
 * SolutionIndustrySection.tsx - 单个行业的满屏吸附分节（solution-section-*）
 *
 * One section per industry, each filling the viewport so the page snaps like the
 * home page does. Accent colour is carried by a modifier class rather than by
 * props, so every hue stays in the token layer.
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
  solutionSectionId,
  type SolutionIndustry,
} from "@/data/solutions/solutions.data";

type Capability = { title: string; description: string };
type Metric = { value: string; label: string };

export default function SolutionIndustrySection({
  industry,
  index,
}: {
  industry: SolutionIndustry;
  index: number;
}) {
  const t = useTranslations("solutions");
  const base = `industries.${industry.id}`;
  const capabilities = t.raw(`${base}.capabilities`) as Capability[];
  const scenarios = t.raw(`${base}.scenarios`) as string[];
  const metrics = t.raw(`${base}.metrics`) as Metric[];

  return (
    <section
      id={solutionSectionId(industry.slug)}
      data-name={`Solution-${industry.slug}`}
      className={`vx-solutions-industry vx-solutions-industry--${industry.accent} snap-section flex min-h-screen items-center`}
    >
      <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:px-8 xl:max-w-screen-2xl">
        {/* 左：行业定位与核心能力 */}
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-3">
            <span className="vx-solutions-accent-soft flex h-11 w-11 items-center justify-center rounded-lg">
              <Icon name={industry.icon} className="h-6 w-6" />
            </span>
            <div>
              <p className="vx-solutions-accent-text text-xs font-semibold uppercase tracking-widest">
                {t(`${base}.eyebrow`)}
              </p>
              <p className="text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                {t(`${base}.name`)}
              </p>
            </div>
            <span
              className="ml-auto text-4xl font-bold text-vx-gray-200 dark:text-vx-gray-700"
              aria-hidden="true"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>

          <h2 className="font-display mt-8 text-3xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white lg:text-4xl">
            {t(`${base}.title`)}
          </h2>
          <p className="mt-5 max-w-website-3xl text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
            {t(`${base}.description`)}
          </p>

          <div className="mt-8">
            <p className="text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
              {t("ui.capabilitiesTitle")}
            </p>
            <ul className="mt-4 space-y-4">
              {capabilities.map((capability) => (
                <li key={capability.title} className="flex gap-3">
                  <span
                    className="vx-solutions-accent-fill mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                      {capability.title}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                      {capability.description}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Button asChild size="lg" className="px-5 hover:bg-vx-brand-500">
              <Link href={`/solutions/${industry.slug}`}>
                {t("ui.viewDetails")}
              </Link>
            </Button>
            {/* 方案咨询统一落到 /contact —— 按钮之间互相跳转没有意义。 */}
            <Button
              asChild
              variant="outline"
              size="lg"
              className="vx-solutions-accent-edge px-5"
            >
              <Link href="/contact">
                {t("ui.consult")}
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* 右：指标 + 典型场景 */}
        <div className="vx-solutions-visual flex flex-col justify-center gap-5">
          <div className="grid grid-cols-3 gap-3">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="vx-solutions-panel rounded-xl p-4 text-center"
              >
                <p className="vx-solutions-accent-text text-xl font-bold">
                  {metric.value}
                </p>
                <p className="mt-2 text-xs leading-5 text-vx-gray-600 dark:text-vx-gray-300">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>

          <div className="vx-solutions-panel rounded-2xl p-6">
            <p className="text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
              {t("ui.scenariosTitle")}
            </p>
            <ul className="mt-4 space-y-3">
              {scenarios.map((scenario) => (
                <li
                  key={scenario}
                  className="flex gap-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300"
                >
                  <Icon
                    name="check"
                    className="vx-solutions-accent-text mt-1 h-4 w-4 shrink-0"
                  />
                  <span>{scenario}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
