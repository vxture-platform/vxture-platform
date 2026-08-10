import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import type { VxConfigService } from "@vxture/core-config";
import {
  INTERNAL_AUTH_HEADER,
  PLATFORM_S2S_AUDIENCE,
  PlatformAuthGuard,
} from "./platform-auth.guard";
import { S2sTokenVerifier } from "./s2s-token-verifier.service";

// Unit tests (T2, product_210 §3.5/§8): dual-accept guard for the platform-
// face C2/C3 self-service routers ONLY — legacy shared-secret path
// (unchanged behavior) + S2S Bearer path (aud=vxture, act.sub required,
// populates req.s2sCaller). Post-D13 the S2S path verifies against the IdP
// JWKS (stubbed global fetch here) instead of the in-process signing key.

const SHARED_SECRET = "shared-secret-value-32-bytes-min";
const ISSUER = "https://auth.test.local";
const KID = "guard-test-kid";

interface Signer {
  sign(
    payload: Record<string, unknown>,
    opts: { audience: string; subject?: string; expiresInSec: number },
  ): string;
  jwks: { keys: object[] };
}

function makeSigner(kid = KID): Signer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as object;
  return {
    jwks: { keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] },
    sign(payload, opts) {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: "RS256", typ: "JWT", kid };
      const claims = {
        ...payload,
        iss: ISSUER,
        aud: opts.audience,
        ...(opts.subject !== undefined ? { sub: opts.subject } : {}),
        iat: now,
        exp: now + opts.expiresInSec,
      };
      const enc = (o: object) =>
        Buffer.from(JSON.stringify(o)).toString("base64url");
      const signingInput = `${enc(header)}.${enc(claims)}`;
      const signer = createSign("RSA-SHA256");
      signer.update(signingInput);
      signer.end();
      const sig = signer.sign(privateKey).toString("base64url");
      return `${signingInput}.${sig}`;
    },
  };
}

function makeVerifier(): S2sTokenVerifier {
  const config = {
    auth: { OIDC_ISSUER: ISSUER },
    platform: { AUTH_BFF_URL: "http://vx-auth-bff:3061" },
  } as unknown as VxConfigService;
  return new S2sTokenVerifier(config);
}

function makeGuard(opts: {
  verifier?: S2sTokenVerifier;
  authInternalToken?: string | undefined;
}): PlatformAuthGuard {
  const config = {
    auth: { AUTH_INTERNAL_TOKEN: opts.authInternalToken },
  } as unknown as VxConfigService;
  return new PlatformAuthGuard(config, opts.verifier ?? makeVerifier());
}

/** Serve this signer's JWKS to the verifier's fetch. */
function stubJwks(signer: Signer): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => signer.jwks,
    })),
  );
}

interface FakeRequest {
  headers: Record<string, string>;
  s2sCaller?: unknown;
  header(name: string): string | undefined;
}

function fakeRequest(headers: Record<string, string> = {}): FakeRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: lower,
    header(name: string) {
      return lower[name.toLowerCase()];
    },
  };
}

function ctx(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlatformAuthGuard — legacy shared-secret path (unchanged)", () => {
  it("passes with a correct x-vxture-internal-auth header", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: SHARED_SECRET });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.s2sCaller).toBeUndefined();
  });

  it("rejects a wrong shared secret", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "wrong" });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("fails closed when AUTH_INTERNAL_TOKEN is unconfigured and no Bearer given", async () => {
    const guard = makeGuard({ authInternalToken: undefined });
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "anything" });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects when neither credential is presented", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    await expect(guard.canActivate(ctx(fakeRequest()))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("PlatformAuthGuard — S2S Bearer path (T2, JWKS-verified)", () => {
  let signer: Signer;
  beforeEach(() => {
    signer = makeSigner();
    stubJwks(signer);
  });

  it("passes a valid aud=vxture token and populates s2sCaller", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      {
        act: { sub: "arda" },
        org_id: "org-1",
        workspace_id: "ws-1",
        mode: "service",
      },
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: 300 },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.s2sCaller).toEqual({
      productCode: "arda",
      mode: "service",
      orgId: "org-1",
      workspaceId: "ws-1",
    });
  });

  it("passes an OBO token (sub present, mode=obo)", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      { act: { sub: "arda" }, org_id: null, workspace_id: "ws-9", mode: "obo" },
      {
        audience: PLATFORM_S2S_AUDIENCE,
        subject: "usr_123",
        expiresInSec: 300,
      },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.s2sCaller).toMatchObject({ productCode: "arda", mode: "obo" });
  });

  it("rejects a token with the wrong audience (a T1 product-to-product token, not aud=vxture)", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      { act: { sub: "arda" } },
      { audience: "runos", expiresInSec: 300 }, // real T1 grant, wrong target
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token with no act.sub claim", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      {},
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: 300 },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a garbage token", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const req = fakeRequest({ authorization: "Bearer not-a-real-jwt" });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an expired token", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      { act: { sub: "arda" } },
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: -3600 },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token signed under a different key (foreign issuer)", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const foreign = makeSigner(); // different RSA keypair, same kid — JWKS still serves the real key
    const token = foreign.sign(
      { act: { sub: "arda" } },
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: 300 },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token whose kid is absent from the JWKS (one refresh, then fail)", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const unknownKid = makeSigner("some-other-kid");
    const token = unknownKid.sign(
      { act: { sub: "arda" } },
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: 300 },
    );
    const req = fakeRequest({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("Bearer path takes precedence even when a legacy header is also present", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const token = signer.sign(
      { act: { sub: "arda" } },
      { audience: PLATFORM_S2S_AUDIENCE, expiresInSec: 300 },
    );
    // deliberately WRONG legacy header value — must not fall through to it
    const req = fakeRequest({
      authorization: `Bearer ${token}`,
      [INTERNAL_AUTH_HEADER]: "wrong-legacy-value",
    });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it("a Bearer token missing entirely falls through to the legacy check", async () => {
    const guard = makeGuard({ authInternalToken: SHARED_SECRET });
    const req = fakeRequest({
      authorization: "NotBearer something",
      [INTERNAL_AUTH_HEADER]: SHARED_SECRET,
    });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });
});
