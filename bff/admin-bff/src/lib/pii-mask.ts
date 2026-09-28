/**
 * pii-mask.ts — 运营后台下发客户邮箱 / 手机时的那一道闸门与那一套掩码。
 * @package @vxture/bff-admin
 * @layer Application
 * @category Lib
 *
 * ── 为什么要有这一个文件 ──
 * 判据只有一条：**持 `user:pii.read` 危码的人看原文，其余人看掩码**（订单详情重设计
 * §3.3，与 accounts.router 同一道闸门）。但同一个判据此前住在两处复制品里
 * （orders.router 的 declaredBy 抄了 accounts.router 一份，头注还写着「两处要一起改」），
 * 而 2026-09-28 加运营待办接口时又要第三份——同一条规则住三处，改一处不报错，
 * 只是另外两处继续下发明文。所以把它收到一处，谁要脱敏就 import 谁。
 *
 * 现状（写下来的，不是猜的）：orders.router 与 ops-todos.router 已改读本文件；
 * accounts.router 仍是自己那一份（那个路由不在本轮改动面内），下一次动它时并进来。
 */

import type { Request } from "express";
import type { RequestContext } from "../types/console.types";

/** 危码：持它才看原文。缺会话 / 缺能力集都算没有。 */
export function hasPiiAccess(req: Request & RequestContext): boolean {
  return req.capabilities?.includes("user:pii.read") ?? false;
}

/** j***@example.com — 保留首字符与整个域名；空串原样。 */
export function maskEmail(email: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email[0] ?? "";
  return `${first}***${email.slice(at)}`;
}

/** 137****5678 — 只留末四位；null 原样。 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, digits.length - 8 > 0 ? 3 : 0)}****${digits.slice(-4)}`;
}
