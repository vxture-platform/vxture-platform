"use client";

/**
 * BestPracticePage.tsx - /cases 实践案例（= 解决方案模式）
 *
 * 2026-09-02 owner：实践案例页采用解决方案页的模式——满屏 hero（背景图 + 文案 + 案例卡片）、
 * 每个案例一个满屏分节、全页吸附滚动。复用 /solutions 的视觉体系（.vx-solutions-hero /
 * .vx-solutions-industry--{accent} / .vx-solutions-panel）与首页同一套 `.snap-section` 吸附。
 *
 * 结构：
 *   case-section-hero   满屏：专用背景图（cases-hero-bg.svg，简洁科技底）+ 文案 + 三张案例卡
 *   case-section-{n}    每案例一屏：左 = 客户 / 标题 / 业务需求 / 技术架构；右 = 封面 + 客户评价 + 技术标签
 *   case-section-bottom 收口：预约演示
 *
 * 此前的「统一技术底座」「三维度描述」两节撤掉（owner：简化为背景图 + 案例卡片）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { useWindowScrollSnap } from "@/hooks";
import ScrollToButton from "./ScrollToButton";

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

/** 与 /solutions 同一套色相修饰类，三案例轮流取色。 */
const ACCENTS = ["sky", "red", "amber"] as const;

const HERO_ID = "case-section-hero";
const BOTTOM_ID = "case-section-bottom";
const sectionId = (index: number) => `case-section-${index + 1}`;

/** Same tuning as the home / solutions pages — sections are viewport-height. */
const SNAP_THRESHOLD = 280;

export default function BestPracticePage() {
  const t = useTranslations("cases");
  const practices = t.raw("page.practices.items") as Practice[];
  const { snapToTarget } = useWindowScrollSnap({
    debugFlag: false,
    targetSelector: ".snap-section",
    targetAlignTo: "top",
    snapThreshold: SNAP_THRESHOLD,
    enabledDirections: ["up", "down"],
  });

  return (
    <div className="vx-page-surface relative">
      {/* ── Hero：满屏，背景图 + 文案 + 案例卡 ─────────────────────────────── */}
      <section
        id={HERO_ID}
        data-name="CasesHero"
        className="vx-solutions-hero snap-section flex min-h-screen items-center"
      >
        {/* 背景图：专门画的简洁科技底（柔光 + 同心薄弧 + 点阵 + 斜向光线），不用案例照片；
            左侧再压一层页面底色渐变，文案区干净。 */}
        <div className="vx-cases-hero-bg" aria-hidden="true" />
        <div
          className="absolute inset-0 bg-linear-to-r from-vx-white via-vx-white/70 to-transparent dark:from-vx-gray-900 dark:via-vx-gray-900/70"
          aria-hidden="true"
        />
        <div className="vx-solutions-grid-layer" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-28 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-website-4xl">
            <p className="vx-website-hero-eyebrow text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("page.hero.eyebrow")}
            </p>
            <h1 className="font-brand mt-4 text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("page.hero.title")}
            </h1>
            <p className="mt-6 max-w-website-3xl text-base leading-7 text-vx-gray-700 dark:text-vx-gray-200">
              {t("page.hero.description")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
                <Link href="/contact#support">
                  {t("page.hero.primaryAction")}
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="xl"
                className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
              >
                <a href={`#${sectionId(0)}`}>
                  {t("page.hero.secondaryAction")}
                </a>
              </Button>
            </div>
          </div>

          {/* 案例卡：点击直接吸附到对应案例分节（同解决方案页的行业卡）。 */}
          <div className="mt-12 lg:mt-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-vx-gray-500 dark:text-vx-gray-400">
              {t("page.hero.casesLabel")}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:max-w-website-5xl lg:grid-cols-3">
              {practices.map((practice, index) => (
                <a
                  key={practice.title}
                  href={`#${sectionId(index)}`}
                  className={`vx-solutions-hero-card vx-solutions-panel vx-solutions-industry--${ACCENTS[index % ACCENTS.length]} flex gap-4 overflow-hidden rounded-xl p-4 transition-transform duration-300 hover:-translate-y-1`}
                >
                  <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                    <Image
                      src={practice.image}
                      alt={practice.imageAlt}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="vx-solutions-accent-text block text-xs font-semibold">
                      {practice.customer}
                    </span>
                    <span className="mt-1 block text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                      {practice.title}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-vx-gray-600 dark:text-vx-gray-300">
                      {practice.subtitle}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="vx-solutions-hero-fade" aria-hidden="true" />
      </section>

      {/* ── 每案例一屏 ───────────────────────────────────────────────────── */}
      {practices.map((practice, index) => (
        <section
          key={practice.title}
          id={sectionId(index)}
          data-name={`Case-${index + 1}`}
          className={`vx-solutions-industry vx-solutions-industry--${ACCENTS[index % ACCENTS.length]} snap-section flex min-h-screen items-center`}
        >
          <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:px-8 xl:max-w-screen-2xl">
            {/* 左：客户 / 标题 / 业务需求 / 技术架构 */}
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-3">
                <span className="vx-solutions-accent-soft flex h-11 w-11 items-center justify-center rounded-lg">
                  <Icon name="building-library" className="h-6 w-6" />
                </span>
                <div>
                  <p className="vx-solutions-accent-text text-xs font-semibold uppercase tracking-widest">
                    {t("page.practices.eyebrow")}
                  </p>
                  <p className="text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                    {practice.customer}
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
                {practice.title}
              </h2>
              <p className="vx-solutions-accent-text mt-3 text-sm font-semibold">
                {practice.subtitle}
              </p>

              <dl className="mt-8 space-y-6">
                <div>
                  <dt className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                    <Icon
                      name="building-library"
                      className="vx-solutions-accent-text h-4 w-4"
                    />
                    {t("page.practices.demandLabel")}
                  </dt>
                  <dd className="mt-2 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
                    {practice.demand}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                    <Icon
                      name="workflow"
                      className="vx-solutions-accent-text h-4 w-4"
                    />
                    {t("page.practices.architectureLabel")}
                  </dt>
                  <dd className="mt-2 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
                    {practice.architecture}
                  </dd>
                </div>
              </dl>

              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <Link href="/contact#support">
                    {t("page.practices.demoAction")}
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="vx-solutions-accent-edge px-5"
                >
                  <Link href="/solutions">
                    {t("page.practices.solutionsAction")}
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* 右：封面 + 客户评价 + 技术标签 */}
            <div className="vx-solutions-visual flex flex-col justify-center gap-5">
              <div className="vx-best-practice-media relative overflow-hidden rounded-2xl">
                <Image
                  src={practice.image}
                  alt={practice.imageAlt}
                  fill
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-linear-to-t from-vx-gray-900/72 via-vx-gray-900/8 to-transparent" />
                <div className="absolute bottom-0 flex flex-wrap gap-2 p-5">
                  {practice.technologies.map((technology) => (
                    <span
                      key={technology}
                      className="rounded-full border border-vx-white/40 bg-vx-white/15 px-2.5 py-1 text-xs font-medium text-vx-white backdrop-blur"
                    >
                      {technology}
                    </span>
                  ))}
                </div>
              </div>

              <div className="vx-solutions-panel rounded-2xl p-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                  <Icon
                    name="chat-circle"
                    className="vx-solutions-accent-text h-4 w-4"
                  />
                  {t("page.practices.evaluationLabel")}
                </p>
                <p className="mt-3 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
                  {practice.evaluation}
                </p>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* ── 收口：预约演示 ─────────────────────────────────────────────────── */}
      <section
        id={BOTTOM_ID}
        data-name="CasesBottom"
        className="vx-section-even"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-website-4xl">
            <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t("page.cta.title")}
            </h2>
            <p className="mt-3 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
              {t("page.cta.description")}
            </p>
          </div>
          <Button
            asChild
            size="xl"
            className="vx-website-cta-action w-max px-5 hover:bg-vx-brand-500"
          >
            <Link href="/contact#support">{t("page.cta.action")}</Link>
          </Button>
        </div>
      </section>

      <ScrollToButton snapToTarget={snapToTarget} />
    </div>
  );
}
