/**
 * theme/index.ts - 主题系统导出入口
 * @package @vxture/design-system
 *
 * 功能：统一导出主题系统的所有公共 API，包括 ThemeProvider 和 useTheme Hook
 *       支持 light / dark / system 三种主题模式
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Index
 */

// ThemeProvider 同时导出 ThemeProvider、useTheme、ThemeProviderProps
export * from "./ThemeProvider";
export * from "./theme.types";
export * from "./script";
export { BootSplash, markAppReady } from "./boot-splash";
