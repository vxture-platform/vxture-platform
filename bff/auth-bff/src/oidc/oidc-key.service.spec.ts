import { generateKeyPairSync } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { describe, it, expect } from "vitest";
import { OidcKeyService } from "./oidc-key.service";

// Minimal fake of the auth config domain consumed by OidcKeyService.
type AuthCfg = {
  OIDC_ALGORITHM: "RS256" | "ES256";
  OIDC_ISSUER: string;
  OIDC_ACTIVE_KID?: string;
  OIDC_SIGNING_PRIVATE_KEY?: string;
};

function makeService(auth: AuthCfg): OidcKeyService {
  const config = { auth } as unknown as ConstructorParameters<
    typeof OidcKeyService
  >[0];
  return new OidcKeyService(config, new JwtService({}));
}

function rsaPrivatePem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return privateKey;
}

const ISSUER = "https://auth.test.local";

describe("OidcKeyService", () => {
  it("loads a PEM key, is ready, and publishes one JWKS key with the kid", () => {
    const svc = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "kid-1",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
    expect(svc.isReady()).toBe(true);
    const jwks = svc.getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kid: "kid-1",
      use: "sig",
      alg: "RS256",
      kty: "RSA",
    });
  });

  it("signs and self-verifies a token round-trip (iss/aud/sub/kid)", () => {
    const svc = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "kid-rt",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
    const token = svc.sign(
      { custom: "x" },
      { audience: "console", subject: "usr_1", expiresInSec: 300 },
    );
    // header carries the kid
    const header = JSON.parse(
      Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
    );
    expect(header).toMatchObject({ alg: "RS256", kid: "kid-rt" });

    const claims = svc.verify(token);
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: "console",
      sub: "usr_1",
      custom: "x",
    });
    expect(typeof claims.jti).toBe("string");
  });

  it("accepts a base64-encoded private key (line-based env loaders)", () => {
    const pem = rsaPrivatePem();
    const b64 = Buffer.from(pem, "utf8").toString("base64");
    const svc = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "kid-b64",
      OIDC_SIGNING_PRIVATE_KEY: b64,
    });
    expect(svc.isReady()).toBe(true);
    expect(svc.getJwks().keys[0]?.kid).toBe("kid-b64");
  });

  it("rejects a token signed under a different key", () => {
    const a = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "a",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
    const b = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "b",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
    const token = a.sign(
      {},
      { audience: "console", subject: "usr_1", expiresInSec: 300 },
    );
    expect(() => b.verify(token)).toThrow();
  });

  it("signs a token with no sub claim when subject is omitted (T1 service-mode)", () => {
    const svc = makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "kid-nosub",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
    const token = svc.sign(
      { act: { sub: "arda" } },
      { audience: "karda", expiresInSec: 300 },
    );
    const claims = svc.verify(token);
    expect(claims).toMatchObject({ iss: ISSUER, aud: "karda" });
    expect(claims.sub).toBeUndefined();
  });

  it("stays inert when no signing key is configured (legacy path unaffected)", () => {
    const svc = makeService({ OIDC_ALGORITHM: "RS256", OIDC_ISSUER: ISSUER });
    expect(svc.isReady()).toBe(false);
    expect(svc.getJwks().keys).toHaveLength(0);
    expect(() =>
      svc.sign({}, { audience: "x", subject: "y", expiresInSec: 1 }),
    ).toThrow();
  });
});

/**
 * 共同签发不变式（vxture-platform#14）。
 *
 * Atlas 的 `OperatorAuthGuard` 同时校验 `scope=mgmt:atlas` / `realm=workforce` /
 * `userType=operator`。这三条今天一起签发，而成立的原因只是**没人写过让它不成立
 * 的代码**——它们恰好在同一个对象字面量里。这组测试把那条隐式性质变成显式契约:
 * 拆开它的重构会在这里失败，而不是在 Atlas 那边表现为多放进去一张票。
 */
describe("共同签发不变式 · mgmt: ⟹ workforce + operator", () => {
  function ready(): OidcKeyService {
    return makeService({
      OIDC_ALGORITHM: "RS256",
      OIDC_ISSUER: ISSUER,
      OIDC_ACTIVE_KID: "k1",
      OIDC_SIGNING_PRIVATE_KEY: rsaPrivatePem(),
    });
  }

  it("三者齐全 → 正常签出", () => {
    const t = ready().sign(
      {
        mode: "operator",
        userType: "operator",
        realm: "workforce",
        scope: "mgmt:atlas",
      },
      { audience: "atlas", subject: "opr_1", expiresInSec: 60 },
    );
    expect(typeof t).toBe("string");
  });

  it.each([
    ["realm 被改掉", { realm: "customer", userType: "operator" }],
    ["userType 被改掉", { realm: "workforce", userType: "user" }],
    ["两者都缺", {}],
    ["realm 缺", { userType: "operator" }],
    ["userType 缺", { realm: "workforce" }],
  ])("%s → 抛，而不是签出一张 Atlas 会拒的票", (_name, extra) => {
    expect(() =>
      ready().sign(
        { scope: "mgmt:atlas", ...extra },
        { audience: "atlas", subject: "opr_1", expiresInSec: 60 },
      ),
    ).toThrow(/co-issuance invariant violated/);
  });

  /*
   * 反向**不成立**，这一条钉住它。operator 的会话令牌也带 workforce/operator，
   * 而它的 scope 是客户端申请的那些。把不变式写成双向会当场搞坏运营者登录——
   * 这正是「只断言成立的那个方向」的原因，不是遗漏。
   */
  it("会话令牌（workforce+operator 但 scope 不是 mgmt:）不受影响", () => {
    const t = ready().sign(
      {
        realm: "workforce",
        userType: "operator",
        scope: "openid profile admin",
      },
      { audience: "admin-console", subject: "opr_1", expiresInSec: 900 },
    );
    expect(typeof t).toBe("string");
  });

  it("供给面令牌（tool: 前缀、不带 realm/userType）不受影响", () => {
    const t = ready().sign(
      { act: { sub: "vxtpl" }, mode: "obo", scope: "tool:runos" },
      { audience: "runos", subject: "usr_1", expiresInSec: 60 },
    );
    expect(typeof t).toBe("string");
  });
});
