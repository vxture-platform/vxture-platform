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

const req = (method: string, originalUrl = "/api/risk-records/x") =>
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
  /* 成功行写的是 `operator_role`（单数）。两边对不上就等于查不到一起，
     而「查得到一起」正是记这行的全部意义。 */
  it("resource_type 与成功路径同名（单数）", () => {
    expect(
      describeRequest(req("PUT", "/api/admin-roles/abc")).resourceType,
    ).toBe("operator_role");
    expect(
      describeRequest(req("POST", "/api/platform-admins")).resourceType,
    ).toBe("operator_account");
    expect(
      describeRequest(req("POST", "/api/system-parameters/abc")).resourceType,
    ).toBe("platform_setting");
  });

  it("未登记的段原样落——宁可类型名难看，不可无记录", () => {
    expect(
      describeRequest(req("POST", "/api/brand-new-thing/x")).resourceType,
    ).toBe("brand_new_thing");
  });

  it("动作取末段（disable / toggle / resolve）", () => {
    expect(
      describeRequest(req("POST", "/api/platform-admins/abc/disable")).action,
    ).toBe("operator_account.disable");
    expect(
      describeRequest(req("POST", "/api/feature-toggles/billing.v2/toggle"))
        .action,
    ).toBe("feature_flag.toggle");
  });

  it("末段就是对象本身时，用 HTTP 方法的语义词", () => {
    const uuid = "0c4fa6cc-a86d-4e96-98cd-deacc0b38b46";
    expect(describeRequest(req("PUT", `/api/admin-roles/${uuid}`)).action).toBe(
      "operator_role.replace",
    );
    expect(describeRequest(req("POST", "/api/risk-records")).action).toBe(
      "risk_record.create",
    );
  });

  it("resource_id 取 uuid；没有 uuid 时取可视码；都没有落 `-`（列 NOT NULL）", () => {
    const uuid = "0c4fa6cc-a86d-4e96-98cd-deacc0b38b46";
    expect(
      describeRequest(req("POST", `/api/compliance-events/${uuid}/resolve`))
        .resourceId,
    ).toBe(uuid);
    expect(
      describeRequest(req("POST", "/api/feature-toggles/billing.v2/toggle"))
        .resourceId,
    ).toBe("billing.v2");
    expect(describeRequest(req("POST", "/api/risk-records")).resourceId).toBe(
      "-",
    );
  });

  it("查询串不进推导", () => {
    expect(
      describeRequest(req("PUT", "/api/admin-roles/abc?force=1")).action,
    ).toBe("operator_role.replace");
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

  /* 发起面写 `arche`，不是抄过来时的 `opera`：三个平台的留痕各归各的，
     opera 的变更审计只读 `actor_console = 'opera'` 的行。 */
  it("有 operator 时按 arche 常量落库", async () => {
    const query = vi.fn<
      (sql: string, params: unknown[]) => Promise<{ rows: [] }>
    >(() => Promise.resolve({ rows: [] }));
    const request = {
      ...req("POST", "/api/risk-records/abc/review"),
      operator: { id: "00000000-0000-4000-a000-000000000011" },
    };
    await insertDeniedAuditLog(
      { query } as unknown as Pool,
      request as never,
      "RISK_RECORD_INVALID_STATE",
    );
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("'operator', 'arche'");
    expect(sql).toContain("'denied'");
    expect(params[0]).toBe("00000000-0000-4000-a000-000000000011");
    expect(params).toContain("RISK_RECORD_INVALID_STATE");
  });
});
