/**
 * types/index.ts - @vxture/design-ui 类型统一导出
 * @package @vxture/design-ui
 *
 * 功能：Design System 类型定义统一导出入口
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Types
 */

/* Container/Toggle/Portal 三件已退役（2026-08-18 owner 批）：全仓零消费的
 * 死零件。存活链是 Provider + useFullscreen + ShellFullscreenToggle。 */
export type {
  FullscreenMode,
  FullscreenOptions,
  FullscreenState,
  FullscreenContextValue,
  FullscreenProviderProps,
} from "./fullscreen";
