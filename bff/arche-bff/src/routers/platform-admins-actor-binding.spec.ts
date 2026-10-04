/**
 * platform-admins-actor-binding.spec.ts — 六条委派动作：没有会话票的请求到不了 delegate()（PR C）。
 * @package @vxture/bff-arche
 *
 * 钉两件 tsc 看不见的事：
 *   1. 请求上下文里没有 `operatorAccessToken`（中间件没挂 / 被人绕过）→ 401，**一次委派都不发、
 *      一行审计都不落**。校验长在委派之前；反了的话 IdP 会 401、这边映射成 503「IdP 不可用」，
 *      排障就奔着 IdP 去了；
 *   2. 有票时委派收到的主体是 `{ operatorId, accessToken }` 一对，票就是中间件挂的那张原文。
 *   既有两道门没被挤掉：无能力码仍是 403、id 不是 uuid 仍是 400。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PlatformAdminsRouter } from "./platform-admins.router";
import type { OperatorAdminService } from "../auth/operator-admin.service";
import type { RequestContext } from "../types/request-context";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const MANAGE = ["arche.plane", "operator:account.manage"];
const ACTOR_TOKEN = "rs256.session.access-token";
const ACTOR = { operatorId: OPERATOR_ID, accessToken: ACTOR_TOKEN };

function makeReq(
  capabilities: string[],
  opts: { withToken?: boolean } = {},
): Request & RequestContext {
  return {
    operator: { id: OPERATOR_ID, displayName: "op", roleRank: 100 },
    capabilities,
    ...(opts.withToken === false ? {} : { operatorAccessToken: ACTOR_TOKEN }),
    originalUrl: "/api/platform-admins",
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

function harness() {
  const auditCalls: string[] = [];
  const rwPool = {
    query: vi.fn(async (sql: string) => {
      auditCalls.push(String(sql));
      return { rows: [] };
    }),
    connect: vi.fn(() => {
      throw new Error("these paths take no client");
    }),
  } as unknown as Pool;
  const roPool = {
    query: vi.fn(() => {
      throw new Error("delegated write paths must not read");
    }),
  } as unknown as Pool;
  const operatorAdmin = {
    createOperator: vi.fn(async () => ({
      ok: true as const,
      operatorId: TARGET_ID,
      deliveredTo: "u***@example.test",
    })),
    disableOperator: vi.fn(async () => ({
      ok: true as const,
      status: "disabled",
      revoked: 1,
    })),
    enableOperator: vi.fn(async () => ({
      ok: true as const,
      status: "active",
    })),
    forceLogoutOperator: vi.fn(async () => ({ ok: true as const, revoked: 2 })),
    resetOperatorMfa: vi.fn(async () => ({ ok: true as const, revoked: 1 })),
    resetOperatorPassword: vi.fn(async () => ({
      ok: true as const,
      deliveredTo: "u***@example.test",
      expiresIn: 1800,
    })),
  };
  const router = new PlatformAdminsRouter(
    roPool,
    rwPool,
    operatorAdmin as unknown as OperatorAdminService,
  );
  return { router, operatorAdmin, auditCalls };
}

function delegateCalls(admin: ReturnType<typeof harness>["operatorAdmin"]) {
  return Object.values(admin).reduce((n, fn) => n + fn.mock.calls.length, 0);
}

type Action =
  | "create"
  | "disable"
  | "enable"
  | "force-logout"
  | "mfa-reset"
  | "reset-password";

const ACTIONS: readonly Action[] = [
  "create",
  "disable",
  "enable",
  "force-logout",
  "mfa-reset",
  "reset-password",
];

function invoke(
  router: PlatformAdminsRouter,
  action: Action,
  req: Request & RequestContext,
): Promise<unknown> {
  const body = { reason: "r" };
  switch (action) {
    case "create":
      return router.createAdmin(req, {
        username: "newop",
        displayName: "New Op",
        email: "newop@example.test",
        roleId: TARGET_ID,
      } as never);
    case "disable":
      return router.disableAdmin(req, TARGET_ID, body);
    case "enable":
      return router.enableAdmin(req, TARGET_ID, body);
    case "force-logout":
      return router.forceLogoutAdmin(req, TARGET_ID, body);
    case "mfa-reset":
      return router.resetAdminMfa(req, TARGET_ID, body);
    case "reset-password":
      return router.resetAdminPassword(req, TARGET_ID, body);
  }
}

describe("PR C · a request without an operator session token cannot reach delegate()", () => {
  for (const action of ACTIONS) {
    it(`${action}: no operatorAccessToken on the context → 401, no delegate, no audit row`, async () => {
      const { router, operatorAdmin, auditCalls } = harness();
      await expect(
        invoke(router, action, makeReq(MANAGE, { withToken: false })),
      ).rejects.toThrow(UnauthorizedException);
      expect(delegateCalls(operatorAdmin)).toBe(0);
      expect(auditCalls).toHaveLength(0);
    });
  }
});

describe("PR C · with a token the delegate receives { operatorId, accessToken } from the context", () => {
  it("force-logout forwards the pair (token = the one the middleware hung on the request)", async () => {
    const { router, operatorAdmin } = harness();
    const result = await router.forceLogoutAdmin(makeReq(MANAGE), TARGET_ID, {
      reason: "r",
    });
    expect(result).toEqual({ ok: true, revoked: 2 });
    expect(operatorAdmin.forceLogoutOperator).toHaveBeenCalledWith(
      TARGET_ID,
      ACTOR,
      "r",
    );
  });

  it("mfa-reset and reset-password forward the same pair", async () => {
    const { router, operatorAdmin } = harness();
    await router.resetAdminMfa(makeReq(MANAGE), TARGET_ID, { reason: "r" });
    await router.resetAdminPassword(makeReq(MANAGE), TARGET_ID, {});
    expect(operatorAdmin.resetOperatorMfa).toHaveBeenCalledWith(
      TARGET_ID,
      ACTOR,
      "r",
    );
    expect(operatorAdmin.resetOperatorPassword).toHaveBeenCalledWith(
      TARGET_ID,
      ACTOR,
      undefined,
    );
  });
});

describe("the token gate did not move in front of the existing gates", () => {
  it("no capability → 403 even without a token, nothing delegated", async () => {
    const { router, operatorAdmin } = harness();
    await expect(
      router.forceLogoutAdmin(
        makeReq(["arche.plane"], { withToken: false }),
        TARGET_ID,
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(delegateCalls(operatorAdmin)).toBe(0);
  });

  it("non-uuid target with a good token → 400 Invalid platform admin id, nothing delegated", async () => {
    const { router, operatorAdmin } = harness();
    await expect(
      router.forceLogoutAdmin(makeReq(MANAGE), "1649201736", {}),
    ).rejects.toThrow(BadRequestException);
    expect(delegateCalls(operatorAdmin)).toBe(0);
  });
});
