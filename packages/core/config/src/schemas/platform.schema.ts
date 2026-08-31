/**
 * platform.schema.ts - Cross-service URLs and cookie domain schema
 * @package @vxture/core-config
 * @description
 *   Defines base URLs for each platform surface and cookie domain config.
 *   All fields have local-development defaults so services start without
 *   explicit config during local development.
 */

import { z } from "zod";

// ============================================================================
// Platform Schema
// ============================================================================

export const platformSchema = z.object({
  /** Website (marketing / end-user) base URL */
  WEBSITE_BASE_URL: z.string().url().default("http://localhost:3000"),
  /** Console (tenant admin) base URL */
  CONSOLE_BASE_URL: z.string().url().default("http://localhost:3020"),
  /** Admin (platform ops) base URL */
  ADMIN_BASE_URL: z.string().url().default("http://localhost:3030"),
  /**
   * Capability Console (OSS-side operator shell, product_250 M-4) base URL.
   * The public hostname is intentionally NOT recorded in the repo (hardening:
   * placeholder-only policy) — production injects it via runtime env.
   */
  OPERA_BASE_URL: z.string().url().default("http://localhost:3040"),
  /**
   * Arche (platform governance plane, operator shell) base URL. Highest-trust
   * operator surface: identity, RBAC, audit, compliance, config. The public
   * hostname is intentionally NOT recorded in the repo (placeholder-only
   * policy) — production injects it via runtime env.
   */
  ARCHE_BASE_URL: z.string().url().default("http://localhost:3050"),
  /**
   * Login / account UI base URL — the public identity surface that renders the
   * IdP interactive login page (accounts.vxture.com in prod; same-origin with
   * the OIDC endpoints there). The IdP redirects unauthenticated /authorize here
   * as `${LOGIN_UI_BASE_URL}/login?login_challenge&realm`. Dev: the standalone
   * accounts frontend port (3080; website 3000 / console 3020 / admin 3030 / opera 3040).
   * See docs/design/identity-platform-idp.md.
   */
  LOGIN_UI_BASE_URL: z.string().url().default("http://localhost:3080"),
  /** Atlas (AI model supply provider) internal S2S API base URL. */
  ATLAS_API_URL: z.string().url().default("http://localhost:3100"),
  /** Runos (capability platform) internal management API base URL. */
  RUNOS_API_URL: z.string().url().default("http://localhost:3120"),
  /** Auth BFF internal base URL (used by proxy BFFs to delegate auth operations) */
  AUTH_BFF_URL: z.string().url().default("http://localhost:3081"),
  /**
   * platform-api internal base URL (product_310 D13 host) — consumed by
   * proxy BFFs that resolve the C2 `/platform/entitlements` contract
   * (product_220 §3) server-to-server instead of re-deriving it from raw DB
   * queries. Container-internal only; nginx does not route /platform/*.
   */
  PLATFORM_API_URL: z.string().url().default("http://localhost:8080"),
  /** Varda agent-server internal base URL (used by varda-bff to proxy chat/confirm) */
  VARDA_SERVER_INTERNAL_URL: z.string().url().default("http://localhost:3091"),
  /** Ruyin product surface base URL (used for post-SSO redirects) */
  RUYIN_BASE_URL: z.string().url().default("http://localhost:3900"),
  /**
   * Cookie domain shared across platform surfaces (website / console / admin).
   * Omit for localhost development (browser ignores explicit localhost domain).
   * Example production value: ".vxture.com"
   */
  COOKIE_DOMAIN_PLATFORM: z.string().min(1).optional(),
  /**
   * Cookie domain for the Ruyin agent product surface.
   * Omit for localhost development.
   */
  COOKIE_DOMAIN_RUYIN: z.string().min(1).optional(),
});

export type PlatformConfig = z.infer<typeof platformSchema>;
