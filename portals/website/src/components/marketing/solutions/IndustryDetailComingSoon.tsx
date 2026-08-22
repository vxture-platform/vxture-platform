"use client";

/**
 * IndustryDetailComingSoon.tsx - 尚未成稿的行业详情页
 *
 * Keeps every 查看详情 on the overview page live: an industry without a written
 * detail page lands here instead of a 404, and the consult CTA still points at
 * /contact like every other one.
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
import type { SolutionIndustry } from "@/data/solutions/solutions.data";

export default function IndustryDetailComingSoon({
  industry,
}: {
  industry: SolutionIndustry;
}) {
  const t = useTranslations("solutions");
  const base = `industries.${industry.id}`;

  return (
    <div className="vx-page-surface">
      <section
        className={`vx-solutions-industry vx-solutions-industry--${industry.accent} flex min-h-screen items-center`}
      >
        <div className="relative mx-auto w-full max-w-website-4xl px-6 py-24 text-center lg:px-8">
          <span className="vx-solutions-accent-soft mx-auto flex h-14 w-14 items-center justify-center rounded-xl">
            <Icon name={industry.icon} className="h-7 w-7" />
          </span>
          <p className="vx-solutions-accent-text mt-6 text-xs font-semibold uppercase tracking-widest">
            {t("detail.comingSoon.eyebrow")}
          </p>
          <h1 className="font-brand mt-3 text-4xl font-bold text-vx-gray-900 dark:text-vx-white md:text-5xl">
            {t(`${base}.name`)}
          </h1>
          <p className="mt-4 text-lg font-semibold text-vx-gray-700 dark:text-vx-gray-200">
            {t("detail.comingSoon.title")}
          </p>
          <p className="mx-auto mt-5 max-w-website-3xl text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
            {t("detail.comingSoon.description")}
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg" className="px-5 hover:bg-vx-brand-500">
              <Link href="/contact">{t("detail.comingSoon.action")}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="px-5">
              <Link href="/solutions">
                <Icon name="arrow-left" className="h-4 w-4" />
                {t("detail.back")}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
