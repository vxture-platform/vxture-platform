"use client";

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import Image from "next/image";
import { CatalogHero, catalogHeroGhostButtonClass } from "./CatalogHero";

type Pillar = {
  icon: IconName;
  title: string;
  description: string;
  points: string[];
};

type FlowStep = {
  title: string;
  description: string;
};

type AgentCapability = {
  icon: IconName;
  title: string;
  description: string;
};

type Scenario = {
  title: string;
  description: string;
};

type Practice = {
  label: string;
  title: string;
  description: string;
  tags: string[];
};

const PRACTICE_IMAGE = "/images/cases/case-intro-03.webp";

/**
 * 应急行业详情页（/solutions/emergency）。
 *
 * 2026-08-22: /solutions 收敛为多行业汇总页后，本页从「解决方案」整体降为应急
 * 这一个行业的详情，翻译随之从 `solutions.*` 移到 `solutions.emergency.*`，
 * 转化出口统一改到 /contact（与汇总页的方案咨询同一个落点）。
 */
export default function EmergencySolutionPage() {
  const t = useTranslations("solutions.emergency");
  const tShared = useTranslations("solutions");
  const highlights = t.raw("hero.highlights") as string[];
  const pillars = t.raw("architecture.items") as Pillar[];
  const flow = t.raw("flow.steps") as FlowStep[];
  const agents = t.raw("agents.items") as AgentCapability[];
  const scenarios = t.raw("scenarios.items") as Scenario[];
  const practices = t.raw("practice.items") as Practice[];

  return (
    <div className="vx-page-surface">
      {/* hero 与 /appcenter 同一款（旧 hero 壳 2026-09-24 全面退役）；返回链接走 above。 */}
      <CatalogHero
        above={
          <Link
            href="/solutions"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-vx-brand-600 transition-colors hover:text-vx-brand-700 dark:text-vx-brand-300 dark:hover:text-vx-brand-200"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            {tShared("detail.back")}
          </Link>
        }
        eyebrow={t("hero.eyebrow")}
        title={t("hero.title")}
        description={t("hero.description")}
        highlights={highlights}
        actions={
          <>
            <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
              <Link href="/contact">{t("hero.primaryAction")}</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="xl"
              className={catalogHeroGhostButtonClass}
            >
              <a href="#solution-architecture">{t("hero.secondaryAction")}</a>
            </Button>
          </>
        }
      />

      <section id="solution-architecture" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("architecture.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("architecture.title")}
              </h2>
            </div>
            <p className="max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("architecture.description")}
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {pillars.map((pillar) => (
              <article
                key={pillar.title}
                className="rounded-lg border border-vx-brand-100 bg-vx-white p-6 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                  <Icon name={pillar.icon} className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                  {pillar.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {pillar.description}
                </p>
                <ul className="mt-5 space-y-2">
                  {pillar.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2 text-sm text-vx-gray-600 dark:text-vx-gray-300"
                    >
                      <Icon
                        name="check"
                        className="mt-0.5 h-4 w-4 shrink-0 text-vx-brand-500"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-even">
        <div className="vx-website-split-grid vx-website-split-grid--30 mx-auto grid max-w-7xl gap-10 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("flow.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("flow.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("flow.description")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {flow.map((step, index) => (
              <article
                key={step.title}
                className="relative min-h-40 rounded-lg border border-vx-gray-200 bg-vx-white p-5 dark:border-vx-gray-800 dark:bg-vx-gray-900"
              >
                <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("agents.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("agents.title")}
              </h2>
            </div>
            <p className="max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("agents.description")}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <article
                key={agent.title}
                className="rounded-lg border border-vx-gray-200 bg-vx-white p-5 dark:border-vx-gray-800 dark:bg-vx-gray-900"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                    <Icon name={agent.icon} className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                      {agent.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                      {agent.description}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-even">
        <div className="vx-website-split-grid vx-website-split-grid--38 mx-auto grid max-w-7xl gap-10 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("scenarios.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("scenarios.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("scenarios.description")}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {scenarios.map((scenario) => (
              <article
                key={scenario.title}
                className="rounded-lg border border-vx-brand-100 bg-vx-brand-50/50 p-5 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20"
              >
                <h3 className="text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {scenario.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {scenario.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-odd">
        <div className="vx-website-split-grid vx-website-split-grid--42 mx-auto grid max-w-7xl gap-10 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="vx-emergency-practice-media relative overflow-hidden rounded-lg">
            <Image
              src={PRACTICE_IMAGE}
              alt={t("practice.imageAlt")}
              fill
              sizes="(min-width: 1024px) 42vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-linear-to-t from-vx-gray-900/70 via-vx-gray-900/10 to-transparent" />
            <div className="absolute bottom-0 p-6 text-vx-white">
              <p className="text-sm font-semibold text-vx-info-200">
                {t("practice.imageLabel")}
              </p>
              <p className="mt-2 max-w-website-md text-2xl font-semibold">
                {t("practice.imageTitle")}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("practice.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("practice.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("practice.description")}
            </p>

            <div className="mt-8 space-y-4">
              {practices.map((practice) => (
                <article
                  key={practice.title}
                  className="rounded-lg border border-vx-gray-200 bg-vx-white p-5 dark:border-vx-gray-800 dark:bg-vx-gray-900"
                >
                  <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                    {practice.label}
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                    {practice.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                    {practice.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {practice.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-vx-brand-100 bg-vx-brand-50 px-2.5 py-1 text-xs font-medium text-vx-brand-700 dark:border-vx-brand-400/20 dark:bg-vx-brand-950/35 dark:text-vx-brand-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="vx-section-even">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 xl:max-w-screen-2xl">
          <div>
            <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("cta.title")}
            </h2>
            <p className="mt-3 max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("cta.description")}
            </p>
          </div>
          <Button
            asChild
            size="xl"
            className="w-max px-5 hover:bg-vx-brand-500"
          >
            <Link href="/contact">{t("cta.action")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
