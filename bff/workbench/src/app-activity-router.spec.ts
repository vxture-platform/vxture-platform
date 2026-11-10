/**
 * Real HTTP activity ownership, workspace and same-origin authorization checks.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-10
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppActivityRouter } from "./app-activity-router";
import { SessionService } from "./auth/session-service";
import { ScopeService } from "./scope-service";
import { CatalogService } from "./catalog-service";
import { ACTIVITY_WRITE_POOL, CONFIG, PRIMARY_POOL } from "./tokens";
import { configureHttp } from "./bootstrap";
import { failure } from "./errors";

const ORIGIN = "https://ruyin.work";
const EVENT = "00000000-0000-4000-a000-000000000001";
const headers = {
  Origin: ORIGIN,
  "X-Workbench-Request": "1",
  "X-Workbench-Scope": "account:tenant:workspace",
  "Content-Type": "application/json",
  "Sec-Fetch-Site": "same-origin",
};
let app: INestApplication;
let base: string;
const write = vi.fn();
const reader = vi.fn();
const membership = vi.fn();
const subscriptions = vi.fn();

// ============================================================================
// Real Nest HTTP boundary; only external identity and database IO are synthetic.
// ============================================================================
beforeEach(async () => {
  write.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("max(occurred_at)"))
      return {
        rows: [
          {
            product_id: "product",
            last_used_at: new Date("2026-11-10T00:00:00Z"),
            launches: "3",
          },
        ],
      };
    if (sql.includes("select view")) return { rows: [{ view: "recent" }] };
    if (sql.includes("select product_id"))
      return { rows: [{ product_id: "product" }] };
    return { rows: [], rowCount: 1 };
  });
  reader.mockReset().mockResolvedValue({
    rows: [
      { id: "product", code: "allowed" },
      { id: "foreign", code: "foreign" },
    ],
  });
  membership.mockReset().mockResolvedValue(undefined);
  subscriptions
    .mockReset()
    .mockResolvedValue([
      { productCode: "allowed", status: "active", maintenance: null },
    ]);
  @Module({
    controllers: [AppActivityRouter],
    providers: [
      {
        provide: SessionService,
        useValue: {
          authenticate: async (req: Request) => {
            if (req.headers["x-test-deny"])
              throw failure(401, "LOGIN_REQUIRED", "Sign in");
            return {
              user: {
                userId: "account",
                activeOrg: "tenant",
                activeWorkspace: "workspace",
              },
            };
          },
        },
      },
      { provide: ScopeService, useValue: { assertCurrent: membership } },
      {
        provide: CatalogService,
        useValue: {
          subscriptions,
          entries: async () => [
            { code: "allowed", homeUrl: "https://example.com" },
          ],
        },
      },
      { provide: PRIMARY_POOL, useValue: { query: reader } },
      { provide: ACTIVITY_WRITE_POOL, useValue: { query: write } },
      { provide: CONFIG, useValue: { origin: ORIGIN } },
    ],
  })
  class FixtureModule {}
  app = await NestFactory.create(FixtureModule, { logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/me/app-activity`;
});
afterEach(async () => {
  await app.close();
});
const post = (path: string, body: unknown, extra = {}) =>
  fetch(`${base}/${path}`, {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });

describe("application activity HTTP authorization", () => {
  it("reads only verified account/workspace history and subscribed favorites", async () => {
    const response = await fetch(`${base}?userId=foreign&workspaceId=foreign`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      view: "recent",
      items: [
        {
          code: "allowed",
          favorite: true,
          lastUsedAt: "2026-11-10T00:00:00.000Z",
          launches30d: 3,
        },
      ],
    });
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("max(occurred_at)"),
      ["account", "tenant", "workspace"],
    );
  });
  it("writes explicit favorite state and ignores browser identity hints", async () => {
    expect(
      (await post("allowed/favorite", { favorite: true, userId: "foreign" }))
        .status,
    ).toBe(201);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("insert into account.user_product_favorites"),
      ["account", "product"],
    );
    expect((await post("allowed/favorite", { favorite: false })).status).toBe(
      201,
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("delete from account.user_product_favorites"),
      ["account", "product"],
    );
  });
  it("records a server-timed idempotent event in the verified scope", async () => {
    expect(
      (
        await post("allowed/launch", {
          eventId: EVENT,
          occurredAt: "2099-01-01",
        })
      ).status,
    ).toBe(201);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(
        "on conflict (user_id, tenant_id, workspace_id, event_id) do nothing",
      ),
      ["account", "tenant", "workspace", "product", EVENT],
    );
  });
  it("rejects cross-origin requests, changed workspaces and expired sessions before writing", async () => {
    for (const [extra, status] of [
      [{ Origin: "https://foreign.example" }, 403],
      [{ "Sec-Fetch-Site": "cross-site" }, 403],
      [{ "X-Workbench-Request": "" }, 403],
      [{ "X-Workbench-Scope": "tenant:other" }, 409],
      [{ "x-test-deny": "1" }, 401],
    ] as const)
      expect((await post("view", { view: "recent" }, extra)).status).toBe(
        status,
      );
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects missing membership, unsubscribed products and unavailable launches", async () => {
    expect((await post("foreign/favorite", { favorite: true })).status).toBe(
      403,
    );
    subscriptions.mockResolvedValue([
      { productCode: "allowed", status: "expired", maintenance: null },
    ]);
    expect((await post("allowed/launch", { eventId: EVENT })).status).toBe(403);
    expect((await post("allowed/favorite", { favorite: true })).status).toBe(
      201,
    );
    write.mockClear();
    membership.mockRejectedValue(
      failure(403, "FORBIDDEN", "Membership removed"),
    );
    expect((await post("allowed/favorite", { favorite: true })).status).toBe(
      403,
    );
    expect(write).not.toHaveBeenCalled();
  });
  it("validates action bodies and persists only supported views", async () => {
    for (const [path, body] of [
      ["view", { view: "combined" }],
      ["allowed/favorite", { favorite: "true" }],
      ["allowed/launch", { eventId: "bad" }],
      ["view", []],
    ] as const)
      expect((await post(path, body)).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect((await post("view", { view: "frequent" })).status).toBe(201);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("do update set view = excluded.view"),
      ["account", "tenant", "workspace", "frequent"],
    );
  });
});
