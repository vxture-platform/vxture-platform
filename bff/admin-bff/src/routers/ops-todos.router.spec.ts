/**
 * ops-todos.router.spec.ts —— 能力门、类别剪裁、申报人脱敏。
 *
 * 页面对 /api/tenants 是硬依赖（platform.tenant.manage），对 /api/orders 是降级
 * （commerce:order.read 缺失时只少订单类）。这里钉住：无会话 401、无租户管理权 403、
 * 无订单读权 → 仓储只被要租户 / 工单三类、两权齐 → 不传 kinds（全量）。
 *
 * 再钉一道：申报人的邮箱 / 手机按 user:pii.read 脱敏。仓储那一层给的是原文（它是共享
 * 算法，不认识调用方的能力集），掩码只能在这里做；漏了就等于开了一条绕过订单详情页
 * 那道闸门的新路——一次请求把全部待办的申报人明文下发。
 */
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { OpsTodo, OpsTodoRepository } from "@vxture/service-ops-todos";
import {
  ORDER_READ_KINDS,
  OpsTodosRouter,
  TENANT_KINDS,
  kindsFor,
  maskApplicants,
} from "./ops-todos.router";
import type { RequestContext } from "../types/console.types";

const makeReq = (capabilities: string[] | null): Request & RequestContext =>
  ({
    user: capabilities ? { id: "op-1", name: "运营" } : undefined,
    capabilities: capabilities ?? undefined,
  }) as unknown as Request & RequestContext;

const routerWith = (list = vi.fn().mockResolvedValue([])) => ({
  router: new OpsTodosRouter({ list } as unknown as OpsTodoRepository),
  list,
});

/** 一条带申报人的待办；只填断言用得到的字段。 */
const todoWithApplicant = (applicant: OpsTodo["applicant"]): OpsTodo =>
  ({
    id: "confirm_payment:ORD-1",
    kind: "confirm_payment",
    severity: "rose",
    priority: 2,
    subject: { type: "order", no: "ORD-1" },
    tenant: null,
    applicant,
    amount: null,
    product: null,
    progress: "pendingVerify",
    waitingSince: "2026-09-28T01:49:00.000Z",
    href: "/orders/ORD-1",
  }) as OpsTodo;

describe("GET /api/ops/todos 的能力门", () => {
  it("无会话 → 401", async () => {
    const { router } = routerWith();
    await expect(router.listTodos(makeReq(null))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("只有订单读权、没有 platform.tenant.manage → 403（页面此前整页拿不到租户就报错）", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listTodos(makeReq(["commerce:order.read"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it("有租户管理权、没有订单读权 → 只要租户 / 工单 / 账号 / 维护七类，账务一类都不给", async () => {
    const { router, list } = routerWith();
    await router.listTodos(makeReq(["platform.tenant.manage"]));
    expect(list).toHaveBeenCalledWith({ kinds: TENANT_KINDS });
    expect(TENANT_KINDS).toEqual([
      "verification",
      "risk",
      "ticket",
      "ticket_sla",
      "maintenance_overdue",
      "deletion_pending",
      "purge_imminent",
    ]);
    // 2026-09-28 第三批的回归判据：钱那一侧的十二类一条都不能漏进来。
    // 此前这一列是 `OPS_TODO_KINDS.filter(不在账务四类)`，值域一扩，退款执行 / 发票 /
    // 加油包 / 欠费订阅会**默认**落进这一列——不报错，只是悄悄放宽。
    for (const money of [
      "refund_execute",
      "refund_processing_stuck",
      "refund_failed",
      "order_pending_payment_aging",
      "subscription_overdue",
      "invoice_applying",
      "invoice_approved",
      "addon_pending_confirm",
    ]) {
      expect(TENANT_KINDS, money).not.toContain(money);
    }
  });

  it("两权齐 → 不传 kinds，全量", async () => {
    const items = [{ id: "confirm_payment:ORD-1" }];
    const { router, list } = routerWith(vi.fn().mockResolvedValue(items));
    const res = await router.listTodos(
      makeReq(["platform.tenant.manage", "commerce:order.read"]),
    );
    expect(list).toHaveBeenCalledWith({});
    expect(res).toEqual({ items });
  });
});

describe("kindsFor：账务十二类与其余七类正好把值域分完", () => {
  it("两组不重叠且并集是全部类别（加一类没归边，模块加载时就该抛）", () => {
    const overlap = ORDER_READ_KINDS.filter((k) => TENANT_KINDS.includes(k));
    expect(overlap).toEqual([]);
    // 并集 == 共享算法的整个值域。逐字列出来而不是拿 OPS_TODO_KINDS 比：
    // 拿值域比自己，等于「两边一样地错也算过」——那道自比在 router 里由
    // assertKindsPartitioned 做（它管「有没有漏」），这里管「分得对不对」。
    expect([...ORDER_READ_KINDS, ...TENANT_KINDS].sort()).toEqual(
      [
        "confirm_payment",
        "reprovision",
        "follow_up_balance",
        "order_pending_payment_aging",
        "refund_audit",
        "refund_execute",
        "refund_processing_stuck",
        "refund_failed",
        "subscription_overdue",
        "invoice_applying",
        "invoice_approved",
        "addon_pending_confirm",
        "verification",
        "risk",
        "ticket",
        "ticket_sla",
        "maintenance_overdue",
        "deletion_pending",
        "purge_imminent",
      ].sort(),
    );
    expect([...ORDER_READ_KINDS, ...TENANT_KINDS]).toHaveLength(19);
  });

  it("持订单读权 → undefined；否则只给非账务那一列", () => {
    expect(kindsFor(makeReq(["commerce:order.read"]))).toBeUndefined();
    expect(kindsFor(makeReq([]))).toBe(TENANT_KINDS);
  });
});

describe("申报人脱敏：判据与掩码同 orders.router 的 declaredBy", () => {
  const raw = todoWithApplicant({
    name: "张三",
    email: "zhangsan@example.com",
    phone: "+8613800001234",
  });

  it("持 user:pii.read → 原文照下发", () => {
    expect(maskApplicants([raw], true)[0]!.applicant).toEqual({
      name: "张三",
      email: "zhangsan@example.com",
      phone: "+8613800001234",
    });
  });

  it("没有 user:pii.read → 邮箱留首字符与域名、手机只留末四位；名字不掩", () => {
    // 掩码函数逐字沿用 orders.router 的那一份：先剥非数字，再留「前 3 + **** + 末 4」。
    // 带国家码的号（+86…）前 3 位就是 861——这是既有行为，本轮不改它，只是在这里写明。
    expect(maskApplicants([raw], false)[0]!.applicant).toEqual({
      name: "张三",
      email: "z***@example.com",
      phone: "861****1234",
    });
  });

  it("applicant 为 null / 单边为 null 的都不被掩成假值", () => {
    expect(maskApplicants([todoWithApplicant(null)], false)[0]!.applicant).toBe(
      null,
    );
    expect(
      maskApplicants(
        [todoWithApplicant({ name: "李四", email: null, phone: null })],
        false,
      )[0]!.applicant,
    ).toEqual({ name: "李四", email: null, phone: null });
  });

  it("不改原对象（仓储返回的那一份还是原文，给日志 / 复用留余地）", () => {
    const items = [raw];
    maskApplicants(items, false);
    expect(items[0]!.applicant?.email).toBe("zhangsan@example.com");
  });
});

describe("GET /api/ops/todos 的脱敏落在响应上", () => {
  const caps = ["platform.tenant.manage", "commerce:order.read"];
  const raw = todoWithApplicant({
    name: "张三",
    email: "zhangsan@example.com",
    phone: "13800001234",
  });

  it("无 user:pii.read：响应里的邮箱 / 手机是掩码", async () => {
    const { router } = routerWith(vi.fn().mockResolvedValue([raw]));
    const res = await router.listTodos(makeReq(caps));
    expect(res.items[0]!.applicant).toEqual({
      name: "张三",
      email: "z***@example.com",
      phone: "138****1234",
    });
    // 明文一个字都不该出现在响应里。
    expect(JSON.stringify(res)).not.toContain("zhangsan@example.com");
    expect(JSON.stringify(res)).not.toContain("13800001234");
  });

  it("持 user:pii.read：响应里是原文", async () => {
    const { router } = routerWith(vi.fn().mockResolvedValue([raw]));
    const res = await router.listTodos(makeReq([...caps, "user:pii.read"]));
    expect(res.items[0]!.applicant).toEqual({
      name: "张三",
      email: "zhangsan@example.com",
      phone: "13800001234",
    });
  });
});
