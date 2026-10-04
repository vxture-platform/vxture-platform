/**
 * accounts-action-reason.spec.ts — 三条账号处置的「原因」必填（批 6）。
 * @package @vxture/bff-admin
 *
 * owner 2026-09-29 裁定：运营停用 / 恢复 / 强制下线从此会通知到客户本人，通知正文
 * 照抄运营填的那句话 ⇒ 这个字段从可选改为**必填**。这里钉的是 tsc 与 lint 都看不见
 * 的五件事：
 *
 *   1. 缺、空串、全空白、非字符串一律 400——空白串曾经能冒充「已填」，而它渲染出去
 *      就是一条没有任何理由的通知；
 *   2. 被拒时**一次委派都没发出**、一行审计都没落。只断言抛异常是不够的：如果校验
 *      长在委派之后，账号已经停用了而接口回 400，客户既被停用又收不到解释；
 *   3. 通过时委派收到的是 **trim 过**的那个串（前后空白不该进客户读到的正文）；
 *   4. 同一句话进审计行的 `after.reason`。在这之前它哪儿都没落地（IdP 的 internal
 *      端点连 `@Body()` 都不收），而弹窗上写着「将写入审计日志」；
 *   5. 新加的这道门**没有挤到既有两道门前面**：无能力码仍是 403、id 不是 uuid 仍是
 *      「Invalid account id」。两道判据长在同一条路上时，后面那条会被前面那条吃掉，
 *      而吃掉的方向决定客户看到的是哪种错；
 *   6.（2026-10-04 PR C）委派收到的主体是 **{ operatorId, accessToken }** 一对——票来自
 *      AuthMiddleware 挂的 `operatorAccessToken`；请求上下文里没有那张票时 401，
 *      **一次委派都不发**：没有票的请求到不了 delegate()。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { AccountsRouter } from "./accounts.router";
import type { OperatorAdminService } from "../auth/operator-admin.service";
import type { RequestContext } from "../types/console.types";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const MANAGE = ["user:account.manage"];
/** 上限 = admin-bff 的 ACCOUNT_ACTION_REASON_MAX，与弹窗的 maxLength 同一个数。 */
const REASON_MAX = 512;

/** AuthMiddleware 挂在请求上的那张会话票（PR C 起委派必须带它）。 */
const ACTOR_TOKEN = "rs256.session.access-token";
/** 委派收到的主体：id + 票，两半同源于 RP 会话。 */
const ACTOR = { operatorId: OPERATOR_ID, accessToken: ACTOR_TOKEN };

function makeReq(
  capabilities: string[],
  opts: { withToken?: boolean } = {},
): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ...(opts.withToken === false ? {} : { operatorAccessToken: ACTOR_TOKEN }),
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

interface AuditCall {
  sql: string;
  params: unknown[];
}

function harness() {
  const auditCalls: AuditCall[] = [];
  const rwPool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      auditCalls.push({ sql: String(sql), params: params ?? [] });
      return { rows: [] };
    }),
    connect: vi.fn(() => {
      throw new Error("these three write paths take no client");
    }),
  } as unknown as Pool;
  /* 只读池一碰就抛：这三条路根本不该读库（id 只做形状校验，不解编码）。
     给个静静返回空的桩，就看不出「悄悄多打了一条查询」。 */
  const roPool = {
    query: vi.fn(() => {
      throw new Error("lifecycle write paths must not read");
    }),
    connect: vi.fn(() => {
      throw new Error("lifecycle write paths must not read");
    }),
  } as unknown as Pool;
  const operatorAdmin = {
    disableAccount: vi.fn(async () => ({
      ok: true as const,
      status: "disabled",
      revoked: 3,
    })),
    enableAccount: vi.fn(async () => ({
      ok: true as const,
      status: "active",
    })),
    forceLogoutAccount: vi.fn(async () => ({ ok: true as const, revoked: 2 })),
  };
  const router = new AccountsRouter(
    roPool,
    rwPool,
    operatorAdmin as unknown as OperatorAdminService,
  );
  return { router, operatorAdmin, auditCalls };
}

/** 委派一共被调了几次（三个动作合计）。被拒时必须是 0。 */
function delegateCalls(admin: ReturnType<typeof harness>["operatorAdmin"]) {
  return (
    admin.disableAccount.mock.calls.length +
    admin.enableAccount.mock.calls.length +
    admin.forceLogoutAccount.mock.calls.length
  );
}

/** 审计行的 after（第 8 个绑定参数，jsonb 串）。 */
function auditAfter(calls: AuditCall[]): Record<string, unknown> {
  const rows = calls.filter((c) => c.sql.includes("support.audit_logs"));
  expect(rows).toHaveLength(1);
  return JSON.parse(String(rows[0]?.params[7])) as Record<string, unknown>;
}

type Action = "disable" | "enable" | "force-logout";

function invoke(
  router: AccountsRouter,
  action: Action,
  req: Request & RequestContext,
  body: { reason?: unknown },
): Promise<unknown> {
  const typed = body as { reason?: string };
  if (action === "disable") {
    return router.disableAccount(req, USER_ID, typed);
  }
  if (action === "enable") {
    return router.enableAccount(req, USER_ID, typed);
  }
  return router.forceLogoutAccount(req, USER_ID, typed);
}

const ACTIONS: readonly Action[] = ["disable", "enable", "force-logout"];

describe("account lifecycle actions require a reason", () => {
  /* 四种「没填」的形态。最要紧的是空白串：它在 JSON 里是个字符串，
     `if (!body.reason)` 那种写法放它过去，而它渲染给客户就是一条空理由。 */
  const BLANK_BODIES: ReadonlyArray<[string, { reason?: unknown }]> = [
    ["absent", {}],
    ["empty string", { reason: "" }],
    ["whitespace only", { reason: "   \n\t " }],
    ["not a string", { reason: 42 }],
  ];

  for (const action of ACTIONS) {
    for (const [label, body] of BLANK_BODIES) {
      it(`${action} rejects a ${label} reason with 400 and delegates nothing`, async () => {
        const { router, operatorAdmin, auditCalls } = harness();
        await expect(
          invoke(router, action, makeReq(MANAGE), body),
        ).rejects.toThrow(BadRequestException);
        await expect(
          invoke(router, action, makeReq(MANAGE), body),
        ).rejects.toThrow(/reason is required/);
        expect(delegateCalls(operatorAdmin)).toBe(0);
        expect(auditCalls).toHaveLength(0);
      });
    }

    it(`${action} rejects a reason over ${REASON_MAX} characters`, async () => {
      const { router, operatorAdmin, auditCalls } = harness();
      const body = { reason: "x".repeat(REASON_MAX + 1) };
      await expect(
        invoke(router, action, makeReq(MANAGE), body),
      ).rejects.toThrow(new RegExp(`reason exceeds ${REASON_MAX}`));
      expect(delegateCalls(operatorAdmin)).toBe(0);
      expect(auditCalls).toHaveLength(0);
    });

    it(`${action} accepts the boundary length of ${REASON_MAX}`, async () => {
      const { router, operatorAdmin } = harness();
      await invoke(router, action, makeReq(MANAGE), {
        reason: "x".repeat(REASON_MAX),
      });
      expect(delegateCalls(operatorAdmin)).toBe(1);
    });
  }

  it("forwards the trimmed reason to the IdP delegate and records it in the audit row", async () => {
    const { router, operatorAdmin, auditCalls } = harness();
    await router.disableAccount(makeReq(MANAGE), USER_ID, {
      reason: "  该账号存在异常登录，已暂时停用。  ",
    });
    expect(operatorAdmin.disableAccount).toHaveBeenCalledWith(
      USER_ID,
      ACTOR,
      "该账号存在异常登录，已暂时停用。",
    );
    expect(auditAfter(auditCalls)).toEqual({
      status: "disabled",
      revoked: 3,
      reason: "该账号存在异常登录，已暂时停用。",
    });
  });

  it("records the reason on enable as well", async () => {
    const { router, operatorAdmin, auditCalls } = harness();
    await router.enableAccount(makeReq(MANAGE), USER_ID, {
      reason: "身份核验已通过，账号恢复正常使用。",
    });
    expect(operatorAdmin.enableAccount).toHaveBeenCalledWith(
      USER_ID,
      ACTOR,
      "身份核验已通过，账号恢复正常使用。",
    );
    expect(auditAfter(auditCalls)).toEqual({
      status: "active",
      reason: "身份核验已通过，账号恢复正常使用。",
    });
  });

  it("records the reason on force-logout as well", async () => {
    const { router, operatorAdmin, auditCalls } = harness();
    await router.forceLogoutAccount(makeReq(MANAGE), USER_ID, {
      reason: "检测到异常登录设备，已退出全部登录。",
    });
    expect(operatorAdmin.forceLogoutAccount).toHaveBeenCalledWith(
      USER_ID,
      ACTOR,
      "检测到异常登录设备，已退出全部登录。",
    );
    expect(auditAfter(auditCalls)).toEqual({
      revoked: 2,
      reason: "检测到异常登录设备，已退出全部登录。",
    });
  });
});

describe("the new gate did not move in front of the existing two", () => {
  it("still answers 403 when the capability is missing, even with no reason", async () => {
    const { router, operatorAdmin, auditCalls } = harness();
    await expect(
      router.disableAccount(makeReq([]), USER_ID, {}),
    ).rejects.toThrow(ForbiddenException);
    expect(delegateCalls(operatorAdmin)).toBe(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("still answers `Invalid account id` for a non-uuid id carrying a good reason", async () => {
    const { router, operatorAdmin } = harness();
    await expect(
      router.disableAccount(makeReq(MANAGE), "1649201736", {
        reason: "该账号存在异常登录，已暂时停用。",
      }),
    ).rejects.toThrow(/Invalid account id/);
    expect(delegateCalls(operatorAdmin)).toBe(0);
  });
});

describe("PR C · the acting operator reaches the delegate as { operatorId, accessToken }", () => {
  it("forwards the session access token from the request context alongside the operator id", async () => {
    const { router, operatorAdmin } = harness();
    await router.disableAccount(makeReq(MANAGE), USER_ID, {
      reason: "该账号存在异常登录，已暂时停用。",
    });
    const [, actor] = operatorAdmin.disableAccount.mock.calls[0] as unknown as [
      string,
      { operatorId: string; accessToken: string },
    ];
    expect(actor).toEqual({
      operatorId: OPERATOR_ID,
      accessToken: ACTOR_TOKEN,
    });
  });

  for (const action of ACTIONS) {
    it(`${action}: a request whose context carries no operator access token → 401, delegate never called, no audit row`, async () => {
      const { router, operatorAdmin, auditCalls } = harness();
      await expect(
        invoke(router, action, makeReq(MANAGE, { withToken: false }), {
          reason: "该账号存在异常登录，已暂时停用。",
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(delegateCalls(operatorAdmin)).toBe(0);
      expect(auditCalls).toHaveLength(0);
    });
  }

  it("the token gate sits behind the capability gate (no capability → 403 even without a token)", async () => {
    const { router, operatorAdmin } = harness();
    await expect(
      router.disableAccount(makeReq([], { withToken: false }), USER_ID, {
        reason: "x",
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(delegateCalls(operatorAdmin)).toBe(0);
  });
});
