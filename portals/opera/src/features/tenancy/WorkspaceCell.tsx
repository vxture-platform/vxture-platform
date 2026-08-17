"use client";

/**
 * WorkspaceCell.tsx — 表格里显示一个工作区，**租户在上、工作区在下**。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 规则与理由见 `directory.ts` 文件头：工作区名几乎全是「默认工作空间」，单独显示
 * 会得到一屏重复的同一个词——看起来像区分开了，其实没有。租户名（org_name）才是
 * 有分辨力的那一半，所以它排在上面。
 *
 * 做成件而不是让每个页面各自拼两行：拼接一旦下放，就会有人少拼一次，那一页立刻
 * 退化成"全是默认工作空间"，而且看起来完全正常——这种错不会报，只会误导。
 */

import type { TenancyDirectory } from "./directory";
import { workspaceDisplay } from "./directory";

export function WorkspaceCell({
  directory,
  workspaceId,
}: {
  readonly directory: TenancyDirectory;
  readonly workspaceId: string | null | undefined;
}) {
  const d = workspaceDisplay(directory, workspaceId);
  if (!d) return <span className="text-muted-foreground">—</span>;

  return (
    /* 两个 uuid 都挂在 title 上：屏幕上给人看名字，对工单 / 日志时还得拿得到 id。 */
    <span className="flex flex-col gap-2xs" title={d.title}>
      <span className="text-body-sm text-foreground">{d.primary}</span>
      {d.secondary ? (
        <span className="text-body-sm text-muted-foreground">
          {d.secondary}
        </span>
      ) : null}
    </span>
  );
}
