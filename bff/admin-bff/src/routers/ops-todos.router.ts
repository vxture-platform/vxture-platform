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

/**
 * 账务类：只给持订单读权（`commerce:order.read`）的人。
 *
 * ── 2026-09-28 第三批为什么必须逐条列 ──
 * 这一列此前只列账务四类，另一列拿 `OPS_TODO_KINDS.filter(不在此列)` 兜其余。那个兜法在
 * 值域只有七类时是对的；第三批把值域扩到十九类之后，**每一个新类别都会默认落进「进了门
 * 就能看」那一边**——退款执行、发票申请、加油包单、欠费订阅全都会对只有
 * `platform.tenant.manage` 的运营敞开，而这件事不报错、不改任何签名，只是悄悄放宽。
 * 所以两列都改成逐条明写，并由下面那条守卫式断言（本文件末尾的 `assertKindsPartitioned`）
 * 保证「加一类就必须在这里归一次边」。
 *
 * 归边的判据是**这条待办点开的那一页要什么权限**：钱与合同那几页（订单 / 退款 / 发票 /
 * 加油包 / 订阅）都在 commerce 域，按今天最接近的那道门 `commerce:order.read` 收；
 * 租户 / 工单 / 账号 / 维护窗口那几页进门就能看，归另一列。
 *
 * ── 一处已知的粗糙，待 owner 定 ──
 * `subscription_overdue` 点开的是 /subscriptions（那一页要 `commerce:subscription.read`
 * 或 `.manage`），`invoice_*` 点开的是 /invoices（要 `commerce:billing.read` 或 `.manage`）。
 * 按 `commerce:order.read` 收它们是**偏严**的近似：只有订阅读权的人看不到欠费订阅这条待办。
 * 偏严不会泄露信息，所以本批先这样；真正的解法是按类别挂各自的能力码（一张
 * kind → capabilities 的表），那要动权限目录的读法，属于 owner 裁定范围，不在实施侧自决。
 */
export const ORDER_READ_KINDS: readonly OpsTodoKind[] = [
  // 订单（/orders/{order_no}）
  "confirm_payment",
  "reprovision",
  "follow_up_balance",
  "order_pending_payment_aging",
  // 退款（都在订单详情页的任务卡上办）
  "refund_audit",
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  // 订阅 / 发票 / 加油包（/subscriptions · /invoices · /addon-orders）
  "subscription_overdue",
  "invoice_applying",
  "invoice_approved",
  "addon_pending_confirm",
];

/**
 * 其余类：进了门（platform.tenant.manage）就能看。
 *
 * 租户 / 工单此前就是同一道门；第三批新进来的四类同理——
 * `ticket_sla` 与 `ticket` 同一张表同一页；`deletion_pending` / `purge_imminent` 点开的是
 * /accounts/{user_no}，那一页的**读**本来就没有另设能力门（只有改动才要
 * `user:account.manage`）；`maintenance_overdue` 不带任何租户或个人信息，且它的出路在
 * 运维台，admin 这边只是让人知道有这件事。
 */
export const TENANT_KINDS: readonly OpsTodoKind[] = [
  "verification",
  "risk",
  "ticket",
  "ticket_sla",
  "maintenance_overdue",
  "deletion_pending",
  "purge_imminent",
];

/**
 * 两列必须不重叠、且并起来正好是算法的整个值域。
 *
 * **在模块加载时就抛**，不是留给单测：共享算法加一类而这里没归边，症状是那一类对
 * 不该看见的人可见（或反过来，谁都看不见），两种都不报错。BFF 起不来比悄悄放宽好。
 */
function assertKindsPartitioned(): void {
  const both = ORDER_READ_KINDS.filter((k) => TENANT_KINDS.includes(k));
  const missing = OPS_TODO_KINDS.filter(
    (k) => !ORDER_READ_KINDS.includes(k) && !TENANT_KINDS.includes(k),
  );
  const stale = [...ORDER_READ_KINDS, ...TENANT_KINDS].filter(
    (k) => !OPS_TODO_KINDS.includes(k),
  );
  if (both.length || missing.length || stale.length) {
    throw new Error(
      "ops-todos.router：待办类别的能力分组与共享算法的值域对不上——" +
        [
          both.length ? `两列都有：${both.join(", ")}` : null,
          missing.length
            ? `没归边（会默认对只有 platform.tenant.manage 的人可见）：${missing.join(", ")}`
            : null,
          stale.length ? `算法已不产出：${stale.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("；"),
    );
  }
}
assertKindsPartitioned();

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
