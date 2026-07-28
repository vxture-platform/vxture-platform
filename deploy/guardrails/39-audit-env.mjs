#!/usr/bin/env node
/**
 * audit-env.mjs - 部署环境变量归属审计脚本�?
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category guardrail
 * @description
 *   �?docs/deployment/01-environments.md 的分工检�?env 文件、Compose
 *   注入方式和旧变量残留，避免共享密钥、Turnstile、OAuth、Provider Key
 *   在错误服务之间重复配置�?
 *
 * @author AI-Generated
 * @date 2026-06-02
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// ============================================================================
// Constants
// ============================================================================

const ROOT = process.cwd();
const WORKER_DIR = process.env.VX_WORKER_DIR ?? "deploy";
const STRICT_RUNTIME = process.env.VX_ENV_AUDIT_STRICT_RUNTIME === "1";
const RUNTIME_DIR =
  process.env.VX_RUNTIME_DIR ??
  (STRICT_RUNTIME ? "/srv/vxture/runtime" : WORKER_DIR);
const SHOW_OK = process.env.VX_ENV_AUDIT_SHOW_OK === "1";
// CI (quality-gate) sets this to escalate deploy-bundle warnings to errors.
const FAIL_WARNINGS = process.env.VX_ENV_AUDIT_FAIL_WARNINGS === "1";

const SEVERITY_ORDER = new Map([
  ["error", 0],
  ["warning", 1],
]);

const SHARED_SECRET_KEYS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "AUTH_INTERNAL_TOKEN",
]);

const COMPOSE_ONLY_KEYS = new Set([
  "VX_IMAGE_REGISTRY",
  "VX_IMAGE_NAMESPACE",
  "VX_IMAGE_TAG",
]);

const TENANT_TURNSTILE_KEYS = new Set([
  "CF_TURNSTILE_TENANT_SECRET_KEY",
  "CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES",
]);

const ADMIN_TURNSTILE_KEYS = new Set([
  "CF_TURNSTILE_ADMIN_SECRET_KEY",
  "CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES",
]);

const FRONTEND_SITE_KEYS = new Set([
  "NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY",
  "NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_ID",
]);

const MAIL_KEYS = new Set([
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
]);

const OAUTH_KEYS = new Set([
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "DINGTALK_APP_KEY",
  "DINGTALK_APP_SECRET",
  "DINGTALK_REDIRECT_URI",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_REDIRECT_URI",
]);

// Confidential RP client-secret bcrypt hashes. They belong in .env.auth-bff (the
// seed projects them into appoidc.oidc_clients); the plaintext OIDC_CLIENT_SECRET
// belongs in each RP's env. Cross-placement is forbidden. Missing either side �?
// RP token exchange fails 401 invalid_client.
// Active platform RPs �?hashes are REQUIRED in .env.auth-bff.
const OIDC_CLIENT_SECRET_HASH_KEYS = new Set([
  "OIDC_CLIENT_SECRET_HASH_WEBSITE",
  "OIDC_CLIENT_SECRET_HASH_CONSOLE",
  "OIDC_CLIENT_SECRET_HASH_ADMIN",
  // umbra = cross-domain RP at ruyin.ai (ex-ruyin, product_300 §2; worker-04);
  // hash lives in .env.auth-bff (seed -> IdP DB), plaintext stays off-box.
  // See app-integration-standard §11.
  "OIDC_CLIENT_SECRET_HASH_UMBRA",
]);
// Future saas app RPs �?hashes documented in .env.auth-bff.example but NOT yet required
// in auth-bff (become required when Phase E deploys each RP). Already forbidden in all
// RP envs to prevent accidental misplacement.
const OIDC_FUTURE_APP_HASH_KEYS = new Set([
  // capconsole = Capability Console shell, second workforce RP (product_250 M-4
  // batch C); local RP on the deploy host like admin. Becomes REQUIRED (move to
  // OIDC_CLIENT_SECRET_HASH_KEYS) when the capconsole stack first deploys.
  "OIDC_CLIENT_SECRET_HASH_CAPCONSOLE",
  // ruyin = NEW client-side product surface (ruyin.vxture.com); provisioned when it ships.
  "OIDC_CLIENT_SECRET_HASH_RUYIN",
  "OIDC_CLIENT_SECRET_HASH_RUNA",
  "OIDC_CLIENT_SECRET_HASH_NOCUS",
  "OIDC_CLIENT_SECRET_HASH_ATLAS",
  "OIDC_CLIENT_SECRET_HASH_ONTOS",
  "OIDC_CLIENT_SECRET_HASH_RAVEN",
  "OIDC_CLIENT_SECRET_HASH_ANLAN",
  "OIDC_CLIENT_SECRET_HASH_FORGE",
  "OIDC_CLIENT_SECRET_HASH_XUANZHEN",
  "OIDC_CLIENT_SECRET_HASH_ARDA",
  // arda-beta is a separate confidential client (beta release channel)
  "OIDC_CLIENT_SECRET_HASH_ARDA_BETA",
  "OIDC_CLIENT_SECRET_HASH_KARDA",
  // karda-beta deferred (TD-001 in vxture-karda, no beta host yet); documented now.
  "OIDC_CLIENT_SECRET_HASH_KARDA_BETA",
]);

const LEGACY_BANNED_PATTERNS = [
  {
    id: "env/no-env-production-reference",
    pattern: /\.env\.production/u,
    paths: ["docs", `${WORKER_DIR}/scripts/12-generate-env-files.sh`],
    message: "Use platform.env + .env.<service>, not .env.production.",
  },
  {
    id: "env/no-jwt-access-secret",
    pattern: /JWT_ACCESS_SECRET/u,
    paths: ["docs", ".env.example", `${WORKER_DIR}`],
    message: "Use JWT_SECRET and JWT_REFRESH_SECRET.",
  },
  {
    id: "env/no-legacy-jwt-expiry",
    pattern: /JWT_(?:ACCESS|REFRESH)_EXPIRES=/u,
    paths: ["docs", ".env.example", `${WORKER_DIR}`],
    message: "Use JWT_ACCESS_EXPIRES_IN and JWT_REFRESH_EXPIRES_IN.",
  },
  {
    id: "env/no-dingtalk-callback-secret",
    pattern: /DINGTALK_CALLBACK_(?:TOKEN|AES_KEY)/u,
    paths: ["docs", ".env.example", `${WORKER_DIR}`],
    message:
      "DingTalk event callback secrets are not part of current OAuth login env.",
  },
  {
    id: "env/no-legacy-auth-host",
    pattern: /https:\/\/auth\.vxture\.com\/oauth/u,
    paths: ["docs", ".env.example", `${WORKER_DIR}`],
    message:
      "OAuth callbacks must use https://accounts.vxture.com/auth/oauth/<provider>/callback.",
  },
  {
    id: "env/no-root-auth-api-host",
    pattern: /https:\/\/vxture\.com\/auth-api/u,
    paths: ["docs", ".env.example", `${WORKER_DIR}`],
    message:
      "OAuth callbacks must use https://accounts.vxture.com/auth/oauth/<provider>/callback.",
  },
];

const ENV_FILE_RULES = [
  {
    label: "root local env",
    actual: ".env.local",
    example: ".env.example",
    requiredActual: false,
    requiredExample: true,
    strictPlaceholders: false,
  },
  {
    label: "worker compose env",
    actual: `${RUNTIME_DIR}/.env`,
    example: `${WORKER_DIR}/.env.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    allowedKeys: COMPOSE_ONLY_KEYS,
    exactKeyOrder: false,
  },
  {
    label: "worker platform shared secrets",
    actual: `${RUNTIME_DIR}/secrets/platform.env`,
    example: `${WORKER_DIR}/secrets/platform.env.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    allowedKeys: new Set(SHARED_SECRET_KEYS),
    requiredKeys: SHARED_SECRET_KEYS,
  },
  {
    label: "worker platform mail secrets",
    actual: `${RUNTIME_DIR}/secrets/platform-mail.env`,
    example: `${WORKER_DIR}/secrets/platform-mail.env.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    allowedKeys: MAIL_KEYS,
    requiredKeys: MAIL_KEYS,
  },
  {
    label: "auth-bff env",
    actual: `${RUNTIME_DIR}/.env.auth-bff`,
    example: `${WORKER_DIR}/.env.auth-bff.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    // Optional keys: empty does not block the deploy.
    // - Operator-MFA secrets: fail-closed feature flags provisioned separately.
    // - OPERATOR_SUPERADMIN_PASSWORD_HASH: deploy-time optional; seed-time
    //   REQUIRED in production (23/29 gate + db-init preflight, 2026-07-21 —
    //   the Admin@2026 default is public).
    // - BETA_BASE_URL variants: empty = beta app not yet deployed; the IdP seed
    //   omits the beta redirect_uri when the value is unset.
    // - OIDC_FUTURE_APP_HASH_KEYS: saas app RP hashes documented for tracking
    //   but not yet required until each RP is deployed (Phase E per app).
    placeholderOptionalKeys: new Set([
      "OPERATOR_TOTP_ENC_KEY",
      "OPERATOR_SUPERADMIN_PASSWORD_HASH",
      // superadmin contact: optional seed projection (empty = keep DB values)
      "OPERATOR_SUPERADMIN_EMAIL",
      "OPERATOR_SUPERADMIN_PHONE",
      // beta base URLs (optional until beta deployment is live)
      "RUYIN_BETA_BASE_URL",
      "RUNA_BETA_BASE_URL",
      "NOCUS_BETA_BASE_URL",
      "ATLAS_BETA_BASE_URL",
      "ONTOS_BETA_BASE_URL",
      "RAVEN_BETA_BASE_URL",
      "ANLAN_BETA_BASE_URL",
      "FORGE_BETA_BASE_URL",
      "XUANZHEN_BETA_BASE_URL",
      "ARDA_BETA_BASE_URL",
      // tailnet webhook delivery target (product_230 §3.1): empty = seed falls
      // back to ARDA_BASE_URL (public edge) — never blocks deploy
      "ARDA_WEBHOOK_BASE_URL",
      // beta client hash rides the beta deployment (empty until then)
      "OIDC_CLIENT_SECRET_HASH_ARDA_BETA",
      // karda beta base URL — deferred, no beta host assigned yet (TD-001)
      "KARDA_BETA_BASE_URL",
      "OIDC_CLIENT_SECRET_HASH_KARDA_BETA",
      // tailnet webhook delivery target — same pattern as ARDA_WEBHOOK_BASE_URL
      "KARDA_WEBHOOK_BASE_URL",
      // future saas app RP hashes (required when each RP goes live)
      ...OIDC_FUTURE_APP_HASH_KEYS,
    ]),
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      ...FRONTEND_SITE_KEYS,
      ...MAIL_KEYS,
      // plaintext RP secret belongs in each RP's env, not the IdP's.
      "OIDC_CLIENT_SECRET",
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "AUTH_BFF_PORT",
      "AUTH_COOKIE_DOMAIN",
      "COOKIE_DOMAIN_PLATFORM",
      // OIDC issuer + interactive login/redirect surface (both accounts.vxture.com);
      // missing/wrong �?discovery, all OIDC, social redirect host + bind-phone
      // redirect all break. Previously unlisted �?a stale env silently passed.
      "OIDC_ISSUER",
      "LOGIN_UI_BASE_URL",
      // portal base URLs feed OAuth allowlists + email redirects + the seed's
      // oidc_client redirect_uris. UMBRA_BASE_URL drives umbra's redirect_uri
      // (cross-domain, ruyin.ai); RUYIN_BASE_URL now names the NEW client-side
      // surface (ruyin.vxture.com). Missing -> localhost default -> 400
      // invalid_redirect_uri.
      "WEBSITE_BASE_URL",
      "CONSOLE_BASE_URL",
      "ADMIN_BASE_URL",
      "UMBRA_BASE_URL",
      "RUYIN_BASE_URL",
      "CF_TURNSTILE_ENABLED",
      // auth-bff (IdP) verifies BOTH tenant and operator (admin-surface)
      // Turnstile via OperatorLoginGuard; admin-bff is RP-only and verifies none.
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...OAUTH_KEYS,
      // bcrypt hashes the seed projects into appoidc.oidc_clients; missing �?401.
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
    ]),
  },
  {
    label: "website-bff env",
    actual: `${RUNTIME_DIR}/.env.website-bff`,
    example: `${WORKER_DIR}/.env.website-bff.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
      // bcrypt hash belongs in IdP env (.env.auth-bff), not the RP's.
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
      ...OIDC_FUTURE_APP_HASH_KEYS,
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "WEBSITE_BFF_PORT",
      "AUTH_BFF_URL",
      "OIDC_ISSUER",
      // this RP's own public origin; redirect_uri is derived from it. Missing �?
      // localhost schema default �?IdP authorize 400 invalid_redirect_uri.
      "WEBSITE_BASE_URL",
      // confidential RP secret presented at the IdP token endpoint; missing �?
      // 401 invalid_client. Provisioned by scripts/27-provision-client-secrets.sh.
      "OIDC_CLIENT_SECRET",
    ]),
  },
  {
    label: "console-bff env",
    actual: `${RUNTIME_DIR}/.env.console-bff`,
    example: `${WORKER_DIR}/.env.console-bff.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
      // bcrypt hash belongs in IdP env (.env.auth-bff), not the RP's.
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
      ...OIDC_FUTURE_APP_HASH_KEYS,
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "CONSOLE_BFF_PORT",
      "AUTH_BFF_URL",
      "OIDC_ISSUER",
      // this RP's own public origin; redirect_uri is derived from it. Missing �?
      // localhost schema default �?IdP authorize 400 invalid_redirect_uri.
      "CONSOLE_BASE_URL",
      // confidential RP secret presented at the IdP token endpoint; missing �?
      // 401 invalid_client. Provisioned by scripts/27-provision-client-secrets.sh.
      "OIDC_CLIENT_SECRET",
    ]),
  },
  {
    label: "admin-bff env",
    actual: `${RUNTIME_DIR}/.env.admin-bff`,
    example: `${WORKER_DIR}/.env.admin-bff.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      // admin-bff is RP-only (Batch 8): operator login + its Turnstile moved to
      // the IdP (auth-bff). admin-bff verifies no Turnstile.
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
      // bcrypt hash belongs in IdP env (.env.auth-bff), not the RP's.
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
      ...OIDC_FUTURE_APP_HASH_KEYS,
      // moved to platform-api with the provisioning dispatcher (D13).
      "ARDA_PROVISION_WEBHOOK_SECRET",
      "KARDA_PROVISION_WEBHOOK_SECRET",
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "ADMIN_BFF_PORT",
      "AUTH_BFF_URL",
      "OIDC_ISSUER",
      // this RP's own public origin; redirect_uri is derived from it. Missing �?
      // localhost schema default �?IdP authorize 400 invalid_redirect_uri.
      "ADMIN_BASE_URL",
      // confidential RP secret presented at the IdP token endpoint; missing �?
      // 401 invalid_client. Provisioned by scripts/27-provision-client-secrets.sh.
      "OIDC_CLIENT_SECRET",
    ]),
  },
  {
    // Capability Console shell BFF (product_250 M-4 batch C) — second workforce
    // RP, same RP-only posture as admin-bff. requiredActual stays false until
    // the capconsole stack first deploys (then flip to STRICT_RUNTIME so a
    // missing env fails closed like the other services).
    label: "capconsole-bff env",
    actual: `${RUNTIME_DIR}/.env.capconsole-bff`,
    example: `${WORKER_DIR}/.env.capconsole-bff.example`,
    requiredActual: false,
    requiredExample: true,
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
      // bcrypt hash belongs in IdP env (.env.auth-bff), not the RP's.
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
      ...OIDC_FUTURE_APP_HASH_KEYS,
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "CAPCONSOLE_BFF_PORT",
      "AUTH_BFF_URL",
      "OIDC_ISSUER",
      // this RP's own public origin (the real hostname lives ONLY in runtime
      // env — the repo carries the x.vxture.com placeholder by hardening policy).
      "CAPCONSOLE_BASE_URL",
      // confidential RP secret presented at the IdP token endpoint; missing →
      // 401 invalid_client. Provisioned by scripts/27-provision-client-secrets.sh.
      "OIDC_CLIENT_SECRET",
    ]),
  },
  {
    label: "platform-api env",
    actual: `${RUNTIME_DIR}/.env.platform-api`,
    example: `${WORKER_DIR}/.env.platform-api.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    // Webhook signing degrades to retry/dead-letter when unset — never blocks deploy.
    placeholderOptionalKeys: new Set([
      "ARDA_PROVISION_WEBHOOK_SECRET",
      "KARDA_PROVISION_WEBHOOK_SECRET",
    ]),
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      // S2S-only host: no browser traffic, no RP identity, no Turnstile,
      // no OAuth, no mail — and never the IdP signing key material.
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
      ...OIDC_CLIENT_SECRET_HASH_KEYS,
      ...OIDC_FUTURE_APP_HASH_KEYS,
      "OIDC_CLIENT_SECRET",
      // D13 credential separation: the signing private key stays in auth-bff;
      // this host verifies S2S bearers via the IdP JWKS only.
      "OIDC_SIGNING_PRIVATE_KEY",
      "OIDC_ACTIVE_KID",
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "PLATFORM_API_PORT",
      // JWKS back-channel for S2S bearer verification.
      "AUTH_BFF_URL",
      // expected `iss` of IdP-minted S2S tokens.
      "OIDC_ISSUER",
    ]),
  },
  {
    label: "model-platform env",
    actual: `${RUNTIME_DIR}/.env.model-platform`,
    example: `${WORKER_DIR}/.env.model-platform.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    forbiddenKeys: new Set([
      "REDIS_URL",
      "REDIS_PASSWORD",
      "JWT_SECRET",
      "JWT_REFRESH_SECRET",
      "AUTH_INTERNAL_TOKEN",
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "MODEL_PLATFORM_PORT",
      "DOUBAO_API_KEY",
    ]),
  },
  {
    label: "gateway-bff env",
    actual: `${RUNTIME_DIR}/.env.gateway-bff`,
    example: `${WORKER_DIR}/.env.gateway-bff.example`,
    requiredActual: STRICT_RUNTIME,
    requiredExample: true,
    forbiddenKeys: new Set([
      ...SHARED_SECRET_KEYS,
      "REDIS_PASSWORD",
      "CF_TURNSTILE_ENABLED",
      ...TENANT_TURNSTILE_KEYS,
      ...ADMIN_TURNSTILE_KEYS,
      ...FRONTEND_SITE_KEYS,
      ...OAUTH_KEYS,
      ...MAIL_KEYS,
    ]),
    requiredKeys: new Set([
      "NODE_ENV",
      "GATEWAY_PORT",
      "WEBSITE_BFF_ORIGIN",
      "CONSOLE_BFF_ORIGIN",
      "ADMIN_BFF_ORIGIN",
      "AUTH_BFF_ORIGIN",
      "GATEWAY_ALLOWED_ORIGINS",
    ]),
  },
];

const RUNTIME_SECRET_FILE_RULES = [
  {
    label: "Postgres raw password",
    path: `${RUNTIME_DIR}/secrets/pg-password`,
  },
  {
    label: "Redis raw password",
    path: `${RUNTIME_DIR}/secrets/redis-password`,
  },
];

const DEPLOY_BUNDLE_REAL_RUNTIME_FILES = [
  ".env",
  ".env.auth-bff",
  ".env.gateway-bff",
  ".env.website-bff",
  ".env.console-bff",
  ".env.admin-bff",
  ".env.platform-api",
  ".env.model-platform",
  "secrets/platform.env",
  "secrets/platform-mail.env",
  "secrets/platform-sms.env",
  "secrets/platform-identity.env",
  "secrets/pg-password",
  "secrets/redis-password",
];

const COMPOSE_SNIPPETS = [
  {
    service: "redis",
    snippet: "secrets: [platform_redis_password]",
  },
  {
    service: "platform_redis_password",
    snippet: "file: /srv/vxture/runtime/secrets/redis-password",
  },
  {
    service: "auth-bff",
    snippet: "/srv/vxture/runtime/.env.auth-bff",
  },
  {
    service: "website-bff",
    snippet: "/srv/vxture/runtime/.env.website-bff",
  },
  {
    service: "console-bff",
    snippet: "/srv/vxture/runtime/.env.console-bff",
  },
  {
    service: "admin-bff",
    snippet: "/srv/vxture/runtime/.env.admin-bff",
  },
  {
    service: "platform-api",
    snippet: "/srv/vxture/runtime/.env.platform-api",
  },
  {
    service: "model-platform",
    snippet: "/srv/vxture/runtime/.env.model-platform",
  },
  {
    service: "gateway-bff",
    snippet: "/srv/vxture/runtime/.env.gateway-bff",
  },
];

const GENERATE_ENV_REQUIRED_GLOBAL_TOKENS = [
  "sync_env_from_example",
  "ensure_plain_secret_file",
  ".env.example",
  ".env.auth-bff.example",
  ".env.website-bff.example",
  ".env.console-bff.example",
  ".env.admin-bff.example",
  ".env.platform-api.example",
  ".env.model-platform.example",
  ".env.gateway-bff.example",
  "secrets/platform.env.example",
  "secrets/platform-mail.env",
  "secrets/platform-sms.env",
  "secrets/platform-identity.env",
  "CHANGEME",
  "已废弃待删除",
];

const GENERATE_ENV_FORBIDDEN_TOKENS = [
  "openssl rand",
  "file_get_or_generate",
  "env_get_or_generate",
  "legacy_service_env_get",
  "write_platform_env",
  'write_env "$PLATFORM_DIR/.env.auth-bff"',
];

// ============================================================================
// Types
// ============================================================================

/**
 * @typedef {object} EnvRecord
 * @property {string} key
 * @property {string} value
 * @property {number} line
 */

/**
 * @typedef {object} ParsedEnv
 * @property {string} relativePath
 * @property {boolean} exists
 * @property {EnvRecord[]} records
 * @property {Map<string, EnvRecord[]>} byKey
 */

// ============================================================================
// Helpers
// ============================================================================

/**
 * 将仓库相对路径转换为绝对路径�?
 *
 * @param {string} relativePath - 仓库相对路径�?
 * @returns {string} 绝对路径�?
 */
function absolute(relativePath) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(ROOT, relativePath);
}

/**
 * 读取文本文件；不存在时返回空字符串�?
 *
 * @param {string} relativePath - 仓库相对路径�?
 * @returns {string} 文件内容�?
 */
function readText(relativePath) {
  const filePath = absolute(relativePath);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

/**
 * 解析 env 文件。只保留 key 和行号，输出时不会泄露真实值�?
 *
 * @param {string} relativePath - 仓库相对路径�?
 * @returns {ParsedEnv} 解析结果�?
 */
function parseEnvFile(relativePath) {
  const filePath = absolute(relativePath);
  if (!existsSync(filePath)) {
    return {
      relativePath,
      exists: false,
      records: [],
      byKey: new Map(),
    };
  }

  const records = [];
  const byKey = new Map();
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) {
      continue;
    }

    const record = {
      key: match[1],
      value: match[2],
      line: index + 1,
    };
    records.push(record);

    const existing = byKey.get(record.key) ?? [];
    existing.push(record);
    byKey.set(record.key, existing);
  }

  return {
    relativePath,
    exists: true,
    records,
    byKey,
  };
}

/**
 * 构造诊断对象�?
 *
 * @param {"error" | "warning"} severity - 严重级别�?
 * @param {string} ruleId - 规则 ID�?
 * @param {string} message - 诊断内容�?
 * @param {string} [location] - 文件位置�?
 * @returns {{ severity: "error" | "warning", ruleId: string, message: string, location?: string }}
 */
function diagnostic(severity, ruleId, message, location) {
  return { severity, ruleId, message, location };
}

/**
 * 判断 env 值是否仍是占位符�?
 *
 * @param {string} value - env 原始值�?
 * @returns {boolean} 是否为占位符�?
 */
function isPlaceholder(value) {
  const normalized = value.trim().replace(/^["']|["']$/gu, "");
  return (
    normalized.length === 0 ||
    normalized === "CHANGE_ME" ||
    normalized === "CHANGEME" ||
    normalized.startsWith("CHANGE_ME_") ||
    normalized.startsWith("CHANGEME_") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("change-me-")
  );
}

/**
 * 比较两个 env 文件�?key 顺序�?
 *
 * @param {ParsedEnv} actual - 实际 env�?
 * @param {ParsedEnv} example - 模板 env�?
 * @returns {boolean} 是否完全一致�?
 */
function keysMatch(actual, example) {
  const actualKeys = actual.records.map((record) => record.key);
  const exampleKeys = example.records.map((record) => record.key);
  return (
    actualKeys.length === exampleKeys.length &&
    actualKeys.every((key, index) => key === exampleKeys[index])
  );
}

/**
 * 递归收集文本文件路径。为了避免误扫构建产物，只扫描规则指定目录�?
 *
 * @param {string} relativePath - 仓库相对路径�?
 * @returns {string[]} 文件路径列表�?
 */
function collectTextFiles(relativePath) {
  const fullPath = absolute(relativePath);
  if (!existsSync(fullPath)) {
    return [];
  }

  const ignoredNames = new Set([
    ".git",
    ".next",
    ".turbo",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]);
  const results = [];

  function walk(currentFullPath, currentRelativePath) {
    const normalizedRelativePath = currentRelativePath.replaceAll("\\", "/");
    if (
      normalizedRelativePath === "guardrails/39-audit-env.mjs" ||
      normalizedRelativePath.endsWith("/guardrails/39-audit-env.mjs")
    ) {
      return;
    }

    const stat = statSync(currentFullPath);
    if (stat.isDirectory()) {
      const name = path.basename(currentFullPath);
      if (ignoredNames.has(name)) {
        return;
      }

      for (const entry of readdirSync(currentFullPath)) {
        walk(
          path.join(currentFullPath, entry),
          path.join(currentRelativePath, entry).replaceAll("\\", "/"),
        );
      }
      return;
    }

    const extension = path.extname(currentFullPath);
    if (
      [
        ".md",
        ".sh",
        ".mjs",
        ".js",
        ".ts",
        ".tsx",
        ".json",
        ".example",
        ".env",
        ".local",
        "",
      ].includes(extension)
    ) {
      results.push(normalizedRelativePath);
    }
  }

  walk(fullPath, relativePath.replaceAll("\\", "/"));
  return results;
}

// ============================================================================
// Audit Rules
// ============================================================================

/**
 * 审计单个 env 文件规则�?
 *
 * @param {typeof ENV_FILE_RULES[number]} rule - 文件规则�?
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditEnvFileRule(rule) {
  const results = [];
  const actual = parseEnvFile(rule.actual);
  const example = parseEnvFile(rule.example);

  if (rule.requiredExample && !example.exists) {
    results.push(
      diagnostic(
        "error",
        "env/missing-example",
        `${rule.label} example file is missing.`,
        rule.example,
      ),
    );
  }

  if (rule.requiredActual && !actual.exists) {
    results.push(
      diagnostic(
        "error",
        "env/missing-runtime",
        `${rule.label} runtime file is missing in strict runtime mode.`,
        rule.actual,
      ),
    );
  }

  for (const envFile of [actual, example]) {
    if (!envFile.exists) {
      continue;
    }

    for (const [key, records] of envFile.byKey.entries()) {
      if (records.length > 1) {
        results.push(
          diagnostic(
            "error",
            "env/duplicate-key",
            `${key} appears ${records.length} times.`,
            `${envFile.relativePath}:${records.map((record) => record.line).join(",")}`,
          ),
        );
      }
    }

    if (rule.allowedKeys) {
      for (const record of envFile.records) {
        if (!rule.allowedKeys.has(record.key)) {
          results.push(
            diagnostic(
              "error",
              "env/unexpected-key",
              `${record.key} is not allowed in ${rule.label}.`,
              `${envFile.relativePath}:${record.line}`,
            ),
          );
        }
      }
    }

    if (rule.forbiddenKeys) {
      for (const record of envFile.records) {
        if (rule.forbiddenKeys.has(record.key)) {
          results.push(
            diagnostic(
              "error",
              "env/forbidden-key",
              `${record.key} belongs to another env scope.`,
              `${envFile.relativePath}:${record.line}`,
            ),
          );
        }
      }
    }

    if (rule.requiredKeys) {
      for (const key of rule.requiredKeys) {
        if (!envFile.byKey.has(key)) {
          results.push(
            diagnostic(
              "error",
              "env/missing-key",
              `${key} is required by ${rule.label}.`,
              envFile.relativePath,
            ),
          );
        }
      }
    }
  }

  if (
    rule.exactKeyOrder !== false &&
    actual.exists &&
    example.exists &&
    !keysMatch(actual, example)
  ) {
    if (STRICT_RUNTIME) {
      for (const record of example.records) {
        if (!actual.byKey.has(record.key)) {
          results.push(
            diagnostic(
              "error",
              "env/missing-example-key",
              `${record.key} exists in example but is missing from runtime env.`,
              rule.actual,
            ),
          );
        }
      }

      for (const record of actual.records) {
        if (!example.byKey.has(record.key)) {
          results.push(
            diagnostic(
              "warning",
              "env/deprecated-runtime-key",
              `${record.key} is not present in example; it can be deleted / is deprecated pending deletion.`,
              `${actual.relativePath}:${record.line}`,
            ),
          );
        }
      }
    } else {
      results.push(
        diagnostic(
          "error",
          "env/key-order-mismatch",
          `${rule.actual} keys must match ${rule.example} exactly.`,
          rule.actual,
        ),
      );
    }
  }

  if (STRICT_RUNTIME && actual.exists && rule.strictPlaceholders !== false) {
    // Keys whose empty/placeholder value is acceptable in prod because the
    // service treats them as optional (fail-closed feature flag or a seeded
    // default) �?they don't block the deploy, they just gate the feature.
    const placeholderOptional = rule.placeholderOptionalKeys ?? new Set();
    for (const record of actual.records) {
      if (placeholderOptional.has(record.key)) continue;
      if (isPlaceholder(record.value)) {
        results.push(
          diagnostic(
            "error",
            "env/runtime-placeholder",
            `${record.key} still uses an empty or placeholder value in strict runtime mode.`,
            `${actual.relativePath}:${record.line}`,
          ),
        );
      }
    }
  }

  return results;
}

/**
 * 审计严格运行模式下的原始 secret 文件�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditRuntimeSecretFiles() {
  if (!STRICT_RUNTIME) {
    return [];
  }

  const results = [];
  for (const rule of RUNTIME_SECRET_FILE_RULES) {
    const filePath = absolute(rule.path);
    if (!existsSync(filePath)) {
      results.push(
        diagnostic(
          "error",
          "env/missing-runtime-secret-file",
          `${rule.label} file is missing in strict runtime mode.`,
          rule.path,
        ),
      );
      continue;
    }

    if (readFileSync(filePath, "utf8").trim().length === 0) {
      results.push(
        diagnostic(
          "error",
          "env/empty-runtime-secret-file",
          `${rule.label} file is empty in strict runtime mode.`,
          rule.path,
        ),
      );
    }
  }

  const platformEnv = parseEnvFile(`${RUNTIME_DIR}/secrets/platform.env`);
  if (platformEnv.exists) {
    const pgPassword = readText(`${RUNTIME_DIR}/secrets/pg-password`).trim();
    const redisPassword = readText(
      `${RUNTIME_DIR}/secrets/redis-password`,
    ).trim();
    const databaseUrl = platformEnv.byKey.get("DATABASE_URL")?.[0]?.value;
    const redisUrl = platformEnv.byKey.get("REDIS_URL")?.[0]?.value;

    if (
      databaseUrl &&
      pgPassword &&
      extractUrlPassword(databaseUrl) !== pgPassword
    ) {
      results.push(
        diagnostic(
          "error",
          "env/derived-database-url-mismatch",
          "DATABASE_URL password must match secrets/pg-password.",
          `${RUNTIME_DIR}/secrets/platform.env`,
        ),
      );
    }

    if (
      redisUrl &&
      redisPassword &&
      extractUrlPassword(redisUrl) !== redisPassword
    ) {
      results.push(
        diagnostic(
          "error",
          "env/derived-redis-url-mismatch",
          "REDIS_URL password must match secrets/redis-password.",
          `${RUNTIME_DIR}/secrets/platform.env`,
        ),
      );
    }
  }

  return results;
}

/**
 * 审计 deploy bundle 是否混入真实运行参数�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditDeployBundleRealRuntimeFiles() {
  const results = [];

  for (const relativeFile of DEPLOY_BUNDLE_REAL_RUNTIME_FILES) {
    const relativePath = `${WORKER_DIR}/${relativeFile}`;
    if (existsSync(absolute(relativePath))) {
      results.push(
        diagnostic(
          FAIL_WARNINGS ? "error" : "warning",
          "env/deploy-bundle-real-runtime-file",
          "Deploy bundle must keep only templates; real env/secrets belong to runtime/ or /srv/vxture/runtime.",
          relativePath,
        ),
      );
    }
  }

  return results;
}

/**
 * 从连接串中提取密码。解析失败时返回空字符串，让审计以不匹配失败�?
 *
 * @param {string} value - 连接串�?
 * @returns {string} 解码后的密码�?
 */
function extractUrlPassword(value) {
  try {
    return new URL(value.trim().replace(/^["']|["']$/gu, "")).password;
  } catch {
    return "";
  }
}

/**
 * 审计 Compose env_file 注入模型�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditCompose() {
  const results = [];
  const relativePath = `${WORKER_DIR}/compose.platform.yml`;
  const content = readText(relativePath);

  if (!content) {
    return [
      diagnostic(
        "error",
        "env/missing-compose",
        "compose.platform.yml is missing.",
        relativePath,
      ),
    ];
  }

  for (const { service, snippet } of COMPOSE_SNIPPETS) {
    if (!content.includes(snippet)) {
      results.push(
        diagnostic(
          "error",
          "env/compose-env-file",
          `${service} env_file must include: ${snippet}`,
          relativePath,
        ),
      );
    }
  }

  return results;
}

/**
 * 审计 12-generate-env-files.sh 生成内容是否与模板归属一致�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditGenerateEnvScript() {
  const results = [];
  const relativePath = `${WORKER_DIR}/scripts/12-generate-env-files.sh`;
  const content = readText(relativePath);

  if (!content) {
    return [
      diagnostic(
        "error",
        "env/missing-generate-env-script",
        "12-generate-env-files.sh is missing.",
        relativePath,
      ),
    ];
  }

  for (const token of GENERATE_ENV_REQUIRED_GLOBAL_TOKENS) {
    if (!content.includes(token)) {
      results.push(
        diagnostic(
          "error",
          "env/generate-env-missing-global-token",
          `12-generate-env-files.sh must contain ${token}.`,
          relativePath,
        ),
      );
    }
  }

  for (const token of GENERATE_ENV_FORBIDDEN_TOKENS) {
    if (content.includes(token)) {
      results.push(
        diagnostic(
          "error",
          "env/generate-env-forbidden-token",
          `12-generate-env-files.sh must not contain ${token}.`,
          relativePath,
        ),
      );
    }
  }

  return results;
}

/**
 * 审计文档和部署脚本中的旧口径残留�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function auditLegacyReferences() {
  const results = [];
  const scanned = new Set();

  for (const rule of LEGACY_BANNED_PATTERNS) {
    for (const scanPath of rule.paths) {
      const files = existsSync(absolute(scanPath))
        ? collectTextFiles(scanPath)
        : [];

      for (const relativePath of files) {
        const scanKey = `${rule.id}:${relativePath}`;
        if (scanned.has(scanKey)) {
          continue;
        }
        scanned.add(scanKey);

        const content = readText(relativePath);
        const lines = content.split(/\r?\n/u);
        for (const [index, line] of lines.entries()) {
          if (rule.pattern.test(line)) {
            results.push(
              diagnostic(
                "error",
                rule.id,
                rule.message,
                `${relativePath}:${index + 1}`,
              ),
            );
          }
        }
      }
    }
  }

  return results;
}

/**
 * 审计所有规则�?
 *
 * @returns {ReturnType<typeof diagnostic>[]} 诊断列表�?
 */
function audit() {
  return [
    ...ENV_FILE_RULES.flatMap(auditEnvFileRule),
    ...auditRuntimeSecretFiles(),
    ...auditDeployBundleRealRuntimeFiles(),
    ...auditCompose(),
    ...auditGenerateEnvScript(),
    ...auditLegacyReferences(),
  ].sort((left, right) => {
    const severityDelta =
      SEVERITY_ORDER.get(left.severity) - SEVERITY_ORDER.get(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return `${left.location ?? ""}${left.ruleId}`.localeCompare(
      `${right.location ?? ""}${right.ruleId}`,
    );
  });
}

/**
 * 打印审计结果�?
 *
 * @param {ReturnType<typeof diagnostic>[]} diagnostics - 诊断列表�?
 * @returns {void}
 */
function printResults(diagnostics) {
  if (diagnostics.length === 0) {
    console.log("[env-audit] OK");
    if (SHOW_OK) {
      console.log(
        `[env-audit] Runtime placeholder checks: ${STRICT_RUNTIME ? "enabled" : "disabled"}`,
      );
    }
    return;
  }

  console.error(`[env-audit] Found ${diagnostics.length} issue(s):`);
  for (const item of diagnostics) {
    const location = item.location ? ` ${item.location}` : "";
    console.error(
      `- ${item.severity.toUpperCase()} ${item.ruleId}${location}: ${item.message}`,
    );
  }
}

// ============================================================================
// Entrypoint
// ============================================================================

const diagnostics = audit();
printResults(diagnostics);

const hasErrors = diagnostics.some((item) => item.severity === "error");
process.exitCode = hasErrors ? 1 : 0;
