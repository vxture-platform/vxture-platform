import { fileURLToPath } from "url";
import createNextIntlPlugin from "next-intl/plugin";
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
  "@vxture/platform-browser": join(
    __dirname,
    "../../packages/platform/browser/src",
  ),
};

const turboAliases = {
  "@vxture-platform/shared": "../../packages/shared/shared/src",
  "@vxture/platform-browser": "../../packages/platform/browser/src",
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
    const rules = [
      {
        source: "/varda/:path*",
        destination: `${process.env.VARDA_BFF_DEV_URL ?? "http://localhost:3090"}/varda/:path*`,
      },
    ];
    /* Local-dev same-origin shim (gated on LOCAL_BFF_PROXY_URL; unset in prod,
     * which uses the admin vhost nginx reverse-proxy instead). Console and
     * website have had this; admin did not — and without it the OIDC login
     * loops: admin-bff registers `redirect_uri = ${ADMIN_BASE_URL}/auth/callback`
     * (i.e. the **portal** origin, because that is what the prod proxy fronts),
     * but locally nothing on :3030 serves /auth/*, so the IdP's callback falls
     * through to this app's catch-all route → renders the shell → the session
     * provider fires another prompt=none silent SSO → repeat. The `vx_sso_silent=0`
     * stop-flag never gets set because the handler that sets it lives in
     * admin-bff and was never reached. Array form = afterFiles, so the portal's
     * own filesystem routes still win. */
    /* ⚠ 刻意**不**读共用的 `LOCAL_BFF_PROXY_URL`：那个名字被 console 占着，值是
     * console-bff(3021)，写在仓库根的 .env.local 里、由 dev-panel 注入到每个子
     * 进程。Next 的优先级是「真实进程环境变量 > 门户目录下的 .env.local」，所以
     * 在 admin 目录里覆盖同名变量是覆盖不掉的——请求会被静默转发到 console-bff，
     * 拿回一个 client_id=console 的 authorize URL，症状是登录永远走不通而且哪一层
     * 都不报错（2026-08-04 实测）。每个门户用自己的变量名，撞不上。 */
    const bff = process.env.ADMIN_BFF_DEV_URL;
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

/* next-intl 的 server 配置入口。不挂这个插件，从 server component 引用 next-intl
   会在**请求时**抛「Couldn't find next-intl config file」——而 build 是绿的，
   因为根 layout 的 `headers()` 让所有路由变成动态、build 期不渲染。 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
