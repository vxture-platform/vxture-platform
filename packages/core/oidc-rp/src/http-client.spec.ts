import { createSign, generateKeyPairSync, createPublicKey } from "node:crypto";
import { describe, it, expect } from "vitest";
import { HttpOidcRpClient } from "./http-client";
import type { OidcRpConfig } from "./types";

const ISSUER = "https://auth.test.local";
const KID = "test-kid-1";

// Generate a test RSA keypair (PEM); expose the public JWK for the stub JWKS.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const publicJwk = {
  ...(createPublicKey(publicKey).export({ format: "jwk" }) as object),
  kid: KID,
  use: "sig",
  alg: "RS256",
};

/** Sign a compact RS256 JWS with the test key. */
function signJws(claims: Record<string, unknown>): string {
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

// Injected fetch stubbing discovery + JWKS.
const stubFetch = (async (url: string | URL | Request) => {
  const u = url.toString();
  if (u.endsWith("/.well-known/openid-configuration")) {
    return new Response(
      JSON.stringify({
        authorization_endpoint: `${ISSUER}/oidc/authorize`,
        token_endpoint: `${ISSUER}/oidc/token`,
        jwks_uri: `${ISSUER}/oidc/jwks`,
        end_session_endpoint: `${ISSUER}/oidc/end_session`,
      }),
      { status: 200 },
    );
  }
  if (u.endsWith("/oidc/jwks")) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

function makeClient(): HttpOidcRpClient {
  const config: OidcRpConfig = {
    issuer: ISSUER,
    clientId: "console",
    clientSecret: "secret",
    redirectUri: "https://console.vxture.com/auth/callback",
    scopes: ["openid", "profile", "console"],
    sessionTtlSec: 3600,
  };
  return new HttpOidcRpClient(config, { fetchImpl: stubFetch });
}

const now = Math.floor(Date.now() / 1000);

describe("HttpOidcRpClient.buildAuthorizeUrl", () => {
  it("builds a PKCE S256 authorize URL with the configured client/scopes", () => {
    const url = new URL(
      makeClient().buildAuthorizeUrl({
        state: "st",
        nonce: "nc",
        codeChallenge: "ch",
        prompt: "none",
        tenantHint: "tn1",
      }),
    );
    expect(url.pathname).toBe("/oidc/authorize");
    expect(url.searchParams.get("client_id")).toBe("console");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile console");
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("tenant_hint")).toBe("tn1");
  });

  /**
   * 工作空间切换（owner 2026-09-09）。
   *
   * 这一条钉的是**参数名那个字面量**。两端各写一次：RP 这边 set("workspace_hint")，
   * IdP 那边读 `q.workspace_hint`——而 IdP 的 query 类型是
   * `Record<string, string | undefined>`，写错名字**照样编译通过**，症状是切换
   * 静默无效（永远落在默认工作空间），最难查。类型检查在这里帮不上忙，只能钉字面量。
   */
  it("带上 workspaceHint 时写出 workspace_hint 参数", () => {
    const url = new URL(
      makeClient().buildAuthorizeUrl({
        state: "st",
        nonce: "nc",
        codeChallenge: "ch",
        workspaceHint: "ws-7",
      }),
    );
    expect(url.searchParams.get("workspace_hint")).toBe("ws-7");
  });

  /* 反向对照：不给就不该出现这个参数。带一个空的 workspace_hint 会让 IdP 把
     「没指定」读成「指定了空字符串」。 */
  it("不给 workspaceHint 时不写这个参数", () => {
    const url = new URL(
      makeClient().buildAuthorizeUrl({
        state: "st",
        nonce: "nc",
        codeChallenge: "ch",
      }),
    );
    expect(url.searchParams.has("workspace_hint")).toBe(false);
  });
});

describe("HttpOidcRpClient.verifyIdToken / verifyAccessToken (JWKS round-trip)", () => {
  it("verifies a valid id_token and maps claims", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sub: "usr_1",
      sid: "sidA",
      exp: now + 300,
      nonce: "nc",
      auth_time: now,
      userType: "tenant_user",
    });
    const claims = await makeClient().verifyIdToken(token, "nc");
    expect(claims).toMatchObject({ sub: "usr_1", sid: "sidA", aud: "console" });
  });

  it("rejects a nonce mismatch", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sub: "u",
      exp: now + 300,
      nonce: "x",
    });
    await expect(makeClient().verifyIdToken(token, "y")).rejects.toThrow(
      /nonce/,
    );
  });

  it("rejects a wrong audience", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "ruyin",
      sub: "u",
      exp: now + 300,
    });
    await expect(makeClient().verifyAccessToken(token)).rejects.toThrow(/aud/);
  });

  it("rejects an expired token", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sub: "u",
      exp: now - 3600,
    });
    await expect(makeClient().verifyAccessToken(token)).rejects.toThrow(
      /expired/,
    );
  });

  it("rejects alg downgrade (none)", async () => {
    const enc = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const bad = `${enc({ alg: "none", kid: KID })}.${enc({ iss: ISSUER, aud: "console" })}.`;
    await expect(makeClient().verifyAccessToken(bad)).rejects.toThrow(/alg/);
  });

  it("rejects a token signed by an unknown key (bad signature)", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = { alg: "RS256", kid: KID };
    const enc = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const si = `${enc(header)}.${enc({ iss: ISSUER, aud: "console", exp: now + 300 })}`;
    const signer = createSign("RSA-SHA256");
    signer.update(si);
    signer.end();
    const forged = `${si}.${signer.sign(other.privateKey).toString("base64url")}`;
    await expect(makeClient().verifyAccessToken(forged)).rejects.toThrow(
      /signature/,
    );
  });
});

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

describe("HttpOidcRpClient.verifyLogoutToken", () => {
  it("verifies a valid back-channel logout_token and returns the sid", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sub: "usr_1",
      sid: "sidA",
      exp: now + 120,
      events: { [BACKCHANNEL_EVENT]: {} },
    });
    const out = await makeClient().verifyLogoutToken(token);
    expect(out).toEqual({ sid: "sidA", sub: "usr_1" });
  });

  it("rejects when the backchannel-logout event is missing", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sid: "sidA",
      exp: now + 120,
    });
    await expect(makeClient().verifyLogoutToken(token)).rejects.toThrow(
      /event/,
    );
  });

  it("rejects a logout_token carrying a nonce", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "console",
      sid: "sidA",
      exp: now + 120,
      nonce: "x",
      events: { [BACKCHANNEL_EVENT]: {} },
    });
    await expect(makeClient().verifyLogoutToken(token)).rejects.toThrow(
      /nonce/,
    );
  });

  it("rejects a wrong audience", async () => {
    const token = signJws({
      iss: ISSUER,
      aud: "ruyin",
      sid: "sidA",
      exp: now + 120,
      events: { [BACKCHANNEL_EVENT]: {} },
    });
    await expect(makeClient().verifyLogoutToken(token)).rejects.toThrow(/aud/);
  });
});
