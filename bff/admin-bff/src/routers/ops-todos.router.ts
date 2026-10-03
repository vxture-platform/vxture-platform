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
 * ── 能力门（2026-10-04 按细码拆门）：进门 = 任一类别的门；类别再各按自己那一页的码剪 ──
 * 此前进门判遗留扁平码 platform.tenant.manage（旧桥从 tenant:profile.manage 合成），
 * 订单类再按 commerce:order.read 收窄。租户 / 工单两条线 2026-10-03 拆门后那道粗门
 * **比它聚合的页面更严**：support / auditor 能看工单、能看租户，却打不开待办页。
 * 本文件当时自己写明了为什么不能只放宽门：没归边的类别会默认对进了门的人可见，
 * 「放宽和归边是两半，要一起做」——现在两半一起做：
 *   · 每一类待办点开的那一页要什么码，这一类就只给持那个码的人（`KIND_GATES`，
 *     对 OpsTodoKind 穷尽，加一类不归边 TS 当场红）；
 *   · 进门 = 持有 `KIND_GATES` 里出现的任一码（从同一张表推出来，不另抄一份清单，
 *     也不另立 `ops:todo.read`——那要动目录与存量角色，而这里没有一条待办是只有
 *     待办页才看得到的东西）；
 *   · 一个码都没有 → 403；有码但某类看不了 → 那一类不给，不 403（与 search.router
 *     按能力剪源同一个原则：这里看得到的，点进去那一页本来也进得去）。
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
 * 每一类待办 → 点开那一页的读门（任一码即可）。
 *
 * ── 2026-09-28 第三批为什么必须逐条列 ──
 * 这一列此前只列账务四类，另一列拿 `OPS_TODO_KINDS.filter(不在此列)` 兜其余。那个兜法在
 * 值域只有七类时是对的；第三批把值域扩到十九类之后，**每一个新类别都会默认落进「进了门
 * 就能看」那一边**——退款执行、发票申请、加油包单、欠费订阅全都会对进了门的运营敞开，
 * 而这件事不报错、不改任何签名，只是悄悄放宽。所以逐条明写，并由类型（对 OpsTodoKind
 * 穷尽的 Record）保证「加一类就必须在这里归一次边」。
 *
 * ── 归边的判据是**这条待办点开的那一页要什么权限** ──
 *   · 钱与合同那几页（订单 / 退款 / 发票 / 加油包 / 订阅）都在 commerce 域，按今天
 *     最接近的那道门 `commerce:order.read` 收；
 *   · 实名审核 → /verifications（tenant:verification.review）；
 *   · 风险 → /tenants（tenant:profile.read | .manage）；
 *   · 工单与工单 SLA → /tickets（support:ticket.read | .manage）；
 *   · 删号等待期 / 即将清除 → /accounts（user:profile.read，2026-10-04 起那一页判它）；
 *   · 维护窗口逾期 → admin 没有这一页（出路在运维台），不带租户或个人信息，进了门就能看。
 *
 * ── 一处已知的粗糙，待 owner 定 ──
 * `subscription_overdue` 点开的是 /subscriptions（那一页要 `commerce:subscription.read`
 * 或 `.manage`），`invoice_*` 点开的是 /invoices（要 `commerce:billing.read` 或 `.manage`）。
 * 按 `commerce:order.read` 收它们是**偏严**的近似：只有订阅读权的人看不到欠费订阅这条待办。
 * 偏严不会泄露信息，所以先这样；精确到那两个码是一行改动，但它是目录读法的取舍，
 * 属于 owner 裁定范围，不在实施侧自决。
 */
const ORDER_READ: readonly string[] = ["commerce:order.read"];
const TENANT_READ: readonly string[] = [
  "tenant:profile.read",
  "tenant:profile.manage",
];
const TICKET_READ: readonly string[] = [
  "support:ticket.read",
  "support:ticket.manage",
];
const VERIFICATION_REVIEW: readonly string[] = ["tenant:verification.review"];
const ACCOUNT_READ: readonly string[] = ["user:profile.read"];
/** 进了门就能看的类别用这个标记；真正的码集在 `ENTRY_CODES` 里由表推出来。 */
const ANY_ENTRANT: readonly string[] = [];

export const KIND_GATES: Readonly<Record<OpsTodoKind, readonly string[]>> = {
  // 订单（/orders/{order_no}）
  confirm_payment: ORDER_READ,
  reprovision: ORDER_READ,
  follow_up_balance: ORDER_READ,
  order_pending_payment_aging: ORDER_READ,
  // 退款（都在订单详情页的任务卡上办）
  refund_audit: ORDER_READ,
  refund_execute: ORDER_READ,
  refund_processing_stuck: ORDER_READ,
  refund_failed: ORDER_READ,
  // 订阅 / 发票 / 加油包（/subscriptions · /invoices · /addon-orders）
  subscription_overdue: ORDER_READ,
  invoice_applying: ORDER_READ,
  invoice_approved: ORDER_READ,
  addon_pending_confirm: ORDER_READ,
  // 租户 / 账号 / 工单
  verification: VERIFICATION_REVIEW,
  risk: TENANT_READ,
  ticket: TICKET_READ,
  ticket_sla: TICKET_READ,
  deletion_pending: ACCOUNT_READ,
  purge_imminent: ACCOUNT_READ,
  // 出路在运维台；admin 这边只是让人知道有这件事
  maintenance_overdue: ANY_ENTRANT,
};

/** 进门的码集 = 表里出现过的每一个码（去重）。不另抄清单，清单就不会跟表漂。 */
export const ENTRY_CODES: readonly string[] = [
  ...new Set(Object.values(KIND_GATES).flat()),
];

/**
 * 表的键集必须正好是算法的整个值域。Record<OpsTodoKind> 在编译期已保证两个方向
 * （缺一类 / 多一类都是 TS 错误）；这里再在模块加载时核一遍，挡住 `as` 断言之类的绕路。
 */
function assertKindsPartitioned(): void {
  const keys = Object.keys(KIND_GATES).sort();
  const all = [...OPS_TODO_KINDS].sort();
  if (keys.join(",") !== all.join(",")) {
    throw new Error(
      "ops-todos.router：待办类别的能力分组与共享算法的值域对不上——" +
        `表里 ${keys.join(", ")}；算法 ${all.join(", ")}`,
    );
  }
}
assertKindsPartitioned();

function assertCanReadOpsTodos(req: Request & RequestContext): void {
  assertAnyCapability(req, ENTRY_CODES);
}

/** 导出仅为可测：能力集 → 传给仓储的类别过滤（undefined = 全部）。 */
export function kindsFor(
  req: Request & RequestContext,
): readonly OpsTodoKind[] | undefined {
  const caps = req.capabilities ?? [];
  const allowed = OPS_TODO_KINDS.filter((kind) => {
    const gate = KIND_GATES[kind];
    return gate.length === 0 || gate.some((code) => caps.includes(code));
  });
  return allowed.length === OPS_TODO_KINDS.length ? undefined : allowed;
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
