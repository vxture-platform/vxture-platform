"use client";

/**
 * SolutionsEcosystemSection.tsx - 解决方案页底部（solution-section-bottom）
 *
 * Rewritten around finding ecosystem partners rather than around a product CTA:
 * three partner shapes plus a single contact entry.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { SOLUTIONS_ECOSYSTEM_ID } from "@/data/solutions/solutions.data";

type Partner = { icon: IconName; title: string; description: string };

export default function SolutionsEcosystemSection() {
  const t = useTranslations("solutions");
  const partners = t.raw("ecosystem.partners") as Partner[];

  return (
    <section
      id={SOLUTIONS_ECOSYSTEM_ID}
      data-name="SolutionsEcosystem"
      className="vx-section-even"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
        <div className="max-w-website-4xl">
          <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
            {t("ecosystem.eyebrow")}
          </p>
          <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
            {t("ecosystem.title")}
          </h2>
          <p className="mt-5 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
            {t("ecosystem.description")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {partners.map((partner) => (
            <article
              key={partner.title}
              className="rounded-xl border border-vx-brand-100 bg-vx-white p-6 transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                <Icon name={partner.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                {partner.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                {partner.description}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-6 rounded-2xl border border-vx-brand-100 bg-vx-brand-50/60 p-8 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/25 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-website-3xl">
            <h3 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("ecosystem.contact.title")}
            </h3>
            <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("ecosystem.contact.description")}
            </p>
            <p className="mt-3 text-xs leading-5 text-vx-gray-500 dark:text-vx-gray-400">
              {t("ecosystem.contact.note")}
            </p>
          </div>
          <Button
            asChild
            size="xl"
            className="vx-website-cta-action px-5 hover:bg-vx-brand-500"
          >
            <Link href="/contact">{t("ecosystem.contact.action")}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
