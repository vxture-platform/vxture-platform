/**
 * hooks/index.ts - Hooks 导出入口
 * @package @vxture/design-ui
 *
 * 功能：统一导出所有自定义 Hooks，提供设计系统的业务逻辑封装
 *
 * @copyright Vxture Team
 * @layer Shared
 * @category Index
 */

export { useBreakpoint } from "./useBreakpoint";
export type { Breakpoint, UseBreakpointReturn } from "./useBreakpoint";

export { useMediaQuery } from "./useMediaQuery";
export { useMounted } from "./useMounted";
export { useControllableState } from "./useControllableState";
export type { UseControllableStateProps } from "./useControllableState";

export { useFullscreen } from "./useFullscreen";

export { useListPagination } from "./useListPagination";
export type { UseListPaginationReturn } from "./useListPagination";
