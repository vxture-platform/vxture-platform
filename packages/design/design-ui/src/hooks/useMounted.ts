/**
 * useMounted.ts - 组件挂载检测 Hook
 * @package @vxture/design-ui
 *
 * 功能：检测组件是否已挂载
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Hooks
 */

import { useEffect, useState } from "react";

/**
 * 组件挂载检测 Hook
 *
 * @returns 是否已挂载
 *
 * @example
 * const mounted = useMounted();
 * if (mounted) {
 *   // 只在客户端执行的代码
 * }
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
