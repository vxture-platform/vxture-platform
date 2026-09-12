/**
 * oidc-key.service.ts - OIDC asymmetric signing + JWKS
 * @package @vxture/bff-auth
 * @description
 *   RS256 signing for OIDC assets (id_token / access_token) and JWKS publication.
 *   RS256 signing for OIDC assets (id_token / access_token) + JWKS. See
 *   docs/design/identity-platform-idp.md §3/§5.
 *
 *   P0: the active key is loaded from config (OIDC_ACTIVE_KID + OIDC_SIGNING_PRIVATE_KEY).
 *   Rotation (next/active/retiring) and multi-key JWKS read appoidc.signing_keys —
 *   wired once SigningKeyRepository lands (P0-4). When no key is configured the
 *   service stays inert (isReady()===false) so the legacy path is unaffected.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { VxConfigService } from "@vxture/core-config";
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";

/** A signing public key in JWK form (RFC 7517) for the JWKS document. */
export type OidcJwk = {
  kty?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  kid: string;
  use: "sig";
  alg: string;
};

export interface OidcSignInput {
  /** the single-valued `aud` — the client_id this token is for */
  audience: string;
  /**
   * the `sub` — usr_<account.id> or opr_<admin.id>. Omit entirely for S2S
   * service-mode tokens (product_210 §3.1: "sub: 用户 id(OBO 模式)/缺省") —
   * there is no user to be the subject when no one is behind the call.
   */
  subject?: string;
  /** lifetime in seconds */
  expiresInSec: number;
  /** additional claims (must NOT include iss/aud/sub/exp/iat/jti) */
  claims?: Record<string, unknown>;
  /** explicit jti; generated if omitted */
  jwtid?: string;
}

/** 管理面令牌的 scope 前缀。供给面是 `tool:`，两者结构上不可互相通过守卫。 */
const MGMT_SCOPE_PREFIX = "mgmt:";

/**
 * 共同签发不变式 —— 声明为契约的 claim 组合，必须在签发处成立。
 *
 * ## 为什么要有这个函数
 *
 * Atlas 的 `OperatorAuthGuard` 同时校验 `scope=mgmt:atlas`、`realm=workforce`、
 * `userType=operator` 三者。那是对的——**对凭据的冗余验证是便宜的防御**，代价是
 * 一次字符串比较，覆盖的是一张错发的票摸到管理面。
 *
 * 但它因此依赖一条平台**从未明说**的性质：`mgmt:` 只会发给 workforce realm 的
 * operator。这条性质今天成立，成立的原因只是**没人写过让它不成立的代码**——三个
 * 字段恰好写在同一个对象字面量里（`token-exchange.service.ts` 的
 * `exchangeOperator`）。口头承认它没有意义：某次重构把它们拆开，唯一的症状是
 * Atlas 那边多放进去一张票，而平台这边一切正常（vxture-platform#14）。
 *
 * 所以「冗余校验是便宜的防御」这句话要补一半：**只有当被校验的几件事由同一处
 * 产生、且平台把共同签发声明为契约时，它才是便宜的**；否则消费方是在替平台铸造
 * 一条它自己都不知道的契约。
 *
 * ## 判据
 *
 * `scope` 以 `mgmt:` 打头 ⟹ `realm === "workforce"` 且 `userType === "operator"`。
 *
 * **只断言这一个方向。** 反向不成立：operator 的**会话**令牌也带
 * workforce/operator，而它的 scope 是客户端申请的那些（`openid profile …`），
 * 不带 `mgmt:`。断成双向会当场搞坏运营者登录——那是判据，不是遗漏。
 */
function assertCoIssuedClaims(claims: Record<string, unknown>): void {
  const scope = claims["scope"];
  if (typeof scope !== "string" || !scope.startsWith(MGMT_SCOPE_PREFIX)) return;
  const realm = claims["realm"];
  const userType = claims["userType"];
  if (realm !== "workforce" || userType !== "operator") {
    throw new Error(
      `co-issuance invariant violated: scope "${scope}" requires ` +
        `realm="workforce" + userType="operator", got ` +
        `realm=${JSON.stringify(realm)} userType=${JSON.stringify(userType)}. ` +
        `这是对外声明过的契约（《产品接入通则》C1 出站 · 共同签发），` +
        `消费方按它写了守卫。要解耦必须先改通则并通告，不能先改代码。`,
    );
  }
}

@Injectable()
export class OidcKeyService {
  private readonly logger = new Logger(OidcKeyService.name);

  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;
  private publicJwk: OidcJwk | null = null;
  private readonly kid: string | null;
  private readonly alg: "RS256" | "ES256";
  private readonly issuer: string;

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {
    const auth = this.config.auth;
    this.alg = auth.OIDC_ALGORITHM;
    this.issuer = auth.OIDC_ISSUER;
    this.kid = auth.OIDC_ACTIVE_KID ?? null;

    // Accept either a raw PEM or a base64-encoded PEM. The env loader is
    // line-based (no multi-line values), so base64 is the portable form for
    // .env files / secret managers; a literal PEM still works when passed via
    // a real (multi-line-capable) environment variable.
    const rawKey = auth.OIDC_SIGNING_PRIVATE_KEY;
    const pem =
      rawKey && !rawKey.includes("-----BEGIN")
        ? Buffer.from(rawKey, "base64").toString("utf8")
        : rawKey;
    if (this.kid && pem) {
      try {
        const keyObj = createPrivateKey(pem); // validates the PEM
        const publicKeyObj = createPublicKey(keyObj);
        const jwk = publicKeyObj.export({ format: "jwk" }) as object;
        this.privateKeyPem = pem;
        this.publicKeyPem = publicKeyObj
          .export({ format: "pem", type: "spki" })
          .toString();
        this.publicJwk = {
          ...jwk,
          kid: this.kid,
          use: "sig",
          alg: this.alg,
        } as OidcJwk;
        this.logger.log(
          `OIDC signing ready (alg=${this.alg}, kid=${this.kid})`,
        );
      } catch (e) {
        this.logger.error(
          `OIDC signing key load failed: ${(e as Error).message}`,
        );
        this.privateKeyPem = null;
        this.publicJwk = null;
      }
    } else {
      this.logger.warn(
        "OIDC signing not configured (OIDC_ACTIVE_KID / OIDC_SIGNING_PRIVATE_KEY absent); IdP issuance disabled.",
      );
    }
  }

  /** True when an active asymmetric signing key is loaded and OIDC issuance is possible. */
  isReady(): boolean {
    return this.privateKeyPem !== null && this.kid !== null;
  }

  /**
   * Sign an OIDC asset (id_token / access_token) with the active asymmetric key.
   * Sets the `kid` header and the iss/aud/sub/exp/iat/jti claims.
   *
   * 本方法是**本 IdP 所有令牌的唯一咽喉**，所以共同签发不变式钉在这里而不是钉在
   * 各个签发点上——钉在签发点只管得住今天写好的那几处，钉在这里连还没写的那些
   * 一起管住。
   */
  sign(payload: Record<string, unknown>, input: OidcSignInput): string {
    if (!this.privateKeyPem || !this.kid) {
      throw new Error("OIDC signing key not configured");
    }
    const claims = { ...(input.claims ?? {}), ...payload };
    assertCoIssuedClaims(claims);
    return this.jwt.sign(claims, {
      privateKey: this.privateKeyPem,
      algorithm: this.alg,
      keyid: this.kid,
      issuer: this.issuer,
      audience: input.audience,
      // Omit the option entirely (not `subject: undefined`) so no `sub`
      // claim is written — jsonwebtoken's SignOptions type requires a
      // string when the key is present at all.
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      expiresIn: input.expiresInSec,
      jwtid: input.jwtid ?? randomUUID(),
    });
  }

  /**
   * Verify an OIDC asset this IdP issued (e.g. at /userinfo or /revoke). Uses
   * the active public key with the asymmetric algorithm; rejects alg downgrade.
   * Throws on invalid signature / expiry / issuer. RP-side verification is via
   * JWKS, not this method.
   */
  verify(token: string): Record<string, unknown> {
    if (!this.publicKeyPem) {
      throw new Error("OIDC verification key not configured");
    }
    return this.jwt.verify(token, {
      publicKey: this.publicKeyPem,
      algorithms: [this.alg],
      issuer: this.issuer,
    }) as Record<string, unknown>;
  }

  /**
   * JWKS document. P0: the active key from config.
   * Rotation merges appoidc.signing_keys (status active/next/retiring) once
   * SigningKeyRepository is available (P0-4).
   */
  getJwks(): { keys: OidcJwk[] } {
    return { keys: this.publicJwk ? [this.publicJwk] : [] };
  }

  get activeKid(): string | null {
    return this.kid;
  }

  get algorithm(): "RS256" | "ES256" {
    return this.alg;
  }

  get oidcIssuer(): string {
    return this.issuer;
  }
}
