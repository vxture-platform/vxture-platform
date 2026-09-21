// ─────────────────────────────────────────────────────────────────────────────
// 明文 PII 的**唯一**闸门与脱敏实现。
//
// `user:pii.read`（data_admin_200 §4.3 高危码，只有 super_admin / admin 持有）决定
// 看到的是明文还是掩码；只有 `user:profile.read` 的角色（operation / support / …）
// 拿到的是掩码值。
//
// 收到这里是因为同一条策略原本只长在 accounts.router 里，而租户详情页的成员表
// 渲染的是**同一批人的同一批字段**却没走闸门——2026-09-21 给成员表加「联系方式」
// 列时发现的。再抄一份就是第二份实现，两页迟早分叉（主体码前缀刚因为三份实现
// 分叉过一次，见 packages/shared/shared/src/principal-no.ts 头注）。
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from "express";

import type { RequestContext } from "../types/console.types";

/** 持 `user:pii.read` 才能看明文 email / phone。 */
export function hasPiiAccess(req: Request & RequestContext): boolean {
  return req.capabilities?.includes("user:pii.read") ?? false;
}

/** j***@example.com —— 留首字符与完整域名；空串仍是空串。 */
export function maskEmail(email: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email[0] ?? "";
  return `${first}***${email.slice(at)}`;
}

/** 137****5678 —— 留后 4 位；null 仍是 null。 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, digits.length - 8 > 0 ? 3 : 0)}****${digits.slice(-4)}`;
}
