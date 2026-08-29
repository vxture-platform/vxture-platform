/**
 * mock-user-preferences.ts - 未登录用户的本地偏好（localStorage）
 * @package @vxture/website
 * @description 偏好类型 + 游客偏好的 localStorage 读写（Header 语言/主题切换用）。
 *   曾附带一份 MOCK_USER_PREFERENCES 假数据，2026-08-30 官网上线前删除：
 *   无任何调用方，留着只会被误当成后端契约。文件名沿用是为了不动 Header 的 import。
 * @layer Presentation
 * @category Data - Preferences
 * @author AI-Generated
 * @date 2026-03-21
 */

import type { Locale } from "@vxture-platform/shared";
import type { Density } from "@vxture/design-system";

/**
 * 全屏模式类型
 */
export type FullscreenMode = "workspace" | "browser";

/**
 * 主题类型（扩展 design-system 的主题，增加 system 选项）
 */
export type ThemePreference = "light" | "dark" | "system";

/**
 * 用户偏好配置接口
 */
export interface UserPreferences {
  /** 用户 ID */
  userId: string;
  /** 语言偏好 */
  locale: Locale;
  /** 主题偏好 */
  theme: ThemePreference;
  /** 密度偏好 */
  density: Density;
  /** 全屏默认模式 */
  fullscreenMode: FullscreenMode;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 未登录用户的临时偏好（localStorage 存储）
 */
export const GUEST_PREFERENCES_KEY = "vxture-guest-preferences";

/**
 * 获取未登录用户的临时偏好
 */
export function getGuestPreferences(): Partial<UserPreferences> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(GUEST_PREFERENCES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * 保存未登录用户的临时偏好
 */
export function setGuestPreferences(prefs: Partial<UserPreferences>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getGuestPreferences();
    const merged = { ...existing, ...prefs };
    localStorage.setItem(GUEST_PREFERENCES_KEY, JSON.stringify(merged));
  } catch {
    // 忽略存储错误
  }
}
