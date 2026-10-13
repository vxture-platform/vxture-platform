/**
 * Real HTTP credential isolation and product reconciliation regressions.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-10-12
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import { createSign, generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { ProvisioningReadGuard } from "../authn/provisioning-read.guard";
import { S2sTokenVerifier } from "../authn/s2s-token-verifier.service";
import { ProvisioningReadService } from "../platform/provisioning-read.service";
import { PlatformProvisioningService } from "../platform/platform-provisioning.service";
import { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
import type { ProvisioningReadPage } from "../types/provisioning-read.types";
import { PROVISIONING_READ_POOL } from "../providers/pg-pool.provider";
import { PlatformProvisioningReadRouter } from "./platform-provisioning-read.router";
import { PlatformProvisioningRouter } from "./platform-provisioning.router";

// ── Signed credentials and storage fixture ─────────────────────────────

const ISSUER = "https://auth.reconciliation.test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const nativeFetch = globalThis.fetch;
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const seed = () => [
  {
    product: "arda",
    id: id(1),
    workspace_id: id(101),
    tenant_id: id(201),
    state: "pending",
    seq: 0,
    created_at: "2026-10-12T01:02:03.123456Z",
    updated_at: "2026-10-12T01:02:03.123456Z",
  },
  {
    product: "arda",
    id: id(2),
    workspace_id: id(102),
    tenant_id: id(202),
    state: "provisioned",
    seq: 3,
    created_at: "2026-10-12T01:02:03.123456Z",
    updated_at: "2026-10-12T01:02:03.123456Z",
  },
  {
    product: "arda",
    id: id(3),
    workspace_id: id(103),
    tenant_id: id(203),
    state: "deprovisioned",
    seq: 7,
    created_at: "2026-10-12T01:02:03.123457Z",
    updated_at: "2026-10-12T01:02:03.123457Z",
  },
  {
    product: "other",
    id: id(4),
    workspace_id: id(104),
    tenant_id: id(204),
    state: "provisioned",
    seq: 9,
    created_at: "2026-10-12T01:02:03.123457Z",
    updated_at: "2026-10-12T01:02:03.123457Z",
  },
];
let facts = seed();
const pool = {
  query: vi.fn(
    async (
      _sql: string,
      [product, at, afterId, limit]: [
        string,
        string | null,
        string | null,
        number,
      ],
    ) => ({
      rows: facts
        .filter(
          (row) =>
            row.product === product &&
            (at === null ||
              row.created_at > at ||
              (row.created_at === at && row.id > afterId!)),
        )
        .sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit),
    }),
  ),
};
const config = {
  auth: { OIDC_ISSUER: ISSUER, AUTH_INTERNAL_TOKEN: "legacy-secret" },
  platform: { AUTH_BFF_URL: "http://auth.reconciliation.test" },
};

function ticket(
  overrides: Record<string, unknown> = {},
  omit: string[] = [],
  foreignKey = false,
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: ISSUER,
    aud: "vxture",
    iat: now,
    exp: now + 300,
    act: { sub: "arda" },
    mode: "service",
    scope: "provisioning:read",
    ...overrides,
  };
  for (const key of omit) delete claims[key];
  const enc = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const input = `${enc({ alg: "RS256", kid: "reconciliation" })}.${enc(claims)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  return `${input}.${sign.sign(foreignKey ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : privateKey).toString("base64url")}`;
}

// ── Real Nest routing and JWKS verification ────────────────────────────

@Module({
  controllers: [PlatformProvisioningReadRouter, PlatformProvisioningRouter],
  providers: [
    ProvisioningReadGuard,
    PlatformAuthGuard,
    S2sTokenVerifier,
    ProvisioningReadService,
    { provide: PROVISIONING_READ_POOL, useValue: pool },
    { provide: VxConfigService, useValue: config },
    {
      provide: PlatformProvisioningService,
      useValue: {
        resolveProductId: async () => id(301),
        recordAck: async () => ({
          ackedAt: "2026-10-12T01:00:00.000Z",
          replayed: false,
        }),
      },
    },
    { provide: LegacyAuthUsageService, useValue: { record: vi.fn() } },
  ],
})
class TestModule {}

describe("provisioning reconciliation HTTP", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input) === "http://auth.reconciliation.test/oidc/jwks") {
          return new Response(
            JSON.stringify({
              keys: [
                {
                  ...publicKey.export({ format: "jwk" }),
                  kid: "reconciliation",
                  alg: "RS256",
                  use: "sig",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return nativeFetch(input, init);
      },
    );
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    facts = seed();
    pool.query.mockClear();
  });
  const read = (token = ticket(), query = "") =>
    fetch(`${base}/platform/provisioning${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it("returns only its own product's retained states with no-store", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ProvisioningReadPage;
    expect(body.items.map((row: { state: string }) => row.state)).toEqual([
      "pending",
      "provisioned",
      "deprovisioned",
    ]);
    expect(body.items.map((row: { seq: number }) => row.seq)).toEqual([
      0, 3, 7,
    ]);
    expect(body.items[0]).not.toHaveProperty("product");
    expect(body.items[0]).not.toHaveProperty("id");
    expect(body.nextCursor).toBeNull();
    const other = (await (
      await read(ticket({ act: { sub: "other" } }))
    ).json()) as ProvisioningReadPage;
    expect(
      other.items.map((row: { workspace_id: string }) => row.workspace_id),
    ).toEqual([id(104)]);
  });

  it("returns a retryable storage error instead of an empty successful list", async () => {
    pool.query.mockRejectedValueOnce(new Error("database unavailable"));
    const res = await read();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: "PROVISIONING_READ_UNAVAILABLE",
      message: "Provisioning reconciliation is temporarily unavailable.",
      retryable: true,
    });
  });

  it("keeps pagination stable across ACK updates and converges on a new round", async () => {
    const first = (await (
      await read(ticket(), "?limit=1")
    ).json()) as ProvisioningReadPage;
    facts[0]!.updated_at = "2026-10-12T08:00:00.000000Z";
    facts[0]!.state = "deprovisioned";
    facts[0]!.seq = 8;
    const second = (await (
      await read(ticket(), `?limit=1&cursor=${first.nextCursor}`)
    ).json()) as ProvisioningReadPage;
    const third = (await (
      await read(ticket(), `?limit=1&cursor=${second.nextCursor}`)
    ).json()) as ProvisioningReadPage;
    expect(
      [...first.items, ...second.items, ...third.items].map(
        (row) => row.workspace_id,
      ),
    ).toEqual([id(101), id(102), id(103)]);
    expect(third.nextCursor).toBeNull();
    const nextRound = (await (await read()).json()) as ProvisioningReadPage;
    expect(nextRound.items[0]).toMatchObject({
      state: "deprovisioned",
      seq: 8,
    });
  });

  it("rejects a cursor from another product before reading storage", async () => {
    const first = (await (
      await read(ticket(), "?limit=1")
    ).json()) as ProvisioningReadPage;
    pool.query.mockClear();
    const res = await read(
      ticket({ act: { sub: "other" } }),
      `?cursor=${first.nextCursor}`,
    );
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    "?product=other",
    "?workspace_id=other",
    "?limit=1&limit=2",
    "?cursor=broken",
    "?limit=0",
  ])("denies invalid input %s", async (query) => {
    const res = await read(ticket(), query);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: expect.stringMatching(/^PROVISIONING_READ_/),
      message: expect.any(String),
      retryable: false,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    { scope: "tool:vxture", workspace_id: id(101), tenant_id: id(201) },
    { scope: "tool:vxture", delegated: true, act: { sub: "atlas" } },
    { scope: "mgmt:vxture", mode: "operator", sub: "opr_1" },
    { scope: "provisioning:read tool:vxture" },
    { aud: "arda" },
    { aud: ["vxture"] },
    { mode: "obo" },
    { sub: "usr_1" },
    { workspace_id: null },
    { org_id: null },
    { tenant_id: null },
    { delegated: false },
    { active_workspace: id(101) },
    { userType: "operator" },
    { act: { sub: "" } },
    { act: { sub: " arda" } },
    { act: ["arda"] },
    { exp: 1 },
    { exp: "never" },
    { iss: "https://foreign.test" },
  ])("denies incompatible signed claims %j", async (claims) => {
    const res = await read(ticket(claims));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "PROVISIONING_READ_TOKEN_INVALID",
      retryable: false,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("denies missing expiry, invalid signature, missing credentials and shared secret", async () => {
    for (const token of [
      ticket({}, ["exp"]),
      ticket({}, [], true),
      "broken.jwt.token",
    ])
      expect((await read(token)).status).toBe(401);
    for (const headers of [{}, { "x-vxture-internal-auth": "legacy-secret" }])
      expect(
        (await fetch(`${base}/platform/provisioning`, { headers })).status,
      ).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("denies discovery tickets on existing ACK while preserving workspace tickets", async () => {
    const ack = (token: string) =>
      fetch(`${base}/provisioning/ack`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspace_id: id(101),
          product: "arda",
          status: "ready",
        }),
      });
    expect((await ack(ticket())).status).toBe(401);
    expect(
      (
        await ack(
          ticket({
            scope: "tool:vxture",
            workspace_id: id(101),
            tenant_id: id(201),
          }),
        )
      ).status,
    ).toBe(201);
  });
});
