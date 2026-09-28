/**
 * pg-notice.repository.spec.ts — 系统来源写路，假 pool。
 *
 * 假 pool 不解析 SQL，所以这里分两半：
 *   · 谓词用**字面断言**钉住（与 dispatch 包的 DEDUPE_SQL 同一手法）——冲突目标写漏
 *     where 谓词时 Postgres 直接拒绝整条语句，而假 pool 对此毫无感觉；
 *   · 绑定顺序与结果翻译用行为断言。
 * 可见性谓词那一半在 operator-notices.itest.spec.ts 打真库。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  CREATE_SYSTEM_NOTICE_SQL,
  PgNoticeRepository,
} from "./pg-notice.repository";
import type { CreateSystemNoticeInput } from "../types/notice.types";

function fakePool(rows: { id: string }[]) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows,
    rowCount: rows.length,
  }));
  return { pool: { query } as unknown as Pool, query };
}

const flat = CREATE_SYSTEM_NOTICE_SQL.replace(/\s+/g, " ").trim();

const input: CreateSystemNoticeInput = {
  targetPlanes: ["admin"],
  severity: "warning",
  title: "客户申请退款 ¥99.00 · ORD-1",
  body: "租户 Acme · ¥99.00 · 客户收到：「退款申请已收到：订单 ORD-1」",
  link: "/orders/ORD-1",
  referenceType: "customer_event",
  referenceId: "refund.requested:refund:r-1:requested",
  expiresAt: null,
};

describe("CREATE_SYSTEM_NOTICE_SQL", () => {
  it("冲突目标原样照抄部分唯一索引 uq_operator_notices_system（列 + where 谓词）", () => {
    // 部分唯一索引只有谓词完全匹配时才被认作冲突仲裁；少了 where 整条语句报错。
    expect(flat).toContain(
      "on conflict (reference_type, reference_id) where source = 'system' and deleted_at is null do nothing",
    );
    // do nothing 而不是 do update：已播过的一件事不许被刷新到未读顶上。
    expect(flat).not.toContain("do update");
    expect(flat).toContain("returning id");
  });

  it("source 与 created_by 都不来自入参：source 恒 'system'，created_by 恒 null", () => {
    expect(flat).toContain(
      "values ($1::varchar(16)[], $2, $3, $4, $5, 'system', $6, $7, $8, null)",
    );
    expect(flat).toContain("insert into admin.operator_notices");
  });
});

describe("PgNoticeRepository.createSystemNotice", () => {
  it("八个参数按占位顺序绑定；回行 → inserted:true 带 id", async () => {
    const f = fakePool([{ id: "n-1" }]);
    const repo = new PgNoticeRepository(f.pool);

    const out = await repo.createSystemNotice(input);

    expect(out).toEqual({ inserted: true, id: "n-1" });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith(CREATE_SYSTEM_NOTICE_SQL, [
      ["admin"],
      "warning",
      input.title,
      input.body,
      "/orders/ORD-1",
      "customer_event",
      "refund.requested:refund:r-1:requested",
      null,
    ]);
  });

  it("link / expiresAt 缺省绑成 null，不是 undefined（pg 对 undefined 会抛）", async () => {
    const f = fakePool([{ id: "n-2" }]);
    const repo = new PgNoticeRepository(f.pool);
    await repo.createSystemNotice({
      targetPlanes: input.targetPlanes,
      severity: input.severity,
      title: input.title,
      body: input.body,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[4]).toBeNull();
    expect(params[7]).toBeNull();
  });

  it("targetPlanes 拷贝成普通数组，不把 readonly 入参原样交给 pg", async () => {
    const f = fakePool([{ id: "n-3" }]);
    const repo = new PgNoticeRepository(f.pool);
    const planes = ["admin", "opera"] as const;

    await repo.createSystemNotice({ ...input, targetPlanes: planes });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[0]).toEqual(["admin", "opera"]);
    expect(params[0]).not.toBe(planes);
  });

  it("冲突不回行 → inserted:false、id:null，不抛（重放不是错误）", async () => {
    const f = fakePool([]);
    const repo = new PgNoticeRepository(f.pool);

    await expect(repo.createSystemNotice(input)).resolves.toEqual({
      inserted: false,
      id: null,
    });
  });

  it("expiresAt 给 Date 时原样绑定（info 类 30 天后退出列表）", async () => {
    const f = fakePool([{ id: "n-4" }]);
    const repo = new PgNoticeRepository(f.pool);
    const expiresAt = new Date("2026-10-28T00:00:00Z");

    await repo.createSystemNotice({ ...input, severity: "info", expiresAt });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe("info");
    expect(params[7]).toBe(expiresAt);
  });
});
