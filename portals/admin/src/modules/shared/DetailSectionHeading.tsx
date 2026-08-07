/**
 * DetailSectionHeading.tsx - 管理后台详情分区标题。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Shared
 *
 * DS 的 `DetailSectionHeading` 在分类重构（22ca6ccc）里被 `SectionHeader`
 * 取代（那边的文件注释写明了继任关系），admin 没跟着改，这条 import 一直挂着。
 *
 * 保留这个薄壳而不是让调用点直接用 SectionHeader：详情页里的分区标题固定是
 * level 2，写在这里一次，比在每个调用点各写一个 `level={2}` 更难写歪。
 * `admin-overview-heading*` 三个 class 钩子随之去掉，理由同 PageHeader.tsx。
 *
 * 2026-08-05：调用点由 8 处涨到 38 处（7 个文件）——此前七个详情页各自还套了一层
 * `SectionHeading` / `ProductSectionHeading` / `TenantSectionHeading`，那是壳的壳，
 * 只把 icon 与 title 透传下来，`description` / `action` / `divider` 全都传不进去。
 * 那七层已删，调用点直接落到本件。
 */

import { SectionHeader, type SectionHeaderProps } from "@vxture/design-system";

export type DetailSectionHeadingProps = Omit<SectionHeaderProps, "level">;

export function DetailSectionHeading(props: DetailSectionHeadingProps) {
  return <SectionHeader level={2} {...props} />;
}
