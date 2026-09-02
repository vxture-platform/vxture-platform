"use client";

/**
 * TiersSideCard — 档位行右侧的窄卡（占一列窄栅格 minmax(8.5rem, 10rem)）。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 实底（灰 → brand-muted 渐变）+ 实线边框，表达「右边还有档位」。两种用法：
 *   · 「个人」视角下的团队档位占位：列团队档名，点击切到「全部」；
 *   · ≥5 档时的收起 / 展开控制（owner 2026-09-03：收起在右侧，沿用这张卡的形式）：
 *     收起态列其余档名 + 「展开」，展开态只剩「收起」。
 */

import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

export function TiersSideCard({
  icon,
  title,
  subtitle,
  action,
  onClick,
}: {
  icon: IconName;
  title: string;
  /** 档名列表等辅助文案；可空 */
  subtitle?: string | null;
  action: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="flex h-auto flex-col items-center justify-center gap-2.5 whitespace-normal rounded-2xl border border-vx-gray-200 bg-linear-to-b from-vx-gray-50 to-vx-brand-50 p-5 text-center font-normal transition hover:border-vx-brand-300 hover:from-vx-brand-50/60 dark:border-vx-gray-700 dark:from-vx-gray-800 dark:to-vx-brand-950 dark:hover:border-vx-brand-500/40"
    >
      <Icon
        name={icon}
        className="h-6 w-6 text-vx-gray-400 dark:text-vx-gray-500"
        aria-hidden
      />
      <span className="text-sm font-medium text-vx-text-primary">{title}</span>
      {subtitle ? (
        <span className="text-xs leading-5 text-vx-text-muted">{subtitle}</span>
      ) : null}
      <span className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
        {action}
      </span>
    </Button>
  );
}
