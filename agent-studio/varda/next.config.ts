import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 开发环境代理：将 /varda/chat 转发到 varda-bff（端口 3121）。
   * 生产环境由 Nginx 负责代理，此配置仅在 `next dev` 时生效。
   */
  async rewrites() {
    return [
      {
        source: "/varda/:path*",
        destination: `${process.env["VARDA_BFF_DEV_URL"] ?? "http://localhost:3090"}/varda/:path*`,
      },
    ];
  },
};

export default nextConfig;
