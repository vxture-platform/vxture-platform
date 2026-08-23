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
 * 网关 API Key 的状态。
 *
 * ── 2026-08-23：字段名与词表都跟着 Atlas 换了一遍 ─────────────────────────────
 *
 * Atlas 现在回的是 **`state`**（不是 `status`），词表是 `active` / `inactive` /
 * `revoked`——**中间那档由 `disabled` 改叫 `inactive`**（product_251 M-B3 的最小词表，
 * 全平面一致）。库里那一列仍写着 `disabled`，两者在 Atlas 的记录边界上换算，不迁数据
 * （回滚只换镜像不动 DDL，迁了会让回滚后的旧镜像读到自己不认识的值）。
 *
 * 同时新增 **`effectiveState`**：把到期折进去之后**现在实际是什么**，多一档
 * `expired`。它是**读时推导**的，不存库——定时任务翻旧行等于为了让排程成立而改写历史，
 * 而在到期发生到任务跑到之间，存着的那个值是假的。优先级是终态优先：revoked 无论到期
 * 与否都是 revoked，inactive 读作 inactive 而不是 expired（那是运营选的、可以撤回的态）。
 *
 * **页面读 `effectiveState`，不自己拿 `expiresAt` 算**：同一个判断有两个实现，迟早会在
 * 边界上分叉，而这个判断决定的是"这把钥匙现在还开不开门"。
 *
 * 此前这里注释写着「`gateway_api_keys` 根本没有 expires_at 列」——那句话现在不成立了，
 * Atlas 已经加了列、create/rotate 都收这个入参。
 */
export type KeyState = "active" | "inactive" | "revoked";

/** 折进到期之后的实际态。`expired` 只可能由 `active` 演变而来（终态优先）。 */
export type KeyEffectiveState = KeyState | "expired";

export const KEY_STATE_META: Record<
  KeyEffectiveState,
  { label: string; tone: Tone }
> = {
  active: { label: "生效中", tone: "success" },
  /* 「已停用」是可逆的暂停，neutral；「已撤销」是终态，danger——两者读起来必须
     一眼分得出轻重，否则运营会把不可逆的那个当成可逆的用。 */
  inactive: { label: "已停用", tone: "neutral" },
  revoked: { label: "已撤销", tone: "danger" },
  /* 「已过期」用 warning：行上写着生效中、实际已经不作数了，是需要有人去处理的一档
     （续期或撤销），不是一个安稳的终态。 */
  expired: { label: "已过期", tone: "warning" },
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
