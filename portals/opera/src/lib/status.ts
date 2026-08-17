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

/**
 * 网关 API Key 的状态。**三档，与 Atlas 的 CHECK 约束一一对应**
 * （`chk_gateway_api_keys_status`，已 VALIDATE，不是候选值列表而是硬约束）。
 *
 * 这里没有「已失效／已过期」一档：`key.gateway_api_keys` **根本没有 expires_at
 * 列**，所以不存在一条到期就自动失效的 key。加一个上游永远不会取到的档位，只会
 * 让人以为设了到期时间就会自动断——而实际上不会，得有人手动来禁用。
 */
export type KeyStatus = "active" | "disabled" | "revoked";

export const KEY_STATUS_META: Record<KeyStatus, { label: string; tone: Tone }> =
  {
    active: { label: "生效中", tone: "success" },
    /* 「已禁用」是可逆的暂停，neutral；「已撤销」是终态，danger——两者读起来必须
       一眼分得出轻重，否则运营会把不可逆的那个当成可逆的用。 */
    disabled: { label: "已禁用", tone: "neutral" },
    revoked: { label: "已撤销", tone: "danger" },
  };

/**
 * runos 的风险等级词表。**同一套值出现在两个地方，语气必须一致**：
 *
 *   - 能力操作的 `riskLevel`（Capability 详情，某个操作有多危险）
 *   - 授权的 `riskScope`（Grant，这条授权允许到哪一档）
 *
 * 两者概念不同但值域相同，运营者看到同一个 `critical` 就该读出同一个轻重。此前
 * 两页各写一份，critical 一处是 warning 一处是 danger。
 *
 * **critical 定为 danger 而不是 warning**：它是唯一会因 Grant 配置被**整类拒绝**
 * 的等级（`270-policy-engine.md` §2 的审批闸门只对它生效），而且 2026-08-13 之前
 * runos 根本不接受注册 critical 操作，这一档是刚刚才真正带电的。
 */
export type RiskLevel = "read" | "write" | "critical";

export const RISK_LEVEL_META: Record<string, { label: string; tone: Tone }> = {
  read: { label: "read", tone: "neutral" },
  write: { label: "write", tone: "info" },
  critical: { label: "critical", tone: "danger" },
};

export type LogLevel = "info" | "warn" | "error";

export const LOG_LEVEL_META: Record<LogLevel, { label: string; tone: Tone }> = {
  info: { label: "INFO", tone: "info" },
  warn: { label: "WARN", tone: "warning" },
  error: { label: "ERROR", tone: "danger" },
};
