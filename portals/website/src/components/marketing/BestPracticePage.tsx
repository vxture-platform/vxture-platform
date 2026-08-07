"use client";

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import Image from "next/image";
import AnimatedHeroBg from "./AnimatedHeroBg";

type Capability = {
  icon: IconName;
  title: string;
  description: string;
};

type Practice = {
  image: string;
  imageAlt: string;
  customer: string;
  title: string;
  subtitle: string;
  demand: string;
  architecture: string;
  evaluation: string;
  technologies: string[];
};

type Dimension = {
  icon: IconName;
  title: string;
  description: string;
};

export default function BestPracticePage() {
  const t = useTranslations("cases");
  const highlights = t.raw("page.hero.highlights") as string[];
  const capabilities = t.raw("page.capabilities.items") as Capability[];
  const dimensions = t.raw("page.dimensions.items") as Dimension[];
  const practices = t.raw("page.practices.items") as Practice[];

  return (
    <div className="vx-page-surface">
      <section className="vx-hero-section">
        <AnimatedHeroBg />
        <div className="vx-hero-content">
          <div className="max-w-3xl">
            <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("page.hero.eyebrow")}
            </p>
            <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("page.hero.title")}
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
              {t("page.hero.description")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-vx-brand-100 bg-vx-white/70 px-3 py-1 text-sm font-medium text-vx-brand-700 shadow-sm shadow-vx-brand-900/5 backdrop-blur dark:border-vx-white/20 dark:bg-vx-white/10 dark:text-vx-gray-100"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
                <Link href="/signin">{t("page.hero.primaryAction")}</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="xl"
                className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
              >
                <a href="#practice-list">{t("page.hero.secondaryAction")}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("page.capabilities.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("page.capabilities.title")}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("page.capabilities.description")}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {capabilities.map((item) => (
              <article
                key={item.title}
                className="rounded-lg border border-vx-brand-100 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                  <Icon name={item.icon} className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-even">
        <div className="vx-website-split-grid vx-website-split-grid--32 mx-auto grid max-w-7xl gap-8 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("page.dimensions.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("page.dimensions.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("page.dimensions.description")}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {dimensions.map((item) => (
              <article
                key={item.title}
                className="rounded-lg border border-vx-gray-200 bg-vx-gray-50 p-5 dark:border-vx-gray-800 dark:bg-vx-gray-900"
              >
                <Icon
                  name={item.icon}
                  className="h-5 w-5 text-vx-brand-600 dark:text-vx-brand-300"
                />
                <h3 className="mt-4 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="practice-list" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("page.practices.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("page.practices.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("page.practices.description")}
            </p>
          </div>

          <div className="mt-10 space-y-6">
            {practices.map((practice) => (
              <article
                key={practice.title}
                className="vx-website-split-grid vx-website-split-grid--36 grid overflow-hidden rounded-lg border border-vx-gray-200 bg-vx-white shadow-sm dark:border-vx-gray-800 dark:bg-vx-gray-900"
              >
                <div className="vx-best-practice-media relative">
                  <Image
                    src={practice.image}
                    alt={practice.imageAlt}
                    fill
                    sizes="(min-width: 1024px) 36vw, 100vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-vx-gray-900/72 via-vx-gray-900/8 to-transparent" />
                  <div className="absolute bottom-0 p-5 text-vx-white">
                    <p className="text-xs font-semibold text-vx-info-200">
                      {practice.customer}
                    </p>
                    <p className="mt-2 text-xl font-semibold">
                      {practice.title}
                    </p>
                  </div>
                </div>

                <div className="p-5 lg:p-6">
                  <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                    {practice.subtitle}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {practice.technologies.map((technology) => (
                      <span
                        key={technology}
                        className="rounded-full border border-vx-brand-100 bg-vx-brand-50 px-2.5 py-1 text-xs font-medium text-vx-brand-700 dark:border-vx-brand-400/20 dark:bg-vx-brand-950/35 dark:text-vx-brand-200"
                      >
                        {technology}
                      </span>
                    ))}
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                        <Icon
                          name="building-library"
                          className="h-4 w-4 text-vx-brand-600 dark:text-vx-brand-300"
                        />
                        {t("page.practices.demandLabel")}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                        {practice.demand}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                        <Icon
                          name="workflow"
                          className="h-4 w-4 text-vx-brand-600 dark:text-vx-brand-300"
                        />
                        {t("page.practices.architectureLabel")}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                        {practice.architecture}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                        <Icon
                          name="chat-circle"
                          className="h-4 w-4 text-vx-brand-600 dark:text-vx-brand-300"
                        />
                        {t("page.practices.evaluationLabel")}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                        {practice.evaluation}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-even">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 xl:max-w-screen-2xl">
          <div>
            <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("page.cta.title")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("page.cta.description")}
            </p>
          </div>
          <Button
            asChild
            size="xl"
            className="w-max px-5 hover:bg-vx-brand-500"
          >
            <Link href="/signin">{t("page.cta.action")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
