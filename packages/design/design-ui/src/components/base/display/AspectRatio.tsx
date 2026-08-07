/**
 * AspectRatio.tsx - 定比容器。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 *
 * 结构照 shadcn 官方 AspectRatio：纯透传，不带样式。为什么不直接让调用方写
 * CSS `aspect-ratio`——原语用 padding-bottom 撑高的老技法兜住尺寸未知的
 * 替换元素（跨域 iframe、未加载完的图），纯 CSS 方案在这些场景下会塌成 0 高。
 */

import * as React from "react";
import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio";

export interface AspectRatioProps extends React.ComponentPropsWithoutRef<
  typeof AspectRatioPrimitive.Root
> {}

const AspectRatio = AspectRatioPrimitive.Root;

export { AspectRatio };
