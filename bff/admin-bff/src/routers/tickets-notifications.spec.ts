/**
 * tickets-notifications.spec.ts —— 工单写路径上的客户通知（工单线批 2，2026-09-29）。
 *
 * 批 1 把写入路径做出来了（代客建单、内部备注与正式回复分离、明确的关闭），于是
 * `support.tickets` 第一次有行；但客户那边一句话都收不到——提了工单的人在等我们说话，而他
 * 只能自己回页面上翻。owner 裁决 6：通知走现有消息中心，点开跳转到工单详情页。
 *
 * 这个文件钉的四件事，tsc 与 eslint 一件都看不见：
 *
 *   1. **装配在不在**。`@Inject(ADMIN_CUSTOMER_NOTIFIER)` 是「客户会不会收到工单通知」的
 *      唯一开关，而 esbuild 打包**不保留装饰器元数据**：漏掉那一行照样编译、boot-smoke 照样
 *      绿，到线上才以 `undefined` 现形（本仓踩过，tenants.router 的构造函数上写着同一段话）。
 *      所以这里直接读 Nest 的 DI 元数据，把那一行本身当判据。
 *   2. **哪条路径发哪条通知**。三处写入（回复 / 标记已解决 / 关闭）各对一条模板，而
 *      **内部备注一条都不发**——判据与可见性完全同一条：给谁看只由 `event_type` 决定。
 *      发错了不会报错：客户收到「工单有新回复」，点进去什么也没有（那一屏按白名单过滤）。
 *   3. **去重锚随事件变**。一张单会被回复很多次，锚只到工单这一层的话，第二条起全被客户
 *      收件箱那个唯一键静默压掉（不报错，日志里只多一行 skipped）。
 *   4. **通知炸了，运营的动作照样成功**。三处都在写入已提交之后才发。
 *
 * ── 这个 spec 看不见什么（写下来，免得它被当成比它实际更强的保证）──
 *   · 看不见通知**真的落进了收件箱**：分发器在这里是个替身。落库那一半在
 *     @vxture/service-notification 的 dispatcher 用例里。
 *   · 看不见客户那一屏会不会显示它（console 的收件箱是另一个包、另一个运行器）。
 *   · 看不见偏好开关：`ticket_activity` 那一行是否已从「开发中」放开，钉在
 *     @vxture/service-account 的 notification-preferences.service.spec.ts 里。
 */
import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import type { Pool } from "pg";
import type { NotifyInput } from "@vxture/service-notification";
import { TICKET_EVENT_INTERNAL_NOTE } from "@vxture-platform/shared";
import { TicketsRouter } from "./tickets.router";
import { ADMIN_CUSTOMER_NOTIFIER } from "../providers/commerce-services.provider";
import { makeReq, makeTxClient, readerOf } from "../testing/pool-mocks";

const MANAGE = ["platform.tenant.manage"];
const TICKET_UUID = "44444444-4444-4444-8444-444444444444";
const TENANT_UUID = "33333333-3333-4333-8333-333333333333";
const REPORTER_UUID = "55555555-5555-4555-8555-555555555555";
const TICKET_NO = "TK-202609-ABCDEF0123";
/** 流水行的 created_at —— 去重锚里那个时刻的唯一来源。 */
const EVENT_AT = "2026-09-29T12:14:32.000Z";

const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** fetchTicketDetail 的读回行（形状只要够 mapper 用）。 */
const DETAIL_ROW = {
  id: TICKET_UUID,
  ticket_no: TICKET_NO,
  title: "登录进不去",
  status: "open",
  priority: "p2",
  updated_at: "2026-09-29T00:00:00.000Z",
  tenant_id: TENANT_UUID,
  tenant_code: "2000000001",
  tenant_name: "示例租户",
  display_name: null,
  tenant_type: "company" as const,
  tenant_status: "active",
  risk_level: "normal",
  province: null,
  city: null,
  industry: null,
  owner_name: null,
};

/** 锁到 / 点查回来的那一行工单：通知要的三样都在它上面。 */
const TICKET_ROW = {
  id: TICKET_UUID,
  status: "in_progress",
  tenant_id: TENANT_UUID,
  account_id: REPORTER_UUID,
  ticket_no: TICKET_NO,
};

/**
 * 分发器替身。**不用 pool-mocks 里那个共用的 `notifierSpy`**，两个理由都是本文件要断言的东西：
 *   · 这里要读 `notify` 收到的那个载荷（模板码、锚、链接、参数），所以形参得有类型；
 *     共用那个的 `notify` 声明成零形参，`mock.calls[0][0]` 在类型上取不到。
 *   · 这里需要一个**会抛**的变体。共用那个的头注说得对：用会抛的替身去证「这条路径不该发」
 *     是一条永远绿的断言（emit 按设计吞异常）。但本文件用它证的是另一件事——**运营的动作
 *     照样成功**，而那个信号在调用方的返回值上，不在替身里，所以它传得出来。
 *     「不该发」那几条断言的仍然是 `notify` 没被调用过。
 */
function ticketNotifier(behaviour: "ok" | "throws" = "ok") {
  const notify = vi.fn(async (_input: NotifyInput) => {
    if (behaviour === "throws") throw new Error("inbox is down");
    return {
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      skipped: 0,
    };
  });
  return {
    notify,
    port: { notify } as unknown as ConstructorParameters<
      typeof TicketsRouter
    >[2],
  };
}

/**
 * 评论三个入口是**单语句** insert…select（不开事务），所以走 `pool.query`。
 * 这个替身按语句形状作答：写流水 → 返回那一行（含 created_at）；
 * 按 uuid 点查工单 → 返回 TICKET_ROW。未见过的语句回空。
 */
function replyPool() {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(String(sql));
    if (/insert\s+into\s+support\.ticket_comments/i.test(sql)) {
      return {
        rows: [
          {
            id: "c1",
            ticket_id: TICKET_UUID,
            event_type: "reply",
            actor_type: "operator",
            actor_id: null,
            actor_name: "operator",
            payload: { body: "已为您重置" },
            created_at: EVENT_AT,
          },
        ],
        rowCount: 1,
      };
    }
    if (/from\s+support\.tickets/i.test(sql)) {
      return { rows: [TICKET_ROW], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as unknown as Pool, calls };
}

/** 事务替身的作答表：锁工单 → TICKET_ROW（带指定旧状态）；插流水 → 带 created_at。 */
function statusResponder(status: string) {
  return (sql: string) => {
    if (/from\s+support\.tickets/i.test(sql) && /for update/i.test(sql)) {
      return [{ ...TICKET_ROW, status }];
    }
    if (/insert\s+into\s+support\.ticket_comments/i.test(sql)) {
      return [{ created_at: EVENT_AT }];
    }
    return [];
  };
}

describe("装配：分发器是显式注入的（漏了 = 三条通知一句话都不发）", () => {
  /**
   * 判据是 Nest 的 DI 元数据本身，不是「构造函数有三个参数」。
   *
   * 形参个数那种判据挡不住真正会发生的那个失误：把 `@Inject(...)` 那一行删掉、形参留着。
   * 那样写 tsc 过、eslint 过、esbuild 过（它不生成装饰器元数据），启动时注进来的是
   * `undefined`，而 `notifyTicketEvent` 的 try/catch 会把 `undefined.notify` 那个 TypeError
   * 吞成一行 warn —— 于是整条线**静默不发**。这条用例是那一行唯一的守卫。
   */
  it("第三个构造参数上挂着 ADMIN_CUSTOMER_NOTIFIER 这个令牌", () => {
    const declared = Reflect.getMetadata(
      SELF_DECLARED_DEPS_METADATA,
      TicketsRouter,
    ) as { index: number; param: unknown }[] | undefined;
    // 读不到就该红，不许当成通过（元数据没了 = 判据失效）。
    expect(Array.isArray(declared)).toBe(true);
    expect(declared!.length).toBe(3);
    const third = declared!.find((d) => d.index === 2);
    expect(third).toBeDefined();
    expect(third!.param).toBe(ADMIN_CUSTOMER_NOTIFIER);
  });
});

describe("回复客户 → ticket.replied", () => {
  it("发一条：模板 / 参数 / 链接 / 收件人都按可视码走，通篇没有 uuid 上屏", async () => {
    const tx = replyPool();
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).addTicketReply(makeReq(MANAGE), TICKET_NO, { body: "已为您重置" });

    expect(spy.notify).toHaveBeenCalledTimes(1);
    const input = spy.notify.mock.calls[0]![0];
    expect(input.templateCode).toBe("ticket.replied");
    expect(input.tenantId).toBe(TENANT_UUID);
    // 文案参数只有可视工单码：回复正文一个字都不进通知（内容只在详情页留一份）。
    expect(input.params).toEqual({ ticketNo: TICKET_NO });
    // 跳转去工单详情页，地址栏走可视码。
    expect(input.link).toBe(`/tickets/${TICKET_NO}`);
    // 报单人必须在收件人里——他才是在等这句回复的那个人（租户 owner 由分发器恒定追加）。
    expect(input.recipients).toEqual([REPORTER_UUID]);
    // 去重锚：可视码 + 事件名 + 这一行流水自己的时刻。
    expect(input.reference).toEqual({
      type: "ticket",
      id: `${TICKET_NO}:replied:${EVENT_AT}`,
    });
    /* `reference_id` 与 `params` 都会被客户收件箱的读路径原样投影给浏览器，所以这两处
       一个 uuid 都不许有。tenantId / recipients 是分发器内部用的，不上屏。 */
    expect(input.reference.id).not.toMatch(UUID_ANYWHERE);
    expect(JSON.stringify(input.params)).not.toMatch(UUID_ANYWHERE);
    expect(input.link).not.toMatch(UUID_ANYWHERE);
  });

  it("回复正文不进通知（搬进来就等于把「给谁看」的判据交给一个看不见 event_type 的层）", async () => {
    const tx = replyPool();
    const spy = ticketNotifier();
    const secret = "客户上季度欠款，先拖两天等法务回话";
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).addTicketReply(makeReq(MANAGE), TICKET_NO, { body: secret });

    expect(JSON.stringify(spy.notify.mock.calls[0]![0])).not.toContain(secret);
  });

  it("同一张单回复两次 = 两个不同的锚（否则第二条起被收件箱唯一键静默压掉）", async () => {
    const seen: string[] = [];
    for (const at of [EVENT_AT, "2026-09-29T12:20:00.000Z"]) {
      const query = vi.fn(async (sql: string) => {
        if (/insert\s+into\s+support\.ticket_comments/i.test(sql)) {
          return {
            rows: [
              {
                id: "c",
                ticket_id: TICKET_UUID,
                event_type: "reply",
                actor_type: "operator",
                actor_id: null,
                actor_name: "operator",
                payload: {},
                created_at: at,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [TICKET_ROW], rowCount: 1 };
      });
      const spy = ticketNotifier();
      await new TicketsRouter(
        readerOf([DETAIL_ROW]),
        { query } as unknown as Pool,
        spy.port,
      ).addTicketReply(makeReq(MANAGE), TICKET_NO, { body: "x" });
      seen.push(spy.notify.mock.calls[0]![0].reference.id);
    }
    expect(new Set(seen).size).toBe(2);
  });

  it("内部备注一条都不发（两个入口都不发：判据是写进去的那个词，不是端点）", async () => {
    for (const call of [
      (r: TicketsRouter) =>
        r.addInternalNote(makeReq(MANAGE), TICKET_NO, { body: "查了日志" }),
      // 旧别名 :id/comments —— body 说不出给谁看，落安全档 internal_note。
      (r: TicketsRouter) =>
        r.addTicketComment(makeReq(MANAGE), TICKET_NO, { body: "随手一记" }),
    ]) {
      const tx = replyPool();
      const spy = ticketNotifier();
      await call(new TicketsRouter(readerOf([DETAIL_ROW]), tx.pool, spy.port));
      expect(spy.notify).not.toHaveBeenCalled();
    }
    /* 顺带钉住这两个入口写的确实是那个词——否则上面那两句「没发通知」可能只是因为
       路径压根没跑到，那会是个恒真的判据。 */
    const tx = replyPool();
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).addInternalNote(makeReq(MANAGE), TICKET_NO, { body: "查了日志" });
    expect(tx.calls.some((sql) => /ticket_comments/i.test(sql))).toBe(true);
    expect(TICKET_EVENT_INTERNAL_NOTE).toBe("internal_note");
  });

  it("通知炸了，回复照样写成并正常返回（失败隔离）", async () => {
    const tx = replyPool();
    const spy = ticketNotifier("throws");
    const record = await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).addTicketReply(makeReq(MANAGE), TICKET_NO, { body: "已为您重置" });

    expect(spy.notify).toHaveBeenCalledTimes(1);
    expect(record.eventType).toBe("reply");
  });
});

describe("状态变更 → ticket.resolved / ticket.closed", () => {
  it("标记已解决发 ticket.resolved，锚与链接都走可视码", async () => {
    const tx = makeTxClient(statusResponder("in_progress"));
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).changeTicketStatus(makeReq(MANAGE), TICKET_NO, { status: "resolved" });

    expect(tx.outcome().committed).toBe(true);
    expect(spy.notify).toHaveBeenCalledTimes(1);
    const input = spy.notify.mock.calls[0]![0];
    expect(input.templateCode).toBe("ticket.resolved");
    expect(input.reference.id).toBe(`${TICKET_NO}:resolved:${EVENT_AT}`);
    expect(input.link).toBe(`/tickets/${TICKET_NO}`);
    expect(input.params).toEqual({ ticketNo: TICKET_NO });
  });

  it("关闭发 ticket.closed，且关闭原因不进通知（详情页已经有那句话）", async () => {
    const tx = makeTxClient(statusResponder("resolved"));
    const spy = ticketNotifier();
    const reason = "客户确认已解决，按约定关闭";
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).closeTicketEndpoint(makeReq(MANAGE), TICKET_NO, { reason });

    expect(tx.outcome().committed).toBe(true);
    const input = spy.notify.mock.calls[0]![0];
    expect(input.templateCode).toBe("ticket.closed");
    expect(input.reference.id).toBe(`${TICKET_NO}:closed:${EVENT_AT}`);
    /* 原因写在 status_changed 的 payload 里（那个词客户看得见）⇒ 详情页上就有。
       通知里再存一份就是同一段话的第二个副本。 */
    expect(JSON.stringify(input)).not.toContain(reason);
  });

  it("通用 status 端点收到 closed 时也发 ticket.closed（两个入口一套规则）", async () => {
    const tx = makeTxClient(statusResponder("open"));
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).changeTicketStatus(makeReq(MANAGE), TICKET_NO, {
      status: "closed",
      note: "电话里当场解决",
    });
    expect(spy.notify.mock.calls[0]![0].templateCode).toBe("ticket.closed");
  });

  it("其余四个状态一条都不发（客户在那几档上没有下一步）", async () => {
    for (const status of ["open", "pending", "in_progress", "reopened"]) {
      const tx = makeTxClient(statusResponder("open"));
      const spy = ticketNotifier();
      await new TicketsRouter(
        readerOf([DETAIL_ROW]),
        tx.pool,
        spy.port,
      ).changeTicketStatus(makeReq(MANAGE), TICKET_NO, { status });
      // 事务确实跑了（状态真的改了）⇒「没发通知」不是因为路径没走到。
      expect(tx.outcome().committed).toBe(true);
      expect(spy.notify).not.toHaveBeenCalled();
    }
  });

  it("关闭被 409 拦下时不发通知（事务回滚了，通知是 commit 之后的事）", async () => {
    const tx = makeTxClient(statusResponder("closed"));
    const spy = ticketNotifier();
    await expect(
      new TicketsRouter(
        readerOf([DETAIL_ROW]),
        tx.pool,
        spy.port,
      ).closeTicketEndpoint(makeReq(MANAGE), TICKET_NO, { reason: "再关一次" }),
    ).rejects.toThrow();
    expect(tx.outcome().rolledBack).toBe(true);
    expect(spy.notify).not.toHaveBeenCalled();
  });

  it("通知炸了，关闭照样成功（失败隔离）", async () => {
    const tx = makeTxClient(statusResponder("resolved"));
    const spy = ticketNotifier("throws");
    const record = await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).closeTicketEndpoint(makeReq(MANAGE), TICKET_NO, { reason: "已处理完毕" });

    expect(tx.outcome().committed).toBe(true);
    expect(spy.notify).toHaveBeenCalledTimes(1);
    expect(record.id).toBe(TICKET_NO);
  });

  it("工单没有可视码时宁可不发，也不把 uuid 递给浏览器", async () => {
    /* `reference_id` 被客户收件箱的读路径原样投影给浏览器。没有 ticket_no 时唯一能写进锚的
       就只剩 uuid —— 那一档的正确行为是跳过并记日志，不是凑一个。 */
    const tx = makeTxClient((sql: string) => {
      if (/from\s+support\.tickets/i.test(sql) && /for update/i.test(sql)) {
        return [{ ...TICKET_ROW, status: "resolved", ticket_no: null }];
      }
      if (/insert\s+into\s+support\.ticket_comments/i.test(sql)) {
        return [{ created_at: EVENT_AT }];
      }
      return [];
    });
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).closeTicketEndpoint(makeReq(MANAGE), TICKET_UUID, { reason: "关掉" });

    expect(tx.outcome().committed).toBe(true);
    expect(spy.notify).not.toHaveBeenCalled();
  });
});

describe("指派事件的 payload 不再带坐席 uuid", () => {
  it("payload 只有名字与备注（这段会原样出到浏览器）", async () => {
    const tx = makeTxClient((sql: string) =>
      /from\s+support\.tickets/i.test(sql) && /for update/i.test(sql)
        ? [{ ...TICKET_ROW, status: "open" }]
        : [],
    );
    const spy = ticketNotifier();
    await new TicketsRouter(
      readerOf([DETAIL_ROW]),
      tx.pool,
      spy.port,
    ).assignTicket(makeReq(MANAGE), TICKET_NO, {
      assigneeId: REPORTER_UUID,
      assigneeName: "李四",
      note: "他熟这块",
    });

    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.ticket_comments/i.test(sql),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    const payload = tx.params[i]!.find(
      (v) => typeof v === "string" && v.trim().startsWith("{"),
    );
    expect(String(payload)).toContain("李四");
    expect(String(payload)).toContain("他熟这块");
    expect(String(payload)).not.toMatch(UUID_ANYWHERE);
    /* 坐席 uuid 仍然写进 tickets.assignee_id 那一列（库内外键，不上屏）。 */
    const u = tx.calls.findIndex((sql) =>
      /update\s+support\.tickets/i.test(sql),
    );
    expect(tx.params[u]).toContain(REPORTER_UUID);
    // 指派不是客户关心的事（`assigned` 也不在客户可见白名单里）⇒ 不发通知。
    expect(spy.notify).not.toHaveBeenCalled();
  });
});
