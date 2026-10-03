/**
 * ops-todo-alert.job.spec.ts —— 作业只挑类别 / 停留 / 上限，判据在共享算法里；
 * 邮件素材由 todoAlertInput 纯函数给（这里一并钉九类文案与去重键）。
 * 2026-10-04 起作业有两拼：ALERT_KINDS（邮件 + 通告）与 NOTICE_ONLY_KINDS（只写通告）。
 */
import { describe, expect, it, vi } from "vitest";
import type { OpsTodo, OpsTodoRepository } from "@vxture/service-ops-todos";
import {
  ALERT_KINDS,
  NOTICE_ONLY_KINDS,
  OpsTodoAlertJob,
} from "./ops-todo-alert.job";
import {
  todoAlertInput,
  type OperatorAlertsWiring,
} from "../notifications/operator-alerts.wiring";
import type { JobHeartbeatService } from "./job-heartbeat.service";

const noopHeartbeat = {
  recordStart: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
} as unknown as JobHeartbeatService;

const NOW = new Date("2026-09-28T12:00:00.000Z");

const todo = (over: Partial<OpsTodo>): OpsTodo => ({
  id: "confirm_payment:ORD-1",
  kind: "confirm_payment",
  severity: "rose",
  priority: 2,
  subject: { type: "order", no: "ORD-1" },
  // 作业那一拼不带跨 schema 富化块，所以申报人与风险档本来就是 null
  // （svc_platform_api 碰不到 account / admin 的那几张，见仓储头注与 97_service_roles.sql）。
  tenant: {
    no: "200000010",
    name: "示例租户",
    type: "company",
    status: "active",
    riskLevel: null,
    region: null,
    industry: null,
    scale: null,
  },
  applicant: null,
  amount: { value: "99.00", currency: "CNY", paid: null },
  product: { code: "karda", name: "Karda", planName: "专业版" },
  progress: "pendingVerify",
  // 3 小时 12 分钟前
  waitingSince: new Date(NOW.getTime() - (3 * 60 + 12) * 60_000).toISOString(),
  href: "/orders/ORD-1",
  escalated: false,
  escalationStep: 0,
  ...over,
});

const ok = { sent: 1, failed: 0, suppressed: false, noRecipient: false };

/**
 * 假仓储按 `kinds` 分两拼回：ALERT_KINDS 那拼回 items，NOTICE_ONLY_KINDS 那拼回 noticeItems。
 * 实现具名（不走 mockImplementationOnce）：按调用顺序排桩会把「两拼谁先谁后」也钉死，
 * 而那不是契约。
 */
const jobWith = (
  items: OpsTodo[],
  alertTodo = vi.fn().mockResolvedValue(ok),
  noticeItems: OpsTodo[] = [],
) => {
  const impl = async (opts: { kinds: readonly string[] }) => {
    if (opts.kinds === ALERT_KINDS) return items;
    if (opts.kinds === NOTICE_ONLY_KINDS) return noticeItems;
    throw new Error(`list 收到未知的 kinds：${opts.kinds.join(",")}`);
  };
  const list = vi.fn(impl);
  const noticeEscalatedTodo = vi.fn().mockResolvedValue(undefined);
  const job = new OpsTodoAlertJob(
    { list } as unknown as OpsTodoRepository,
    { alertTodo, noticeEscalatedTodo } as unknown as OperatorAlertsWiring,
    noopHeartbeat,
  );
  return { job, list, alertTodo, noticeEscalatedTodo };
};

describe("OpsTodoAlertJob.pass", () => {
  it("向共享算法要裁定过的九类、默认 15 分钟、上限 50、不要富化块，每条各发一封；只写通告的类别另起一拼", async () => {
    const items = [
      todo({}),
      todo({
        id: "refund_audit:RFD-1",
        kind: "refund_audit",
        subject: { type: "refund", no: "RFD-1" },
        progress: "refundAudit",
      }),
    ];
    const { job, list, alertTodo, noticeEscalatedTodo } = jobWith(items);
    await job.tick();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith({
      kinds: ALERT_KINDS,
      minAgeMinutes: 15,
      limit: 50,
      // 少了这一项，生产上整条查询 42501：本进程的角色没有 account / admin 的多数表。
      includeApplicant: false,
    });
    // 第二拼：同样的停留 / 上限 / 不带富化块，只是类别换成只写通告的那几类。
    // 必须是**另一拼**：limit 50 按 rose 优先取，amber 的通告类别并进第一拼会被挤没。
    expect(list).toHaveBeenCalledWith({
      kinds: NOTICE_ONLY_KINDS,
      minAgeMinutes: 15,
      limit: 50,
      includeApplicant: false,
    });
    expect(alertTodo).toHaveBeenCalledTimes(2);
    expect(alertTodo).toHaveBeenCalledWith(items[0]);
    expect(alertTodo).toHaveBeenCalledWith(items[1]);
    expect(noticeEscalatedTodo).not.toHaveBeenCalled();
  });

  it("只写通告那一拼：升档的调 noticeEscalatedTodo 一次、不发邮件；没升档的什么都不做", async () => {
    const escalated = todo({
      id: "verification:200000010",
      kind: "verification",
      severity: "rose",
      priority: 20,
      subject: { type: "tenant", no: "200000010" },
      amount: null,
      product: null,
      progress: "verification",
      href: "/verifications",
      escalated: true,
      escalationStep: 2,
    });
    const calm = todo({
      id: "verification:200000011",
      kind: "verification",
      severity: "amber",
      priority: 20,
      subject: { type: "tenant", no: "200000011" },
      amount: null,
      product: null,
      progress: "verification",
      href: "/verifications",
      escalated: false,
      escalationStep: 0,
    });
    const { job, alertTodo, noticeEscalatedTodo } = jobWith(
      [],
      vi.fn().mockResolvedValue(ok),
      [escalated, calm],
    );
    await job.tick();
    expect(noticeEscalatedTodo).toHaveBeenCalledTimes(1);
    expect(noticeEscalatedTodo).toHaveBeenCalledWith(escalated);
    // 一封邮件都不发：verification 的邮件半仍未裁定（守卫的 UNRULED）。
    expect(alertTodo).not.toHaveBeenCalled();
    // 本轮不算失败（没有「无人可达」这回事：通告不要收件人）。
    expect(noopHeartbeat.recordFailure).not.toHaveBeenCalled();
  });

  it("只写通告的类别逐字：verification（有阈值、邮件半未裁的那一类）", () => {
    expect(NOTICE_ONLY_KINDS).toEqual(["verification"]);
    // 两拼不重叠：同一类既发邮件又单独写通告会写两条一样的通告（去重键相同，第二条落 inserted:false，
    // 但那是靠库兜住，不是设计）。
    for (const kind of NOTICE_ONLY_KINDS) {
      expect(ALERT_KINDS, kind).not.toContain(kind);
    }
  });

  /**
   * 裁定表逐字钉在这里：改 ALERT_KINDS 是改 owner 的裁定，不该顺手改。
   * 与共享算法的类别值域、与 todoAlertInput 的分支之间的对账在
   * scripts/guardrails/check-ops-todo-alerts.mjs（那一道是 CI 门）。
   */
  it("九类逐字：全是严重度恒 rose 的那些", () => {
    expect(ALERT_KINDS).toEqual([
      "confirm_payment",
      "reprovision",
      "refund_audit",
      "refund_execute",
      "refund_processing_stuck",
      "refund_failed",
      "addon_pending_confirm",
      "ticket_sla",
      "maintenance_overdue",
    ]);
  });

  it("没有待办就不发（两拼都空）", async () => {
    const { job, alertTodo, noticeEscalatedTodo } = jobWith([]);
    await job.tick();
    expect(alertTodo).not.toHaveBeenCalled();
    expect(noticeEscalatedTodo).not.toHaveBeenCalled();
  });

  it("有待办却无人可达 → 本轮记失败（心跳 recordFailure）", async () => {
    const { job } = jobWith(
      [todo({})],
      vi.fn().mockResolvedValue({ ...ok, sent: 0, noRecipient: true }),
    );
    await job.tick();
    expect(noopHeartbeat.recordFailure).toHaveBeenCalled();
  });
});

describe("todoAlertInput：九类各一封，去重键是 code + 可视码", () => {
  it("confirm_payment 沿用 #231 原文", () => {
    const input = todoAlertInput(todo({}), {
      link: "https://y.vxture.com/orders/ORD-1",
      now: NOW,
    });
    expect(input).toEqual({
      code: "ops.order.pending_verify",
      reference: { type: "order", id: "ORD-1" },
      subject: "ORD-1 客户已申报付款，待确认收款（已等 3 小时 12 分钟）",
      lines: [
        "示例租户 申报已完成支付，金额 ¥99.00，等待运营核对到账。",
        "订单 ORD-1，已等待 3 小时 12 分钟。",
        "核对到账后在订单详情页「确认收款」（确认即自动开通），或驳回申报。",
      ],
      link: "https://y.vxture.com/orders/ORD-1",
    });
  });

  it("reprovision 沿用 #231 原文", () => {
    const input = todoAlertInput(
      todo({ kind: "reprovision", progress: "paidUnprovisioned" }),
      { link: undefined, now: NOW },
    );
    expect(input.code).toBe("ops.order.paid_unprovisioned");
    expect(input.reference).toEqual({ type: "order", id: "ORD-1" });
    expect(input.subject).toBe(
      "ORD-1 已收款但权益未开通（已等 3 小时 12 分钟）",
    );
    expect(input.lines[0]).toBe(
      "示例租户 的账单已结清，金额 ¥99.00，但开通没有落地。",
    );
    expect(input.link).toBeUndefined();
  });

  it("refund_audit：主体是退款单号，金额是退款额，链接落到订单详情", () => {
    const input = todoAlertInput(
      todo({
        id: "refund_audit:RFD-202609-4E7BD7BEC1",
        kind: "refund_audit",
        subject: { type: "refund", no: "RFD-202609-4E7BD7BEC1" },
        progress: "refundAudit",
        href: "/orders/ORD-9",
      }),
      { link: "https://y.vxture.com/orders/ORD-9", now: NOW },
    );
    expect(input).toEqual({
      code: "ops.refund.pending_audit",
      reference: { type: "refund", id: "RFD-202609-4E7BD7BEC1" },
      subject:
        "RFD-202609-4E7BD7BEC1 客户申请退款，待审核（已等 3 小时 12 分钟）",
      lines: [
        "示例租户 申请退款 ¥99.00（Karda 专业版），等待运营审核。",
        "退款单 RFD-202609-4E7BD7BEC1，已等待 3 小时 12 分钟。",
        "在订单详情页「审核退款」：通过后执行退款，或驳回并写明原因。",
      ],
      link: "https://y.vxture.com/orders/ORD-9",
    });
  });

  /**
   * 退款剩下三格各一个模板码：去重键 = (code, reference_type, reference_id, channel)，
   * 所以三格**不能**共用 `ops.refund.pending_audit`——共用的话，审核通过那一刻
   * 「该执行了」这封会被前一封的 4h 静默窗口吞掉，而那正是钱该出去的时刻。
   */
  it("退款另外三格：模板码各不相同，主体仍是退款单号", () => {
    const refund = (kind: OpsTodo["kind"]) =>
      todoAlertInput(
        todo({
          kind,
          subject: { type: "refund", no: "RFD-2" },
          href: "/orders/ORD-9",
        }),
        { link: undefined, now: NOW },
      );
    const codes = [
      "refund_execute",
      "refund_processing_stuck",
      "refund_failed",
    ].map((k) => refund(k as OpsTodo["kind"]).code);
    expect(codes).toEqual([
      "ops.refund.pending_execute",
      "ops.refund.processing_stuck",
      "ops.refund.failed",
    ]);
    expect(new Set(codes).size).toBe(3);
    for (const kind of [
      "refund_execute",
      "refund_processing_stuck",
      "refund_failed",
    ] as const) {
      expect(refund(kind).reference).toEqual({ type: "refund", id: "RFD-2" });
      expect(refund(kind).subject).toContain("RFD-2");
      expect(refund(kind).subject).toContain("3 小时 12 分钟");
    }
    // 审过没退那封要说清「客户已经被告知通过了」——这是它与待审那封的区别。
    expect(refund("refund_execute").lines.join("\n")).toContain(
      "客户这边已经收到",
    );
  });

  it("加油包待核销：主体是加油包单号，宾语类别单列（不与订单撞去重键）", () => {
    const input = todoAlertInput(
      todo({
        kind: "addon_pending_confirm",
        subject: { type: "addon", no: "ORD-202609-ADDON1" },
        product: { code: "pack-1", name: "Token 加油包", planName: null },
        href: "/addon-orders",
      }),
      { link: "https://y.vxture.com/addon-orders", now: NOW },
    );
    expect(input.code).toBe("ops.addon.pending_confirm");
    expect(input.reference).toEqual({
      type: "addon_order",
      id: "ORD-202609-ADDON1",
    });
    expect(input.subject).toBe(
      "ORD-202609-ADDON1 加油包待核销（已等 3 小时 12 分钟）",
    );
    expect(input.lines[0]).toContain("Token 加油包");
    expect(input.lines[2]).toContain("确认即刻授予配额");
  });

  it("工单首响超时：带标题与优先级，并写出四档时限", () => {
    const input = todoAlertInput(
      todo({
        kind: "ticket_sla",
        subject: { type: "ticket", no: "TCK-9" },
        amount: null,
        product: null,
        href: "/tickets/TCK-9",
        ticket: { title: "支付页打不开", priority: "p0", status: "open" },
      }),
      { link: "https://y.vxture.com/tickets/TCK-9", now: NOW },
    );
    expect(input.code).toBe("ops.ticket.first_response_overdue");
    expect(input.reference).toEqual({ type: "ticket", id: "TCK-9" });
    expect(input.lines[0]).toContain("支付页打不开");
    expect(input.lines[0]).toContain("p0");
    expect(input.lines[1]).toContain("p0 1 小时");
  });

  it("维护窗口超时：主体是窗口标题，没有链接时正文自己说去哪儿办", () => {
    const input = todoAlertInput(
      todo({
        // 维护窗口那一类的待办身份是窗口主键：标题上没有唯一约束，也长到 256。
        id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
        kind: "maintenance_overdue",
        subject: { type: "maintenance", no: "数据库主从切换" },
        tenant: null,
        amount: null,
        product: null,
        // admin 里没有维护窗口这一页，所以 href 是 null，作业也给不出绝对链接。
        href: null,
      }),
      { link: undefined, now: NOW },
    );
    expect(input.code).toBe("ops.maintenance.window_overdue");
    /* 去重键跟**身份**走、不跟标题走（两者的差别与长度收口见
       operator-alerts.wiring.spec 里 todoAlertInput 那一组）。这个键只进账本，不上屏。 */
    expect(input.reference).toEqual({
      type: "maintenance_window",
      id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
    });
    // 上屏的仍然是运营给它起的那个名字。
    expect(input.subject).toBe(
      "维护窗口已超过计划结束时间 3 小时 12 分钟：数据库主从切换",
    );
    expect(input.link).toBeUndefined();
    expect(input.lines[2]).toContain("运维台");
  });

  it("租户已删除 / 没有产品时文案不留空洞", () => {
    const input = todoAlertInput(
      todo({
        kind: "refund_audit",
        subject: { type: "refund", no: "RFD-2" },
        tenant: null,
        product: null,
      }),
      { link: undefined, now: NOW },
    );
    expect(input.lines[0]).toBe(
      "（租户已删除） 申请退款 ¥99.00，等待运营审核。",
    );
  });

  it("没裁定过的类别直接抛，不静默跳过", () => {
    for (const kind of [
      "ticket",
      "subscription_overdue",
      "invoice_applying",
      "deletion_pending",
    ] as const) {
      expect(() =>
        todoAlertInput(todo({ kind, subject: { type: "ticket", no: "X-1" } }), {
          link: undefined,
          now: NOW,
        }),
      ).toThrow(/没有告警裁定/);
    }
  });
});
