import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* 直接指向源码而非 dist：预览面的用途就是看改动的即时效果，走构建产物等于
 * 每改一行都要重新 build。产品不这么做——它们消费发布出去的包。 */
const alias = "../../design-system/src/client.ts";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* 开发指示灯浮在左下角，正好压住侧栏底部的模式开关。这个应用整个就是拿来看界面的，
   * 框架的调试挂件不该盖在被看的东西上面。 */
  devIndicators: false,
  experimental: { webpackBuildWorker: false },
  transpilePackages: ["@vxture/design-system"],
  turbopack: {
    resolveAlias: { "@vxture/design-system": alias },
  },
  webpack: (config) => {
    config.resolve.alias["@vxture/design-system"] = join(__dirname, alias);
    return config;
  },
};

export default nextConfig;
