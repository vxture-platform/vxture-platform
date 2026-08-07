/**
 * PageHeader.tsx - 管理后台页面标题。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Shared
 *
 * 本文件是给 42 个调用点保留的形状适配层，包的是 DS 的 **`ViewHeader`**。
 *
 * **页头是 `ViewHeader`，不是 `SectionHeader level={1}`**（2026-08-05 修正）。
 * 两件分工不同：`ViewHeader` 是一页的页头（48px 裸色图标、20px 标题、右侧动作区
 * 底沿与描述行对齐），`SectionHeader` 是页内的板块标题，level 2/3/4 依次向下。
 * 拿板块标题的 level 1 去当页头，字号对得上，版式却是另一件东西的。
 *
 * `ViewHeader` 的收录依据正是 admin——它的文件头写着"admin 49 处，且 admin 已经
 * 拷了一份自己的实现"。console 18 个文件、opera 12 个都在用，admin 是唯一没回接的。
 *
 * `secondary` 因此回到它该在的地方：`ViewHeader` 原生就有这个槽，放的是标题行内的
 * 状态标。此前它被和 `action` 合并塞进右侧动作区——那是"接下来做什么"的位置，
 * 状态标挂在那里读起来像个按钮。
 *
 * 一并去掉的是 `admin-overview-heading*` 三个 class 钩子：那套 CSS 用
 * `--vx-admin-overview-*` 局部变量把标题的字号、图标尺寸、色值又实现了一遍，
 * 与 T2 语义层各说各话。取值现在由 DS 出，钩子失去作用。（样式文件本身保留不动。）
 *
 * `eyebrow` 是死参数：ViewHeader 定稿明确"页头只有标题与描述两行"，SectionHeader
 * 也从没接过它。少数调用点仍在传，一直没渲染过——留待清理，不在本次范围。
 */

import type { ReactNode } from "react";
import { ViewHeader } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

interface AdminPageHeaderProps {
  eyebrow?: string;
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
  secondary?: ReactNode;
}

export function PageHeader({
  icon = "squares-four",
  title,
  description,
  action,
  secondary,
}: AdminPageHeaderProps) {
  return (
    <ViewHeader
      icon={icon}
      title={title}
      description={description}
      {...(secondary ? { secondary } : {})}
      {...(action ? { action } : {})}
    />
  );
}
