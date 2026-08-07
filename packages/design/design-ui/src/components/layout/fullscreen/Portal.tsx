/**
 * Portal.tsx - 全屏 Portal 组件
 * @package @vxture/design-ui
 *
 * 功能：允许全屏内容跳出当前 React DOM 树，直接挂载到 body 上
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import { createPortal } from "react-dom";
import { FullscreenPortalProps } from "../../../types/fullscreen";

export function Portal({ children }: FullscreenPortalProps) {
  // 确保只在客户端渲染
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(children, document.body);
}
