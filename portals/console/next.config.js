import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import createNextIntlPlugin from "next-intl/plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadRootEnv() {
  const envPath = join(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;

    const key = line.slice(0, sep).trim();
    const value = unwrapEnvValue(line.slice(sep + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unwrapEnvValue(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

loadRootEnv();

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
  reactStrictMode: true,
  transpilePackages: ["@vxture/design-system"],
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  experimental: {
    webpackBuildWorker: false,
  },
  env: {
    NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY:
      process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "",
  },
  turbopack: {
    resolveAlias: turboAliases,
  },
  async rewrites() {
    const rules = [
      {
        source: "/varda/:path*",
        destination: `${process.env.VARDA_BFF_DEV_URL ?? "http://localhost:3121"}/varda/:path*`,
      },
    ];
    // Local-dev same-origin shim (gated on LOCAL_BFF_PROXY_URL; unset in prod,
    // which uses the console.vxture.com nginx reverse-proxy instead). Proxies the
    // OIDC-RP routes (/auth/*) and console-bff data API (/api/*) to console-bff so
    // the browser sees one origin → the RP session cookie works. Array form =
    // afterFiles, so the portal's own /api/health filesystem route still wins.
    /* 门户各用自己的变量名。共用名 `LOCAL_BFF_PROXY_URL` 保留作兜底，但它是个
     * 陷阱：dev-panel 会把仓库根 .env.local 注入每个子进程，于是 admin/website
     * 也会读到 console 的 3021，而门户目录下的同名 .env.local 覆盖不掉进程环境
     * 变量——症状是登录被静默转发到别人的 BFF（2026-08-04 实测）。 */
    const bff =
      process.env.CONSOLE_BFF_DEV_URL ?? process.env.LOCAL_BFF_PROXY_URL;
    if (bff) {
      rules.push(
        { source: "/auth/:path*", destination: `${bff}/auth/:path*` },
        { source: "/api/:path*", destination: `${bff}/api/:path*` },
      );
    }
    return rules;
  },
  webpack: (config) => {
    Object.assign(config.resolve.alias, internalAliases);
    return config;
  },
};

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

export default withNextIntl(nextConfig);
