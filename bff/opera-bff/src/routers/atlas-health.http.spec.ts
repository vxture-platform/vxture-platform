/**
 * Monitoring settings permission boundaries and PATCH delegation over HTTP.
 * @package @vxture/bff-opera
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-20
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
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";

let upstreamUrl = "";
const exchange = { getToken: vi.fn(async () => "atlas-management-ticket") };
const pool = { query: vi.fn(async () => ({ rows: [] })) };
@Module({
  controllers: [AtlasRouter],
  providers: [
    {
      provide: VxConfigService,
      useFactory: () => ({ platform: { ATLAS_API_URL: upstreamUrl } }),
    },
    { provide: OperatorExchangeService, useValue: exchange },
    { provide: OPERA_BFF_RO_POOL, useValue: pool },
    { provide: OPERA_BFF_RW_POOL, useValue: pool },
  ],
})
class HttpTestModule {}

// ============================================================================
// Real route/body/query handling; session middleware supplies synthetic identity
// ============================================================================
describe("Opera monitoring settings HTTP routes", () => {
  let app: INestApplication;
  let upstream: Server;
  let base: string;
  const calls: { url: string; method: string; body: unknown }[] = [];
  beforeAll(async () => {
    upstream = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      calls.push({
        url: req.url ?? "",
        method: req.method ?? "",
        body: body ? JSON.parse(body) : null,
      });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          global: {},
          targets: [{ modelCode: "m" }],
          vendors: [{ providerCode: "p" }],
          overrides: [{ subjectKind: "model" }, { subjectKind: "provider" }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    app = await NestFactory.create(HttpTestModule, { logger: false });
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
  it("requires authentication and rejects a read without the matching permission", async () => {
    expect((await fetch(`${base}/api/atlas/health-settings`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/atlas/health-settings?kind=provider`, {
          headers: headers("model:model.read"),
        })
      ).status,
    ).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it.each(["model", "provider"])(
    "projects %s settings under its own read permission",
    async (kind) => {
      const response = await fetch(
        `${base}/api/atlas/health-settings?kind=${kind}`,
        { headers: headers(`model:${kind}.read`) },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.overrides).toEqual([{ subjectKind: kind }]);
      expect(body[kind === "provider" ? "targets" : "vendors"]).toEqual([]);
      expect(calls[0]?.url).toBe("/capability/health-settings");
    },
  );
  it("blocks writes with read-only or another subject's management permission", async () => {
    for (const cap of ["model:model.read", "model:provider.manage"]) {
      expect(
        (
          await fetch(`${base}/api/atlas/health-settings/model%3Am`, {
            method: "PATCH",
            headers: headers(cap),
            body: '{"probeEnabled":false}',
          })
        ).status,
      ).toBe(403);
    }
    expect(calls).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it("preserves explicit zero and null in the authorized PATCH", async () => {
    const body = { balanceMinAmount: 0, balancePollMinutes: null };
    const response = await fetch(
      `${base}/api/atlas/health-settings/provider%3Ap`,
      {
        method: "PATCH",
        headers: headers("model:provider.manage"),
        body: JSON.stringify(body),
      },
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        url: "/capability/health-settings/provider%3Ap",
        method: "PATCH",
        body,
      },
    ]);
  });
});
