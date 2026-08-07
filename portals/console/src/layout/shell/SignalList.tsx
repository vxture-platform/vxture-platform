/**
 * SignalList — 板块内的「标题 + 说明」条目列表，右侧可挂一个状态件。
 *
 * 原实现挂 .vx-signal-list，随遗留样式退役后无样式。重建只用 T2 工具类：
 * 条目之间用虚线分隔（060 线型语义：实线开区块、虚线分行——这里分的是行，
 * 不是区块），最后一条不带线。
 *
 * 不做成 DS 件：它是「板块里的一段列表」，形状由所在板块决定，DS 里对应的
 * 位置已经有 Section / SectionHeader 管标题阶梯，再收一个同层的件只会和它们
 * 争同一个职责。
 */

import type { ReactNode } from "react";

export interface SignalListItem {
  title: string;
  description?: string;
  aside?: ReactNode;
}

export function SignalList({ items }: { items: SignalListItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item, index) => (
        <li
          key={item.title}
          className={[
            "flex items-start justify-between gap-md py-sm",
            index < items.length - 1
              ? "border-b border-dashed border-border"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="flex min-w-0 flex-col gap-2xs">
            <strong className="text-label-md text-foreground">
              {item.title}
            </strong>
            {item.description ? (
              <p className="text-body-sm text-muted-foreground">
                {item.description}
              </p>
            ) : null}
          </div>
          {item.aside ? <div className="shrink-0">{item.aside}</div> : null}
        </li>
      ))}
    </ul>
  );
}
