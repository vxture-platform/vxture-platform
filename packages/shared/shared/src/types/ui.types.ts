/**
 * ui.types.ts - Shared UI semantic types
 * @package @vxture-platform/shared
 * @description Cross-layer UI primitives consumed by design-system, BFF, and agent UIs. Provides shared UI type definitions without platform-specific implementation.
 */

/**
 * 语义色彩类型
 * 跨层共用：design-system 组件、BFF 响应状态字段、agent UI 均引用此类型
 */
export type SemanticColor =
  | "primary"
  | "secondary"
  | "brand"
  | "info"
  | "success"
  | "warning"
  | "danger";
