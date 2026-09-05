import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool } from "pg";
import { AuditRouter } from "./audit.router";
import type { RequestContext } from "../types/console.types";

/**
 * 批 6 把审计日志从 `limit 200` 硬顶改成服务端分页 + 总数 + 动作筛选。这里钉住:
 * 参数的钳制口径、计数与列表共用同一套谓词、offset 算法、行映射,以及缺租户上下文
 * 时不查库直接 401。库用假件——路由只拼参数,不需要真 SQL。
 */

type Row = {
  id: string;
  created_at: Date;
  actor_type: string;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  result: string;
  ip_address: string | null;
};

function fakePool(total: number, rows: Row[]) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ total: String(total) }] })
    .mockResolvedValueOnce({ rows });
  return { pool: { query } as unknown as Pool, query };
}

function req(tenantId: string | null = "t-1") {
  return {
    tenant: tenantId ? { id: tenantId } : undefined,
  } as unknown as Request & RequestContext;
}

const ROW: Row = {
  id: "log-1",
  created_at: new Date("2026-09-05T03:00:00Z"),
  actor_type: "customer",
  actor_name: "Alice",
  action: "tenant.member.invite",
  resource_type: "member",
  resource_id: "u-2",
  result: "denied",
  ip_address: "10.0.0.1",
};

describe("AuditRouter.listLogs", () => {
  it("缺租户上下文时 401,且不查库", async () => {
    const { pool, query } = fakePool(0, []);
    const router = new AuditRouter(pool);
    await expect(router.listLogs(req(null))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("默认:90 天、不筛结果与动作、第 1 页 20 条;计数与列表同一套谓词", async () => {
    const { pool, query } = fakePool(1, [ROW]);
    const router = new AuditRouter(pool);
    const page = await router.listLogs(req());

    expect(query).toHaveBeenCalledTimes(2);
    const [countSql, countParams] = query.mock.calls[0] as [string, unknown[]];
    const [listSql, listParams] = query.mock.calls[1] as [string, unknown[]];
    expect(countSql).toMatch(/count\(\*\)/);
    expect(countParams).toEqual(["t-1", 90, null, null]);
    expect(listSql).toMatch(/limit \$5 offset \$6/);
    expect(listParams).toEqual(["t-1", 90, null, null, 20, 0]);
    // 同一套谓词:列表参数的前四位就是计数参数
    expect(listParams.slice(0, 4)).toEqual(countParams);

    expect(page).toEqual({
      items: [
        {
          id: "log-1",
          at: "2026-09-05T03:00:00.000Z",
          actorName: "Alice",
          actorType: "customer",
          action: "tenant.member.invite",
          resourceType: "member",
          resourceId: "u-2",
          result: "denied",
          ipAddress: "10.0.0.1",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it("页码与页大小钳制:非法回默认,超上限截到上限,offset 按页算", async () => {
    const { pool, query } = fakePool(0, []);
    const router = new AuditRouter(pool);
    const page = await router.listLogs(
      req(),
      undefined,
      undefined,
      undefined,
      "3",
      "10",
    );
    expect(query.mock.calls[1]?.[1]).toEqual(["t-1", 90, null, null, 10, 20]);
    expect(page.page).toBe(3);
    expect(page.pageSize).toBe(10);

    const second = fakePool(0, []);
    const clamped = await new AuditRouter(second.pool).listLogs(
      req(),
      undefined,
      undefined,
      undefined,
      "0",
      "500",
    );
    expect(second.query.mock.calls[1]?.[1]).toEqual([
      "t-1",
      90,
      null,
      null,
      100,
      0,
    ]);
    expect(clamped.page).toBe(1);
    expect(clamped.pageSize).toBe(100);
  });

  it("天数钳到 1..90;结果只认 success / failure;动作只认受管形状", async () => {
    const { pool, query } = fakePool(0, []);
    await new AuditRouter(pool).listLogs(
      req(),
      "failure",
      "365",
      "tenant.member.invite",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "t-1",
      90,
      "failure",
      "tenant.member.invite",
    ]);

    const loose = fakePool(0, []);
    await new AuditRouter(loose.pool).listLogs(
      req(),
      "denied",
      "7",
      "DROP TABLE support.audit_logs",
    );
    // denied 不是可选的筛选值(它并入 failure 的口径由 SQL 处理);非法动作码整个丢弃
    expect(loose.query.mock.calls[0]?.[1]).toEqual(["t-1", 7, null, null]);
  });

  it("result 映射:success / denied 原样,其它一律 failure", async () => {
    const rows: Row[] = [
      { ...ROW, id: "a", result: "success" },
      { ...ROW, id: "b", result: "denied" },
      { ...ROW, id: "c", result: "failure" },
      { ...ROW, id: "d", result: "weird" },
    ];
    const { pool } = fakePool(4, rows);
    const page = await new AuditRouter(pool).listLogs(req());
    expect(page.items.map((i) => i.result)).toEqual([
      "success",
      "denied",
      "failure",
      "failure",
    ]);
  });
});
