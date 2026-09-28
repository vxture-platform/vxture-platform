/**
 * ops-todo-alert.job.spec.ts —— 作业只挑类别 / 停留 / 上限，判据在共享算法里；
 * 邮件素材由 todoAlertInput 纯函数给（这里一并钉三类文案与去重键）。
 */
import { describe, expect, it, vi } from "vitest";
import type { OpsTodo, OpsTodoRepository } from "@vxture/service-ops-todos";
import { ALERT_KINDS, OpsTodoAlertJob } from "./ops-todo-alert.job";
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
  // （svc_platform_api 碰不到 account / admin，见仓储头注与 97_service_roles.sql）。
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
  ...over,
});

const ok = { sent: 1, failed: 0, suppressed: false, noRecipient: false };

const jobWith = (
  items: OpsTodo[],
  alertTodo = vi.fn().mockResolvedValue(ok),
) => {
  const list = vi.fn().mockResolvedValue(items);
  const job = new OpsTodoAlertJob(
    { list } as unknown as OpsTodoRepository,
    { alertTodo } as unknown as OperatorAlertsWiring,
    noopHeartbeat,
  );
  return { job, list, alertTodo };
};

describe("OpsTodoAlertJob.pass", () => {
  it("向共享算法要裁定过的三类、默认 15 分钟、上限 50、不要富化块，每条各发一封", async () => {
    const items = [
      todo({}),
      todo({
        id: "refund_audit:RFD-1",
        kind: "refund_audit",
        subject: { type: "refund", no: "RFD-1" },
        progress: "refundAudit",
      }),
    ];
    const { job, list, alertTodo } = jobWith(items);
    await job.tick();
    expect(list).toHaveBeenCalledWith({
      kinds: ALERT_KINDS,
      minAgeMinutes: 15,
      limit: 50,
      // 少了这一项，生产上整条查询 42501：本进程的角色没有 account / admin。
      includeApplicant: false,
    });
    expect(ALERT_KINDS).toEqual([
      "confirm_payment",
      "reprovision",
      "refund_audit",
    ]);
    expect(alertTodo).toHaveBeenCalledTimes(2);
    expect(alertTodo).toHaveBeenCalledWith(items[0]);
    expect(alertTodo).toHaveBeenCalledWith(items[1]);
  });

  it("没有待办就不发", async () => {
    const { job, alertTodo } = jobWith([]);
    await job.tick();
    expect(alertTodo).not.toHaveBeenCalled();
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

describe("todoAlertInput：三类各一封，去重键是 code + 可视码", () => {
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

  it("refund_audit：新一条，主体是退款单号，金额是退款额，链接落到订单详情", () => {
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
    expect(() =>
      todoAlertInput(
        todo({ kind: "ticket", subject: { type: "ticket", no: "TCK-1" } }),
        { link: undefined, now: NOW },
      ),
    ).toThrow(/没有告警裁定/);
  });
});
