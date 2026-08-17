"use client";

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import AnimatedHeroBg from "./AnimatedHeroBg";

type Pillar = {
  icon: IconName;
  title: string;
  description: string;
};

type Step = {
  title: string;
  description: string;
};

type Capability = {
  icon: IconName;
  title: string;
  description: string;
};

export default function AboutUsPage() {
  const t = useTranslations("company.about");
  const highlights = t.raw("hero.highlights") as string[];
  const pillars = t.raw("positioning.items") as Pillar[];
  const steps = t.raw("method.steps") as Step[];
  const capabilities = t.raw("capabilities.items") as Capability[];
  const principles = t.raw("principles.items") as string[];

  return (
    <div className="vx-page-surface">
      <section className="vx-hero-section">
        <AnimatedHeroBg />

        <div className="vx-hero-content">
          <div className="max-w-website-3xl">
            <p className="vx-website-hero-eyebrow mb-4 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("hero.eyebrow")}
            </p>
            <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
              {t("hero.description")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-vx-brand-100 bg-vx-white/70 px-3 py-1 text-sm font-medium text-vx-brand-700 shadow-sm shadow-vx-brand-900/5 backdrop-blur dark:border-vx-white/15 dark:bg-vx-white/10 dark:text-vx-gray-100"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
                <Link href="/signin">{t("hero.primaryAction")}</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="xl"
                className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/25 dark:bg-vx-white/10 dark:text-vx-white dark:hover:bg-vx-white/15"
              >
                <a href="#about-positioning">{t("hero.secondaryAction")}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="about-positioning" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-website-3xl">
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("positioning.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("positioning.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("positioning.description")}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {pillars.map((item) => (
              <article
                key={item.title}
                className="rounded-lg border border-vx-gray-200 bg-vx-gray-50 p-5 dark:border-vx-gray-800 dark:bg-vx-gray-900"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                  <Icon name={item.icon} className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
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
        <div className="vx-website-split-grid vx-website-split-grid--34 mx-auto grid max-w-7xl gap-10 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("method.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("method.title")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("method.description")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-lg border border-vx-brand-100 bg-vx-white p-5 shadow-sm dark:border-vx-gray-800 dark:bg-vx-gray-900"
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
                {t("capabilities.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("capabilities.title")}
              </h2>
            </div>
            <p className="max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("capabilities.description")}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {capabilities.map((item) => (
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

      <section className="vx-section-even">
        <div className="vx-website-split-grid vx-website-split-grid--34 mx-auto grid max-w-7xl gap-8 px-6 lg:px-8 xl:max-w-screen-2xl">
          <div>
            <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {t("principles.eyebrow")}
            </p>
            <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("principles.title")}
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {principles.map((item) => (
              <div
                key={item}
                className="rounded-lg border border-vx-gray-200 bg-vx-white p-4 text-sm leading-6 text-vx-gray-600 dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:text-vx-gray-300"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-section-odd">
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
            <Link href="/signin">{t("cta.action")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
