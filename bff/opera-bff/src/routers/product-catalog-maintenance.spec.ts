/**
 * product-catalog-maintenance.spec.ts —— 产品页的升级维护入口（owner 2026-09-28）。
 *
 * 「现在 opera 只有停用，点击后 website 完全开不到了。暂停和恢复入口没有找到。」
 * 入口长在产品页，写路径仍是维护窗口那一套（create → start / complete 三个 *Tx
 * helper）。这份 spec 钉的是**产品页这一站位**接对了没有：
 *
 *  1. start 是一笔事务：锁产品行 → 建窗口（挂本产品、标题按产品名拼）→ start 打标
 *     → 窗口两条审计 + 产品一条审计 → commit；回的记录 `maintenance` 已置。
 *  2. endAt 必须在未来：过去 / 缺失 → 400 点名 endAt，**事务一次都没开**。
 *  3. 已在维护中 → 409 PRODUCT_ALREADY_UNDER_MAINTENANCE：不插窗口、不打标、回滚。
 *  4. complete：窗口条件 UPDATE → 按窗口清标 → 审计 → commit；回的记录 `maintenance` 为 null。
 *  5. 不在维护中 → 409 PRODUCT_NOT_UNDER_MAINTENANCE：不碰窗口、回滚。
 *  6. 能力门是 `ops:maintenance.manage`——只有 `integration:product.manage` 不够。
 *
 * ── 假 pool ──
 * 记下每一条语句与参数，断言按 SQL 特征取；只有「先后」本身是判据的地方
 * （锁产品 → 建窗口 → 窗口 start → 打标 → 产品审计）才比下标。产品行的占用列是
 * 一个会随 stamp / release 变化的变量：回读时按它拼 `maintenance`，于是「SQL 发了
 * 但回给页面的记录没刷新」这类漏也逮得到。
 */
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

/* 路由文件把 `VxConfigService` 当 DI 令牌（`@Inject(VxConfigService)`），所以它是
   运行时引用；`@vxture/core-config` 的入口指向 dist，这里给一个空类顶替令牌位
   （同 product-catalog-retirement.spec.ts）。 */
vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-000000000001";
const WINDOW_ID = "0d3c2f1e-1111-4111-8111-000000000001";
const OTHER_WINDOW_ID = "0d3c2f1e-2222-4222-8222-000000000002";
const OPERATOR_ID = "7f6e5d4c-3333-4333-8333-000000000003";
const END_AT = new Date(Date.now() + 2 * 60 * 60 * 1000);
const END_AT_ISO = END_AT.toISOString();

function makeReq(capabilities = ["ops:maintenance.manage"]) {
  return {
    operator: { id: OPERATOR_ID, displayName: null },
    capabilities,
    headers: {},
  } as unknown as Request & RequestContext;
}

interface Scenario {
  /** 产品存不存在（不存在 / 已删除 → 锁到 0 行）。 */
  exists?: boolean;
  /** 产品当前被哪个窗口占着（null = 不在维护中）。 */
  stampedBy?: string | null;
}

function makeRouter(scenario: Scenario = {}) {
  const { exists = true, stampedBy = null } = scenario;
  const calls: { text: string; args: unknown[] }[] = [];
  /* 产品行的占用列：stamp 打上、release 清掉，回读按它拼。 */
  let occupiedBy: string | null = stampedBy;

  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    calls.push({ text: sql, args });
    if (/^\s*(begin|commit|rollback)\s*$/i.test(sql)) return { rows: [] };

    // 产品页入口：锁产品行。
    if (/FOR UPDATE OF p/.test(sql) && /FROM product\.products p/.test(sql)) {
      if (!exists) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            id: PRODUCT_ID,
            product_code: "karda",
            product_name: "Karda",
            maintenance_window_id: occupiedBy,
          },
        ],
        rowCount: 1,
      };
    }
    // 产品行的占用列。打标语句的子查询也提到绑定表，所以这一支要排在绑定表那支
    // 之前；清标的 WHERE 也写着 `= $1`，所以先认 `= null`。
    if (/update product\.products/i.test(sql)) {
      if (/maintenance_window_id = null/i.test(sql)) {
        occupiedBy = null;
      } else if (/set maintenance_window_id = \$1/i.test(sql)) {
        occupiedBy = args[0] as string;
      }
      return { rows: [], rowCount: 1 };
    }
    // 窗口 helper：产品码 → id。
    if (/product_code = any/i.test(sql)) {
      const codes = args[0] as string[];
      const rows = codes
        .filter((c) => c === "karda")
        .map((c) => ({ id: PRODUCT_ID, product_code: c }));
      return { rows, rowCount: rows.length };
    }
    if (/insert into admin\.maintenance_windows/i.test(sql)) {
      return { rows: [{ id: WINDOW_ID }], rowCount: 1 };
    }
    if (/admin\.maintenance_window_products/i.test(sql)) {
      // 绑定的删 / 插 / 锁三条都落在这张表上；锁那条回绑定产品的占用。
      if (/for update of p/i.test(sql)) {
        return {
          rows: [{ product_code: "karda", maintenance_window_id: occupiedBy }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    }
    // 窗口状态转移（start / complete）。
    if (/update admin\.maintenance_windows/i.test(sql)) {
      return { rows: [{ end_at: END_AT }], rowCount: 1 };
    }
    if (/insert into support\.audit_logs/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    // 事务内回读 / GET 单读（SELECT_COLUMNS 带 maintenance_* 三列）。
    if (
      /FROM product\.products\s+WHERE (id|product_code) = \$1 AND deleted_at IS NULL/.test(
        sql,
      )
    ) {
      return {
        rows: [
          {
            id: PRODUCT_ID,
            product_code: "karda",
            product_type: "agent",
            category_id: null,
            product_name: "Karda",
            product_nick: null,
            description: null,
            capability_keys: [],
            tags: [],
            standalone_subscribable: true,
            status: "active",
            is_customer_visible: true,
            is_workforce_visible: true,
            origin: "self",
            origin_provider: null,
            integration_mode: "platform_managed",
            release_stage: "stable",
            layer: null,
            launch_override_at: null,
            launch_override_pending: null,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
            icon_url: null,
            icon_version: null,
            surfaces: ["web"],
            maintenance_window_id: occupiedBy,
            maintenance_until: occupiedBy ? END_AT : null,
            maintenance_title: occupiedBy ? "Karda 升级维护" : null,
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });

  const client = { query, release: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    query,
  } as unknown as Pool;
  const config = {
    platform: {
      ATLAS_API_URL: "http://atlas.test/",
      RUNOS_API_URL: "http://runos.test/",
    },
  } as unknown as VxConfigService;
  const router = new ProductCatalogRouter(pool, config, {
    getToken: vi.fn(async () => "obo"),
  } as unknown as OperatorExchangeService);

  const find = (re: RegExp) => calls.find((c) => re.test(c.text));
  const findAll = (re: RegExp) => calls.filter((c) => re.test(c.text));
  const indexOf = (re: RegExp) => calls.findIndex((c) => re.test(c.text));
  return { router, calls, find, findAll, indexOf };
}

const LOCK_PRODUCT = /FROM product\.products p[\s\S]*FOR UPDATE OF p/;
const INSERT_WINDOW = /insert into admin\.maintenance_windows/i;
const BIND_INSERT = /insert into admin\.maintenance_window_products/i;
const WINDOW_START = /set status = 'in_progress'/i;
const WINDOW_COMPLETE = /set status = 'completed'/i;
/* 判据取**赋值形态**：SELECT 里也写着 maintenance_window_id，裸列名会误中回读。 */
const STAMP = /update product\.products[\s\S]*maintenance_window_id = \$1/i;
const RELEASE = /update product\.products[\s\S]*maintenance_window_id = null/i;
const AUDIT = /insert into support\.audit_logs/i;
const BEGIN = /^\s*begin\s*$/i;
const COMMIT = /^\s*commit\s*$/i;
const ROLLBACK = /^\s*rollback\s*$/i;

async function rejection(promise: Promise<unknown>): Promise<{
  status: number | undefined;
  code: string | undefined;
  field: string | undefined;
  message: string | undefined;
}> {
  try {
    await promise;
  } catch (error) {
    const e = error as {
      getStatus?: () => number;
      getResponse?: () => { code?: string; field?: string; message?: string };
    };
    const body = e.getResponse?.() ?? {};
    return {
      status: e.getStatus?.(),
      code: body.code,
      field: body.field,
      message: body.message,
    };
  }
  throw new Error("预期被拒，但成功了");
}

describe("POST :code/maintenance/start —— 建窗口并立刻开始，一笔事务", () => {
  it("锁产品 → 建窗口（挂本产品）→ start 打标 → 审计 → commit；回的记录带 maintenance", async () => {
    const t = makeRouter();
    const record = await t.router.startMaintenance(makeReq(), "karda", {
      endAt: END_AT_ISO,
      description: "切换网关",
    });

    // 先后：锁产品在建窗口之前，窗口 start 在打标之前，打标在产品审计之前。
    expect(t.indexOf(BEGIN)).toBeLessThan(t.indexOf(LOCK_PRODUCT));
    expect(t.indexOf(LOCK_PRODUCT)).toBeLessThan(t.indexOf(INSERT_WINDOW));
    expect(t.indexOf(INSERT_WINDOW)).toBeLessThan(t.indexOf(WINDOW_START));
    expect(t.indexOf(WINDOW_START)).toBeLessThan(t.indexOf(STAMP));
    expect(t.find(COMMIT)).toBeDefined();
    expect(t.find(ROLLBACK)).toBeUndefined();

    // 窗口的形状：minor、标题按产品名拼、start_at = now、end_at = 入参、挂本产品。
    const insert = t.find(INSERT_WINDOW)!;
    expect(insert.args[0]).toBe("minor");
    expect(insert.args[1]).toBe("Karda 升级维护");
    expect(insert.args[2]).toBe("切换网关");
    expect(insert.args[4]).toEqual([]);
    const startAt = new Date(insert.args[5] as string).getTime();
    expect(Math.abs(startAt - Date.now())).toBeLessThan(5_000);
    expect(insert.args[6]).toBe(END_AT_ISO);
    expect(insert.args[7]).toBe(OPERATOR_ID);
    expect(t.find(BIND_INSERT)!.args).toEqual([WINDOW_ID, [PRODUCT_ID]]);

    // 打标：窗口 id + 窗口 end_at。
    expect(t.find(STAMP)!.args).toEqual([WINDOW_ID, END_AT_ISO]);

    // 三条审计：窗口 create / start + 产品维度一条（按产品查审计要看得见）。
    const actions = t.findAll(AUDIT).map((c) => c.args[1]);
    expect(actions).toEqual([
      "governance.maintenance.create",
      "governance.maintenance.start",
      "catalog.product.maintenance_start",
    ]);
    const productAudit = t.findAll(AUDIT)[2]!;
    expect(productAudit.args[3]).toBe("product");
    expect(productAudit.args[4]).toBe(PRODUCT_ID);
    expect(JSON.parse(productAudit.args[6] as string)).toEqual({
      windowId: WINDOW_ID,
      maintenanceUntil: END_AT_ISO,
      description: "切换网关",
    });

    // 回读的记录已经是维护中的样子。
    expect(record.maintenance).toEqual({
      windowId: WINDOW_ID,
      title: "Karda 升级维护",
      until: END_AT_ISO,
    });
    expect(record.state).toBe("active");
  });

  it("description 可省：写 null，不是空串", async () => {
    const t = makeRouter();
    await t.router.startMaintenance(makeReq(), "karda", { endAt: END_AT_ISO });
    expect(t.find(INSERT_WINDOW)!.args[2]).toBeNull();
  });

  it("endAt 在过去 → 400 点名 endAt，事务一次都没开", async () => {
    const t = makeRouter();
    const error = await rejection(
      t.router.startMaintenance(makeReq(), "karda", {
        endAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_INVALID_VALUE");
    expect(error.field).toBe("endAt");
    expect(t.calls).toHaveLength(0);
  });

  it("endAt 缺失 / 不是时间 → 400 点名 endAt", async () => {
    const t = makeRouter();
    const missing = await rejection(
      t.router.startMaintenance(makeReq(), "karda", {}),
    );
    expect(missing.status).toBe(400);
    expect(missing.field).toBe("endAt");
    const garbage = await rejection(
      t.router.startMaintenance(makeReq(), "karda", { endAt: "下周三" }),
    );
    expect(garbage.status).toBe(400);
    expect(garbage.field).toBe("endAt");
    expect(t.calls).toHaveLength(0);
  });

  it("已在维护中 → 409 PRODUCT_ALREADY_UNDER_MAINTENANCE：不插窗口、不打标、回滚", async () => {
    const t = makeRouter({ stampedBy: OTHER_WINDOW_ID });
    const error = await rejection(
      t.router.startMaintenance(makeReq(), "karda", { endAt: END_AT_ISO }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("PRODUCT_ALREADY_UNDER_MAINTENANCE");
    expect(error.message).toContain("karda");
    expect(t.find(LOCK_PRODUCT)).toBeDefined();
    expect(t.find(INSERT_WINDOW)).toBeUndefined();
    expect(t.find(STAMP)).toBeUndefined();
    expect(t.find(AUDIT)).toBeUndefined();
    expect(t.find(ROLLBACK)).toBeDefined();
    expect(t.find(COMMIT)).toBeUndefined();
  });

  it("产品不存在 → 404，回滚", async () => {
    const t = makeRouter({ exists: false });
    const error = await rejection(
      t.router.startMaintenance(makeReq(), "nope", { endAt: END_AT_ISO }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("CATALOG_PRODUCT_NOT_FOUND");
    expect(t.find(INSERT_WINDOW)).toBeUndefined();
    expect(t.find(ROLLBACK)).toBeDefined();
  });

  it("uuid 与产品码都认：按形状挑列", async () => {
    const byCode = makeRouter();
    await byCode.router.startMaintenance(makeReq(), "karda", {
      endAt: END_AT_ISO,
    });
    expect(byCode.find(LOCK_PRODUCT)!.text).toMatch(/p\.product_code = \$1/);
    expect(byCode.find(LOCK_PRODUCT)!.args).toEqual(["karda"]);

    const byId = makeRouter();
    await byId.router.startMaintenance(makeReq(), PRODUCT_ID, {
      endAt: END_AT_ISO,
    });
    expect(byId.find(LOCK_PRODUCT)!.text).toMatch(/p\.id = \$1/);
    expect(byId.find(LOCK_PRODUCT)!.args).toEqual([PRODUCT_ID]);
  });

  it("能力门是 ops:maintenance.manage —— 只有 integration:product.manage 不够", async () => {
    const t = makeRouter();
    const error = await rejection(
      t.router.startMaintenance(
        makeReq(["integration:product.manage"]),
        "karda",
        {
          endAt: END_AT_ISO,
        },
      ),
    );
    expect(error.status).toBe(403);
    expect(error.code).toBe("NOT_ENTITLED");
    expect(t.calls).toHaveLength(0);
  });
});

describe("POST :code/maintenance/complete —— 结束当前窗口", () => {
  it("窗口 complete → 按窗口清标 → 审计 → commit；回的记录 maintenance 为 null", async () => {
    const t = makeRouter({ stampedBy: WINDOW_ID });
    const record = await t.router.completeMaintenance(makeReq(), "karda");

    expect(t.indexOf(LOCK_PRODUCT)).toBeLessThan(t.indexOf(WINDOW_COMPLETE));
    expect(t.find(WINDOW_COMPLETE)!.args).toEqual([
      WINDOW_ID,
      null,
      OPERATOR_ID,
    ]);
    expect(t.indexOf(WINDOW_COMPLETE)).toBeLessThan(t.indexOf(RELEASE));
    expect(t.find(RELEASE)!.args).toEqual([WINDOW_ID]);
    expect(t.find(COMMIT)).toBeDefined();

    const actions = t.findAll(AUDIT).map((c) => c.args[1]);
    expect(actions).toEqual([
      "governance.maintenance.complete",
      "catalog.product.maintenance_complete",
    ]);
    const productAudit = t.findAll(AUDIT)[1]!;
    expect(productAudit.args[3]).toBe("product");
    expect(productAudit.args[4]).toBe(PRODUCT_ID);
    expect(JSON.parse(productAudit.args[6] as string)).toEqual({
      windowId: WINDOW_ID,
      productsReleased: 1,
    });

    expect(record.maintenance).toBeNull();
  });

  it("不在维护中 → 409 PRODUCT_NOT_UNDER_MAINTENANCE：不碰窗口、回滚", async () => {
    const t = makeRouter({ stampedBy: null });
    const error = await rejection(
      t.router.completeMaintenance(makeReq(), "karda"),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe("PRODUCT_NOT_UNDER_MAINTENANCE");
    expect(t.find(WINDOW_COMPLETE)).toBeUndefined();
    expect(t.find(RELEASE)).toBeUndefined();
    expect(t.find(AUDIT)).toBeUndefined();
    expect(t.find(ROLLBACK)).toBeDefined();
  });

  it("产品不存在 → 404", async () => {
    const t = makeRouter({ exists: false });
    const error = await rejection(
      t.router.completeMaintenance(makeReq(), "nope"),
    );
    expect(error.status).toBe(404);
    expect(t.find(WINDOW_COMPLETE)).toBeUndefined();
  });

  it("能力门同 start", async () => {
    const t = makeRouter({ stampedBy: WINDOW_ID });
    const error = await rejection(
      t.router.completeMaintenance(
        makeReq(["integration:product.manage"]),
        "karda",
      ),
    );
    expect(error.status).toBe(403);
    expect(t.calls).toHaveLength(0);
  });
});

describe("产品记录上的 maintenance 投影（GET :idOrCode 与写路径同一个 mapper）", () => {
  it("不在维护中：maintenance 为 null，不给半个对象", async () => {
    const t = makeRouter({ stampedBy: null });
    const record = await t.router.get(
      makeReq(["integration:product.read"]),
      "karda",
    );
    expect(record?.maintenance).toBeNull();
  });

  it("维护中：windowId / title / until 三项，until 是 ISO", async () => {
    const t = makeRouter({ stampedBy: WINDOW_ID });
    const record = await t.router.get(
      makeReq(["integration:product.read"]),
      "karda",
    );
    expect(record?.maintenance).toEqual({
      windowId: WINDOW_ID,
      title: "Karda 升级维护",
      until: END_AT_ISO,
    });
  });
});
