"use client";

/**
 * AboutUsPage.tsx - /about 关于我们（三屏，无 hero，吸附滚动）
 *
 * 2026-09-02 owner 三轮裁定：
 *   · 三个主题要醒目：每屏一句话当亮点（大标题 + 高亮行），几条辅助点各一短句；不做大段卡片，无 icon。
 *   · 借鉴解决方案 hero 板块的思路（渐变底 + 工程网格 + 线框球体），但不套模板，三屏左右 / 结构各异：
 *       01 定位 · 我们是谁     —— 文案靠左，球体靠右；三条判断横排在下（借 hero 思路）
 *       02 方法 · 我们怎么做   —— 镜像：网格靠左；四步阶梯（大号数字）在左，文案在右；三条承诺一行
 *       03 能力 · 我们能交付什么 —— 居中：文案居中，四层横向一排，球体居中垫底；CTA 居中
 *   · 文案是判断与主张（重写所有行业、服务所有企业），与产品 / 方案 / 案例页零重复。
 *
 * 每屏用 .vx-solutions-industry--{accent} 提供 --solutions-accent（sky / emerald / amber），
 * 吸附复用首页 `.snap-section` 契约（顶部留 header 高度由 .snap-section 统一给）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { useWindowScrollSnap } from "@/hooks";
import ScrollToButton from "./ScrollToButton";
import { PathPattern, RadarPattern, StackPattern } from "./about/AboutPatterns";

type Point = { title: string; description: string };

const SECTION_IDS = {
  positioning: "about-section-positioning",
  method: "about-section-method",
  capabilities: "about-section-capabilities",
} as const;

/** Same tuning as the home / solutions pages — sections are viewport-height. */
const SNAP_THRESHOLD = 280;

/** 一句话亮点：眉题 + 大标题（第二行高亮渐变）+ 一句描述。 */
function Statement({
  eyebrow,
  title,
  titleHighlight,
  description,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  titleHighlight: string;
  description: string;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-website-4xl text-center" : ""}>
      <p className="vx-website-hero-eyebrow vx-solutions-accent-text text-sm font-semibold uppercase">
        {eyebrow}
      </p>
      <h2 className="font-brand mt-4 text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
        {title}
        <span className="block bg-linear-to-r from-vx-brand-600 to-vx-info-500 bg-clip-text text-transparent dark:from-vx-brand-300 dark:to-vx-info-300">
          {titleHighlight}
        </span>
      </h2>
      <p
        className={`mt-6 text-base leading-7 text-vx-gray-700 dark:text-vx-gray-200 ${
          centered ? "mx-auto max-w-website-3xl" : "max-w-website-3xl"
        }`}
      >
        {description}
      </p>
    </div>
  );
}

/** 辅助点：短 accent 横线 + 一句话 + 一行小字。 */
function PointItem({ point }: { point: Point }) {
  return (
    <div className="vx-about-point">
      <p className="mt-4 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
        {point.title}
      </p>
      <p className="mt-1 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
        {point.description}
      </p>
    </div>
  );
}

export default function AboutUsPage() {
  const t = useTranslations("company.about");
  const pillars = t.raw("positioning.items") as Point[];
  const steps = t.raw("method.steps") as Point[];
  const principles = t.raw("method.principles") as string[];
  const layers = t.raw("capabilities.items") as Point[];
  const { snapToTarget } = useWindowScrollSnap({
    debugFlag: false,
    targetSelector: ".snap-section",
    targetAlignTo: "top",
    snapThreshold: SNAP_THRESHOLD,
    enabledDirections: ["up", "down"],
  });

  return (
    <div className="vx-page-surface relative">
      {/* 01 定位 · 我们是谁 —— 借解决方案 hero 思路：渐变底 + 右半网格 + 右侧球体；文案左，三条判断横排在下 */}
      <section
        id={SECTION_IDS.positioning}
        data-name="About-Positioning"
        className="vx-solutions-hero vx-solutions-industry--sky snap-section flex min-h-screen items-center"
      >
        <div className="vx-solutions-grid-layer" aria-hidden="true" />
        {/* 01 图案：雷达（同心圆 + 刻度 + 扫描扇面 + 汇聚节点），与解决方案页的球体不同 */}
        <div
          className="vx-solutions-hero-pattern hidden lg:block"
          aria-hidden="true"
        >
          <RadarPattern />
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-website-4xl">
            <Statement
              eyebrow={t("positioning.eyebrow")}
              title={t("positioning.title")}
              titleHighlight={t("positioning.titleHighlight")}
              description={t("positioning.description")}
            />
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-3 lg:max-w-website-5xl lg:mt-20">
            {pillars.map((point) => (
              <PointItem key={point.title} point={point} />
            ))}
          </div>
        </div>

        <div className="vx-solutions-hero-fade" aria-hidden="true" />
      </section>

      {/* 02 方法 · 我们怎么做 —— 镜像：网格靠左；左侧四步阶梯（大号数字），右侧一句话亮点 + 三条承诺 */}
      <section
        id={SECTION_IDS.method}
        data-name="About-Method"
        className="vx-solutions-industry vx-solutions-industry--emerald snap-section flex min-h-screen items-center"
      >
        <div
          className="vx-solutions-grid-layer vx-solutions-grid-layer--left"
          aria-hidden="true"
        />
        {/* 02 图案：点阵上的阶梯路径（四个落点），落在右下角留白处 */}
        <div
          className="vx-about-pattern-corner hidden lg:block"
          aria-hidden="true"
        >
          <PathPattern />
        </div>
        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-16 lg:px-8 xl:max-w-screen-2xl">
          {/* 四步是真实的先后次序：大号数字承载信息，不是装饰 */}
          <ol className="order-2 lg:order-1 lg:col-span-6">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="vx-about-step flex items-baseline gap-6 py-6 pl-6"
              >
                <span
                  className="vx-about-step-numeral font-mono text-4xl font-bold leading-none md:text-5xl"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="order-1 flex flex-col justify-center lg:order-2 lg:col-span-6">
            <Statement
              eyebrow={t("method.eyebrow")}
              title={t("method.title")}
              titleHighlight={t("method.titleHighlight")}
              description={t("method.description")}
            />
            <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
              {principles.map((principle) => (
                <li
                  key={principle}
                  className="flex items-center gap-2 text-sm font-medium text-vx-gray-800 dark:text-vx-gray-100"
                >
                  <span
                    className="vx-solutions-accent-fill h-1.5 w-1.5 rounded-full"
                    aria-hidden="true"
                  />
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 03 能力 · 我们能交付什么 —— 居中：一句话亮点居中，四层横向一排，球体居中垫底，CTA 居中 */}
      <section
        id={SECTION_IDS.capabilities}
        data-name="About-Capabilities"
        className="vx-solutions-industry vx-solutions-industry--amber snap-section flex min-h-screen items-center"
      >
        <div
          className="vx-solutions-grid-layer vx-solutions-grid-layer--full"
          aria-hidden="true"
        />
        {/* 03 图案：四层等轴测叠板，居中垫在四项能力后面 */}
        <div
          className="vx-about-pattern-center hidden lg:block"
          aria-hidden="true"
        >
          <StackPattern />
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <Statement
            align="center"
            eyebrow={t("capabilities.eyebrow")}
            title={t("capabilities.title")}
            titleHighlight={t("capabilities.titleHighlight")}
            description={t("capabilities.description")}
          />
          <div className="mx-auto mt-14 grid max-w-website-5xl gap-8 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
            {layers.map((point) => (
              <PointItem key={point.title} point={point} />
            ))}
          </div>
          <div className="mt-14 flex flex-col items-center gap-4 text-center lg:mt-20">
            <p className="text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
              {t("capabilities.cta.title")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
                <Link href="/contact#support">
                  {t("capabilities.cta.action")}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="xl"
                className="vx-solutions-accent-edge px-5"
              >
                <Link href="/cases">
                  {t("capabilities.cta.secondary")}
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ScrollToButton snapToTarget={snapToTarget} />
    </div>
  );
}
