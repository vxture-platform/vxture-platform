import { describe, it, expect, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Pool } from "pg";
import {
  CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
  TICKET_EVENT_INTERNAL_NOTE,
  TICKET_EVENT_REPLY,
} from "@vxture-platform/shared";
import { TicketsRouter } from "./tickets.router";
import {
  insertParam,
  makeReq,
  makeTxClient,
  noDbPool,
  readerOf,
} from "../testing/pool-mocks";

/**
 * 工单写路径（批 1：运营代客建单 / 内部备注与正式回复分离 / 明确关闭）。
 *
 * 这个 spec 钉的是 tsc 与 eslint 都看不见的那几件事：
 *
 *   1. **写进库的那个词**。`event_type` 是唯一的可见性判据，所以「这条路径写的
 *      到底是哪个词」必须有断言。写错词不会报错，只会在客户那一屏上现形。
 *      建单那条事件同理：把它实际写进去的词**从语句里读出来**，再对着
 *      `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES` 断言它不在里面——手抄一份期望值
 *      正是让「代码改了词、白名单没跟上」这种漂移躲过去的东西。
 *   2. **默认落安全档**。请求没说这条流水给谁看时，落到的必须是客户看不见的那档。
 *   3. **关闭只有一套规则**。`:id/close` 与 `:id/status`(closed) 两个入口都必须
 *      要求原因、都必须对终态 409——不然规则等于没有（走另一个入口即可绕过）。
 *   4. 授权在碰库之前；抛错必须回滚并释放。
 *
 * 断言按**列名**取 INSERT 参数（`insertParam`），不按下标：日后给 ticket_comments
 * 或 audit_logs 加一列，占位符整体右移而断言含义不该跟着漂。
 */

const MANAGE = ["platform.tenant.manage"];
const TENANT_UUID = "33333333-3333-4333-8333-333333333333";
const TICKET_UUID = "44444444-4444-4444-8444-444444444444";

/** 一条已存在的工单（fetchTicketDetail 的读回行，形状只要够 mapper 用）。 */
const DETAIL_ROW = {
  id: TICKET_UUID,
  ticket_no: "TK-202609-ABCDEF0123",
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

function routerWith(tx: { pool: Pool }, reader: Pool = readerOf([DETAIL_ROW])) {
  return new TicketsRouter(reader, tx.pool);
}

/**
 * 记账式的非事务 pool 替身：评论三个入口是**单语句** insert…select（不开事务），
 * 所以它们走 `pool.query` 而不是 `pool.connect()`。`makeTxClient` 的 pool.query
 * 返回 undefined，用它测这三条路径会抛在替身里，把「替身不对」伪装成「代码不对」。
 */
function makeQueryPool(rows: unknown[] = [{ id: "c1" }]): {
  pool: Pool;
  calls: string[];
  params: unknown[][];
} {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push(String(sql));
    params.push(values ?? []);
    return { rows, rowCount: rows.length };
  });
  return { pool: { query } as unknown as Pool, calls, params };
}

/** 找出写进 support.ticket_comments 的那条语句（及其参数）。 */
function commentInsert(calls: string[], params: unknown[][]) {
  const i = calls.findIndex((sql) =>
    /insert\s+into\s+support\.ticket_comments/i.test(sql),
  );
  if (i < 0) throw new Error("没有任何语句写 support.ticket_comments");
  return { sql: calls[i]!, values: params[i]! };
}

/** 按顶层逗号切（`jsonb_build_object('body', $4)` 里的逗号不算）。 */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * 从 `insert into … (列) select 表达式, …` 里按**列名**取参数值。
 *
 * `insertParam`（pool-mocks）只认 `values (…)` 那一种形状，而工单流水的写入全是
 * `insert…select`（要在同一条语句里按 ticket_no / id 解析工单）。按名取而不按下标，
 * 理由与 insertParam 的头注同一条：日后给 ticket_comments 加一列，占位符整体右移，
 * 而断言的含义不该跟着漂。取不到就**抛**——断言拿到 undefined 会把「助手没看懂
 * 这条 SQL」伪装成「被测代码写错了」。
 */
function insertSelectParam(
  sql: string,
  values: unknown[],
  column: string,
): unknown {
  const shape =
    /insert\s+into\s+[\w."]+\s*\(([^)]*)\)\s*select\s+([\s\S]*?)\s+from\s/i.exec(
      sql,
    );
  if (!shape) {
    throw new Error(
      `insertSelectParam: 这不是可识别的 insert…select：${sql.slice(0, 120)}`,
    );
  }
  const columns = splitTopLevel(shape[1]!).map((name) => name.toLowerCase());
  const exprs = splitTopLevel(shape[2]!);
  if (columns.length !== exprs.length) {
    throw new Error(
      `insertSelectParam: ${columns.length} 列对 ${exprs.length} 个值，对不上`,
    );
  }
  const at = columns.indexOf(column.toLowerCase());
  if (at < 0) {
    throw new Error(
      `insertSelectParam: 列 ${column} 不在列表里（有 ${columns.join(", ")}）`,
    );
  }
  const placeholder = /^\$(\d+)/.exec(exprs[at]!);
  if (!placeholder) {
    throw new Error(
      `insertSelectParam: 列 ${column} 写的是字面量 ${exprs[at]}，没有对应参数`,
    );
  }
  const index = Number(placeholder[1]) - 1;
  if (index >= values.length) {
    throw new Error(
      `insertSelectParam: 列 ${column} 用 $${index + 1}，但只送了 ${values.length} 个参数`,
    );
  }
  return values[index];
}

describe("工单写路径 —— 可见性契约", () => {
  it("正式回复写 'reply'，且 'reply' 在客户可见集合里", async () => {
    const tx = makeQueryPool([{ id: "c1", event_type: TICKET_EVENT_REPLY }]);
    const router = routerWith(tx);
    await router.addTicketReply(makeReq(MANAGE), "TK-1", {
      body: "已为您重置",
    });

    const { values, sql } = commentInsert(tx.calls, tx.params);
    expect(values).toContain(TICKET_EVENT_REPLY);
    // 词是绑参进去的，不是拼在 SQL 里的字面量。
    expect(sql).not.toMatch(/'reply'/);
    expect(CUSTOMER_VISIBLE_TICKET_EVENT_TYPES).toContain(TICKET_EVENT_REPLY);
  });

  it("内部备注写 'internal_note'，且它**不在**客户可见集合里", async () => {
    const tx = makeQueryPool([
      { id: "c2", event_type: TICKET_EVENT_INTERNAL_NOTE },
    ]);
    const router = routerWith(tx);
    await router.addInternalNote(makeReq(MANAGE), "TK-1", { body: "查了日志" });

    expect(commentInsert(tx.calls, tx.params).values).toContain(
      TICKET_EVENT_INTERNAL_NOTE,
    );
    expect(
      CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[],
    ).not.toContain(TICKET_EVENT_INTERNAL_NOTE);
  });

  it("旧 :id/comments 入口（body 说不出给谁看）落安全档 internal_note", async () => {
    const tx = makeQueryPool([{ id: "c3" }]);
    const router = routerWith(tx);
    await router.addTicketComment(makeReq(MANAGE), "TK-1", {
      body: "随手一记",
    });

    const { values } = commentInsert(tx.calls, tx.params);
    expect(values).toContain(TICKET_EVENT_INTERNAL_NOTE);
    expect(values).not.toContain(TICKET_EVENT_REPLY);
    // 也不能再写回客户自己发言的那个词。
    expect(values).not.toContain("comment");
  });

  it("三个入口共用同一条 SQL，差别只在绑的那个词", async () => {
    const shapes: string[] = [];
    for (const call of [
      (r: TicketsRouter) =>
        r.addInternalNote(makeReq(MANAGE), "TK-1", { body: "x" }),
      (r: TicketsRouter) =>
        r.addTicketReply(makeReq(MANAGE), "TK-1", { body: "x" }),
      (r: TicketsRouter) =>
        r.addTicketComment(makeReq(MANAGE), "TK-1", { body: "x" }),
    ]) {
      const tx = makeQueryPool([{ id: "c" }]);
      await call(routerWith(tx));
      shapes.push(commentInsert(tx.calls, tx.params).sql);
    }
    expect(new Set(shapes).size).toBe(1);
  });

  it("空正文三个入口一律 400，且不碰库", async () => {
    const tx = noDbPool();
    const router = new TicketsRouter(tx.pool, tx.pool);
    await expect(
      router.addTicketReply(makeReq(MANAGE), "TK-1", { body: "   " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      router.addInternalNote(makeReq(MANAGE), "TK-1", {}),
    ).rejects.toThrow(BadRequestException);
  });

  it("没有 platform.tenant.manage 时，回复端点在碰库之前就 403", async () => {
    const tx = noDbPool();
    const router = new TicketsRouter(tx.pool, tx.pool);
    await expect(
      router.addTicketReply(makeReq([]), "TK-1", { body: "x" }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.connect).not.toHaveBeenCalled();
  });
});

describe("工单写路径 —— 运营代客建单", () => {
  const BODY = {
    tenantCode: "2000000001",
    title: "客户电话反馈登录失败",
    description: "客户称输入正确密码后一直回到登录页。",
  };

  /** 建单事务里按语句形状作答：解析租户 → 插入工单 → 插入事件 → 审计。 */
  function createResponder(opts: { tenant?: boolean; member?: unknown } = {}) {
    return (sql: string) => {
      if (/from\s+tenancy\.tenants/.test(sql)) {
        return opts.tenant === false ? [] : [{ id: TENANT_UUID }];
      }
      if (/from\s+account\.users/.test(sql)) {
        return opts.member === undefined ? [] : [opts.member];
      }
      return [];
    };
  }

  it("source 写 'admin'（运营代录的渠道），不是 'console'", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.tickets/i.test(sql),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    // 按列名取，不按下标：加一列时占位符整体右移而断言含义不该跟着漂。
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "source")).toBe("admin");
    expect(tx.calls[i]).not.toMatch(/'console'/);
    expect(tx.outcome().committed).toBe(true);
  });

  it("写进库的 source 与审计里声称的 source 是同一个值", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const ti = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.tickets/i.test(sql),
    );
    const ai = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.audit_logs/i.test(sql),
    );
    const stored = insertParam(tx.calls[ti]!, tx.params[ti]!, "source");
    const audited = insertParam(tx.calls[ai]!, tx.params[ai]!, "after");
    expect(String(audited)).toContain(`"source":"${String(stored)}"`);
  });

  it("单号是可视码 TK-{YYYYMM}-{10}，不是 uuid", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.tickets/i.test(sql),
    );
    const no = insertParam(tx.calls[i]!, tx.params[i]!, "ticket_no");
    expect(no).toMatch(/^TK-\d{6}-[0-9A-F]{10}$/);
  });

  it("建单事件的 payload 里没有 uuid（这段会原样出到浏览器）", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const { values } = commentInsert(tx.calls, tx.params);
    const payload = values.find(
      (v) => typeof v === "string" && v.trim().startsWith("{"),
    );
    expect(payload).toBeTruthy();
    expect(String(payload)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  /**
   * 建单事件的 payload 带着 source / reporter_name / on_behalf_of_customer，那三项都是
   * **内部口径**。所以它写的那个词必须不在客户可见白名单里——这一条原先只有
   * 一句注释担保，而注释拦不住任何东西（别名那条安全默认早就是钩住的，这条没有）。
   */
  it("建单事件写的那个词**不在**客户可见白名单里", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const { sql, values } = commentInsert(tx.calls, tx.params);
    // 词从语句里按列名读出来，不在这里手抄一份「created」；白名单也是 import 权威
    // 值域本身。两边都不手抄，改任一边这条断言才跟着动。
    const word = insertSelectParam(sql, values, "event_type");
    expect(typeof word).toBe("string");
    expect(String(word).length).toBeGreaterThan(0);
    expect(
      CUSTOMER_VISIBLE_TICKET_EVENT_TYPES as readonly string[],
    ).not.toContain(String(word));
  });

  it("审计的 resource_id 用可视码 ticket_no，并挂上租户", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), BODY);

    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.audit_logs/i.test(sql),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "action")).toBe(
      "ticket.create",
    );
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "resource_id")).toMatch(
      /^TK-/,
    );
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "tenant_id")).toBe(
      TENANT_UUID,
    );
  });

  it("租户可视码解不出来 → 404，事务回滚并释放", async () => {
    const tx = makeTxClient(createResponder({ tenant: false }));
    await expect(
      routerWith(tx).createTicket(makeReq(MANAGE), BODY),
    ).rejects.toThrow(NotFoundException);
    expect(tx.outcome()).toMatchObject({ rolledBack: true, released: true });
  });

  /**
   * 下面两条测的是 **API-only 的 accountCode 分支**：admin 的建单弹窗刻意不送这个
   * 字段（`CreateTicketInput` 里根本没有它），所以本仓只有这个 spec 走这条分支。
   * 留着它的理由与那条 follow-up 写在 `createTicket` 的头注里——这里只提醒读者：
   * 这两条绿了**不代表界面上有这个功能**。
   */
  it("【API-only：界面不送 accountCode】不是该租户的成员 → 400（不许把 A 的单署上 B 的人）", async () => {
    const tx = makeTxClient(createResponder());
    await expect(
      routerWith(tx).createTicket(makeReq(MANAGE), {
        ...BODY,
        accountCode: "1000000009",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("【API-only：界面不送 accountCode】给了成员账号时 reporter_name 取该账号的 display_name", async () => {
    const tx = makeTxClient(
      createResponder({ member: { id: TENANT_UUID, display_name: "张三" } }),
    );
    await routerWith(tx).createTicket(makeReq(MANAGE), {
      ...BODY,
      accountCode: "1000000009",
      reporterName: "运营手打的名字",
    });
    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.tickets/i.test(sql),
    );
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "reporter_name")).toBe(
      "张三",
    );
  });

  it("只给租户不给账号：account_id 留 NULL，不拿主联系人顶上", async () => {
    const tx = makeTxClient(createResponder());
    await routerWith(tx).createTicket(makeReq(MANAGE), {
      ...BODY,
      reporterName: "打电话来的人",
    });
    const i = tx.calls.findIndex((sql) =>
      /insert\s+into\s+support\.tickets/i.test(sql),
    );
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "account_id")).toBeNull();
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "reporter_name")).toBe(
      "打电话来的人",
    );
    // 联系人表压根不该被查。
    expect(tx.calls.some((c) => /tenant_contacts/.test(c))).toBe(false);
  });

  it("uuid 当租户码传进来 → 400（请求体里只收可视码）", async () => {
    const tx = noDbPool();
    await expect(
      new TicketsRouter(tx.pool, tx.pool).createTicket(makeReq(MANAGE), {
        ...BODY,
        tenantCode: TENANT_UUID,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.connect).not.toHaveBeenCalled();
  });

  it("标题或正文缺失 → 400，不碰库", async () => {
    const tx = noDbPool();
    const router = new TicketsRouter(tx.pool, tx.pool);
    await expect(
      router.createTicket(makeReq(MANAGE), { ...BODY, title: "  " }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      router.createTicket(makeReq(MANAGE), { ...BODY, description: undefined }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.connect).not.toHaveBeenCalled();
  });

  it("单号撞上唯一约束（23505）→ 409，不是裸 500", async () => {
    const tx = makeTxClient((sql) => {
      if (/insert\s+into\s+support\.tickets/i.test(sql)) {
        const err = new Error("duplicate key") as Error & { code: string };
        err.code = "23505";
        throw err;
      }
      if (/from\s+tenancy\.tenants/.test(sql)) return [{ id: TENANT_UUID }];
      return [];
    });
    await expect(
      routerWith(tx).createTicket(makeReq(MANAGE), BODY),
    ).rejects.toThrow(ConflictException);
    expect(tx.outcome()).toMatchObject({ rolledBack: true, released: true });
  });

  it("没有能力时在碰库之前就 403", async () => {
    const tx = noDbPool();
    await expect(
      new TicketsRouter(tx.pool, tx.pool).createTicket(makeReq([]), BODY),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.connect).not.toHaveBeenCalled();
  });
});

describe("工单写路径 —— 明确的关闭", () => {
  const lockResponder = (status: string) => (sql: string) =>
    /from\s+support\.tickets/.test(sql) && /for update/.test(sql)
      ? [{ id: TICKET_UUID, status }]
      : [];

  it("关闭必须带原因，缺了就 400（不碰库）", async () => {
    const tx = noDbPool();
    await expect(
      new TicketsRouter(tx.pool, tx.pool).closeTicketEndpoint(
        makeReq(MANAGE),
        "TK-1",
        { reason: "   " },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.connect).not.toHaveBeenCalled();
  });

  it("全新的 open 单可以直接关（不要求先 resolved）", async () => {
    const tx = makeTxClient(lockResponder("open"));
    await routerWith(tx).closeTicketEndpoint(makeReq(MANAGE), "TK-1", {
      reason: "电话里当场解决，客户确认可用",
    });
    expect(tx.outcome().committed).toBe(true);
    const i = tx.calls.findIndex((c) => /update\s+support\.tickets/i.test(c));
    expect(tx.params[i]).toContain("closed");
  });

  it("已关闭再关一次 → 409（不覆盖 closed_at、不追加第二条关闭）", async () => {
    const tx = makeTxClient(lockResponder("closed"));
    await expect(
      routerWith(tx).closeTicketEndpoint(makeReq(MANAGE), "TK-1", {
        reason: "再关一次",
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.outcome()).toMatchObject({ rolledBack: true, released: true });
    expect(tx.calls.some((c) => /update\s+support\.tickets/i.test(c))).toBe(
      false,
    );
  });

  it("已撤单的不能关 → 409（撤单与关单是两个终态）", async () => {
    const tx = makeTxClient(lockResponder("cancelled"));
    await expect(
      routerWith(tx).closeTicketEndpoint(makeReq(MANAGE), "TK-1", {
        reason: "顺手关掉",
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  it("关闭写 status_changed（客户看得见的词），payload.note = 原因", async () => {
    const tx = makeTxClient(lockResponder("in_progress"));
    await routerWith(tx).closeTicketEndpoint(makeReq(MANAGE), "TK-1", {
      reason: "已按客户要求处理完毕",
    });
    const { values } = commentInsert(tx.calls, tx.params);
    expect(values).toContain("status_changed");
    expect(CUSTOMER_VISIBLE_TICKET_EVENT_TYPES).toContain("status_changed");
    expect(
      String(values.find((v) => typeof v === "string" && v.startsWith("{"))),
    ).toContain("已按客户要求处理完毕");
  });

  it("关闭写审计（action=ticket.close，resource_id 用可视码）", async () => {
    const tx = makeTxClient(lockResponder("resolved"));
    await routerWith(tx).closeTicketEndpoint(
      makeReq(MANAGE),
      "TK-202609-AAAAAAAAAA",
      {
        reason: "客户确认已解决",
      },
    );
    const i = tx.calls.findIndex((c) =>
      /insert\s+into\s+support\.audit_logs/i.test(c),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "action")).toBe(
      "ticket.close",
    );
    expect(insertParam(tx.calls[i]!, tx.params[i]!, "resource_id")).toBe(
      "TK-202609-AAAAAAAAAA",
    );
  });

  /**
   * 关闭的规则长在两处就等于没长：走 `:id/status` 就能绕过必填原因与终态 409。
   * 这两条钉住「第二个入口也走同一套规则」。
   */
  it("通用 status 端点收到 closed 且没带 note → 同样 400", async () => {
    const tx = noDbPool();
    await expect(
      new TicketsRouter(tx.pool, tx.pool).changeTicketStatus(
        makeReq(MANAGE),
        "TK-1",
        { status: "closed" },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.connect).not.toHaveBeenCalled();
  });

  it("通用 status 端点收到 closed 且单子已关 → 同样 409", async () => {
    const tx = makeTxClient(lockResponder("closed"));
    await expect(
      routerWith(tx).changeTicketStatus(makeReq(MANAGE), "TK-1", {
        status: "closed",
        note: "换个入口再关",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("status 端点的其余取值照旧直接改（没顺手长出状态机）", async () => {
    const tx = makeTxClient(lockResponder("open"));
    await routerWith(tx).changeTicketStatus(makeReq(MANAGE), "TK-1", {
      status: "resolved",
    });
    expect(tx.outcome().committed).toBe(true);
    // resolved 不走关闭那条路 ⇒ 没有 ticket.close 审计。
    expect(
      tx.calls.some((c) => /insert\s+into\s+support\.audit_logs/i.test(c)),
    ).toBe(false);
  });

  it("重开仍然走 status 端点（reopened），关闭端点不管重开", async () => {
    const tx = makeTxClient(lockResponder("closed"));
    await routerWith(tx).changeTicketStatus(makeReq(MANAGE), "TK-1", {
      status: "reopened",
    });
    expect(tx.outcome().committed).toBe(true);
    const i = tx.calls.findIndex((c) => /update\s+support\.tickets/i.test(c));
    expect(tx.params[i]).toContain("reopened");
  });
});

describe("工单读取 —— 运营面刻意看得见全部", () => {
  it("运营的时间线查询不带可见性过滤（内部备注就是写给这一屏看的）", async () => {
    const seen: string[] = [];
    const reader = {
      query: vi.fn(async (sql: string) => {
        seen.push(String(sql));
        return { rows: [] };
      }),
    } as unknown as Pool;
    await new TicketsRouter(reader, reader).listTicketComments(
      makeReq(MANAGE),
      "TK-1",
    );
    expect(seen[0]).toMatch(/from\s+support\.ticket_comments/);
    expect(seen[0]).not.toMatch(/event_type\s*=\s*any/i);
  });
});
