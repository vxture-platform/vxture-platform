/**
 * ops-todos.router.ts — 运营待办（2026-09-28 根治批）
 * @package @vxture/bff-admin
 *
 * Contract: GET /api/ops/todos
 *   response: { items: OpsTodo[] }（形状见 @vxture/service-ops-todos）
 *
 * 待办的判据**不在这里**：全在 `@vxture/service-ops-todos` 的那几段 SQL 片段里，
 * platform-api 的告警作业读的也是它们。这条路由只做三件事——能力门、类别剪裁、脱敏。
 * 页面拿到列表后只做筛选 / 排序 / 分页 / CSV / 渲染，不再自己派生（owner：「页面和作业
 * 读同一份」）。
 *
 * ── 能力门：为什么是 platform.tenant.manage，订单类再按 commerce:order.read 收窄 ──
 * 待办页此前读三个列表接口拼出来：/api/tenants 与 /api/tickets 都要 platform.tenant.manage
 * （tenants.router / tickets.router 同一道门），/api/orders 要 commerce:order.read。页面对
 * 租户接口是**硬依赖**（拿不到整页报错），对订单接口是**降级**（没有订单权限的运营仍能看
 * 其余待办——页面注释原话）。这里原样镜像：
 *   · 进门 = platform.tenant.manage，与页面今天「能看到东西」所需的最低权限一致；
 *   · 持 commerce:order.read 才给账务四类（confirm_payment / reprovision /
 *     follow_up_balance / refund_audit），否则只回租户与工单三类——同 search.router 按能力
 *     剪源，不 403。
 * 不另立 `ops:todo.read`：那要动权限目录与存量角色，属于 auth.service 里写明的「按域重设
 * 门禁」那一轮；本次不扩也不缩任何人今天能看到的范围。
 *
 * ── 申报人邮箱 / 手机按 user:pii.read 脱敏 ──
 * 仓储那一层给的是**原文**（它是共享算法，不认识调用方的能力集）；脱敏是读方的事。
 * 判据与掩码与 orders.router 的 declaredBy **同一份**（../lib/pii-mask）：持 user:pii.read
 * 看原文，否则 `j***@example.com` / `137****5678`。
 * 「能进这道门的人本就看得到」不成立——订单详情页此前就已经对无 user:pii.read 者掩码，
 * 待办页不脱敏等于开了一条绕过那道闸门的新路（一次请求把全部待办的申报人明文下发）。
 *
 * @layer Application
 * @category Router
 */

import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  OPS_TODO_KINDS,
  OpsTodoRepository,
  type OpsTodo,
  type OpsTodoKind,
} from "@vxture/service-ops-todos";
import { assertAnyCapability } from "../auth/capability";
import { hasPiiAccess, maskEmail, maskPhone } from "../lib/pii-mask";
import type { RequestContext } from "../types/console.types";

export interface OpsTodosResponse {
  items: OpsTodo[];
}

/** 账务四类：只给持订单读权的人。 */
export const ORDER_READ_KINDS: readonly OpsTodoKind[] = [
  "confirm_payment",
  "reprovision",
  "follow_up_balance",
  "refund_audit",
];

/** 其余三类：进了门就能看（租户 / 工单此前就是同一道 platform.tenant.manage）。 */
export const TENANT_KINDS: readonly OpsTodoKind[] = OPS_TODO_KINDS.filter(
  (kind) => !ORDER_READ_KINDS.includes(kind),
);

function assertCanReadOpsTodos(req: Request & RequestContext): void {
  assertAnyCapability(req, ["platform.tenant.manage"]);
}

function canReadOrders(req: Request & RequestContext): boolean {
  return req.capabilities?.includes("commerce:order.read") ?? false;
}

/** 导出仅为可测：能力集 → 传给仓储的类别过滤（undefined = 全部）。 */
export function kindsFor(
  req: Request & RequestContext,
): readonly OpsTodoKind[] | undefined {
  return canReadOrders(req) ? undefined : TENANT_KINDS;
}

/**
 * 导出仅为可测：无 user:pii.read 时把申报人的邮箱 / 手机换成掩码。
 * 名字不掩（订单页、工单页本来就显示名字）；`applicant` 为 null 的原样透传。
 */
export function maskApplicants(
  items: readonly OpsTodo[],
  canReadPii: boolean,
): OpsTodo[] {
  if (canReadPii) return [...items];
  return items.map((item) => {
    const applicant = item.applicant;
    if (!applicant) return item;
    return {
      ...item,
      applicant: {
        name: applicant.name,
        email: applicant.email === null ? null : maskEmail(applicant.email),
        phone: maskPhone(applicant.phone),
      },
    };
  });
}

@Controller("api/ops")
export class OpsTodosRouter {
  // 必须显式 @Inject：打包走 esbuild，它不产 emitDecoratorMetadata。
  constructor(
    @Inject(OpsTodoRepository) private readonly todos: OpsTodoRepository,
  ) {}

  @Get("todos")
  async listTodos(
    @Req() req: Request & RequestContext,
  ): Promise<OpsTodosResponse> {
    assertCanReadOpsTodos(req);
    const kinds = kindsFor(req);
    // 页面全量取，不带 minAge；筛选 / 分页在浏览器里做。
    const items = await this.todos.list(kinds ? { kinds } : {});
    return { items: maskApplicants(items, hasPiiAccess(req)) };
  }
}
