import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load root .env.local so OIDC_* / NEXT_PUBLIC_* are available locally.
function loadRootEnv() {
  const envPath = join(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q))
      value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadRootEnv();

// Internal package aliases. Webpack needs absolute paths; Turbopack (Windows)
// needs relative — same dual-alias split as the website portal.
const internalAliases = {
  "@vxture/shared": join(__dirname, "../../packages/shared/shared/src"),
  "@vxture/design-system": join(
    __dirname,
    "../../packages/design/design-system/src/client.ts",
  ),
  "@vxture/platform-browser": join(
    __dirname,
    "../../packages/platform/browser/src",
  ),
};
const turboAliases = {
  "@vxture/shared": "../../packages/shared/shared/src",
  "@vxture/design-system": "../../packages/design/design-system/src/client.ts",
  "@vxture/platform-browser": "../../packages/platform/browser/src",
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  transpilePackages: ["@vxture/design-system"],
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  env: {
    // Public base of the OIDC API (prod: accounts.vxture.com, same-origin;
    // dev: auth-bff directly). The login form POSTs to ${base}/oidc/authorize/login.
    NEXT_PUBLIC_OIDC_API_BASE:
      process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081",
    NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY:
      process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "",
    // operator surface reuses the ops/admin Turnstile (运营面)
    NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_KEY:
      process.env.NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_KEY ?? "",
    // Dead-end recovery fallback (see AutoReturnToApp / resolveReturnUrl).
    NEXT_PUBLIC_WEBSITE_URL: process.env.NEXT_PUBLIC_WEBSITE_URL ?? "",
  },
  turbopack: { resolveAlias: turboAliases },
  webpack: (config) => {
    Object.assign(config.resolve.alias, internalAliases);
    return config;
  },
  compiler: { removeConsole: process.env.NODE_ENV === "production" },
};

export default nextConfig;
