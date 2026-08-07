/**
 * auth.schema.ts - Authentication configuration schema
 * @package @vxture/core-config
 * @description
 *   Zod schema for authentication (JWT) configuration
 *
 * @author AI-Generated
 * @date 2026-03-15
 */

import { z } from "zod";

// ============================================================================
// Auth Schema  (JWT + Session)
// ============================================================================

export const authSchema = z.object({
  /** Access token signing secret, must be ≥ 32 random characters in production */
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters for security"),

  /** Refresh token signing secret — must differ from JWT_SECRET to prevent cross-token forgery */
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters for security"),

  /** Access token expiration, supports vercel/ms format: 15m, 1h, 7d */
  JWT_ACCESS_EXPIRES_IN: z.string().default("8h"),

  /** Refresh token expiration */
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  /**
   * Refresh token blacklist storage backend
   * redis  — Recommended for production, supports active revocation
   * memory — Only for single-process testing, lost after restart
   */
  JWT_BLACKLIST_STORAGE: z.enum(["redis", "memory"]).default("redis"),

  /** BCRYPT password hash rounds, higher is safer but slower */
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),

  /**
   * Shared secret for internal service-to-service requests (X-Vxture-Internal-Auth header).
   * Required in production; defaults to a non-secret fallback for local development.
   */
  AUTH_INTERNAL_TOKEN: z.string().min(1).optional(),

  // ── OIDC IdP (P0; coexists with the HS256 path until P5) ──────────────────
  /** OIDC issuer — the public-facing auth origin used as the `iss` claim */
  OIDC_ISSUER: z.string().default("http://localhost:3090"),

  /** Asymmetric signing algorithm for OIDC assets (id_token / access_token) */
  OIDC_ALGORITHM: z.enum(["RS256", "ES256"]).default("RS256"),

  /** Active signing key id (JWT header `kid`); when absent, OIDC issuance is disabled */
  OIDC_ACTIVE_KID: z.string().optional(),

  /**
   * Active signing private key (PEM PKCS8). In production injected via secret manager;
   * public keys / historical kids are tracked in identity.signing_key for rotation.
   */
  OIDC_SIGNING_PRIVATE_KEY: z.string().optional(),

  /** access_token lifetime (seconds) */
  OIDC_ACCESS_TTL: z.coerce.number().int().positive().default(900),

  /** refresh_token lifetime (seconds) */
  OIDC_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),

  /**
   * 客户面（console / website）中央会话的**总时效**，秒。
   *
   * ── 闲置去哪了 ───────────────────────────────────────────────────────
   * 原先还有一个 `OIDC_SESSION_IDLE_TTL`，由 IdP 拿"空闲"的名义计时。**IdP 没有
   * 判断空闲所需的信息**：它看不见用户点击，只看得见换票，于是那个"空闲 TTL"实际
   * 退化成固定寿命——`min(idle, abs)` 恒等于 idle，`abs` 从未生效，配套的
   * `touchOidcSession` 又全仓零调用点，活跃用户照样被踢。
   *
   * 在场判断已移到门户：`@vxture/core-identity-sdk` 的 `startIdleWatcher`，由真实
   * 交互事件驱动，客户面阈值 4 小时（`IDLE_MS.customer`）。
   *
   * 总时效不因活动延长——这正是它存在的意义：给"一直有人点"的会话画一个终点。
   * 24 小时是 NIST 800-63B AAL2 的建议上限（owner 2026-08-07 定，workplans §二十三）。
   */
  OIDC_SESSION_ABS_TTL: z.coerce.number().int().positive().default(86400),

  /**
   * 运营面（admin / opera）中央会话的**总时效**，秒。
   *
   * **与 `OIDC_SESSION_ABS_TTL` 是两条独立的策略**，当前取值相同纯属巧合，不要合并
   * 成一个变量：运营面是高权限面，将来收紧总时效时只会动这一个。两者的差别今天体
   * 现在门户的闲置阈值上——运营面 30 分钟对客户面 4 小时（`IDLE_MS.workforce`）。
   *
   * 取 24 小时而不是原来的 8 小时：8 小时正好卡在一个工作日的长度上，必然切断正在
   * 干活的人，而 owner 的要求是连续工作不被打断（同上）。
   */
  OPERATOR_SESSION_ABS_TTL: z.coerce.number().int().positive().default(86400),

  /**
   * AES-256-GCM key for operator TOTP secrets at rest (admin.operator_mfa.totp_secret).
   * Derived to 32 bytes via SHA-256, so any ≥32-char random secret works. When
   * absent, operator TOTP enrollment/verification is unavailable (fail-closed) —
   * see identity-platform-operator.md §9.
   */
  OPERATOR_TOTP_ENC_KEY: z.string().min(32).optional(),

  // ── operator WebAuthn / Passkey (identity-platform-operator.md §2.1/§9) ────
  /** Relying Party ID = the registrable domain of the operator login surface. */
  OPERATOR_WEBAUTHN_RP_ID: z.string().optional(),
  /** Human-readable Relying Party name shown by the authenticator. */
  OPERATOR_WEBAUTHN_RP_NAME: z.string().default("Vxture"),
  /** Expected ceremony origin (exact scheme+host[+port]) for attestation/assertion. */
  OPERATOR_WEBAUTHN_ORIGIN: z.string().optional(),
});

export type AuthConfig = z.infer<typeof authSchema>;
