/**
 * Real HTTP authorization, account isolation and CSRF regressions for inbox actions.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-06
 */
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { InboxRouter } from "./inbox-router";
import { SessionService } from "./auth/session-service";
import { CONFIG, INBOX_WRITE_POOL, PRIMARY_POOL } from "./tokens";
import { configureHttp } from "./bootstrap";
import { failure } from "./errors";

const MESSAGE = "00000000-0000-4000-a000-000000000001";
const ACCOUNT = "00000000-0000-4000-a000-000000000100";
const ORIGIN = "https://ruyin.work";
let app: INestApplication;
let base: string;
let written: boolean;
const query = vi.fn();
const writeQuery = vi.fn();
const headers = {
  Origin: ORIGIN,
  "X-Workbench-Request": "1",
  "Sec-Fetch-Site": "same-origin",
};

// ============================================================================
// Storage is synthetic; requests exercise the real controller and HTTP boundary.
// ============================================================================
beforeEach(async () => {
  written = false;
  query.mockReset();
  writeQuery.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("select count"))
      return { rows: [{ n: written ? "0" : "1" }] };
    if (sql.includes("select id"))
      return {
        rows: [
          {
            id: MESSAGE,
            title: "Your message",
            body: "Account-owned",
            link: "/billing",
            read_at: written ? new Date() : null,
            created_at: new Date("2026-11-06T01:00:00Z"),
          },
        ],
      };
    throw new Error("Read-only pool received a mutation");
  });
  writeQuery.mockImplementation(async (sql: string, values: string[]) => {
    if (!sql.startsWith("update support.inbox_messages set read_at ="))
      throw new Error("Writer received a query outside its permission scope");
    const owns =
      values.length === 1
        ? values[0] === ACCOUNT
        : values[0] === MESSAGE && values[1] === ACCOUNT;
    if (owns) written = true;
    return { rows: owns ? [{ id: MESSAGE }] : [], rowCount: owns ? 1 : 0 };
  });
  @Module({
    controllers: [InboxRouter],
    providers: [
      { provide: CONFIG, useValue: { origin: ORIGIN } },
      { provide: PRIMARY_POOL, useValue: { query } },
      { provide: INBOX_WRITE_POOL, useValue: { query: writeQuery } },
      {
        provide: SessionService,
        useValue: {
          authenticate: async (req: Request) => {
            if (req.headers["x-test-deny"])
              throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in");
            return { user: { userId: ACCOUNT } };
          },
        },
      },
    ],
  })
  class FixtureModule {}
  app = await NestFactory.create(FixtureModule, { logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.close();
});

describe("account inbox", () => {
  it("uses verified account ownership, ignoring browser user hints", async () => {
    const response = await fetch(`${base}/api/me/inbox?userId=someone-else`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unreadCount: 1,
      items: [{ id: MESSAGE, readAt: null }],
    });
    for (const [sql, values] of query.mock.calls) {
      expect(sql).toContain("account_id = $1");
      expect(sql).toContain("deleted_at is null");
      expect(values).toEqual([ACCOUNT]);
    }
    expect(written).toBe(false);
    expect(writeQuery).not.toHaveBeenCalled();
  });
  it("does not read or mutate without a session", async () => {
    for (const method of ["GET", "POST"]) {
      const path = method === "GET" ? "" : "/read-all";
      expect(
        (
          await fetch(`${base}/api/me/inbox${path}`, {
            method,
            headers: { ...headers, "X-Test-Deny": "1" },
          })
        ).status,
      ).toBe(401);
    }
    expect(query).not.toHaveBeenCalled();
    expect(writeQuery).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, absent-origin and missing request-header writes", async () => {
    for (const unsafe of [
      { ...headers, Origin: "https://evil.invalid" },
      { "X-Workbench-Request": "1" },
      { Origin: ORIGIN },
      { ...headers, "Sec-Fetch-Site": "same-site" },
    ]) {
      expect(
        (
          await fetch(`${base}/api/me/inbox/read-all`, {
            method: "POST",
            headers: unsafe,
          })
        ).status,
      ).toBe(403);
    }
    expect(query).not.toHaveBeenCalled();
    expect(writeQuery).not.toHaveBeenCalled();
  });
  it("marks only the authenticated recipient's non-deleted message read", async () => {
    const response = await fetch(`${base}/api/me/inbox/${MESSAGE}/read`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(201);
    expect(written).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(writeQuery).toHaveBeenCalledWith(
      expect.stringContaining("account_id = $2 and deleted_at is null"),
      [MESSAGE, ACCOUNT],
    );
    expect(
      (
        await fetch(
          `${base}/api/me/inbox/00000000-0000-4000-a000-000000000099/read`,
          { method: "POST", headers },
        )
      ).status,
    ).toBe(404);
  });
  it("rejects malformed IDs without touching storage", async () => {
    expect(
      (
        await fetch(`${base}/api/me/inbox/not-a-uuid/read`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(404);
    expect(query).not.toHaveBeenCalled();
    expect(writeQuery).not.toHaveBeenCalled();
  });
  it("acknowledges all unread messages only for the verified account", async () => {
    const response = await fetch(`${base}/api/me/inbox/read-all`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ updated: 1 });
    expect(query).not.toHaveBeenCalled();
    expect(writeQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "account_id = $1 and read_at is null and deleted_at is null",
      ),
      [ACCOUNT],
    );
  });
});
