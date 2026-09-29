import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
  TICKET_EVENT_INTERNAL_NOTE,
  TICKET_STATUSES,
} from "@vxture-platform/shared";
import { TicketsRouter } from "./tickets.router";
import type { RequestContext } from "../types/console.types";

/**
 * 客户侧工单路由的判据。五件事各自钉住：
 *
 * ① **租户隔离**：每条读写的谓词里都必须有会话租户；别家的单号在解析那一步就
 *    404，**后面一条写入都不许发出去**（不是「写了但没人看见」）。
 * ② **时间线的可见性过滤**：绑的数组必须就是 @shared 的那份白名单，
 *    `internal_note` 不在里面，且方向是白名单不是黑名单。
 *    「真的过滤掉了」要在真库上验（已在本机 platform_main 上跑过：写入
 *    created / internal_note / assigned / comment / reply 五条，这条查询只回
 *    comment 与 reply）——单测能钉住的是**绑的是哪份值域**，那正是会漂的地方。
 * ③ **响应体里没有 uuid**：假件故意在库侧返回 uuid（工单 id、payload 里的
 *    assignee_id），再逐字段走一遍响应，证明窄投影把它们都挡在了进程里。
 * ④ **状态语义**：终态不收回复、resolved 被回复即自动重新打开、活着的单不许
 *    「重新打开」。分组与门户 `lib/ticket-state.ts` 必须同一套（末尾那条对账）。
 * ⑤ **动静时刻不取 updated_at**：运营的内部备注也会推进 updated_at。
 *
 * 库用假件——路由只负责拼参数与判分支，不需要真 SQL。
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const TICKET_UUID = "11111111-2222-4333-8444-555555555555";
const ASSIGNEE_UUID = "99999999-8888-4777-8666-555555555555";
const CODE = "TK-202609-ABCDEF1234";

type Result = { rows: unknown[]; rowCount?: number };
type Handler = (kind: string, sql: string, params: unknown[]) => Result;

/** 按 SQL 文本认出这是哪一条查询（顺序有讲究，先认更专的）。 */
function kindOf(sql: string): string {
  const text = sql.trim();
  if (/^(begin|commit|rollback)$/i.test(text)) return text.toLowerCase();
  if (text.includes("insert into support.tickets")) return "insertTicket";
  if (text.includes("insert into support.ticket_comments"))
    return "insertEvent";
  if (text.includes("join support.tickets t on t.id = c.ticket_id"))
    return "timeline";
  if (text.includes("for update")) return "lock";
  if (text.includes("where t.ticket_no = $1")) return "one";
  if (text.includes("left join lateral")) return "list";
  if (text.includes("set status =")) return "reopen";
  if (text.includes("set updated_at = now()")) return "touch";
  return "unknown";
}

interface Call {
  kind: string;
  sql: string;
  params: unknown[];
}

function makeDb(handler: Handler) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    const kind = kindOf(text);
    calls.push({ kind, sql: text, params: params ?? [] });
    return handler(kind, text, params ?? []);
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = {
    query,
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return { pool, query, calls, release };
}

const KINDS = (calls: Call[]): string[] => calls.map((c) => c.kind);

function req(
  tenantId: string | null = "tenant-uuid",
  userId = "user-uuid",
): Request & RequestContext {
  return {
    user: { id: userId, name: "客户甲" },
    tenant: tenantId ? { id: tenantId } : undefined,
  } as unknown as Request & RequestContext;
}

function ticketRow(status = "open") {
  return {
    ticket_no: CODE,
    title: "登录不上",
    status,
    priority: "p2",
    category: "general",
    description: "换了手机就登录不上了",
    created_at: new Date("2026-09-20T02:00:00Z"),
    updated_at: new Date("2026-09-28T09:30:00Z"),
    reporter_name: "张三",
    last_activity_event_type: "reply",
    last_activity_at: new Date("2026-09-25T06:00:00Z"),
  };
}

/** 一条**客户看得见**的状态变更，payload 里故意带一个内部 uuid。 */
const STATUS_EVENT_ROW = {
  event_type: "status_changed",
  actor_type: "operator",
  actor_name: "客服小李",
  payload: {
    from: "open",
    to: "resolved",
    note: "已在后台重置",
    assignee_id: ASSIGNEE_UUID,
  },
  created_at: new Date("2026-09-28T09:30:00Z"),
};

function assertNoUuid(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    expect(UUID_RE.test(value), `${path} 泄露了 uuid：${value}`).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoUuid(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expect(UUID_RE.test(key), `${path}.${key} 的键是 uuid`).toBe(false);
      assertNoUuid(item, `${path}.${key}`);
    }
  }
}

// ── 列表 ─────────────────────────────────────────────────────────────────────

describe("TicketsRouter.list", () => {
  it("缺租户上下文时 401，且一次库都不查", async () => {
    const { pool, query } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).list(req(null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it("租户只从会话取；可见值域绑参下发；上限绑参不插值", async () => {
    const { pool, calls } = makeDb(() => ({ rows: [] }));
    await new TicketsRouter(pool).list(req("tenant-A"));

    expect(KINDS(calls)).toEqual(["list"]);
    const list = calls[0]!;
    expect(list.params[0]).toBe("tenant-A");
    expect(list.params[1]).toEqual([...CUSTOMER_VISIBLE_TICKET_EVENT_TYPES]);
    /* 上限多拉一行（200 + 1）：多出来那一行不进响应，只用来记一条 warn。
       列表按最后一次可见动静倒序，截掉的恰好是最久没动的那几张，
       而抽屉跟列表页都是在这一页上再筛的 ⇒ 屏幕上看不出来。 */
    expect(list.params[2]).toBe(201);
    expect(list.sql).toMatch(/limit \$3/);
  });

  it("读工单流水带白名单绑参，方向不是黑名单；排序不取 updated_at", async () => {
    const { pool, calls } = makeDb(() => ({ rows: [] }));
    await new TicketsRouter(pool).list(req());
    const sql = calls[0]!.sql;
    expect(sql).toMatch(/c\.event_type = any\(\$2::text\[\]\)/);
    expect(sql).not.toMatch(/event_type\s*(<>|!=)|event_type\s+not\s+in/i);
    // 动静时刻取「最后一条客户可见流水」，取不到退回建单时刻——不是 updated_at
    expect(sql).toMatch(
      /order by coalesce\(last_visible\.created_at, t\.created_at\) desc/,
    );
  });

  it("行映射：lastActivity 来自可见流水，响应无 uuid", async () => {
    const { pool } = makeDb(() => ({
      rows: [
        ticketRow("open"),
        {
          ...ticketRow("closed"),
          ticket_no: "TK-202609-0000000001",
          last_activity_event_type: null,
          last_activity_at: null,
        },
      ],
    }));
    const items = await new TicketsRouter(pool).list(req());

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      ticketNo: CODE,
      title: "登录不上",
      status: "open",
      priority: "p2",
      category: "general",
      createdAt: "2026-09-20T02:00:00.000Z",
      updatedAt: "2026-09-28T09:30:00.000Z",
      // 租户级可见 ⇒ 「同事里谁提的」是真信息，所以报单人要到客户手里。
      reporterName: "张三",
      lastActivityAt: "2026-09-25T06:00:00.000Z",
      lastActivityEventType: "reply",
    });
    // 一条可见流水都没有 ⇒ 两项都是 null，不拿 updated_at 顶替
    expect(items[1]!.lastActivityAt).toBeNull();
    expect(items[1]!.lastActivityEventType).toBeNull();
    assertNoUuid(items);
  });

  it("超上限：多拉的那一行不进响应，只用来记 warn", async () => {
    /* 造 201 行（刚好碰到探针那一行）。契约是裸数组，所以「被截断了」只能
       落在服务端日志里；这一条钉的是**响应不多出那一行**（否则客户端的分页
       会多出一行幽灵）。 */
    const rows = Array.from({ length: 201 }, (_, i) => ({
      ...ticketRow("open"),
      ticket_no: `TK-202609-${String(i).padStart(10, "0")}`,
    }));
    const { pool } = makeDb(() => ({ rows }));
    const items = await new TicketsRouter(pool).list(req());
    expect(items).toHaveLength(200);
    expect(items.at(-1)!.ticketNo).toBe("TK-202609-0000000199");
  });
});

// ── 详情 / 时间线 ────────────────────────────────────────────────────────────

describe("TicketsRouter.detail", () => {
  it("别的租户的单号 → 404，且不去读时间线", async () => {
    const { pool, calls } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).detail(req("tenant-B"), CODE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(KINDS(calls)).toEqual(["one"]);
    expect(calls[0]!.params.slice(0, 2)).toEqual([CODE, "tenant-B"]);
  });

  it("单号形状不对 → 400，不查库（uuid 也解析不出工单）", async () => {
    const { pool, query } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).detail(req(), "  "),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("时间线绑 @shared 的白名单，internal_note 不在其中", async () => {
    const { pool, calls } = makeDb((kind) =>
      kind === "one" ? { rows: [ticketRow()] } : { rows: [] },
    );
    await new TicketsRouter(pool).detail(req("tenant-A"), CODE);

    expect(KINDS(calls)).toEqual(["one", "timeline"]);
    const timeline = calls[1]!;
    expect(timeline.sql).toMatch(/c\.event_type = any\(\$3::text\[\]\)/);
    expect(timeline.sql).not.toMatch(
      /event_type\s*(<>|!=)|event_type\s+not\s+in/i,
    );
    const kinds = timeline.params[2] as string[];
    expect(kinds).toEqual([...CUSTOMER_VISIBLE_TICKET_EVENT_TYPES]);
    expect(kinds).not.toContain(TICKET_EVENT_INTERNAL_NOTE);
    // 租户仍是谓词的一部分：时间线不靠「上一条查询已经核过了」免检
    expect(timeline.params.slice(0, 2)).toEqual([CODE, "tenant-A"]);
  });

  it("窄投影：payload 里的内部 uuid 不进响应；正文与状态落点双接受", async () => {
    const { pool } = makeDb((kind) => {
      if (kind === "one") return { rows: [ticketRow("resolved")] };
      if (kind === "timeline")
        return {
          rows: [
            {
              event_type: "comment",
              actor_type: "customer",
              actor_name: "客户甲",
              payload: { body: "换了手机就登录不上了" },
              created_at: new Date("2026-09-20T02:05:00Z"),
            },
            STATUS_EVENT_ROW,
          ],
        };
      return { rows: [] };
    });
    const detail = await new TicketsRouter(pool).detail(req(), CODE);

    expect(detail.ticketNo).toBe(CODE);
    expect(detail.description).toBe("换了手机就登录不上了");
    expect(detail.events[0]!.body).toBe("换了手机就登录不上了");
    expect(detail.events[0]!.status).toBeNull();
    // 运营写的是 payload.note / payload.to（不是 body / status）——两个键都要认
    expect(detail.events[1]).toEqual({
      eventType: "status_changed",
      actorType: "operator",
      actorName: "客服小李",
      body: "已在后台重置",
      status: "resolved",
      createdAt: "2026-09-28T09:30:00.000Z",
    });
    assertNoUuid(detail);
  });
});

// ── 建单 ─────────────────────────────────────────────────────────────────────

describe("TicketsRouter.createTicket", () => {
  const body = { title: "登录不上", description: "换了手机就登录不上了" };

  it("客户送 priority / category → 400，且一次库都不查", async () => {
    const { pool, query } = makeDb(() => ({ rows: [] }));
    const router = new TicketsRouter(pool);
    await expect(
      router.createTicket(req(), { ...body, priority: "p0" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.createTicket(req(), { ...body, category: "billing" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("标题/正文必填", async () => {
    const { pool } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).createTicket(req(), { title: "  " }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("身份与来源全取会话：tenant/account 不从请求体来，source=console", async () => {
    const { pool, calls } = makeDb((kind) =>
      kind === "insertTicket"
        ? { rows: [{ id: TICKET_UUID, ...ticketRow() }] }
        : { rows: [] },
    );
    const created = await new TicketsRouter(pool).createTicket(
      req("tenant-A", "user-A"),
      // 请求体里塞租户/账号，必须一个字都不进 SQL
      { ...body, tenantId: "tenant-Z", accountId: "user-Z" } as never,
    );

    expect(KINDS(calls)).toEqual([
      "begin",
      "insertTicket",
      "insertEvent",
      "commit",
    ]);
    const insert = calls[1]!;
    expect(insert.params[0]).toBe("tenant-A");
    expect(insert.params[1]).toBe("user-A");
    expect(insert.params[2]).toMatch(/^TK-\d{6}-[0-9A-F]{10}$/);
    expect(insert.params[3]).toBe("console");
    expect(insert.params.slice(4)).toEqual([
      body.title,
      body.description,
      "客户甲",
    ]);
    // 建单事件刻意不在白名单里（客户不该在自己的时间线上读到内部口径）
    const createdEvent = calls[2]!;
    expect(createdEvent.params[1]).toBe("created");
    expect(
      CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[],
    ).not.toContain(createdEvent.params[1]);
    // 新单还没有可见流水：两项是 null，且不多发一次查询
    expect(created.lastActivityAt).toBeNull();
    expect(created.lastActivityEventType).toBeNull();
    assertNoUuid(created);
  });

  it("单号撞号 → 409（唯一约束兜底），事务回滚", async () => {
    const { pool, calls } = makeDb((kind) => {
      if (kind === "insertTicket") {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      return { rows: [] };
    });
    await expect(
      new TicketsRouter(pool).createTicket(req(), body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(KINDS(calls)).toEqual(["begin", "insertTicket", "rollback"]);
  });
});

// ── 回复 ─────────────────────────────────────────────────────────────────────

describe("TicketsRouter.addReply", () => {
  const msg = { body: "还是登录不上" };
  const appended = {
    event_type: "comment",
    actor_type: "customer",
    actor_name: "客户甲",
    payload: { body: msg.body },
    created_at: new Date("2026-09-29T01:00:00Z"),
  };

  it("别的租户的单号 → 404，且一条写入都没发出去", async () => {
    const { pool, calls } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).addReply(req("tenant-B"), CODE, msg),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(KINDS(calls)).toEqual(["begin", "lock", "rollback"]);
    expect(calls[1]!.params).toEqual([CODE, "tenant-B"]);
  });

  it("已关闭 / 已取消的单不收回复 → 409，不写入", async () => {
    for (const status of ["closed", "cancelled"]) {
      const { pool, calls } = makeDb((kind) =>
        kind === "lock"
          ? { rows: [{ id: TICKET_UUID, status }] }
          : { rows: [] },
      );
      await expect(
        new TicketsRouter(pool).addReply(req(), CODE, msg),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(KINDS(calls)).toEqual(["begin", "lock", "rollback"]);
    }
  });

  it("活着的单：写一条客户发言（词在白名单里），并 bump updated_at", async () => {
    const { pool, calls } = makeDb((kind) => {
      if (kind === "lock")
        return { rows: [{ id: TICKET_UUID, status: "open" }] };
      if (kind === "insertEvent") return { rows: [appended] };
      return { rows: [] };
    });
    const event = await new TicketsRouter(pool).addReply(req(), CODE, msg);

    expect(KINDS(calls)).toEqual([
      "begin",
      "lock",
      "insertEvent",
      "touch",
      "commit",
    ]);
    const written = calls[2]!;
    const word = written.params[1] as string;
    expect(CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[]).toContain(
      word,
    );
    expect(word).not.toBe(TICKET_EVENT_INTERNAL_NOTE);
    expect(written.params[4]).toBe(JSON.stringify({ body: msg.body }));
    // 写进 payload 的只有正文，没有任何 id
    assertNoUuid(JSON.parse(written.params[4] as string));
    // bump 只动 updated_at，不碰锚点列
    expect(calls[3]!.sql).toMatch(/set updated_at = now\(\)/);
    expect(calls[3]!.sql).not.toMatch(
      /set[\s\S]*\b(ticket_no|created_at)\b\s*=/,
    );
    expect(event.eventType).toBe("comment");
    assertNoUuid(event);
  });

  it("已解决的单被回复 ⇒ 自动重新打开，并留下客户看得见的状态变更", async () => {
    const { pool, calls } = makeDb((kind) => {
      if (kind === "lock")
        return { rows: [{ id: TICKET_UUID, status: "resolved" }] };
      if (kind === "insertEvent") return { rows: [appended] };
      return { rows: [] };
    });
    await new TicketsRouter(pool).addReply(req(), CODE, msg);

    expect(KINDS(calls)).toEqual([
      "begin",
      "lock",
      "insertEvent",
      "reopen",
      "insertEvent",
      "commit",
    ]);
    expect(calls[3]!.params).toEqual([TICKET_UUID, "reopened"]);
    expect(calls[3]!.sql).toMatch(/resolved_at = null/);
    const statusEvent = calls[4]!;
    expect(statusEvent.params[1]).toBe("status_changed");
    expect(CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[]).toContain(
      statusEvent.params[1],
    );
    expect(statusEvent.params[4]).toBe(
      JSON.stringify({ from: "resolved", to: "reopened" }),
    );
  });
});

// ── 重新打开 ─────────────────────────────────────────────────────────────────

describe("TicketsRouter.reopenTicket", () => {
  it("必须带一句话（否则 400，不查库）", async () => {
    const { pool, query } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).reopenTicket(req(), CODE, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it("别的租户的单号 → 404，且没有写入", async () => {
    const { pool, calls } = makeDb(() => ({ rows: [] }));
    await expect(
      new TicketsRouter(pool).reopenTicket(req("tenant-B"), CODE, {
        reason: "又出现了",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(KINDS(calls)).toEqual(["begin", "lock", "rollback"]);
  });

  it("还能回复的单不许「重新打开」 → 409", async () => {
    const { pool, calls } = makeDb((kind) =>
      kind === "lock"
        ? { rows: [{ id: TICKET_UUID, status: "pending" }] }
        : { rows: [] },
    );
    await expect(
      new TicketsRouter(pool).reopenTicket(req(), CODE, { reason: "又出现了" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(KINDS(calls)).toEqual(["begin", "lock", "rollback"]);
  });

  it("关闭的单：一条 status_changed 承载那句话，随后回读刷新后的行", async () => {
    const { pool, calls } = makeDb((kind) => {
      if (kind === "lock")
        return { rows: [{ id: TICKET_UUID, status: "closed" }] };
      if (kind === "one")
        return {
          rows: [
            {
              ...ticketRow("reopened"),
              last_activity_event_type: "status_changed",
              last_activity_at: new Date("2026-09-29T02:00:00Z"),
            },
          ],
        };
      return { rows: [] };
    });
    const ticket = await new TicketsRouter(pool).reopenTicket(req(), CODE, {
      reason: "又出现了",
    });

    expect(KINDS(calls)).toEqual([
      "begin",
      "lock",
      "reopen",
      "insertEvent",
      "commit",
      "one",
    ]);
    expect(calls[2]!.sql).toMatch(/closed_at = null/);
    const statusEvent = calls[3]!;
    expect(statusEvent.params[1]).toBe("status_changed");
    expect(statusEvent.params[4]).toBe(
      JSON.stringify({ from: "closed", to: "reopened", note: "又出现了" }),
    );
    // 流水时刻取 clock_timestamp()，不是事务常量 now()——否则同事务的两行撞成
    // 同一微秒，时间线的先后就退化成随机 uuid 的顺序。
    expect(statusEvent.sql).toMatch(/clock_timestamp\(\)/);
    expect(ticket.status).toBe("reopened");
    expect(ticket.lastActivityEventType).toBe("status_changed");
    assertNoUuid(ticket);
  });
});

// ── 与门户同一套状态判据 ─────────────────────────────────────────────────────

describe("状态分组与门户对账", () => {
  /**
   * 服务端的「能回复 / 已终结」必须与 `portals/console/src/lib/ticket-state.ts`
   * 同一套：门户按它决定显示输入框还是「重新打开」，服务端按它决定 409。两边
   * 分叉的症状是客户对着一个开着的框写完字、被拒。
   * 这里用**行为**反推服务端那一侧（不 import 私有常量）：七个值逐个跑一次回复。
   */
  it("七个状态逐个跑：只有 closed / cancelled 被拒", async () => {
    const rejected: string[] = [];
    for (const status of TICKET_STATUSES) {
      const { pool } = makeDb((kind) => {
        if (kind === "lock") return { rows: [{ id: TICKET_UUID, status }] };
        if (kind === "insertEvent")
          return {
            rows: [
              {
                event_type: "comment",
                actor_type: "customer",
                actor_name: "客户甲",
                payload: { body: "再说一句" },
                created_at: new Date("2026-09-29T01:00:00Z"),
              },
            ],
          };
        return { rows: [] };
      });
      try {
        await new TicketsRouter(pool).addReply(req(), CODE, {
          body: "再说一句",
        });
      } catch {
        rejected.push(status);
      }
    }
    expect(rejected).toEqual(["closed", "cancelled"]);
  });
});
