"use client";

/**
 * kit.tsx - 预览面自己的骨架件。
 * @package @vxture/design-preview
 *
 * ⚠ 这里的东西**不是设计系统的一部分**，只服务于这张预览页：分组标题、示例行、
 *   模式轴开关。它们刻意只用 DS 已有的工具类拼，不引入任何新样式来源——预览面
 *   一旦有自己的皮，看到的就不再是 DS 的真实产出了。
 */

import * as React from "react";

export const DENSITIES = ["compact", "default", "comfortable"] as const;
export const FONT_SIZES = ["small", "default", "large"] as const;

export type Density = (typeof DENSITIES)[number];
export type FontSize = (typeof FONT_SIZES)[number];

/** 密度与字号不是 provider，是 html 上的一个类——和产品运行时的机制一致。 */
export function useRootClass(
  prefix: string,
  value: string,
  all: readonly string[],
) {
  React.useEffect(() => {
    const root = document.documentElement;
    all.forEach((v) => root.classList.remove(`${prefix}${v}`));
    root.classList.add(`${prefix}${value}`);
  }, [all, prefix, value]);
}

export interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly note?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function Section({ id, title, note, children }: SectionProps) {
  return (
    <section id={id} className="flex scroll-mt-xl flex-col gap-md">
      <div className="flex flex-col gap-2xs border-b border-border pb-sm">
        <h2 className="text-title-sm text-foreground">{title}</h2>
        {note ? (
          <p className="text-body-sm text-muted-foreground">{note}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-lg">{children}</div>
    </section>
  );
}

export interface RowProps {
  readonly label?: string;
  readonly stack?: boolean;
  readonly children: React.ReactNode;
}

/** 一条示例。label 说明这一行在验证什么，不写就是纯展示。 */
export function Row({ label, stack = false, children }: RowProps) {
  return (
    <div className="flex flex-col gap-xs">
      {label ? (
        <span className="text-label-sm text-muted-foreground">{label}</span>
      ) : null}
      <div
        className={
          stack
            ? "flex flex-col items-start gap-sm"
            : "flex flex-wrap items-center gap-sm"
        }
      >
        {children}
      </div>
    </div>
  );
}

/** 待重写组件的警示条。这些件还挂着已退役的类名，渲染无样式是预期内的。 */
export function PendingNote() {
  return (
    <p className="rounded-md border border-warning-border bg-warning-muted px-sm py-xs text-body-sm text-warning-text">
      以下组件尚未重写，仍依赖已退役的遗留类名——
      <strong>渲染无样式是预期结果</strong>， 它们的存在是为了让重写进度可见。
    </p>
  );
}
