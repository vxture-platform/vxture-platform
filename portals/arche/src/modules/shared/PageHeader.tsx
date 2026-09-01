/**
 * PageHeader.tsx - 治理台页面标题(形状适配层,包 DS 的 ViewHeader)。
 * @package @vxture/arche
 * @layer Presentation
 * @category Modules - Shared
 *
 * 与 admin/console/opera 同款:ViewHeader 是一页的页头(48px 裸色图标、20px 标题、
 * 右侧动作区底沿与描述行对齐);`secondary` 是标题行内的状态标槽。迁入页原样用
 * `@/modules/shared/PageHeader`,此处提供 arche 本地实现,不跨门户 import。
 */

import type { ReactNode } from "react";
import { ViewHeader } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";

interface ArchePageHeaderProps {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
  secondary?: ReactNode;
  /** 死参数:ViewHeader 定稿只有标题+描述两行。收下不渲染,仅为兼容迁入页(同 admin)。 */
  eyebrow?: string;
}

export function PageHeader({
  icon = "squares-four",
  title,
  description,
  action,
  secondary,
}: ArchePageHeaderProps) {
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
