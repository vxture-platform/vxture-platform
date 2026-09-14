/**
 * operator-sessions.router.spec.ts —— 什么算登录失败。
 *
 * 登录服务写入 success / bad_credential / mfa_required / mfa_failed / locked。
 * `mfa_required` 是密码通过、等二次验证的正常中间步骤。上线当天实测：它被算成失败，
 * 一次正常的 MFA 登录就让总览上「24 小时登录失败」+1。反向验证：把 SQL 改回
 * `<> 'success'`，下面两条会红。
 */
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../types/request-context";
import { OperatorSessionsRouter } from "./operator-sessions.router";

const req = {
  operator: { id: "00000000-0000-4000-a000-000000000011" },
  capabilities: ["arche.plane", "operator:session.read"],
} as unknown as Request & RequestContext;

function routerWith() {
  const query = vi.fn<
    (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  >(() => Promise.resolve({ rows: [] }));
  return {
    router: new OperatorSessionsRouter({ query } as unknown as Pool),
    query,
  };
}

describe("登录失败的口径", () => {
  it("统计不把 mfa_required 算成失败", async () => {
    const { router, query } = routerWith();
    await router.summary(req);
    const attemptsSql = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("operator_login_attempt"));
    expect(attemptsSql).toContain("not in ('success', 'mfa_required')");
    expect(attemptsSql).not.toContain("<> 'success'");
  });

  it("「失败」筛选不含 mfa_required", async () => {
    const { router, query } = routerWith();
    await router.signIns(req, "failure");
    const [sql] = query.mock.calls[0]!;
    expect(sql).toContain("la.result not in ('success', 'mfa_required')");
  });

  it("没有 operator:session.read → 403，不查库", async () => {
    const { router, query } = routerWith();
    const denied = {
      ...req,
      capabilities: ["arche.plane"],
    } as unknown as Request & RequestContext;
    await expect(router.summary(denied)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
