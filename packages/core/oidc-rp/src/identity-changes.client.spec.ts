/**
 * Signed invalidation rejection and bounded trusted-key recovery.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IdentityEventVerifier,
  parseIdentityChange,
} from "./identity-changes.client";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
  issuer: "https://accounts.test",
  clientId: "console",
  clientSecret: "test",
  redirectUri: "https://console.test/callback",
  scopes: ["openid"],
  sessionTtlSec: 600,
};
const scope = {
  issuer: config.issuer,
  clientId: "console",
  environment: "dev" as const,
};
const event = {
  schema_version: 1,
  type: "identity.access_changed",
  event_id: randomUUID(),
  occurred_at: new Date().toISOString(),
  issuer: scope.issuer,
  audience: "console",
  realm: "customer",
  environment: "dev",
  cursor: "opaque",
  version: "9007199254740993",
  subject: { sub: `usr_${randomUUID()}` },
  scope: { org_id: null, workspace_id: null, product_id: null },
};
function jwt(header: Record<string, unknown> = {}) {
  const head = Buffer.from(
    JSON.stringify({
      alg: "RS256",
      kid: "test",
      typ: "vxture-identity-event+jwt",
      ...header,
    }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: scope.issuer,
      aud: "console",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: randomUUID(),
      event,
    }),
  ).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), keys.privateKey).toString("base64url")}`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ============================================================================
// The verifier must preserve outages as retryable, including its cooldown window.
// ============================================================================
describe("changes-v1 typed signature verification", () => {
  it("accepts BigInt versions without precision loss and uses only the configured JWKS", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            keys: [
              {
                ...keys.publicKey.export({ format: "jwk" }),
                kid: "test",
                alg: "RS256",
                use: "sig",
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", request);
    expect(
      (await new IdentityEventVerifier(config, "dev").verify(jwt())).version,
    ).toBe("9007199254740993");
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://accounts.test/oidc/jwks",
    );
  });
  it("coalesces key outages and keeps retries unavailable throughout cooldown", async () => {
    const request = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", request);
    const verifier = new IdentityEventVerifier(config, "dev");
    const outcomes = await Promise.allSettled([
      verifier.verify(jwt()),
      verifier.verify(jwt()),
    ]);
    expect(
      outcomes.every(
        (r) =>
          r.status === "rejected" &&
          (r.reason as { unavailable: boolean }).unavailable,
      ),
    ).toBe(true);
    await expect(verifier.verify(jwt())).rejects.toMatchObject({
      unavailable: true,
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([
    { alg: "HS256" },
    { typ: "JWT" },
    { jku: "https://evil.test/keys" },
    { crit: ["unknown"] },
  ])(
    "rejects unsupported protected headers before fetching keys: %j",
    async (header) => {
      const request = vi.fn();
      vi.stubGlobal("fetch", request);
      await expect(
        new IdentityEventVerifier(config, "dev").verify(jwt(header)),
      ).rejects.toMatchObject({ unavailable: false });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects an invalid signature without persisting or treating it as an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              keys: [
                { ...keys.publicKey.export({ format: "jwk" }), kid: "test" },
              ],
            }),
          ),
      ),
    );
    const parts = jwt().split(".");
    parts[2] = Buffer.alloc(256).toString("base64url");
    await expect(
      new IdentityEventVerifier(config, "dev").verify(parts.join(".")),
    ).rejects.toMatchObject({ unavailable: false });
  });
  it.each(["0", "-1", "01", "9223372036854775808", "1e3"])(
    "rejects an invalid durable version %s",
    (version) => {
      expect(() => parseIdentityChange({ ...event, version }, scope)).toThrow();
    },
  );
});

// Explicit workforce scope cannot reuse customer subjects or context payloads.
it("isolates workforce access invalidations from customer context and subjects", () => {
  const workforce = {
    ...event,
    realm: "workforce",
    subject: { sub: `opr_${randomUUID()}` },
  };
  const binding = { ...scope, realm: "workforce" as const };
  expect(parseIdentityChange(workforce, binding).realm).toBe("workforce");
  expect(() => parseIdentityChange(workforce, scope)).toThrow();
  expect(() =>
    parseIdentityChange({ ...workforce, subject: event.subject }, binding),
  ).toThrow();
  expect(() =>
    parseIdentityChange(
      { ...workforce, scope: { ...event.scope, org_id: randomUUID() } },
      binding,
    ),
  ).toThrow();
  expect(() =>
    parseIdentityChange(
      {
        ...workforce,
        type: "session.context_changed",
        scope: undefined,
        subject: { ...workforce.subject, sid: randomUUID() },
      },
      binding,
    ),
  ).toThrow();
});
