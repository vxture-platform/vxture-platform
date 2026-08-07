/**
 * SummaryStrip — 页头下方的一排概览指标（标签 / 数值 / 说明 / 可选右上角挂件）。
 *
 * 原实现整体挂 .vx-summary-strip，随 DS T2 重写的遗留样式退役后连间距都没有。
 * 重建走 DS 的 Card + T2 工具类：卡片本身是 DS 件（透明模式叠层由 surface 档
 * 决定），栅格与排版走 T2 刻度，不再有本地类名。
 *
 * 不直接用 DS 的 MetricGrid：那件的 `icon` 收窄为 IconName，而本件的 `aside`
 * 是自由插槽（调用方塞的是 Icon 元素，也可能是徽标）。等调用方确实只放图标时
 * 再收敛过去，现在换 API 会把改动摊到所有调用页。
 */

import type { ReactNode } from "react";
import { Card, CardContent } from "@vxture/design-system";

export interface SummaryStripItem {
  label: string;
  value: string;
  hint?: string;
  aside?: ReactNode;
}

export function SummaryStrip({ items }: { items: SummaryStripItem[] }) {
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} surface="soft" className="gap-sm py-lg">
          <CardContent className="flex flex-col gap-2xs">
            <div className="flex items-start justify-between gap-sm">
              <span className="text-label-sm text-muted-foreground">
                {item.label}
              </span>
              {item.aside ? (
                <span className="shrink-0 text-muted-foreground">
                  {item.aside}
                </span>
              ) : null}
            </div>
            <strong className="text-title-lg text-foreground">
              {item.value}
            </strong>
            {item.hint ? (
              <p className="text-body-sm text-muted-foreground">{item.hint}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
