/**
 * operator-auth.middleware.spec.ts —— 平台门。
 *
 * 三个运营平台共用一个 IdP 与一张权限表，所以「登录成功」对三个平台都成立。本平台的
 * 门是根码 `arche.plane`：没有它的账号在数据面上一律 403，只有会话端点放行，让门户
 * 能说清原因。反向验证：把门摘掉，第二、三条会红。
 */
import { rpSessionCookieName } from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { OperatorAuthMiddleware } from "./operator-auth.middleware";

const OPERATOR_ID = "00000000-0000-4000-a000-000000000011";
const RUNTIME = { cookieSecure: false, config: { clientId: "arche" } };

function setup(capabilities: string[]) {
  const authz = {
    resolve: vi.fn(async () => ({
      operator: { id: OPERATOR_ID, displayName: "op", roleRank: 10 },
      capabilities,
    })),
  };
  const rpAuth = {
    resolve: vi.fn(async () => ({
      status: "ok",
      claims: { sub: `opr_${OPERATOR_ID}`, userType: "operator" },
      accessToken: "token",
    })),
  };
  const middleware = new OperatorAuthMiddleware(
    authz as never,
    rpAuth as never,
    RUNTIME as never,
  );
  const run = async (url: string) => {
    const req = {
      originalUrl: url,
      cookies: { [rpSessionCookieName(false, "arche")]: "sid" },
    } as unknown as Request;
    const captured: { status?: number; body?: Record<string, unknown> } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        captured.body = body;
        return this;
      },
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    await middleware.use(req, res, next);
    return { captured, next: next as unknown as ReturnType<typeof vi.fn>, req };
  };
  return { run };
}

describe("平台门（arche.plane）", () => {
  it("持有根码 → 放行，能力码挂在请求上", async () => {
    const { run } = setup(["arche.plane", "audit:log.read"]);
    const { next, req, captured } = await run("/api/audit-logs");
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.status).toBeUndefined();
    expect(
      (req as unknown as { capabilities: string[] }).capabilities,
    ).toContain("audit:log.read");
  });

  it("没有根码 → 403 NOT_ENTITLED，不进 router", async () => {
    const { run } = setup(["model:model.manage"]);
    const { next, captured } = await run("/api/audit-logs?from=x");
    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(403);
    expect(captured.body?.["code"]).toBe("NOT_ENTITLED");
    expect(captured.body?.["retryable"]).toBe(false);
  });

  it("持有本平台的操作码却没有根码 → 仍然 403（门看根码，不看子码）", async () => {
    const { run } = setup(["audit:log.read"]);
    const { next, captured } = await run("/api/audit-logs");
    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(403);
  });

  it("会话端点不设门：门户要靠它说清原因", async () => {
    const { run } = setup(["model:model.manage"]);
    const { next, captured } = await run("/api/session");
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.status).toBeUndefined();
  });
});
