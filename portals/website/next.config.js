import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

/** @type {import('next').NextConfig} */

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

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

// ─── 内部包路径映射（两份，原因见下方说明）────────────────────────────────────────
//
// 为什么不能合并为一份？
//
// Turbopack 在 Windows 上存在已知限制：experimental.turbo.resolveAlias
// 的值必须是「相对路径字符串」，传入绝对路径（如 join(__dirname, ...)）
// 会触发 "windows imports are not implemented yet" 错误。
//
// Webpack 则相反，resolve.alias 标准用法要求绝对路径，相对路径无法正确解析。
//
// 因此两份 alias 的「值类型」本身不同，无法共用同一份数据：
//   internalAliases → 绝对路径，供 Webpack（next build）使用
//   turboAliases    → 相对路径，供 Turbopack（next dev --turbo）使用
//
// shared / core-locale / platform-browser / design-system 直接指向 src。
// design-system 主入口自身声明 "use client"，server-safe 能力走 /tokens /types /server 子入口。

// Webpack 用：绝对路径
// 只保留 portal 层允许引用的包（shared / core-locale / design-system）
const internalAliases = {
  "@vxture/shared": join(__dirname, "../../packages/shared/shared/src"),
  "@vxture/core-locale": join(__dirname, "../../packages/core/locale/src"),
  "@vxture/design-system": join(
    __dirname,
    "../../packages/design/design-system/src/client.ts",
  ),
  "@vxture/platform-browser": join(
    __dirname,
    "../../packages/platform/browser/src",
  ),
};

// Turbopack 用：相对路径（Windows 限制，不可改为绝对路径）
// 只保留 portal 层允许引用的包（shared / core-locale / design-system）
const turboAliases = {
  "@vxture/shared": "../../packages/shared/shared/src",
  "@vxture/core-locale": "../../packages/core/locale/src",
  "@vxture/design-system": "../../packages/design/design-system/src/client.ts",
  "@vxture/platform-browser": "../../packages/platform/browser/src",
};

const nextConfig = {
  typedRoutes: true,

  transpilePackages: ["@vxture/design-system"],

  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,

  env: {
    CUSTOM_API_URL:
      process.env.NEXT_PUBLIC_WEBSITE_BFF_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3011",
    NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY:
      process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "",
  },

  async redirects() {
    return [];
  },

  async rewrites() {
    // Local-dev same-origin shim (gated on LOCAL_BFF_PROXY_URL; unset in prod,
    // which uses the vxture.com nginx reverse-proxy instead). Proxies the
    // OIDC-RP routes (/auth/*) and website-bff data API (/api/*) to website-bff so
    // the browser sees one origin → the RP session cookie works. Array form =
    // afterFiles, so the portal's own /api/health filesystem route still wins.
    /* 门户各用自己的变量名。共用名 `LOCAL_BFF_PROXY_URL` 保留作兜底，但它是个
     * 陷阱：dev-panel 会把仓库根 .env.local 注入每个子进程，那里的值是
     * console-bff(3021)，于是 website 会把自己的 /auth/* 转发到 console 的 BFF，
     * 而门户目录下的同名 .env.local 覆盖不掉进程环境变量（2026-08-04 实测）。 */
    const bff =
      process.env.WEBSITE_BFF_DEV_URL ?? process.env.LOCAL_BFF_PROXY_URL;
    if (!bff) return [];
    return [
      { source: "/auth/:path*", destination: `${bff}/auth/:path*` },
      { source: "/api/:path*", destination: `${bff}/api/:path*` },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
    ],
    formats: ["image/webp", "image/avif"],
  },

  // ─── Turbopack 配置（next dev --turbo 专用）──────────────────────────────────
  // webpack() 回调在 Turbopack 模式下完全不执行，alias 必须在此处单独声明。
  // experimental.turbo 已废弃，迁移至顶层 turbopack 字段（Next.js 15+）。
  turbopack: {
    resolveAlias: turboAliases,
  },

  // ─── Webpack 配置（next build / next dev 无 --turbo）────────────────────────
  // Turbopack 模式下此回调不执行，两者互不干扰。
  webpack: (config) => {
    Object.assign(config.resolve.alias, internalAliases);
    return config;
  },

  devIndicators: {
    position: "bottom-right",
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default withNextIntl(nextConfig);
