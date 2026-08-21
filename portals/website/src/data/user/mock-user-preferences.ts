/**
 * mock-user-preferences.ts - 模拟用户偏好配置（临时）
 * @package @vxture/website
 * @description 模拟后端返回的用户偏好数据，用于开发阶段
 * @layer Presentation
 * @category Data - Mock
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
 * 模拟已登录用户的偏好数据
 */
export const MOCK_USER_PREFERENCES: UserPreferences = {
  userId: "user-001",
  locale: "zh-CN",
  theme: "system",
  density: "default",
  fullscreenMode: "workspace",
  updatedAt: "2026-03-21T10:30:00Z",
};

/**
 * 模拟未登录用户的临时偏好（localStorage 存储）
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
