/**
 * Verify roster authorization and paging through real Nest HTTP and RS256/JWKS.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { VxConfigService } from "@vxture/core-config";
import {
  ProductSeatService,
  type ProductRosterPage,
} from "@vxture/service-subscription";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ProductRosterGuard } from "../authn/product-roster.guard";
import { S2sTokenVerifier } from "../authn/s2s-token-verifier.service";
import { PlatformProductRosterRouter } from "./platform-product-roster.router";

// ============================================================================
// Real transport/signatures; domain data is a controlled test double.
// ============================================================================
const ORG = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const SUBJECT = "usr_11111111-1111-4111-8111-111111111111";
const VERSION = "a".repeat(32);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const listAuthorizedUsers =
  vi.fn<(...args: unknown[]) => Promise<ProductRosterPage | null>>();
const config = { auth: { OIDC_ISSUER: "" }, platform: { AUTH_BFF_URL: "" } };
@Module({
  controllers: [PlatformProductRosterRouter],
  providers: [
    ProductRosterGuard,
    S2sTokenVerifier,
    { provide: VxConfigService, useValue: config },
    { provide: ProductSeatService, useValue: { listAuthorizedUsers } },
  ],
})
class TestModule {}

function token(overrides: Record<string, unknown> = {}) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "RS256", typ: "JWT", kid: "roster" })}.${encode(
    {
      iss: config.auth.OIDC_ISSUER,
      aud: "vxture",
      exp: now + 300,
      iat: now,
      act: { sub: "cospace" },
      mode: "service",
      scope: "tool:vxture",
      org_id: ORG,
      workspace_id: WS,
      ...overrides,
    },
  )}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}

// ============================================================================
// Ticket restrictions, isolation, revocation and failure behavior
// ============================================================================
describe("product roster signed HTTP", () => {
  let app: INestApplication;
  let jwks: Server;
  let base: string;
  beforeAll(async () => {
    jwks = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          keys: [
            {
              ...publicKey.export({ format: "jwk" }),
              kid: "roster",
              alg: "RS256",
              use: "sig",
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
    config.auth.OIDC_ISSUER = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}`;
    config.platform.AUTH_BFF_URL = config.auth.OIDC_ISSUER;
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      jwks.close((err) => (err ? reject(err) : resolve())),
    );
  });
  beforeEach(() => {
    listAuthorizedUsers.mockReset();
    listAuthorizedUsers.mockResolvedValue({
      version: VERSION,
      items: [{ subject: SUBJECT, displayName: "Manager" }],
      hasMore: false,
    });
  });
  function read(query = "", credential = token()) {
    return fetch(`${base}/platform/product-roster${query}`, {
      headers: { Authorization: `Bearer ${credential}` },
    });
  }
  it("returns a minimized live projection for a product service ticket", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      org_id: ORG,
      workspace_id: WS,
      product: "cospace",
      authorization_mode: "assigned_seats",
      version: VERSION,
      items: [{ subject: SUBJECT, display_name: "Manager", eligible: true }],
      nextCursor: null,
    });
    expect(listAuthorizedUsers).toHaveBeenCalledWith(
      { orgId: ORG, workspaceId: WS, productCode: "cospace" },
      null,
      100,
    );
  });
  it("allows a product manager's OBO ticket without platform membership administration", async () => {
    expect((await read("", token({ mode: "obo", sub: SUBJECT }))).status).toBe(
      200,
    );
    expect(listAuthorizedUsers).toHaveBeenCalledWith(
      {
        orgId: ORG,
        workspaceId: WS,
        productCode: "cospace",
        requesterSubject: SUBJECT,
      },
      null,
      100,
    );
  });
  it("rejects a removed OBO reader on the live authority read", async () => {
    listAuthorizedUsers.mockResolvedValue(null);
    const response = await read("", token({ mode: "obo", sub: SUBJECT }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "PRODUCT_ROSTER_ACCESS_DENIED",
      retryable: false,
    });
  });
  it.each([
    { aud: "cospace" },
    { scope: "provisioning:read" },
    { scope: "mgmt:vxture" },
    { delegated: true },
    { mode: "operator" },
    { mode: "unknown" },
    { org_id: null },
    { workspace_id: null },
    { mode: "obo" },
    { sub: SUBJECT },
    { act: { sub: "" } },
    { exp: null },
    { exp: 1 },
    { iss: "https://foreign.example" },
  ])("rejects a signed ticket with invalid authority %#", async (overrides) => {
    expect((await read("", token(overrides))).status).toBe(401);
    expect(listAuthorizedUsers).not.toHaveBeenCalled();
  });
  it.each([
    { org_id: "bad" },
    { workspace_id: "bad" },
    { mode: "obo", sub: "usr_1234567890" },
  ])("rejects malformed identity bindings %#", async (overrides) => {
    expect((await read("", token(overrides))).status).toBe(403);
    expect(listAuthorizedUsers).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { "x-vxture-internal-auth": "legacy" },
    { Cookie: "vx_session=fake" },
  ])("rejects unbound non-ticket credentials %#", async (headers) => {
    const response = await fetch(`${base}/platform/product-roster`, {
      headers,
    });
    expect(response.status).toBe(401);
    expect(listAuthorizedUsers).not.toHaveBeenCalled();
  });
  it("rejects a forged signature", async () => {
    expect(
      (await read("", token().split(".").slice(0, 2).join(".") + ".Zm9yZ2Vk"))
        .status,
    ).toBe(401);
    expect(listAuthorizedUsers).not.toHaveBeenCalled();
  });
  it.each([
    "workspace_id=x",
    "org_id=x",
    "product=x",
    "subject=x",
    "limit=0",
    "limit=201",
    "limit=-1",
    "limit=1.1",
    "limit=01",
    "limit=1&limit=2",
    "cursor=",
    "cursor=bad",
    "cursor=x&cursor=y",
  ])("rejects invalid query %s", async (query) => {
    expect((await read(`?${query}`)).status).toBe(400);
    expect(listAuthorizedUsers).not.toHaveBeenCalled();
  });
  it("paginates with the full live revision and only the cursor position", async () => {
    listAuthorizedUsers.mockResolvedValueOnce({
      version: VERSION,
      items: [{ subject: SUBJECT, displayName: null }],
      hasMore: true,
    });
    const first = (await (await read("?limit=1")).json()) as {
      nextCursor: string;
    };
    expect(first.nextCursor).toBeTruthy();
    expect((await read(`?limit=1&cursor=${first.nextCursor}`)).status).toBe(
      200,
    );
    expect(listAuthorizedUsers).toHaveBeenLastCalledWith(
      { orgId: ORG, workspaceId: WS, productCode: "cospace" },
      SUBJECT,
      1,
    );
  });
  it.each([{ org_id: WS }, { workspace_id: ORG }, { act: { sub: "another" } }])(
    "binds cursors to verified context %#",
    async (overrides) => {
      listAuthorizedUsers.mockResolvedValueOnce({
        version: VERSION,
        items: [{ subject: SUBJECT, displayName: null }],
        hasMore: true,
      });
      const first = (await (await read("?limit=1")).json()) as {
        nextCursor: string;
      };
      listAuthorizedUsers.mockClear();
      expect(
        (await read(`?cursor=${first.nextCursor}`, token(overrides))).status,
      ).toBe(400);
      expect(listAuthorizedUsers).not.toHaveBeenCalled();
    },
  );
  it("requires a restart when a seat or display name changes between pages", async () => {
    listAuthorizedUsers.mockResolvedValueOnce({
      version: VERSION,
      items: [{ subject: SUBJECT, displayName: null }],
      hasMore: true,
    });
    const first = (await (await read("?limit=1")).json()) as {
      nextCursor: string;
    };
    listAuthorizedUsers.mockResolvedValueOnce({
      version: "b".repeat(32),
      items: [],
      hasMore: false,
    });
    const response = await read(`?cursor=${first.nextCursor}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "PRODUCT_ROSTER_CHANGED",
      retryable: true,
    });
  });
  it("reports unavailable authority instead of an empty roster", async () => {
    listAuthorizedUsers.mockRejectedValueOnce(
      new Error("private database fault"),
    );
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "PRODUCT_ROSTER_UNAVAILABLE",
      message: "Authorized users could not be read. Retry the request.",
      retryable: true,
    });
  });
  it("preserves a successful empty roster", async () => {
    listAuthorizedUsers.mockResolvedValueOnce({
      version: VERSION,
      items: [],
      hasMore: false,
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [],
      nextCursor: null,
    });
  });
});
