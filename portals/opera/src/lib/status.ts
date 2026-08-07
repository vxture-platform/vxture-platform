/**
 * status.ts — Opera 侧业务状态 → DS 语气(tone)映射。
 *
 * DS 零业务：tone 六档只表达严重度；"provider degraded 算 warning"这类判断
 * 是产品的事，集中在这一个文件，页面不各自映射。
 */

import type { Tone } from "@vxture/design-system";

export type ResourceStatus = "active" | "degraded" | "down" | "disabled";

export const RESOURCE_STATUS_META: Record<
  ResourceStatus,
  { label: string; tone: Tone }
> = {
  active: { label: "运行中", tone: "success" },
  degraded: { label: "降级", tone: "warning" },
  down: { label: "不可用", tone: "danger" },
  disabled: { label: "已停用", tone: "neutral" },
};

export type KeyStatus = "active" | "disabled" | "revoked";

export const KEY_STATUS_META: Record<KeyStatus, { label: string; tone: Tone }> =
  {
    active: { label: "生效中", tone: "success" },
    disabled: { label: "已禁用", tone: "neutral" },
    revoked: { label: "已吊销", tone: "danger" },
  };

export type LogLevel = "info" | "warn" | "error";

export const LOG_LEVEL_META: Record<LogLevel, { label: string; tone: Tone }> = {
  info: { label: "INFO", tone: "info" },
  warn: { label: "WARN", tone: "warning" },
  error: { label: "ERROR", tone: "danger" },
};
