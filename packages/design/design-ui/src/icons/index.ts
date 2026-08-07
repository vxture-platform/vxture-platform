/**
 * index.ts - 图标模块导出入口
 * @package @vxture/design-ui
 *
 * 功能：统一导出图标模块的公共 API
 *
 * @copyright Vxture Team
 * @layer Shared
 * @category Index
 */

export { Icon } from "./Icon";
export type {
  IconProps,
  IconWeight,
  IconSize,
  IconSizeMap,
} from "./icon.types";
export type { IconName } from "./iconDictionary";
// 名字全集也导出：图标选择器、图标总览这类界面需要遍历它，否则只能各自抄一份。
export { iconDictionary, ICON_GROUPS } from "./iconDictionary";
