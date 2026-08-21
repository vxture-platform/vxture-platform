/**
 * script.ts - SSR 主题启动脚本
 * @package @vxture/design-system
 * @layer Presentation
 * @category Theme
 * @description
 *   在首帧渲染前同步 html.dark 与 color-scheme，避免系统主题闪烁。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import { THEME_CONSTANTS } from "@vxture/design-tokens";

export const themeBootstrapScript = `
(function() {
  try {
    var saved = localStorage.getItem('${THEME_CONSTANTS.STORAGE_KEY}') || '${THEME_CONSTANTS.DEFAULT_THEME}';
    var isDark = saved === 'dark' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (_) {}
})();
`.trim();
