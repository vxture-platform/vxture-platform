import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const internalAliases = {
  "@vxture/shared": join(__dirname, "../../packages/shared/shared/src"),
  "@vxture/design-system": join(
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
    // /auth/* URLs (in prod nginx routes them on the same vhost, keeping the
    // real hostname out of the repo). `next dev` proxies them to the local BFF.
    return [
      {
        source: "/auth/:path*",
        destination: `${process.env.CAPCONSOLE_BFF_DEV_URL ?? "http://localhost:3051"}/auth/:path*`,
      },
    ];
  },
  webpack: (config) => {
    Object.assign(config.resolve.alias, internalAliases);
    return config;
  },
};

export default nextConfig;
