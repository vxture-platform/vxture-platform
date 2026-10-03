/**
 * ops-todos.router.spec.ts —— 能力门、类别剪裁、申报人脱敏。
 *
 * 2026-10-04 拆门：进门 = 持有任一类别的门；每一类待办只给能打开它那一页的人
 * （KIND_GATES），一个码都没有才 403。此前进门判遗留扁平码 platform.tenant.manage，
 * 账务类再按 commerce:order.read 收窄——租户 / 工单两条线拆门后那道粗门比它聚合的页面
 * 更严（support / auditor 能看工单却打不开待办页）。
 *
 * 再钉一道：申报人的邮箱 / 手机按 user:pii.read 脱敏。仓储那一层给的是原文（它是共享
 * 算法，不认识调用方的能力集），掩码只能在这里做；漏了就等于开了一条绕过订单详情页
 * 那道闸门的新路——一次请求把全部待办的申报人明文下发。
 */
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  OPS_TODO_KINDS,
  type OpsTodo,
  type OpsTodoRepository,
} from "@vxture/service-ops-todos";
import {
  ENTRY_CODES,
  KIND_GATES,
  OpsTodosRouter,
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

const MONEY_KINDS = [
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
];

describe("GET /api/ops/todos 的能力门", () => {
  it("无会话 → 401", async () => {
    const { router } = routerWith();
    await expect(router.listTodos(makeReq(null))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("一个类别的门都没有 → 403，仓储不被调用", async () => {
    const { router, list } = routerWith();
    await expect(
      router.listTodos(makeReq(["user:pii.read", "promotion:campaign.read"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it("只有订单读权（拆门前整页 403）→ 进门，只拿账务十二类 + 维护窗口", async () => {
    const { router, list } = routerWith();
    await router.listTodos(makeReq(["commerce:order.read"]));
    expect(list).toHaveBeenCalledWith({
      kinds: [...MONEY_KINDS, "maintenance_overdue"],
    });
  });

  it("只有工单读码（support / auditor 那一形）→ 工单两类 + 维护窗口，钱一类都不给", async () => {
    const { router, list } = routerWith();
    await router.listTodos(makeReq(["support:ticket.read"]));
    const kinds = list.mock.calls[0]![0].kinds as string[];
    expect(kinds.sort()).toEqual(
      ["ticket", "ticket_sla", "maintenance_overdue"].sort(),
    );
    for (const money of MONEY_KINDS) expect(kinds, money).not.toContain(money);
  });

  it("只有租户读码 → 风险 + 维护窗口；实名审核要自己的码", async () => {
    const { router, list } = routerWith();
    await router.listTodos(makeReq(["tenant:profile.read"]));
    const kinds = list.mock.calls[0]![0].kinds as string[];
    expect(kinds.sort()).toEqual(["risk", "maintenance_overdue"].sort());
    expect(kinds).not.toContain("verification");
  });

  it("只有账号读码 → 删号两类 + 维护窗口（点开的是 /accounts，那一页判 user:profile.read）", async () => {
    const { router, list } = routerWith();
    await router.listTodos(makeReq(["user:profile.read"]));
    const kinds = list.mock.calls[0]![0].kinds as string[];
    expect(kinds.sort()).toEqual(
      ["deletion_pending", "purge_imminent", "maintenance_overdue"].sort(),
    );
  });

  it("administrator 那一组码 → 不传 kinds，全量", async () => {
    const items = [{ id: "confirm_payment:ORD-1" }];
    const { router, list } = routerWith(vi.fn().mockResolvedValue(items));
    const res = await router.listTodos(
      makeReq([
        "tenant:profile.manage",
        "tenant:verification.review",
        "support:ticket.manage",
        "user:profile.read",
        "commerce:order.read",
      ]),
    );
    expect(list).toHaveBeenCalledWith({});
    expect(res).toEqual({ items });
  });
});

describe("KIND_GATES：十九类各归一边，进门码从表里推出", () => {
  it("表的键集正好是共享算法的值域（加一类没归边，模块加载时就该抛）", () => {
    expect(Object.keys(KIND_GATES).sort()).toEqual([...OPS_TODO_KINDS].sort());
    expect(Object.keys(KIND_GATES)).toHaveLength(19);
  });

  it("钱那十二类只认 commerce:order.read；维护窗口是唯一「进门即可见」的类", () => {
    for (const kind of MONEY_KINDS) {
      expect(KIND_GATES[kind as keyof typeof KIND_GATES], kind).toEqual([
        "commerce:order.read",
      ]);
    }
    const open = Object.entries(KIND_GATES)
      .filter(([, gate]) => gate.length === 0)
      .map(([kind]) => kind);
    expect(open).toEqual(["maintenance_overdue"]);
  });

  it("进门码集 = 表里出现过的码，去重且不含遗留扁平串", () => {
    const fromTable = [...new Set(Object.values(KIND_GATES).flat())];
    expect([...ENTRY_CODES].sort()).toEqual(fromTable.sort());
    expect(ENTRY_CODES.some((c) => c.startsWith("platform."))).toBe(false);
    expect(ENTRY_CODES).toContain("support:ticket.read");
    expect(ENTRY_CODES).toContain("user:profile.read");
  });

  it("kindsFor：全开 → undefined；部分 → 只给开了门的那些", () => {
    expect(kindsFor(makeReq([...ENTRY_CODES]))).toBeUndefined();
    /* 空码集只剩「进门即可见」那一类——但空码集根本进不了门（上面的 403 用例），
       kindsFor 不是门，它只在过门之后被调。 */
    expect(kindsFor(makeReq([]))).toEqual(["maintenance_overdue"]);
    expect(kindsFor(makeReq(["tenant:verification.review"]))).toEqual([
      "verification",
      "maintenance_overdue",
    ]);
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
  const caps = ["commerce:order.read"];
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
