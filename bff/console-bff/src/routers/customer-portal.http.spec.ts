/**
 * Exercise the real Console HTTP capability gate and session tenant selection.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-15
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CapabilityGuard } from "../auth/capability";
import type { RequestContext } from "../types/console.types";
import { CustomerPortalRouter } from "./customer-portal.router";

// ============================================================================
// Only the test middleware stands in for the verified current identity.
// ============================================================================
const TENANT = "00000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "00000000-0000-4000-8000-000000000002";
const query = vi.fn(async (sql: string, values?: string[]) =>
  sql.includes("to_regclass")
    ? { rows: [{ ready: true }], rowCount: 1 }
    : { rows: [], rowCount: values?.[0] === TENANT && granted ? 1 : 0 },
);
let granted = false;
let manager = false;
let authenticated = false;

@Module({
  controllers: [CustomerPortalRouter],
  providers: [
    { provide: "COMMERCE_PG_POOL", useValue: { query } },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
class TestModule {}

describe("Console customer portal HTTP permissions", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(
      (req: Request & RequestContext, _res: Response, next: NextFunction) => {
        if (authenticated) {
          req.user = {
            id: OTHER_TENANT,
            name: "Manager",
            email: "",
            roleLabel: "",
            timezone: null,
          };
          req.tenant = {
            id: TENANT,
            name: "Institute",
            mode: "tenant",
            workspace: "Default",
            tenantType: "organization",
          } satisfies NonNullable<RequestContext["tenant"]>;
          req.capabilities = manager ? ["tenant.settings.manage"] : [];
        }
        next();
      },
    );
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/api/customer-portal`;
  });
  beforeEach(() => {
    authenticated = true;
    manager = true;
    granted = false;
    query.mockClear();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("checks the active session and manager capability before querying", async () => {
    authenticated = false;
    expect((await fetch(`${base}/availability`)).status).toBe(401);
    authenticated = true;
    manager = false;
    expect((await fetch(`${base}/availability`)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("shows availability only for the granted session organization", async () => {
    await expect((await fetch(`${base}/availability`)).json()).resolves.toEqual(
      { available: false },
    );
    granted = true;
    const response = await fetch(
      `${base}/availability?tenantId=${OTHER_TENANT}`,
    );
    await expect(response.json()).resolves.toEqual({ available: true });
    expect(query.mock.lastCall?.[1]).toEqual([TENANT]);
  });

  it("does not expose platform binding or publishing endpoints", async () => {
    expect((await fetch(`${base}/binding`, { method: "PUT" })).status).toBe(
      404,
    );
    expect(
      (await fetch(`${base}/versions/version/actions`, { method: "POST" }))
        .status,
    ).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
});
