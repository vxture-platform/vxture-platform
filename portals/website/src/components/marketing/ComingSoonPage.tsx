"use client";

/**
 * ComingSoonPage.tsx - 「待建设」页模板
 *
 * 全站待建设页的唯一形状：满屏、上下渐变底、居中的图标 + eyebrow + 名称 +
 * 一行状态 + 一段说明 + 主次两个按钮。任何还没成稿的页面都挂这一件，不再
 * 各写各的——否则「开发中」在不同入口会长成三四个样子。
 *
 * 底色是**从上到下**的渐变，与 legacy 的分节底（`.vx-section-odd`）同一语言，
 * 但不复用那条规则：这里直接用 DS token 支撑的工具类拼，页面层不新增 CSS。
 * 明暗两套各自声明——brand-100 是 T1 定值色阶、不跟随模式，暗色下直接用会发白。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-22
 */

import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";

export type ComingSoonAccent = "brand" | "sky" | "amber" | "emerald" | "red";

/**
 * 强调色。每档写成**完整类名字符串**，不做 `text-vx-${hue}-600` 拼接：
 * Tailwind 只为源码里字面出现的类名产出规则，拼接出来的不产出任何 CSS
 * 且不报错——症状是「颜色没生效」，与本仓踩过的几处静默失效同源。
 */
const ACCENT_CLASSES: Record<
  ComingSoonAccent,
  { readonly chip: string; readonly ink: string }
> = {
  brand: {
    chip: "bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200",
    ink: "text-vx-brand-600 dark:text-vx-brand-300",
  },
  sky: {
    chip: "bg-vx-info-50 text-vx-info-600 dark:bg-vx-info-900/40 dark:text-vx-info-200",
    ink: "text-vx-info-600 dark:text-vx-info-300",
  },
  amber: {
    chip: "bg-vx-warning-50 text-vx-warning-600 dark:bg-vx-warning-900/40 dark:text-vx-warning-200",
    ink: "text-vx-warning-600 dark:text-vx-warning-300",
  },
  emerald: {
    chip: "bg-vx-success-50 text-vx-success-600 dark:bg-vx-success-900/40 dark:text-vx-success-200",
    ink: "text-vx-success-600 dark:text-vx-success-300",
  },
  red: {
    chip: "bg-vx-error-50 text-vx-error-600 dark:bg-vx-error-900/40 dark:text-vx-error-200",
    ink: "text-vx-error-600 dark:text-vx-error-300",
  },
};

/** 上下渐变底：亮色由品牌浅色收到卡面色，暗色走中性两档。 */
const SURFACE_CLASS =
  "bg-linear-to-b from-vx-brand-100 to-vx-surface dark:from-vx-gray-800 dark:to-vx-gray-900";

export interface ComingSoonPageProps {
  readonly icon: IconName;
  readonly accent?: ComingSoonAccent;
  /** 小号全大写的分类词。 */
  readonly eyebrow: string;
  /** 页面主体名称，最大的一行。 */
  readonly title: string;
  /** 状态行：这一页处于什么阶段。 */
  readonly subtitle: string;
  readonly description: string;
  /** 主按钮，通常是转化出口。不给则不渲染。 */
  readonly primaryAction?: { readonly href: string; readonly label: string };
  /** 次按钮：回到来处。 */
  readonly backAction: { readonly href: string; readonly label: string };
}

export default function ComingSoonPage({
  icon,
  accent = "brand",
  eyebrow,
  title,
  subtitle,
  description,
  primaryAction,
  backAction,
}: ComingSoonPageProps) {
  const tone = ACCENT_CLASSES[accent];

  return (
    <section className={`flex min-h-screen items-center ${SURFACE_CLASS}`}>
      <div className="mx-auto w-full max-w-website-4xl px-6 py-24 text-center lg:px-8">
        <span
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${tone.chip}`}
        >
          <Icon name={icon} className="h-8 w-8" />
        </span>
        <p
          className={`mt-6 text-xs font-semibold uppercase tracking-widest ${tone.ink}`}
        >
          {eyebrow}
        </p>
        <h1 className="font-brand mt-3 text-4xl font-bold text-vx-gray-900 dark:text-vx-white md:text-5xl">
          {title}
        </h1>
        <p className="mt-4 text-lg font-semibold text-vx-gray-700 dark:text-vx-gray-200">
          {subtitle}
        </p>
        <p className="mx-auto mt-5 max-w-website-3xl text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
          {description}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          {primaryAction ? (
            <Button asChild size="lg" className="px-5 hover:bg-vx-brand-500">
              <Link href={primaryAction.href}>{primaryAction.label}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="lg" className="px-5">
            <Link href={backAction.href}>
              <Icon name="arrow-left" className="h-4 w-4" />
              {backAction.label}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
