/**
 * Banner.tsx - 常驻提示条。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 与 `Toast` 的分工：Toast 说"刚才那一下成了没有"，说完就走；Banner 说"这个页面
 * 现在处于什么状态"，只要状态还在就得一直看得见。所以本件不自动消失，`onDismiss`
 * 也只在状态可由用户主动接受时才给。
 *
 * 相对原实现：tone 从自有的五值（含 `ai`）改为共用的六档语气（见 `./tone`）——
 * 同一个语气在 StatusBadge 与本件有两套名字迟早对不上，`ai` 归 `brand`、
 * `error` 归 `danger`；图标由语气决定，不开 prop；新增 `action` 与 `onDismiss`。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon } from "../../../icons";
import { toneIcons, toneSurfaceClasses, type Tone } from "../../tone";

export type BannerTone = Tone;

export interface BannerProps {
  readonly tone?: BannerTone;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  /** 给了才出现关闭按钮——不是所有状态都允许用户自行消掉。 */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

function Banner({
  tone = "info",
  title,
  description,
  action,
  onDismiss,
  className,
}: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-sm rounded-xl border p-md",
        toneSurfaceClasses[tone],
        className,
      )}
    >
      <Icon
        name={toneIcons[tone]}
        size={16}
        aria-hidden="true"
        className="mt-2xs shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <span className="text-label-md">{title}</span>
        {description ? (
          <span className="text-body-sm opacity-muted">{description}</span>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          className={cn(
            "-mr-2xs -mt-2xs shrink-0 rounded-sm p-2xs opacity-muted",
            "transition-opacity duration-fast ease-standard outline-none",
            "hover:opacity-100",
            interactive,
          )}
        >
          <Icon name="x" size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export { Banner };
