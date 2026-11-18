/**
 * Policy proxy permission, upstream conflict and audit behavior over HTTP.
 * @package @vxture/bff-opera
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-18
 */
import "reflect-metadata";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AtlasRouter } from "./atlas.router";
import { RunosRouter } from "./runos.router";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";

let upstreamUrl = "";
const exchange = { getToken: vi.fn(async () => "management-ticket") };
const pool = { query: vi.fn(async () => ({ rows: [] })) };
@Module({
  controllers: [AtlasRouter, RunosRouter],
  providers: [
    {
      provide: VxConfigService,
      useFactory: () => ({
        platform: { ATLAS_API_URL: upstreamUrl, RUNOS_API_URL: upstreamUrl },
      }),
    },
    { provide: OperatorExchangeService, useValue: exchange },
    { provide: OPERA_BFF_RO_POOL, useValue: pool },
    { provide: OPERA_BFF_RW_POOL, useValue: pool },
  ],
})
class PolicyHttpModule {}

// Real HTTP proxy and authorization boundary --------------------------------
describe("continuous grant policy proxy", () => {
  let app: INestApplication;
  let upstream: Server;
  let base: string;
  let upstreamStatus = 200;
  const calls: { url: string; method: string; body: unknown }[] = [];
  beforeAll(async () => {
    upstream = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      calls.push({
        url: req.url ?? "",
        method: req.method ?? "",
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(upstreamStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          upstreamStatus === 409
            ? {
                code: "GRANT_POLICY_REVISION_CONFLICT",
                message: "Changed",
                retryable: false,
              }
            : { revision: 1, rules: [] },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    app = await NestFactory.create(PolicyHttpModule, { logger: false });
    app.use(
      (
        req: {
          headers: Record<string, string>;
          operator?: unknown;
          capabilities?: string[];
          operatorAccessToken?: string;
        },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.headers["x-test-session"]) {
          req.operator = { id: "00000000-0000-4000-8000-000000000001" };
          req.operatorAccessToken = "operator-session";
        }
        req.capabilities = req.headers["x-test-capabilities"]?.split(",") ?? [];
        next();
      },
    );
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  beforeEach(() => {
    calls.length = 0;
    upstreamStatus = 200;
    pool.query.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  });
  const headers = (capability: string) => ({
    "content-type": "application/json",
    "x-test-session": "yes",
    "x-test-capabilities": capability,
  });
  for (const [kind, upstreamPrefix, readPermission, managePermission] of [
    ["atlas", "capability", "model:model.read", "model:model.manage"],
    ["runos", "commerce", "capability:runos.read", "capability:runos.manage"],
  ] as const) {
    it(`${kind} rejects unauthenticated and read-only writes before contacting upstream`, async () => {
      expect(
        (await fetch(`${base}/api/${kind}/grant-policies/yucer`)).status,
      ).toBe(401);
      for (const suffix of ["", "/preview"]) {
        expect(
          (
            await fetch(`${base}/api/${kind}/grant-policies/yucer${suffix}`, {
              method: "POST",
              headers: headers(readPermission),
              body: '{"expectedRevision":0,"rules":[]}',
            })
          ).status,
        ).toBe(403);
      }
      expect(calls).toHaveLength(0);
    });
    it(`${kind} delegates each read and draft preview without a write audit`, async () => {
      for (const suffix of ["", "/effective", "/history"]) {
        expect(
          (
            await fetch(`${base}/api/${kind}/grant-policies/yucer${suffix}`, {
              headers: headers(readPermission),
            })
          ).status,
        ).toBe(200);
      }
      const body = { expectedRevision: 0, rules: [] };
      expect(
        (
          await fetch(`${base}/api/${kind}/grant-policies/yucer/preview`, {
            method: "POST",
            headers: headers(managePermission),
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(200);
      expect(calls.map((call) => call.url)).toEqual(
        ["", "/effective", "/history", "/preview"].map(
          (suffix) =>
            `/${upstreamPrefix}/product-grant-policies/yucer${suffix}`,
        ),
      );
      expect(calls[3]?.body).toEqual(body);
      expect(pool.query).not.toHaveBeenCalled();
    });
    it(`${kind} saves through audit and preserves stale revision conflicts`, async () => {
      const body = { expectedRevision: 0, rules: [] };
      const init = {
        method: "POST",
        headers: headers(managePermission),
        body: JSON.stringify(body),
      };
      expect(
        (await fetch(`${base}/api/${kind}/grant-policies/yucer`, init)).status,
      ).toBe(200);
      expect(pool.query).toHaveBeenCalled();
      expect(calls[0]?.body).toEqual(body);
      upstreamStatus = 409;
      const response = await fetch(
        `${base}/api/${kind}/grant-policies/yucer`,
        init,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "GRANT_POLICY_REVISION_CONFLICT",
      });
    });
  }
});
