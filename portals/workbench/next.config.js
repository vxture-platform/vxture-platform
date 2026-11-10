/**
 * Explicit same-origin proxy configuration for the Work RP and catalog.
 * @package @vxture/workbench
 * @layer Presentation
 * @category config
 * @author AI-Generated
 * @date 2026-11-05
 */

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: [
    "@vxture/platform-workspace-ui",
    "@vxture/platform-browser",
  ],
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  async rewrites() {
    const rules = [];
    // The dedicated Work RP must accept this portal's return origin and cookie.
    // Never fall back to Console's BFF or its OIDC client configuration.
    const work = process.env.WORKBENCH_BFF_PROXY_URL;
    const catalog = process.env.WORKBENCH_CATALOG_PROXY_URL;
    for (const value of [work, catalog]) {
      if (value && !/^https?:\/\//.test(value))
        throw new Error("Work proxy URLs must use HTTP(S)");
    }
    if (catalog)
      rules.push({
        source: "/api/products/catalog",
        destination: `${catalog.replace(/\/$/, "")}/api/products/catalog`,
      });
    if (work) {
      const base = work.replace(/\/$/, "");
      rules.push({
        source: "/auth/:path*",
        destination: `${base}/auth/:path*`,
      });
      rules.push({ source: "/api/:path*", destination: `${base}/api/:path*` });
    }
    return rules;
  },
};

export default config;
