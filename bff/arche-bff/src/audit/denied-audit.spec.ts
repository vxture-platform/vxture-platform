/**
 * denied-audit.spec.ts —— 口径表与路径推导。
 *
 * 口径表（哪些状态记、哪些不记）是 owner 拍板的**决定**，不是实现细节：
 * 它被人顺手改宽（"400 也记一下吧"）会把审计表淹掉，改窄（"409 算业务错误不记"）
 * 会把安全事实丢掉。两个方向都要挡住。
 */
import type { Request } from "express";
import type { Pool } from "pg";
import { describe as group, expect, it, vi } from "vitest";
import {
  describe as describeRequest,
  insertDeniedAuditLog,
  shouldAuditDenial,
} from "./denied-audit";

const req = (method: string, originalUrl = "/api/products/x") =>
  ({ method, originalUrl, headers: {} }) as unknown as Request;

group("口径：哪些拒绝值得留痕", () => {
  it("403 / 409 的写操作要记", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(shouldAuditDenial(req(m), 403)).toBe(true);
      expect(shouldAuditDenial(req(m), 409)).toBe(true);
    }
  });

  it("400 / 401 / 404 / 5xx 不记", () => {
    for (const s of [400, 401, 404, 422, 500, 502]) {
      expect(shouldAuditDenial(req("POST"), s)).toBe(false);
    }
  });

  it("读操作一律不记", () => {
    expect(shouldAuditDenial(req("GET"), 403)).toBe(false);
    expect(shouldAuditDenial(req("HEAD"), 409)).toBe(false);
  });
});

group("路径推导 —— 与成功行查得到一起去", () => {
  /* 成功行写的是 `maintenance_window`（单数）。两边对不上就等于查不到一起，
     而「查得到一起」正是记这行的全部意义。 */
  it("resource_type 与成功路径同名（单数）", () => {
    expect(
      describeRequest(req("PUT", "/api/maintenance-windows/abc")).resourceType,
    ).toBe("maintenance_window");
    expect(describeRequest(req("POST", "/api/products")).resourceType).toBe(
      "product",
    );
    expect(
      describeRequest(req("POST", "/api/oidc-clients/vxtpl/activate"))
        .resourceType,
    ).toBe("oidc_client");
  });

  it("未登记的段原样落——宁可类型名难看，不可无记录", () => {
    expect(
      describeRequest(req("POST", "/api/brand-new-thing/x")).resourceType,
    ).toBe("brand_new_thing");
  });

  it("动作取末段（start / activate / state）", () => {
    expect(
      describeRequest(req("POST", "/api/maintenance-windows/abc/start")).action,
    ).toBe("maintenance_window.start");
    expect(
      describeRequest(req("POST", "/api/oidc-clients/vxtpl/deactivate")).action,
    ).toBe("oidc_client.deactivate");
  });

  it("末段就是对象本身时，用 HTTP 方法的语义词", () => {
    const uuid = "0c4fa6cc-a86d-4e96-98cd-deacc0b38b46";
    expect(
      describeRequest(req("PUT", `/api/maintenance-windows/${uuid}`)).action,
    ).toBe("maintenance_window.replace");
    expect(describeRequest(req("POST", "/api/products")).action).toBe(
      "product.create",
    );
  });

  it("resource_id 取 uuid；没有 uuid 时取可视码；都没有落 `-`（列 NOT NULL）", () => {
    const uuid = "0c4fa6cc-a86d-4e96-98cd-deacc0b38b46";
    expect(
      describeRequest(req("PATCH", `/api/products/${uuid}/state`)).resourceId,
    ).toBe(uuid);
    expect(
      describeRequest(req("POST", "/api/oidc-clients/vxtpl/activate"))
        .resourceId,
    ).toBe("vxtpl");
    expect(describeRequest(req("POST", "/api/products")).resourceId).toBe("-");
  });

  it("查询串不进推导", () => {
    expect(
      describeRequest(req("PUT", "/api/products/abc?force=1")).action,
    ).toBe("product.replace");
  });
});

group("没有主体就写不了", () => {
  /* `actor_id` 是 NOT NULL。401 那一档不是"选择不记"，是**物理上记不了**——
     没有会话就没有主体。这类进访问日志，不进审计。 */
  it("无 operator 时直接返回，不发 SQL", async () => {
    const query = vi.fn();
    await insertDeniedAuditLog(
      { query } as unknown as Pool,
      req("POST") as never,
      "NOT_ENTITLED",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("有 operator 时按 opera 常量落库", async () => {
    const query = vi.fn<
      (sql: string, params: unknown[]) => Promise<{ rows: [] }>
    >(() => Promise.resolve({ rows: [] }));
    const request = {
      ...req("POST", "/api/products/abc/state"),
      operator: { id: "00000000-0000-4000-a000-000000000011" },
    };
    await insertDeniedAuditLog(
      { query } as unknown as Pool,
      request as never,
      "CATALOG_INVALID_STATE_TRANSITION",
    );
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("'operator', 'opera'");
    expect(sql).toContain("'denied'");
    expect(params[0]).toBe("00000000-0000-4000-a000-000000000011");
    expect(params).toContain("CATALOG_INVALID_STATE_TRANSITION");
  });
});
