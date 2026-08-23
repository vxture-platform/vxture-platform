import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const internalAliases = {
  "@vxture-platform/shared": join(
    __dirname,
    "../../packages/shared/shared/src",
  ),
  /* 键上的 `$` 表示**精确匹配**，不可省。webpack 的 alias 默认是前缀匹配，而本条的
   * 值是个文件（client.ts）而不是目录，于是 `@vxture/design-system/styles/fonts.css`
   * 会被改写成 `…/src/client.ts/styles/fonts.css` —— 路径里夹着一个文件名，必然
   * 解析失败。加 `$` 后只有裸包名走 alias，`/styles/*` 子路径回落到 package.json
   * exports 正常解析。（值为目录的那几条前缀匹配是对的，故不加 `$`。） */
};

const turboAliases = {
  "@vxture-platform/shared": "../../packages/shared/shared/src",
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  experimental: {
    webpackBuildWorker: false,
  },
  transpilePackages: [],
  turbopack: {
    resolveAlias: turboAliases,
  },
  async rewrites() {
    // Dev-only same-origin seam: the shell always calls its BFF with relative
    // /auth/* and /api/* URLs (in prod nginx routes them on the same vhost,
    // keeping the real hostname out of the repo). `next dev` proxies them to
    // the local BFF.
    //
    // 端口是 **3041**，不是 3051。3051 是 2026-08-10 端口重排前的旧值，
    // `deploy/scripts/15-migrate-runtime-ports.sh` 明写着
    // `.env.opera-bff|OPERA_BFF_PORT=3051|OPERA_BFF_PORT=3041`，而全仓其余五处
    // （compose、.env 样例、`main.ts` 默认值、dev-panel 注入、端口分配文档）都已经是
    // 3041 —— 只有这一行没跟上。它平时不发作是因为 dev-panel 会显式注入
    // `OPERA_BFF_DEV_URL`，把默认值盖掉；直接 `pnpm --filter @vxture/opera dev` 的人
    // 才会踩到，而表现是**登录跳不动、/api/* 全部拿不到响应**，看起来像 BFF 没起。
    const operaBff = process.env.OPERA_BFF_DEV_URL ?? "http://localhost:3041";
    return [
      { source: "/auth/:path*", destination: `${operaBff}/auth/:path*` },
      // /api/health 是 Next 自己的路由（app/api/health），不能代出去——把它排除在
      // 外，其余 /api/* 才交给 BFF。
      {
        source: "/api/:path((?!health$).*)",
        destination: `${operaBff}/api/:path*`,
      },
    ];
  },
  webpack: (config) => {
    Object.assign(config.resolve.alias, internalAliases);
    return config;
  },
};

export default nextConfig;
