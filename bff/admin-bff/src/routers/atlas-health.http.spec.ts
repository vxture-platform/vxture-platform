/**
 * Admin health projection admission and upstream delegation over real HTTP.
 * @package @vxture/bff-admin
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

const exchange = { getToken: vi.fn(async () => "atlas-management-ticket") };
let upstreamUrl = "";
@Module({
  controllers: [AtlasRouter],
  providers: [
    {
      provide: VxConfigService,
      useFactory: () => ({ platform: { ATLAS_API_URL: upstreamUrl } }),
    },
    { provide: OperatorExchangeService, useValue: exchange },
  ],
})
class HttpTestModule {}

// ============================================================================
// Synthetic session middleware; production guards are covered separately
// ============================================================================
describe("Admin health HTTP routes", () => {
  let app: INestApplication;
  let upstream: Server;
  let base: string;
  const calls: { url: string; auth: string | undefined }[] = [];
  beforeAll(async () => {
    upstream = createServer((req, res) => {
      calls.push({ url: req.url ?? "", auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url?.includes("events")
            ? { items: [], nextCursor: "opaque|cursor" }
            : {
                generatedAt: "now",
                models: [],
                routes: [],
                vendors: [],
                atlas: [],
              },
        ),
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
          user?: unknown;
          capabilities?: string[];
          operatorAccessToken?: string;
        },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.headers["x-test-session"]) {
          req.user = { id: "test-operator" };
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
    exchange.getToken.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  });
  const headers = {
    "x-test-session": "yes",
    "x-test-capabilities": "pricing:model.read",
  };
  it.each(["health", "health/events"])(
    "requires a session and the Admin read capability for %s",
    async (path) => {
      expect((await fetch(`${base}/api/atlas/${path}`)).status).toBe(401);
      expect(
        (
          await fetch(`${base}/api/atlas/${path}`, {
            headers: { "x-test-session": "yes" },
          })
        ).status,
      ).toBe(403);
      expect(calls).toHaveLength(0);
    },
  );
  it("encodes an opaque cursor and exchanges the current operator token server-side", async () => {
    const response = await fetch(
      `${base}/api/atlas/health/events?after=opaque%7Ccursor&limit=50`,
      { headers },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      nextCursor: "opaque|cursor",
    });
    expect(exchange.getToken).toHaveBeenCalledWith("operator-session", "atlas");
    expect(calls).toEqual([
      {
        url: "/capability/health/events?after=opaque%7Ccursor&limit=50",
        auth: "Bearer atlas-management-ticket",
      },
    ]);
  });
  it("rejects caller-supplied identity filters before making an upstream call", async () => {
    const response = await fetch(
      `${base}/api/atlas/health/events?workspace_id=other`,
      { headers },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "HEALTH_UNKNOWN_FILTER",
    );
    expect(calls).toHaveLength(0);
  });
  it("passes through the existing current-state snapshot", async () => {
    expect((await fetch(`${base}/api/atlas/health`, { headers })).status).toBe(
      200,
    );
    expect(calls[0]?.url).toBe("/capability/health");
  });
});
