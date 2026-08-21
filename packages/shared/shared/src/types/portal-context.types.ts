/**
 * portal-context.types.ts - 跨 Portal 导航上下文类型
 * @package @vxture-platform/shared
 * @description 定义跨 Portal 跳转时携带的上下文信息，供 console 侧读取并展示来源 Portal 标题与返回入口。
 */

// =============================================================================
// Portal 来源标识
// =============================================================================

/**
 * 已知 Portal 来源标识符。
 * 使用 `string & {}` 兜底，保留类型提示同时允许未来扩展新 Portal。
 */
export type PortalSource = "website" | "agent-studio" | "admin" | (string & {});

// =============================================================================
// 跨 Portal 导航上下文
// =============================================================================

/**
 * 跨 Portal 跳转时附在 URL 中的上下文信息。
 *
 * 用法：
 *   发起方（如 website）调用 `encodePortalContext` 序列化并附到 console URL
 *   接收方（console）调用 `decodePortalContext` 解析并渲染返回入口
 */
export interface PortalNavContext {
  /** 来源 Portal 标识符 */
  from: PortalSource;
  /** 返回目标完整 URL（含 locale 前缀），用于 console 的「返回」操作 */
  returnTo: string;
  /** 来源 Portal 显示名称，console 顶栏展示 */
  caller: string;
  /** 调用方生成的状态值，SSO 场景中原样带回调用方 */
  state?: string;
  /** 来源 Portal Logo URL（可选），相对路径或绝对 URL */
  callerLogo?: string;
}
