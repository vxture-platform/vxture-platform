import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";
import { AccountsRouter } from "./accounts.router";
import type { RequestContext } from "../types/console.types";

// GET /api/accounts/:id 从「标量」升成「标量 + 三段明细」（2026-09-21，账号详情页
// 照租户详情重建）。这里守三件 tsc 看不见的事：
//   1. 三段明细各自从**自己那条 SQL** 的行映射出来，没有串台；
//   2. `online` 是布尔而不是计数，且真的随会话数变（恒 false 的话「强制下线」
//      永远灰着，恒 true 的话它对谁都亮——两种都看不出来）；
//   3. `verifiedStatus` 对库里的越界值退到 `unverified`，不冒充已认证。
// 池是按 SQL 片段分派的桩：每条明细 SQL 有一个只属于它的表名，据此路由。

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const MANAGE = ["platform.tenant.manage"];

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

type Responder = (sqlLower: string) => unknown[] | undefined;

function makeRoPool(responder: Responder) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    const text = String(sql);
    calls.push(text);
    return { rows: responder(text.toLowerCase()) ?? [] };
  });
  const connect = vi.fn(() => {
    throw new Error("read path must not take a client");
  });
  return { pool: { query, connect } as unknown as Pool, calls, query };
}

/* AccountsRouter 还注入了 OperatorAdminService（凭据/生命周期写路径用）。
   只读投影碰不到它，给个一碰就抛的桩：真被用到要当场响，不能静静地过。 */
function noOperatorAdmin() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `read path must not touch OperatorAdminService.${String(prop)}`,
        );
      },
    },
  ) as never;
}

function noDbPool(): Pool {
  return {
    query: vi.fn(() => {
      throw new Error("DB must not be touched");
    }),
    connect: vi.fn(() => {
      throw new Error("DB must not be touched");
    }),
  } as unknown as Pool;
}

const BASE_ROW = {
  id: USER_ID,
  account_code: "1649201736",
  display_name: "陈立",
  email: "ops@acme.demo",
  phone: "13712345678",
  status: "active",
  account_login_disabled: false,
  registered_at: "2026-08-10T14:17:29.000Z",
  activated_at: "2026-08-10T14:20:00.000Z",
  primary_tenant_id: "22222222-2222-4222-8222-222222222222",
  primary_tenant_code: "2515306732",
  primary_tenant_name: "示例科技",
  primary_tenant_type: "organization",
  role: "Tenant Owner",
  tenant_count: 2,
  last_active_at: "2026-09-21T03:11:00.000Z",
  last_active_ip: "111.206.1.2",
  login_count_30d: 7,
  tenant_bindings: [],
  online_session_count: 1,
  verified_status: "verified",
  avatar_hash: null,
};

/**
 * 按 SQL 里那张只属于它的表名分派。
 *
 * **主行 SQL 必须第一个判**：共用的 ACCOUNT_SELECT 自己就 join 了
 * `session.login_attempts`（30 天登录次数）与 `session.auth_sessions`（在线数），
 * 所以那两个表名**不是**明细 SQL 独有的。按它们分派会把主行送进登录史那一支，
 * 拿到的标量全是别人的行——而断言若不碰标量，这个错会静静地过。
 * `from account.users` 只有主行 SQL 有。
 */
function route(sqlLower: string, overrides: Record<string, unknown[]> = {}) {
  if (sqlLower.includes("from account.users"))
    return overrides.base ?? [BASE_ROW];
  if (sqlLower.includes("product.plan_components"))
    return overrides.products ?? [{ product_name: "umbra" }];
  if (sqlLower.includes("count(*) filter"))
    return overrides.counts ?? [{ open_count: 2, total_count: 9 }];
  if (sqlLower.includes("support.tickets"))
    return (
      overrides.tickets ?? [
        {
          ticket_no: "TK-0001",
          title: "登录不上",
          status: "open",
          priority: "p1",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z",
        },
      ]
    );
  if (sqlLower.includes("session.login_attempts"))
    return (
      overrides.logins ?? [
        {
          id: "8786c983-7381-42ae-bc16-d2caa904c547",
          result: "bad_credentials",
          auth_method: "password",
          ip_address: "111.206.1.2",
          created_at: "2026-09-20T14:29:53.000Z",
        },
      ]
    );
  return [];
}

describe("GET /api/accounts/:id detail projection", () => {
  it("maps the three detail arrays from their own rows", async () => {
    const ro = makeRoPool((sql) => route(sql));
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    const record = await router.getAccount(makeReq(MANAGE), USER_ID);

    expect(record.productNames).toEqual(["umbra"]);
    expect(record.ticketOpenCount).toBe(2);
    expect(record.ticketTotalCount).toBe(9);
    expect(record.tickets).toEqual([
      {
        ticketNo: "TK-0001",
        title: "登录不上",
        status: "open",
        priority: "p1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    /* 登录史**含失败**：只给成功的那几条，等于把运营要查的东西滤掉了。
       这条钉的就是 bad_credentials 能出来。 */
    expect(record.loginHistory).toEqual([
      {
        id: "8786c983-7381-42ae-bc16-d2caa904c547",
        result: "bad_credentials",
        authMethod: "password",
        ip: "111.206.1.2",
        createdAt: "2026-09-20T14:29:53.000Z",
      },
    ]);
  });

  /* 两档成对：判据不随会话数变的话，「强制下线」要么永远灰、要么对谁都亮，
     两种都不会有人报错。 */
  it("derives online from the session count, both ways", async () => {
    const on = makeRoPool((sql) => route(sql));
    const online = await new AccountsRouter(
      on.pool,
      noDbPool(),
      noOperatorAdmin(),
    ).getAccount(makeReq(MANAGE), USER_ID);
    expect(online.online).toBe(true);

    const off = makeRoPool((sql) =>
      route(sql, { base: [{ ...BASE_ROW, online_session_count: 0 }] }),
    );
    const offline = await new AccountsRouter(
      off.pool,
      noDbPool(),
      noOperatorAdmin(),
    ).getAccount(makeReq(MANAGE), USER_ID);
    expect(offline.online).toBe(false);
  });

  it("falls back to unverified for values outside the CHECK set", async () => {
    const ro = makeRoPool((sql) =>
      route(sql, { base: [{ ...BASE_ROW, verified_status: "bogus" }] }),
    );
    const record = await new AccountsRouter(
      ro.pool,
      noDbPool(),
      noOperatorAdmin(),
    ).getAccount(makeReq(MANAGE), USER_ID);
    /* 认不得的值按**最保守**那一档算：不能让脏数据冒充已认证。 */
    expect(record.verifiedStatus).toBe("unverified");
  });

  it("404s on a missing account without firing the detail queries", async () => {
    const ro = makeRoPool((sql) => route(sql, { base: [] }));
    const router = new AccountsRouter(ro.pool, noDbPool(), noOperatorAdmin());
    await expect(
      router.getAccount(makeReq(MANAGE), USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    /* 判「只打了主行这一条」，不判某张表没被提到——`session.login_attempts` 与
       `session.auth_sessions` 在主行 SQL 里就有（同上面 route 的注释），拿它们
       当明细的标记会永远判成「明细也跑了」。条数是唯一没有歧义的判据。 */
    expect(ro.calls).toHaveLength(1);
  });
});
