import { describe, it, expect, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";
import { TenantsRouter } from "./tenants.router";
import type { RequestContext } from "../types/console.types";

// GET /api/tenants/:id 投影（2026-08-30 去占位）。这里守两件 tsc 看不见的事：
//   1. 响应里**没有**那批曾经写死的字段（monthlyCost / sla / tokenUsed …）——类型删了，
//      但 mapper 若再把它们 spread 回来 tsc 不会拦（多余属性只在字面量处查）。
//   2. 标量计数与五段明细确实从各自那条 SQL 的行映射出来，pg 给的字符串数字被转成 number，
//      null（没有配额池 / 没有会话）保持 null 而不是变成 0。
// 池是按 SQL 片段分派的桩：每条明细 SQL 有一个只属于它的表名 / 别名，据此路由。

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
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
  id: TENANT_ID,
  tenant_no: "100001",
  name: "示例科技",
  type: "organization",
  status: "active",
  verification_status: "verified",
  created_at: "2026-02-10T12:50:19.000Z",
  updated_at: "2026-08-10T12:50:19.000Z",
  industry: "互联网",
  scale: "100-499",
  contact_name: "陈立",
  contact_phone: "+8613900000001",
  country_code: "CN",
  address: null,
  description: "Demo 租户",
  owner_email: "ops@acme.demo",
  owner_account: "demo_acme",
  owner_display_name: "陈立",
  verification_submitted_at: "2026-03-10T14:17:29.000Z",
  verification_reviewed_at: "2026-08-10T14:17:29.000Z",
  // pg 对 count(*)（bigint）与 numeric 一律给字符串。
  member_count: "3",
  active_member_count: "2",
  admin_count: "1",
  subscription_count: "2",
  product_count: "1",
  month_revenue: "10788.00",
  total_revenue: "22776.50",
  ticket_open_count: "1",
  risk_level: "follow_up",
  last_active_at: "2026-08-29T10:00:00.000Z",
};

const MEMBER_ROW = {
  membership_id: "33333333-3333-4333-8333-333333333333",
  user_id: "44444444-4444-4444-8444-444444444444",
  role_id: "55555555-5555-4555-8555-555555555555",
  role_scope: "tenant",
  status: "active",
  title: null,
  department: null,
  created_at: "2026-08-10T14:17:29.000Z",
  updated_at: "2026-08-10T14:17:29.000Z",
  account: "demo_acme",
  email: "ops@acme.demo",
  user_status: "active",
  display_name: "陈立",
  role_code: "owner",
  role_name: "Tenant Owner",
  last_active_at: null,
  last_active_ip: null,
};

const SUB_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  order_no: "DEMO-ORD-0001",
  status: "active",
  subscription_kind: "paid",
  cycle_unit: "year",
  cycle_count: 1,
  pay_amount: "11988.00",
  currency: "CNY",
  auto_renew: true,
  start_at: "2026-03-10T12:50:19.000Z",
  end_at: "2027-03-10T12:50:19.000Z",
  next_renewal_at: null,
  plan_name: "Arda Pro",
  version_no: 1,
  product_names: ["数据平台"],
};

const USAGE_ROW = {
  metric_key: "ai.credit",
  month_amount: "0",
  quota_limit: "500",
  quota_used: "175",
  unit: "credits",
};

const AUDIT_ROW = {
  id: "77777777-7777-4777-8777-777777777777",
  action: "tenant.member.invite",
  result: "success",
  actor_type: "customer",
  created_at: "2026-08-20T08:00:00.000Z",
  operator_name: null,
  customer_display_name: "陈立",
  customer_account: "demo_acme",
};

const TICKET_ROW = {
  ticket_no: "DEMO-TK-0002",
  title: "希望增加数据源连接数",
  status: "in_progress",
  priority: "p2",
  updated_at: "2026-08-10T14:17:29.000Z",
};

/** 每条 SQL 一个只属于它的锚：主投影先判，因为它的相关子查询里也提到了别的表。 */
function route(
  sql: string,
  overrides: Partial<Record<string, unknown[]>> = {},
) {
  if (sql.includes("from tenancy.tenants t"))
    return overrides.base ?? [BASE_ROW];
  if (sql.includes("as membership_id"))
    return overrides.members ?? [MEMBER_ROW];
  if (sql.includes("product.plans pl"))
    return overrides.subscriptions ?? [SUB_ROW];
  if (sql.includes("usage_summary_months"))
    return overrides.usage ?? [USAGE_ROW];
  if (sql.includes("support.audit_logs")) return overrides.audit ?? [AUDIT_ROW];
  if (sql.includes("from support.tickets k"))
    return overrides.tickets ?? [TICKET_ROW];
  return undefined;
}

// 2026-08-30 之前投影里写死的那批字段。无论以后 mapper 怎么改，它们都不该再出现。
const REMOVED_FIELDS = [
  "monthlyCost",
  "grossMarginRate",
  "tokenUsed",
  "tokenQuota",
  "satisfaction",
  "sla",
  "tags",
  "modelPolicies",
] as const;

describe("GET /api/tenants/:id detail projection", () => {
  it("rejects a caller without tenant.manage before any DB access", async () => {
    const ro = noDbPool();
    const router = new TenantsRouter(ro, noDbPool());
    await expect(
      router.getTenant(makeReq(["platform.tenant.read"]), TENANT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ro.query).not.toHaveBeenCalled();
  });

  it("404s on a missing tenant without firing the detail queries", async () => {
    const ro = makeRoPool((sql) => route(sql, { base: [] }));
    const router = new TenantsRouter(ro.pool, noDbPool());
    await expect(
      router.getTenant(makeReq(MANAGE), TENANT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ro.calls).toHaveLength(1);
  });

  it("maps the scalar counts from the base row and fires exactly five detail queries", async () => {
    const ro = makeRoPool((sql) => route(sql));
    const router = new TenantsRouter(ro.pool, noDbPool());
    const record = await router.getTenant(makeReq(MANAGE), TENANT_ID);

    expect(ro.calls).toHaveLength(6);
    expect(record.tenantCode).toBe("100001");
    expect(record.memberCount).toBe(3);
    expect(record.activeMemberCount).toBe(2);
    expect(record.adminCount).toBe(1);
    expect(record.subscriptionCount).toBe(2);
    expect(record.productCount).toBe(1);
    expect(record.monthlyRevenue).toBe(10788);
    expect(record.totalRevenue).toBe(22776.5);
    expect(record.ticketOpenCount).toBe(1);
    expect(record.riskLevel).toBe("follow_up");
    expect(record.lastActiveAt).toBe("2026-08-29T10:00:00.000Z");
  });

  it("maps the five detail arrays from their own rows", async () => {
    const ro = makeRoPool((sql) => route(sql));
    const router = new TenantsRouter(ro.pool, noDbPool());
    const record = await router.getTenant(makeReq(MANAGE), TENANT_ID);

    expect(record.members).toEqual([
      {
        id: MEMBER_ROW.membership_id,
        accountCode: "demo_acme",
        name: "陈立",
        email: "ops@acme.demo",
        role: "Tenant Owner",
        roleCode: "owner",
        status: "active",
        joinedAt: "2026-08-10T14:17:29.000Z",
        lastActiveAt: null,
        lastActiveIp: null,
      },
    ]);

    expect(record.subscriptions).toEqual([
      {
        id: SUB_ROW.id,
        orderNo: "DEMO-ORD-0001",
        productNames: ["数据平台"],
        planName: "Arda Pro",
        planVersion: 1,
        kind: "paid",
        status: "active",
        cycleUnit: "year",
        cycleCount: 1,
        payAmount: 11988,
        currency: "CNY",
        autoRenew: true,
        startedAt: "2026-03-10T12:50:19.000Z",
        endsAt: "2027-03-10T12:50:19.000Z",
        nextRenewalAt: null,
      },
    ]);

    expect(record.usage).toEqual([
      {
        metricKey: "ai.credit",
        unit: "credits",
        monthUsage: 0,
        quotaLimit: 500,
        quotaUsed: 175,
      },
    ]);

    expect(record.auditEvents).toEqual([
      {
        id: AUDIT_ROW.id,
        action: "tenant.member.invite",
        actor: "陈立",
        at: "2026-08-20T08:00:00.000Z",
        result: "success",
      },
    ]);

    // 工单 id 是可视码 ticket_no；in_progress 归到 processing。
    expect(record.tickets).toEqual([
      {
        id: "DEMO-TK-0002",
        title: "希望增加数据源连接数",
        status: "processing",
        priority: "p2",
        updatedAt: "2026-08-10T14:17:29.000Z",
      },
    ]);
  });

  it("carries none of the former placeholder fields", async () => {
    const ro = makeRoPool((sql) => route(sql));
    const router = new TenantsRouter(ro.pool, noDbPool());
    const record = await router.getTenant(makeReq(MANAGE), TENANT_ID);
    for (const field of REMOVED_FIELDS) {
      expect(record).not.toHaveProperty(field);
    }
  });

  it("keeps null as null: no open risk record → normal, no session → null lastActiveAt, no pool → null quota", async () => {
    const ro = makeRoPool((sql) =>
      route(sql, {
        base: [{ ...BASE_ROW, risk_level: null, last_active_at: null }],
        usage: [
          { ...USAGE_ROW, quota_limit: null, quota_used: null, unit: null },
        ],
      }),
    );
    const router = new TenantsRouter(ro.pool, noDbPool());
    const record = await router.getTenant(makeReq(MANAGE), TENANT_ID);
    expect(record.riskLevel).toBe("normal");
    expect(record.lastActiveAt).toBeNull();
    expect(record.usage[0]).toMatchObject({
      quotaLimit: null,
      quotaUsed: null,
      unit: null,
    });
  });

  it("refuses a subscription status outside the shared domain instead of guessing", async () => {
    const ro = makeRoPool((sql) =>
      route(sql, { subscriptions: [{ ...SUB_ROW, status: "past_due" }] }),
    );
    const router = new TenantsRouter(ro.pool, noDbPool());
    await expect(router.getTenant(makeReq(MANAGE), TENANT_ID)).rejects.toThrow(
      /Unknown subscription status/,
    );
  });
});

describe("GET /api/tenants list projection", () => {
  it("maps the same scalar counts but carries no detail arrays", async () => {
    const ro = makeRoPool((sql) => route(sql));
    const router = new TenantsRouter(ro.pool, noDbPool());
    const [record] = await router.listTenants(makeReq(MANAGE));

    expect(ro.calls).toHaveLength(1);
    expect(record?.adminCount).toBe(1);
    expect(record?.monthlyRevenue).toBe(10788);
    expect(record?.riskLevel).toBe("follow_up");
    for (const field of [
      "members",
      "subscriptions",
      "usage",
      "auditEvents",
      "tickets",
      ...REMOVED_FIELDS,
    ]) {
      expect(record).not.toHaveProperty(field);
    }
  });
});
