"use client";

/**
 * AboutUsPage.tsx - /about 关于我们（三屏，无 hero，吸附滚动）
 *
 * 2026-09-02 owner：去掉 hero，三个满屏分节、全页吸附；文案要「高度」——不是网站说明书、
 * 不与产品 / 方案 / 案例页重复，写的是判断与主张（重写所有行业、服务所有企业）：
 *   01 定位 · 我们是谁     —— 每一个行业都将被智能重写（三个判断）
 *   02 方法 · 我们怎么做   —— 让智能长进业务的骨骼（四条方法论，序号承载真实次序）+ 三条承诺
 *   03 能力 · 我们能交付什么 —— 一套完整的行业智能体系（四层）+ CTA
 * 结构固定为 标题 + 描述 + 3~4 卡；卡片走 website-about.css 的科技感修饰（.vx-about-card）。
 *
 * 分节视觉复用 /solutions 的 .vx-solutions-industry--{accent}（提供 --solutions-accent），
 * 吸附复用首页 `.snap-section` 契约（顶部留 header 高度由 .snap-section 统一给）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { useWindowScrollSnap } from "@/hooks";
import ScrollToButton from "./ScrollToButton";

type Pillar = { icon: IconName; title: string; description: string };
type Step = { title: string; description: string };
type Capability = { icon: IconName; title: string; description: string };

const SECTIONS = [
  { id: "about-section-positioning", key: "positioning", accent: "sky" },
  { id: "about-section-method", key: "method", accent: "emerald" },
  { id: "about-section-capabilities", key: "capabilities", accent: "amber" },
] as const;

/** Same tuning as the home / solutions pages — sections are viewport-height. */
const SNAP_THRESHOLD = 280;

function SectionHeading({
  index,
  eyebrow,
  title,
  description,
  icon,
}: {
  index: number;
  eyebrow: string;
  title: string;
  description: string;
  icon: IconName;
}) {
  return (
    <div className="flex flex-col justify-center">
      <div className="flex items-center gap-3">
        <span className="vx-about-card-icon">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <p className="vx-solutions-accent-text text-xs font-semibold uppercase tracking-widest">
          {eyebrow}
        </p>
        <span
          className="ml-auto font-mono text-4xl font-bold text-vx-gray-200 dark:text-vx-gray-700"
          aria-hidden="true"
        >
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <h2 className="font-display mt-8 text-3xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white lg:text-4xl">
        {title}
      </h2>
      <p className="mt-5 max-w-website-3xl text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
        {description}
      </p>
    </div>
  );
}

/** 右下 L 形角标：每张卡都有，纯装饰。 */
function CardCorner() {
  return <span className="vx-about-card-corner" aria-hidden="true" />;
}

export default function AboutUsPage() {
  const t = useTranslations("company.about");
  const pillars = t.raw("positioning.items") as Pillar[];
  const steps = t.raw("method.steps") as Step[];
  const principles = t.raw("method.principles") as string[];
  const capabilities = t.raw("capabilities.items") as Capability[];
  const { snapToTarget } = useWindowScrollSnap({
    debugFlag: false,
    targetSelector: ".snap-section",
    targetAlignTo: "top",
    snapThreshold: SNAP_THRESHOLD,
    enabledDirections: ["up", "down"],
  });

  return (
    <div className="vx-page-surface relative">
      {/* 01 定位 · 我们是谁 */}
      <section
        id={SECTIONS[0].id}
        data-name="About-Positioning"
        className={`vx-solutions-industry vx-solutions-industry--${SECTIONS[0].accent} snap-section flex min-h-screen items-center`}
      >
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:px-8 xl:max-w-screen-2xl">
          <SectionHeading
            index={0}
            icon="buildings"
            eyebrow={t("positioning.eyebrow")}
            title={t("positioning.title")}
            description={t("positioning.description")}
          />
          <div className="vx-solutions-visual flex flex-col justify-center gap-4">
            {pillars.map((item) => (
              <article key={item.title} className="vx-about-card flex gap-4">
                <span className="vx-about-card-icon shrink-0">
                  <Icon name={item.icon} className="h-5 w-5" />
                </span>
                <div className="pr-6">
                  <h3 className="text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                    {item.description}
                  </p>
                </div>
                <CardCorner />
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 02 方法 · 我们怎么做 */}
      <section
        id={SECTIONS[1].id}
        data-name="About-Method"
        className={`vx-solutions-industry vx-solutions-industry--${SECTIONS[1].accent} snap-section flex min-h-screen items-center`}
      >
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col justify-center gap-8">
            <SectionHeading
              index={1}
              icon="workflow"
              eyebrow={t("method.eyebrow")}
              title={t("method.title")}
              description={t("method.description")}
            />
            <div className="vx-about-card">
              <p className="text-sm font-semibold text-vx-gray-900 dark:text-vx-white">
                {t("method.principlesTitle")}
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                {principles.map((principle) => (
                  <li
                    key={principle}
                    className="flex items-center gap-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200"
                  >
                    <Icon
                      name="check"
                      className="vx-solutions-accent-text h-4 w-4 shrink-0"
                    />
                    <span>{principle}</span>
                  </li>
                ))}
              </ul>
              <CardCorner />
            </div>
          </div>
          {/* 四步是真实的先后次序：序号承载信息，不是装饰。 */}
          <ol className="vx-solutions-visual grid content-center gap-4 sm:grid-cols-2">
            {steps.map((step, index) => (
              <li key={step.title} className="vx-about-card">
                <p className="vx-about-card-index font-mono text-xs font-semibold">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {step.description}
                </p>
                <CardCorner />
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 03 能力 · 我们能交付什么 */}
      <section
        id={SECTIONS[2].id}
        data-name="About-Capabilities"
        className={`vx-solutions-industry vx-solutions-industry--${SECTIONS[2].accent} snap-section flex min-h-screen items-center`}
      >
        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col justify-center gap-8">
            <SectionHeading
              index={2}
              icon="sparkles"
              eyebrow={t("capabilities.eyebrow")}
              title={t("capabilities.title")}
              description={t("capabilities.description")}
            />
            <div className="vx-about-card">
              <p className="text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                {t("capabilities.cta.title")}
              </p>
              <p className="mt-2 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                {t("capabilities.cta.description")}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <Button
                  asChild
                  size="lg"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <Link href="/contact#support">
                    {t("capabilities.cta.action")}
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="vx-solutions-accent-edge px-5"
                >
                  <Link href="/cases">
                    {t("capabilities.cta.secondary")}
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <CardCorner />
            </div>
          </div>
          <div className="vx-solutions-visual grid content-center gap-4 sm:grid-cols-2">
            {capabilities.map((item) => (
              <article key={item.title} className="vx-about-card">
                <span className="vx-about-card-icon">
                  <Icon name={item.icon} className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-vx-gray-900 dark:text-vx-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {item.description}
                </p>
                <CardCorner />
              </article>
            ))}
          </div>
        </div>
      </section>

      <ScrollToButton snapToTarget={snapToTarget} />
    </div>
  );
}
