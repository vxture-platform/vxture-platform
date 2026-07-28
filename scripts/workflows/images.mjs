/**
 * images.mjs - Docker 镜像构建配置（单一数据源）。
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category workflow
 * @description
 *   15 个镜像的 matrix 构建配置（name / image / dockerfile / build-args）。
 *   被 classify-changes.mjs 的 `--matrix` 模式消费，产出 docker-build 的动态 matrix：
 *   只为「本次需重建」的镜像生成 matrix 项，docs/scripts-only 时为空集 → build job
 *   整体跳过。镜像名 + 路径规则的对应在 classify-changes.mjs 的 IMAGE_RULES 维护，
 *   两处 name 必须一致。
 *
 * @author AI-Generated
 * @date 2026-06-10
 */

export const IMAGES = [
  // ── Next.js 门户 ───────────────────────────────────────────────────────────
  {
    name: "platform_website",
    image: "ghcr.io/vxture/platform_website",
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/website\nPACKAGE_FILTER=@vxture/website\nNEXT_PUBLIC_API_URL=https://api.vxture.com\nNEXT_PUBLIC_WEBSITE_BFF_URL=https://vxture.com",
  },
  {
    name: "platform_console",
    image: "ghcr.io/vxture/platform_console",
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/console\nPACKAGE_FILTER=@vxture/console\nNEXT_PUBLIC_API_URL=https://api.vxture.com\nNEXT_PUBLIC_CONSOLE_BFF_URL=https://console.vxture.com",
  },
  {
    name: "platform_admin",
    image: "ghcr.io/vxture/platform_admin",
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/admin\nPACKAGE_FILTER=@vxture/admin\nNEXT_PUBLIC_API_URL=https://api.vxture.com\nNEXT_PUBLIC_ADMIN_BFF_URL=https://admin.vxture.com",
  },
  // opera：能力控制台外壳（product_250 M-4 批C）。不传 NEXT_PUBLIC_*_BFF_URL
  // —— 外壳一律同源相对路径调 BFF（真实域名按加固决策不入仓,由 nginx 同 vhost 路由）。
  {
    name: "platform_opera",
    image: "ghcr.io/vxture/platform_opera",
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/opera\nPACKAGE_FILTER=@vxture/opera",
  },
  {
    name: "platform_accounts",
    image: "ghcr.io/vxture/platform_accounts",
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/accounts\nPACKAGE_FILTER=@vxture/accounts\nNEXT_PUBLIC_OIDC_API_BASE=https://accounts.vxture.com",
  },
  // ── 平台 BFF ───────────────────────────────────────────────────────────────
  {
    name: "platform_bff-gateway",
    image: "ghcr.io/vxture/platform_bff-gateway",
    dockerfile: "deploy/docker/Dockerfile.gateway",
    "build-args": "",
  },
  {
    name: "platform_bff-auth",
    image: "ghcr.io/vxture/platform_bff-auth",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args": "SERVICE_PATH=bff/auth-bff\nPACKAGE_FILTER=@vxture/bff-auth",
  },
  {
    name: "platform_bff-website",
    image: "ghcr.io/vxture/platform_bff-website",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/website-bff\nPACKAGE_FILTER=@vxture/bff-website",
  },
  {
    name: "platform_bff-console",
    image: "ghcr.io/vxture/platform_bff-console",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/console-bff\nPACKAGE_FILTER=@vxture/bff-console",
  },
  {
    name: "platform_bff-admin",
    image: "ghcr.io/vxture/platform_bff-admin",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/admin-bff\nPACKAGE_FILTER=@vxture/bff-admin",
  },
  {
    name: "platform_bff-opera",
    image: "ghcr.io/vxture/platform_bff-opera",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/opera-bff\nPACKAGE_FILTER=@vxture/bff-opera",
  },
  {
    name: "platform_bff-platform-api",
    image: "ghcr.io/vxture/platform_bff-platform-api",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/platform-api\nPACKAGE_FILTER=@vxture/bff-platform-api",
  },
  // ── Agent BFF ──────────────────────────────────────────────────────────────
  {
    name: "varda_bff",
    image: "ghcr.io/vxture/varda_bff",
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/varda-bff\nPACKAGE_FILTER=@vxture/bff-varda",
  },
  // ── Agent Server ───────────────────────────────────────────────────────────
  {
    name: "varda_agent",
    image: "ghcr.io/vxture/varda_agent",
    dockerfile: "deploy/docker/Dockerfile.nestjs-prisma",
    "build-args":
      "SERVICE_PATH=agent-server/varda\nPACKAGE_FILTER=@vxture/agent-server-varda\nPRISMA_SCHEMA=agent-server/varda/prisma/schema.prisma",
  },
  // ── 共享服务 ───────────────────────────────────────────────────────────────
  {
    name: "platform_service-model-platform",
    image: "ghcr.io/vxture/platform_service-model-platform",
    dockerfile: "deploy/docker/Dockerfile.nestjs-prisma",
    "build-args":
      "SERVICE_PATH=services/model/platform\nPACKAGE_FILTER=@vxture/service-model-platform\nPRISMA_SCHEMA=services/model/platform/prisma/schema.prisma",
  },
];

export const ALL_IMAGE_NAMES = IMAGES.map((entry) => entry.name);
