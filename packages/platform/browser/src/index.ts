/**
 * @vxture/platform-browser - 浏览器环境工具包
 * @package @vxture/platform-browser
 *
 * Description: 浏览器环境工具函数，封装浏览器 API。
 * 包含滚动、存储、剪贴板、视口等浏览器特定功能。
 *
 * @layer Infrastructure
 * @category Core
 *
 * @remarks
 * - 仅在浏览器环境使用
 * - 服务端代码禁止引用此包
 * - 所有函数必须检查 typeof window !== 'undefined'
 *
 * @example
 * ```ts
 * import { resetWindowScrollTop, type ScrollBehavior } from '@vxture/platform-browser';
 *
 * resetWindowScrollTop('smooth');
 * ```
 */

export * from "./utils";
export {
  downscaleImage,
  MAX_EDGE,
  pickOutputType,
  shouldSkipDownscale,
  targetSize,
} from "./image-downscale";
