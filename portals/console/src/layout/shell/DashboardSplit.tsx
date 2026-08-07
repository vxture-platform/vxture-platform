/**
 * DashboardSplit — 并排两个板块的栅格，窄屏塌单列。
 *
 * 原实现挂 .vx-dashboard-layout，随遗留样式退役后并排关系丢失（两块直接上下
 * 堆叠且无间距）。重建只用 T2 工具类：`gap-lg` 跟 Section 之间的板块节奏同档，
 * lg 以上并排。
 */

import type { ReactNode } from "react";

export function DashboardSplit({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-lg lg:grid-cols-2 [&>*]:min-w-0">{children}</div>
  );
}
