/**
 * operator-sessions.router.spec.ts —— 在线会话以 IdP 中央会话为准。
 *
 * 上线后实测：owner 自己登录着，在线会话却是空的。此前按刷新令牌表判在线，而令牌链会被
 * 并发刷新的重放判定整条吊销、中央会话仍在。反向验证：把 `active` 改回查令牌表（不调
 * `listOperatorSessions`），「本人会话在列表里」一条会红。
 */
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type {
  IdpOperatorSession,
  OperatorAdminService,
} from "../auth/operator-admin.service";
import type { RequestContext } from "../types/request-context";
import {
  OperatorSessionsRouter,
  sessionRefOf,
} from "./operator-sessions.router";

const SELF = "00000000-0000-4000-a000-000000000011";
const OTHER = "00000000-0000-4000-a000-000000000022";
const SELF_SID = "sid-self-current";

const req = {
  operator: { id: SELF },
  capabilities: ["arche.plane", "operator:session.read"],
  sessionId: SELF_SID,
} as unknown as Request & RequestContext;

function session(
  operatorId: string,
  sid: string,
  createdAt: string,
): IdpOperatorSession {
  return {
    sessionRef: sessionRefOf(sid),
    operatorId,
    authMethod: "totp",
    clients: ["arche"],
    createdAt,
    expiresAt: "2026-09-16T00:00:00.000Z",
  };
}

function routerWith(sessions: IdpOperatorSession[]) {
  const query = vi.fn<
    (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  >(() =>
    Promise.resolve({
      rows: [
        {
          id: SELF,
          operator_name: "系统管理员",
          username: "systemadmin",
          role_name: "super_admin",
        },
        {
          id: OTHER,
          operator_name: "审计员",
          username: "auditor",
          role_name: "auditor",
        },
      ],
    }),
  );
  const listOperatorSessions = vi.fn(() => Promise.resolve(sessions));
  const idp = { listOperatorSessions } as unknown as OperatorAdminService;
  return {
    router: new OperatorSessionsRouter({ query } as unknown as Pool, idp),
    query,
    listOperatorSessions,
  };
}

describe("在线会话", () => {
  it("本人会话在列表里，并标出当前会话", async () => {
    const { router } = routerWith([
      session(SELF, SELF_SID, "2026-09-15T01:00:00.000Z"),
      session(SELF, "sid-self-other-device", "2026-09-15T00:00:00.000Z"),
      session(OTHER, "sid-other", "2026-09-15T02:00:00.000Z"),
    ]);
    const rows = await router.active(req);
    expect(rows).toHaveLength(3);
    const mine = rows.filter((row) => row.isSelf);
    expect(mine).toHaveLength(2);
    expect(mine.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(rows.find((row) => row.operatorId === OTHER)?.isSelf).toBe(false);
  });

  it("不下发 sid", async () => {
    const { router } = routerWith([
      session(SELF, SELF_SID, "2026-09-15T01:00:00.000Z"),
    ]);
    const [row] = await router.active(req);
    expect(JSON.stringify(row)).not.toContain(SELF_SID);
  });

  it("汇总：会话数与在线账号数", async () => {
    const { router } = routerWith([
      session(SELF, "a", "2026-09-15T01:00:00.000Z"),
      session(SELF, "b", "2026-09-15T01:00:00.000Z"),
      session(OTHER, "c", "2026-09-15T01:00:00.000Z"),
    ]);
    expect(await router.summary(req)).toEqual({
      activeSessions: 3,
      onlineOperators: 2,
    });
  });

  it("默认按登录时间倒序；排序白名单外的列 400", async () => {
    const { router } = routerWith([
      session(OTHER, "old", "2026-09-15T00:00:00.000Z"),
      session(SELF, "new", "2026-09-15T03:00:00.000Z"),
    ]);
    const rows = await router.active(req);
    expect(rows.map((row) => row.operatorId)).toEqual([SELF, OTHER]);
    await expect(router.active(req, "sessionRef")).rejects.toThrow();
  });

  it("没有 operator:session.read → 403，不问 IdP", async () => {
    const { router, listOperatorSessions } = routerWith([]);
    const denied = {
      ...req,
      capabilities: ["arche.plane"],
    } as unknown as Request & RequestContext;
    await expect(router.summary(denied)).rejects.toThrow();
    expect(listOperatorSessions).not.toHaveBeenCalled();
  });
});
