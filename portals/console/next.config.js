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
  /* 键上的 `$` 表示**精确匹配**，不可省。webpack 的 alias 默认是前缀匹配，而本条的
   * 值是个文件（client.ts）而不是目录，于是 `@vxture/design-system/styles/fonts.css`
   * 会被改写成 `…/src/client.ts/styles/fonts.css` —— 路径里夹着一个文件名，必然
   * 解析失败。加 `$` 后只有裸包名走 alias，`/styles/*` 子路径回落到 package.json
   * exports 正常解析。（值为目录的那几条前缀匹配是对的，故不加 `$`。） */
  "@vxture/design-system$": join(
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
    // 首次补齐页的法务链接指门户站（console 没有 /legal 路由）。缺省生产域：
    // compose 未注入时（本地 dev）也不至于拼出相对 404。
    NEXT_PUBLIC_WEBSITE_URL:
      process.env.NEXT_PUBLIC_WEBSITE_URL ?? "https://vxture.com",
  },
  turbopack: {
    resolveAlias: turboAliases,
  },
  async rewrites() {
    const rules = [
      {
        source: "/varda/:path*",
        destination: `${process.env.VARDA_BFF_DEV_URL ?? "http://localhost:3090"}/varda/:path*`,
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
