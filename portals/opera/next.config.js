import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
};

const turboAliases = {
  "@vxture/shared": "../../packages/shared/shared/src",
  "@vxture/design-system": "../../packages/design/design-system/src/client.ts",
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  experimental: {
    webpackBuildWorker: false,
  },
  transpilePackages: ["@vxture/design-system"],
  turbopack: {
    resolveAlias: turboAliases,
  },
  async rewrites() {
    // Dev-only same-origin seam: the shell always calls its BFF with relative
    // /auth/* and /api/* URLs (in prod nginx routes them on the same vhost,
    // keeping the real hostname out of the repo). `next dev` proxies them to
    // the local BFF.
    const operaBff = process.env.OPERA_BFF_DEV_URL ?? "http://localhost:3051";
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
