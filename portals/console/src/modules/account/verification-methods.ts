/**
 * verification-methods.ts — 企业认证三种方式的呈现定义,认证结果页与提交页共用。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 只管**怎么摆给用户看**;能力真判据在 console-bff `lib/verification-level`,
 * 页面不自己推。方式轴与主体轴(个人 / 企业)正交,见租户信息页设计 §企业认证。
 *
 * 资料要求(owner 2026-09-06 走查修正):
 *   lite      企业名称 · 统一社会信用代码(**只此两项**,法定代表人姓名已去掉)
 *   face      企业登记信息 · 法定代表人本人扫脸核身
 *   documents 认证申请表 · 营业执照影像
 * **所有方式一律不要求身份证件影像**(owner 明令);扫脸是核身不是收证件影像。
 */

import type { ConsoleVerificationMethod } from "@/api/console-bff";
import type { StatusBadgeTone } from "@vxture/design-system";

/** 申请状态 → 语气。superseded:组织改名即作废原认证(批 5c)。 */
export const VERIFICATION_STATUS_TONES: Record<string, StatusBadgeTone> = {
  unverified: "neutral",
  pending: "info",
  verified: "success",
  rejected: "warning",
  superseded: "danger",
};

export interface VerificationMethodDef {
  readonly key: ConsoleVerificationMethod;
  readonly icon: "file-text" | "user" | "folder";
  /** 该方式认证后能否开票(**说明**,不是判据)。 */
  readonly canInvoice: boolean;
  /** 「需要提供」列几条,文案键 methods.<key>.items.<n>。 */
  readonly itemCount: number;
}

/** 呈现次序即卡片顺序。 */
export const VERIFICATION_METHODS: readonly VerificationMethodDef[] = [
  { key: "lite", icon: "file-text", canInvoice: false, itemCount: 2 },
  // 扫脸没有对应图标(装着的 DS 10.1.0 无 camera / scan),用「人」表示核到本人
  { key: "face", icon: "user", canInvoice: true, itemCount: 2 },
  { key: "documents", icon: "folder", canInvoice: true, itemCount: 2 },
];
