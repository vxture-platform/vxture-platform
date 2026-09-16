/**
 * StackCell.tsx - 列表格子的「主行 + 辅行」纵向居中形态。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Shared
 *
 * admin 的列表体例是居中（42 处列定义写着 `align: "center"`），于是「主信息一行、
 * 辅助说明一行」的格子在 14 个文件里各手写了一遍：外层 `inline-flex flex-col
 * items-center gap-2xs`，辅行 `text-body-sm text-muted-foreground`。本件把那段
 * 标记原样收成一处——**标记逐字不变**，替换后观感为零变化，这是收敛的前提。
 *
 * ── 为什么不直接用 DS 的 TableTitleCell ──
 * 形态确实相近（标题 + 副文），但那一件是**横向**容器：标题与副文都 `truncate`
 * 单行截断、副文带 `min-h-control-3xs` 占位。换过去会把 admin 的居中体例改成左起
 * 单行，行高也变一档——那不是重构，是改版面。
 *
 * ── 这是垫片，不是终局 ──
 * 终局是 DS 的 `TableTitleCell` 收一个「纵向居中」布局变体，admin 全部落到 DS 件、
 * 本件删除。垫片的意义只在于：不必等 DS 发版就能先把 19 处散写收拢。
 */

import type { ReactNode } from "react";

export interface StackCellProps {
  /** 主行。文字、带兜底分支的表达式都行。 */
  readonly main: ReactNode;
  /** 辅行说明。不给就只渲染主行，不留空位。 */
  readonly sub?: ReactNode;
  /** 原生 `title`：整格的悬停全文（如登录 IP）。 */
  readonly title?: string;
}

export function StackCell({ main, sub, title }: StackCellProps) {
  return (
    <span
      className="inline-flex flex-col items-center gap-2xs"
      {...(title ? { title } : {})}
    >
      {main}
      {sub ? (
        <span className="text-body-sm text-muted-foreground">{sub}</span>
      ) : null}
    </span>
  );
}
