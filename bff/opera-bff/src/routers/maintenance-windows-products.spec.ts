/**
 * maintenance-windows-products.spec.ts —— 产品级维护窗口的状态转移（owner 2026-09-27）。
 *
 * 钉的是「窗口动了，产品行跟没跟」。这一层没有任何外在症状：窗口 start 了、状态也
 * 对、审计也有，只是 product.products 的两列没打上——官网照常卖、console 照常下单，
 * 直到客户在维护中买到一个打不开的产品。守卫脚本对这种漏写是瞎的，所以钉在这里：
 *
 *  1. start 打标：窗口条件 UPDATE 命中之后，绑定产品打上 window id + 窗口 end_at。
 *  2. start 撞占用：某个产品已被**另一个**进行中的窗口占着 → 409 点名，整笔回滚，
 *     一个产品都不打（窗口不会半开）。
 *  3. complete / cancel 清标：按 maintenance_window_id = 本窗口清，不按绑定表。
 *  4. in_progress 顺延 end_at → products.maintenance_until 跟着改；没送 endAt 就不碰。
 *  5. create / update 的产品码必须在目录里：不认识的码 400 点名，且不插窗口行。
 *
 * ── 假 pool ──
 * 记下每一条语句与参数，断言按 SQL 特征取，不靠调用次序；只有「先后」本身是判据的
 * 地方（窗口 UPDATE 在打标之前）才比下标。
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "../types/request-context";
import { MaintenanceWindowsRouter } from "./maintenance-windows.router";

const WINDOW_ID = "0d3c2f1e-1111-4111-8111-000000000001";
const OTHER_WINDOW_ID = "0d3c2f1e-2222-4222-8222-000000000002";
const OPERATOR_ID = "7f6e5d4c-3333-4333-8333-000000000003";
const END_AT = new Date("2026-10-01T04:00:00.000Z");

function makeReq(): Request & RequestContext {
  return {
    operator: { id: OPERATOR_ID, displayName: null },
    capabilities: ["ops:maintenance.manage"],
    headers: {},
  } as unknown as Request & RequestContext;
}

interface BoundProduct {
  product_code: string;
  maintenance_window_id: string | null;
}

interface Scenario {
  /** 窗口条件 UPDATE 命不命中（0 = 状态不对或不存在）。 */
  transitionHits?: boolean;
  /** 窗口是否存在（决定 0 行时是 404 还是 409）。 */
  exists?: boolean;
  /** start 时锁到的绑定产品及其当前占用。 */
  bound?: BoundProduct[];
  /** PUT 前锁到的当前行。 */
  current?: {
    status: "scheduled" | "in_progress" | "completed";
    product_codes: string[];
  };
  /** 目录里存在的产品码 → id。 */
  catalog?: Record<string, string>;
}

function makeRouter(scenario: Scenario = {}) {
  const {
    transitionHits = true,
    exists = true,
    bound = [],
    current = { status: "scheduled", product_codes: [] },
    catalog = {},
  } = scenario;
  const calls: { text: string; args: unknown[] }[] = [];

  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    calls.push({ text: sql, args });
    if (/^\s*(begin|commit|rollback)\s*$/i.test(sql)) return { rows: [] };

    // 状态转移：三条条件 UPDATE 都落在 admin.maintenance_windows 上。
    if (/update admin\.maintenance_windows/i.test(sql)) {
      if (!transitionHits) return { rows: [], rowCount: 0 };
      return { rows: [{ end_at: END_AT }], rowCount: 1 };
    }
    if (/select 1 from admin\.maintenance_windows/i.test(sql)) {
      return {
        rows: exists ? [{ "?column?": 1 }] : [],
        rowCount: exists ? 1 : 0,
      };
    }
    // start：锁绑定产品行。
    if (/for update of p/i.test(sql)) {
      return { rows: bound, rowCount: bound.length };
    }
    // PUT：锁窗口行。
    if (/for update of w/i.test(sql)) {
      return {
        rows: [
          {
            status: current.status,
            severity: "minor",
            title: "网关切换",
            affected_services: [],
            product_codes: current.product_codes,
            start_at: new Date("2026-10-01T02:00:00.000Z"),
            end_at: END_AT,
          },
        ],
        rowCount: 1,
      };
    }
    // 产品码 → id。
    if (/product_code = any/i.test(sql)) {
      const codes = args[0] as string[];
      const rows = codes
        .filter((c) => c in catalog)
        .map((c) => ({ id: catalog[c], product_code: c }));
      return { rows, rowCount: rows.length };
    }
    if (/insert into admin\.maintenance_windows/i.test(sql)) {
      return { rows: [{ id: WINDOW_ID }], rowCount: 1 };
    }
    if (/update product\.products/i.test(sql)) {
      return { rows: [], rowCount: bound.length };
    }
    // 回读。
    if (/left join admin\.operator_account/i.test(sql)) {
      return {
        rows: [
          {
            id: WINDOW_ID,
            severity: "minor",
            status: "in_progress",
            title: "网关切换",
            description: null,
            impact_description: null,
            affected_services: [],
            products: bound.map((b) => ({
              productCode: b.product_code,
              productName: b.product_code.toUpperCase(),
            })),
            start_at: new Date("2026-10-01T02:00:00.000Z"),
            end_at: END_AT,
            actual_end_at: null,
            created_by: OPERATOR_ID,
            created_by_name: "ops",
            updated_by: OPERATOR_ID,
            created_at: new Date("2026-09-30T00:00:00.000Z"),
            updated_at: new Date("2026-09-30T00:00:00.000Z"),
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const client = { query, release: vi.fn() };
  const rwPool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    query,
  } as unknown as Pool;
  const roPool = { query } as unknown as Pool;
  const router = new MaintenanceWindowsRouter(roPool, rwPool);

  const find = (re: RegExp) => calls.find((c) => re.test(c.text));
  const indexOf = (re: RegExp) => calls.findIndex((c) => re.test(c.text));
  return { router, calls, find, indexOf };
}

/* 判据取**赋值形态**：SELECT 里也写着 maintenance_window_id，裸列名会误中回读。 */
const STAMP = /update product\.products[\s\S]*maintenance_window_id = \$1/i;
const RELEASE = /update product\.products[\s\S]*maintenance_window_id = null/i;
const UNTIL_SYNC =
  /update product\.products\s+set maintenance_until = \$2\s+where maintenance_window_id = \$1/i;
const WINDOW_START = /set status = 'in_progress'/i;
const AUDIT = /insert into support\.audit_logs/i;

async function rejection(promise: Promise<unknown>): Promise<{
  status: number | undefined;
  code: string | undefined;
  message: string | undefined;
}> {
  try {
    await promise;
  } catch (error) {
    const e = error as {
      getStatus?: () => number;
      getResponse?: () => { code?: string; message?: string };
    };
    const body = e.getResponse?.() ?? {};
    return { status: e.getStatus?.(), code: body.code, message: body.message };
  }
  throw new Error("预期被拒，但成功了");
}

describe("start：窗口进入 in_progress 时给绑定产品打标", () => {
  it("打上 window id + 窗口 end_at，且在窗口 UPDATE 之后、审计之前", async () => {
    const t = makeRouter({
      bound: [
        { product_code: "karda", maintenance_window_id: null },
        { product_code: "arda", maintenance_window_id: null },
      ],
    });
    const item = await t.router.startMaintenanceWindow(makeReq(), WINDOW_ID);

    const stamp = t.find(STAMP);
    expect(stamp).toBeDefined();
    expect(stamp!.args).toEqual([WINDOW_ID, END_AT.toISOString()]);
    expect(t.indexOf(WINDOW_START)).toBeLessThan(t.indexOf(STAMP));
    expect(t.indexOf(STAMP)).toBeLessThan(t.indexOf(AUDIT));
    expect(t.find(/^\s*commit\s*$/i)).toBeDefined();
    expect(item.products.map((p) => p.productCode)).toEqual(["karda", "arda"]);
  });

  it("没挂产品的平台级窗口照常开始：打标语句仍跑，命中 0 行不算错", async () => {
    const t = makeRouter({ bound: [] });
    await t.router.startMaintenanceWindow(makeReq(), WINDOW_ID);
    expect(t.find(STAMP)).toBeDefined();
    expect(t.find(/^\s*commit\s*$/i)).toBeDefined();
  });

  it("某个产品被另一个进行中的窗口占着 → 409 点名，整笔回滚、一个都不打", async () => {
    const t = makeRouter({
      bound: [
        { product_code: "karda", maintenance_window_id: OTHER_WINDOW_ID },
        { product_code: "vxtpl", maintenance_window_id: null },
      ],
    });
    const error = await rejection(
      t.router.startMaintenanceWindow(makeReq(), WINDOW_ID),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("MAINTENANCE_WINDOW_PRODUCT_BUSY");
    expect(error.message).toContain("karda");
    expect(error.message).not.toContain("vxtpl");
    expect(t.find(STAMP)).toBeUndefined();
    expect(t.find(AUDIT)).toBeUndefined();
    expect(t.find(/^\s*rollback\s*$/i)).toBeDefined();
  });

  it("占用是本窗口自己打的（重放）不算撞", async () => {
    const t = makeRouter({
      bound: [{ product_code: "karda", maintenance_window_id: WINDOW_ID }],
    });
    await t.router.startMaintenanceWindow(makeReq(), WINDOW_ID);
    expect(t.find(STAMP)).toBeDefined();
  });

  it("窗口不是 scheduled → 409，不锁产品、不打标", async () => {
    const t = makeRouter({ transitionHits: false, exists: true });
    const error = await rejection(
      t.router.startMaintenanceWindow(makeReq(), WINDOW_ID),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("MAINTENANCE_WINDOW_INVALID_TRANSITION");
    expect(t.find(/for update of p/i)).toBeUndefined();
    expect(t.find(STAMP)).toBeUndefined();
  });

  it("窗口不存在 → 404", async () => {
    const t = makeRouter({ transitionHits: false, exists: false });
    const error = await rejection(
      t.router.startMaintenanceWindow(makeReq(), WINDOW_ID),
    );
    expect(error.status).toBe(404);
    expect(t.find(STAMP)).toBeUndefined();
  });
});

describe("complete / cancel：清掉本窗口打的标", () => {
  it("complete → 按 maintenance_window_id = 本窗口清", async () => {
    const t = makeRouter();
    await t.router.completeMaintenanceWindow(makeReq(), WINDOW_ID, {});
    const release = t.find(RELEASE);
    expect(release).toBeDefined();
    expect(release!.args).toEqual([WINDOW_ID]);
    expect(t.indexOf(/set status = 'completed'/i)).toBeLessThan(
      t.indexOf(RELEASE),
    );
    expect(t.find(AUDIT)).toBeDefined();
  });

  it("cancel → 同样清", async () => {
    const t = makeRouter();
    await t.router.cancelMaintenanceWindow(makeReq(), WINDOW_ID);
    const release = t.find(RELEASE);
    expect(release).toBeDefined();
    expect(release!.args).toEqual([WINDOW_ID]);
  });

  it("complete 撞状态（不是 in_progress）→ 409，不清标", async () => {
    const t = makeRouter({ transitionHits: false });
    const error = await rejection(
      t.router.completeMaintenanceWindow(makeReq(), WINDOW_ID, {}),
    );
    expect(error.status).toBe(409);
    expect(t.find(RELEASE)).toBeUndefined();
  });

  it("cancel 撞终态 → 409，不清标", async () => {
    const t = makeRouter({ transitionHits: false });
    const error = await rejection(
      t.router.cancelMaintenanceWindow(makeReq(), WINDOW_ID),
    );
    expect(error.status).toBe(409);
    expect(t.find(RELEASE)).toBeUndefined();
  });
});

describe("in_progress 顺延 end_at → maintenance_until 跟着改", () => {
  const LIVE_BODY = {
    title: "网关切换",
    severity: "minor",
    startAt: "2026-10-01T02:00:00.000Z",
    affectedServices: [],
    productCodes: ["karda"],
  };

  it("送了更晚的 endAt：窗口顺延 + 产品行同步", async () => {
    const t = makeRouter({
      current: { status: "in_progress", product_codes: ["karda"] },
    });
    await t.router.updateMaintenanceWindow(makeReq(), WINDOW_ID, {
      ...LIVE_BODY,
      endAt: "2026-10-01T06:00:00.000Z",
    });
    const sync = t.find(UNTIL_SYNC);
    expect(sync).toBeDefined();
    expect(sync!.args).toEqual([WINDOW_ID, "2026-10-01T06:00:00.000Z"]);
  });

  it("没送 endAt（只追记描述）：不碰产品行", async () => {
    const t = makeRouter({
      current: { status: "in_progress", product_codes: ["karda"] },
    });
    await t.router.updateMaintenanceWindow(makeReq(), WINDOW_ID, {
      ...LIVE_BODY,
      description: "追记一段",
    });
    expect(t.find(UNTIL_SYNC)).toBeUndefined();
    expect(t.find(/update admin\.maintenance_windows/i)).toBeDefined();
  });

  it("进行中换产品 → 409 点名 productCodes，什么都不写", async () => {
    const t = makeRouter({
      current: { status: "in_progress", product_codes: ["karda"] },
    });
    const error = await rejection(
      t.router.updateMaintenanceWindow(makeReq(), WINDOW_ID, {
        ...LIVE_BODY,
        productCodes: ["karda", "arda"],
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("MAINTENANCE_WINDOW_LIVE_FIELDS_LOCKED");
    expect(error.message).toContain("productCodes");
    expect(t.find(/update admin\.maintenance_windows/i)).toBeUndefined();
    expect(t.find(UNTIL_SYNC)).toBeUndefined();
  });
});

describe("产品码必须在目录里", () => {
  const BODY = {
    title: "数据库版本升级",
    startAt: "2026-10-01T02:00:00.000Z",
    endAt: "2026-10-01T04:00:00.000Z",
  };
  const CATALOG = {
    karda: "aaaaaaaa-0000-4000-8000-000000000001",
    arda: "aaaaaaaa-0000-4000-8000-000000000002",
  };

  it("create：不认识的码 → 400 点名，窗口行不插", async () => {
    const t = makeRouter({ catalog: CATALOG });
    const error = await rejection(
      t.router.createMaintenanceWindow(makeReq(), {
        ...BODY,
        productCodes: ["karda", "nope"],
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("MAINTENANCE_WINDOW_PRODUCT_UNKNOWN");
    expect(error.message).toContain("nope");
    expect(error.message).not.toContain("karda");
    expect(t.find(/insert into admin\.maintenance_windows/i)).toBeUndefined();
  });

  it("create：码都认识 → 按解析出的 id 插绑定（去重）", async () => {
    const t = makeRouter({ catalog: CATALOG });
    await t.router.createMaintenanceWindow(makeReq(), {
      ...BODY,
      productCodes: ["arda", "karda", "arda"],
    });
    const bind = t.find(/insert into admin\.maintenance_window_products/i);
    expect(bind).toBeDefined();
    expect(bind!.args).toEqual([WINDOW_ID, [CATALOG.arda, CATALOG.karda]]);
    const audit = t.find(AUDIT);
    expect(audit).toBeDefined();
    expect(JSON.parse(String(audit!.args[6]))).toMatchObject({
      productCodes: ["arda", "karda"],
    });
  });

  it("create：不送 productCodes = 平台级公告，不插绑定", async () => {
    const t = makeRouter({ catalog: CATALOG });
    await t.router.createMaintenanceWindow(makeReq(), BODY);
    expect(t.find(/product_code = any/i)).toBeUndefined();
    expect(
      t.find(/insert into admin\.maintenance_window_products/i),
    ).toBeUndefined();
  });

  it("update（scheduled）：全量替换绑定——先删光再插", async () => {
    const t = makeRouter({
      catalog: CATALOG,
      current: { status: "scheduled", product_codes: ["karda"] },
    });
    await t.router.updateMaintenanceWindow(makeReq(), WINDOW_ID, {
      ...BODY,
      productCodes: ["arda"],
    });
    const del = /delete from admin\.maintenance_window_products/i;
    const ins = /insert into admin\.maintenance_window_products/i;
    expect(t.find(del)!.args).toEqual([WINDOW_ID]);
    expect(t.find(ins)!.args).toEqual([WINDOW_ID, [CATALOG.arda]]);
    expect(t.indexOf(del)).toBeLessThan(t.indexOf(ins));
  });
});
