"use client";

/**
 * ComingSoonPage.tsx - 「待建设」页模板
 *
 * 全站待建设页的唯一形状：满屏、居中、图标 + eyebrow + 名称 + 一行状态 + 一段
 * 说明 + 主次两个按钮。任何还没成稿的页面都挂这一件，不再各写各的——否则
 * 「开发中」在不同入口会长成三四个样子。
 *
 * 提炼自 solutions 的行业详情占位页（该页仍是本件的调用方之一）。
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

/**
 * 强调色。对应 src/styles 里既有的 `.vx-solutions-industry--*` 修饰类——
 * 复用已有类，不为此新增样式规则。
 */
export type ComingSoonAccent = "sky" | "red" | "amber" | "emerald";

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
  accent = "sky",
  eyebrow,
  title,
  subtitle,
  description,
  primaryAction,
  backAction,
}: ComingSoonPageProps) {
  return (
    <div className="vx-page-surface">
      <section
        className={`vx-solutions-industry vx-solutions-industry--${accent} flex min-h-screen items-center`}
      >
        <div className="relative mx-auto w-full max-w-website-4xl px-6 py-24 text-center lg:px-8">
          <span className="vx-solutions-accent-soft mx-auto flex h-14 w-14 items-center justify-center rounded-xl">
            <Icon name={icon} className="h-7 w-7" />
          </span>
          <p className="vx-solutions-accent-text mt-6 text-xs font-semibold uppercase tracking-widest">
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
    </div>
  );
}
