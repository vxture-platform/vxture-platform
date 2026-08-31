"use client";

/**
 * SolutionField —— 解决方案创建/编辑表单的字段外壳。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Products
 *
 * 统一「标签在上、控件在下」竖排 + 必填 `*` + 底部一行(左提示 / 右字符计数)。
 * 创建页与详情页编辑框共用一份,避免各写一遍再各漏一处(owner 2026-08-31:
 * 每个框常态显示 `已用/上限` 计数;标签横排会把中文逐字竖排,故一律竖排)。
 */

import { type ReactNode } from "react";
import { Label, cn } from "@vxture/design-system";

export function SolutionField({
  label,
  required = false,
  hint,
  hintTone = "muted",
  count,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  /** 字段下方左侧的说明/错误文案。 */
  hint?: ReactNode;
  hintTone?: "muted" | "danger";
  /** 右侧常态字符计数;value.length 与 HTML maxLength 同按 UTF-16 计,和后端上限对齐。 */
  count?: { value: string; max: number };
  children: ReactNode;
}) {
  const showFooter = hint != null || count != null;
  return (
    <div className="flex flex-col gap-xs">
      <Label>
        {label}
        {required ? <span className="text-destructive-text"> *</span> : null}
      </Label>
      {children}
      {showFooter ? (
        <div className="flex items-start justify-between gap-md text-body-sm">
          <span
            className={cn(
              "min-w-0",
              hintTone === "danger"
                ? "text-destructive-text"
                : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
          {count ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {count.value.length}/{count.max}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
