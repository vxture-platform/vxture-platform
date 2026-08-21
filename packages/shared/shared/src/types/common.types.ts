/**
 * common.types.ts - Shared common types
 * @package @vxture-platform/shared
 * @description Cross-layer navigation and interaction primitives. Provides shared type definitions for common UI patterns used across all layers.
 */

import type { SemanticColor } from "./ui.types";

/** 基础链接结构，跨层导航原语 */
export interface Link {
  label: string;
  href: string;
}

/**
 * 带语义色彩的操作按钮，扩展自 Link
 * color 由消费方映射到对应的 ButtonVariant，shared 层不感知 UI 实现细节
 */
export interface Action extends Link {
  color?: SemanticColor;
  icon?: string;
}
