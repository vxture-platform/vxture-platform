/**
 * densityConfig.ts - Density 配置
 * @package @vxture/design-system
 *
 * 功能：定义 UI 密度系统的配置
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Configuration
 */

import type { Density } from "./density.types";

// ============================================================================
// 配置
// ============================================================================

/**
 * 默认 Density
 */
export const DEFAULT_DENSITY: Density = "default";

/* DENSITY_PRESETS 已退役（2026-08-18 owner 批）：全仓零消费的死导出——密度
 * 落地走 densityClass + CSS token 重映射，这份 px 预设表从未被运行时读取。 */

/**
 * Density localStorage key
 */
export const DENSITY_STORAGE_KEY = "vx-density";
