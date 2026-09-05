/**
 * verification-level.ts — 认证方式 → 租户能力,单一权威判定(owner 2026-09-06)。
 * @package @vxture/bff-console
 *
 * 认证有两根正交的轴:主体轴(个人 / 企业)与**方式轴**(怎么证明的)。能力差异挂在
 * 方式轴上:
 *
 *   | 方式        | 中文名           | 订阅 | 开票 | 本期 |
 *   | ----------- | ---------------- | ---- | ---- | ---- |
 *   | `lite`      | 简易企业实名认证 | ✅   | ❌   | 开放 |
 *   | `face`      | 法人扫脸实名认证 | ✅   | ✅   | 开发中 |
 *   | `documents` | 提交资料实名认证 | ✅   | ✅   | 开发中 |
 *
 * 判定只认**已通过(verified)**的最新一条申请:pending / rejected 都还不是能力。
 *
 * ⚠️ 后果要说在明处:本期只有 `lite` 可提交,于是 `canIssueInvoice` 对所有租户都是
 * false——开票入口在扫脸 / 资料认证上线前是关的。这是 owner 的分期决定(简易认证
 * 「可订阅、不可开票」),不是漏改;若要在过渡期放开,把 INVOICE_LEVELS 加上 "lite"
 * 一处即可,别在调用点各开一个口子。
 */

import type { TenantVerificationMethod } from "@vxture/service-organization";

/** 租户认证等级:未认证 / 简易(可订阅不可开票)/ 完整(可开票)。 */
export type TenantVerificationLevel = "none" | "lite" | "full";

/** 可开票的等级集合。过渡期若要放开简易认证开票,只改这里。 */
const INVOICE_LEVELS: ReadonlySet<TenantVerificationLevel> = new Set(["full"]);

/** 由「最新一条申请」的状态 + 方式派生等级;未通过一律 none。 */
export function verificationLevelOf(
  latest:
    | { status: string; verificationMethod: TenantVerificationMethod }
    | null
    | undefined,
): TenantVerificationLevel {
  if (!latest || latest.status !== "verified") return "none";
  return latest.verificationMethod === "lite" ? "lite" : "full";
}

/** 该等级能否申请开票。 */
export function canIssueInvoice(level: TenantVerificationLevel): boolean {
  return INVOICE_LEVELS.has(level);
}
