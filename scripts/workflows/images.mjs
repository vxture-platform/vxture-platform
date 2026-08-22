/**
 * images.mjs - Docker 镜像构建配置（单一数据源）。
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category workflow
 * @description
 *   14 个镜像的 matrix 构建配置（name / image / dockerfile / build-args）。
 *   被 classify-changes.mjs 的 `--matrix` 模式消费，产出 docker-build 的动态 matrix：
 *   只为「本次需重建」的镜像生成 matrix 项，docs/scripts-only 时为空集 → build job
 *   整体跳过。镜像名 + 路径规则的对应在 classify-changes.mjs 的 IMAGE_RULES 维护，
 *   两处 name 必须一致。
 *
 * GHCR namespace is derived from the owning org at run time rather than
 * hardcoded. It used to read `ghcr.io/vxture/…`; after the repo split moved the
 * release channel to vxture-platform/ the job's GITHUB_TOKEN — scoped to this
 * repo — could no longer push there, and the first release attempt (v0.21.0)
 * died on `denied: permission_denied: The requested installation does not
 * exist`. That path had never run in this repo, so nothing caught it earlier.
 * Deriving it means the next move of the repo cannot reintroduce the bug.
 *
 * @author AI-Generated
 * @date 2026-06-10
 */

/**
 * Owning org for the GHCR namespace. GitHub Actions always sets
 * GITHUB_REPOSITORY_OWNER; the fallback only serves local invocations
 * (`node scripts/workflows/classify-changes.mjs` on a dev machine).
 */
const GHCR_OWNER = process.env.GITHUB_REPOSITORY_OWNER || "vxture-platform";

/** Fully-qualified GHCR reference for one image. */
export function ghcrImage(name) {
  return `ghcr.io/${GHCR_OWNER}/${name}`;
}

export const IMAGES = [
  // ── Next.js 门户 ───────────────────────────────────────────────────────────
  {
    name: "platform_website",
    image: ghcrImage("platform_website"),
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/website\nPACKAGE_FILTER=@vxture/website\nNEXT_PUBLIC_API_URL=https://api.vxture.com\nNEXT_PUBLIC_WEBSITE_BFF_URL=https://vxture.com",
  },
  {
    name: "platform_console",
    image: ghcrImage("platform_console"),
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/console\nPACKAGE_FILTER=@vxture/console\nNEXT_PUBLIC_API_URL=https://api.vxture.com\nNEXT_PUBLIC_CONSOLE_BFF_URL=https://console.vxture.com",
  },
  // admin：NEXT_PUBLIC_ADMIN_BFF_URL 不在此处硬编码真实域名（加固决策,
  // 2026-07-28 追加,与 opera 同一性质）——由 docker-build.yml 从 GH Actions
  // 仓库变量 vars.ADMIN_BASE_URL 注入(与 Turnstile key 同一模式)。
  {
    name: "platform_admin",
    image: ghcrImage("platform_admin"),
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/admin\nPACKAGE_FILTER=@vxture/admin\nNEXT_PUBLIC_API_URL=https://api.vxture.com",
  },
  // opera：能力控制台外壳（product_250 M-4 批C）。不传 NEXT_PUBLIC_*_BFF_URL
  // —— 外壳一律同源相对路径调 BFF（真实域名按加固决策不入仓,由 nginx 同 vhost 路由）。
  {
    name: "platform_opera",
    image: ghcrImage("platform_opera"),
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args": "PORTAL_PATH=portals/opera\nPACKAGE_FILTER=@vxture/opera",
  },
  {
    name: "platform_accounts",
    image: ghcrImage("platform_accounts"),
    dockerfile: "deploy/docker/Dockerfile.nextjs",
    "build-args":
      "PORTAL_PATH=portals/accounts\nPACKAGE_FILTER=@vxture/accounts\nNEXT_PUBLIC_OIDC_API_BASE=https://accounts.vxture.com\nNEXT_PUBLIC_WEBSITE_URL=https://vxture.com",
  },
  // ── 平台 BFF ───────────────────────────────────────────────────────────────
  {
    name: "platform_bff-gateway",
    image: ghcrImage("platform_bff-gateway"),
    dockerfile: "deploy/docker/Dockerfile.gateway",
    "build-args": "",
  },
  {
    name: "platform_bff-auth",
    image: ghcrImage("platform_bff-auth"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args": "SERVICE_PATH=bff/auth-bff\nPACKAGE_FILTER=@vxture/bff-auth",
  },
  {
    name: "platform_bff-website",
    image: ghcrImage("platform_bff-website"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/website-bff\nPACKAGE_FILTER=@vxture/bff-website",
  },
  {
    name: "platform_bff-console",
    image: ghcrImage("platform_bff-console"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/console-bff\nPACKAGE_FILTER=@vxture/bff-console",
  },
  {
    name: "platform_bff-admin",
    image: ghcrImage("platform_bff-admin"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/admin-bff\nPACKAGE_FILTER=@vxture/bff-admin",
  },
  {
    name: "platform_bff-opera",
    image: ghcrImage("platform_bff-opera"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/opera-bff\nPACKAGE_FILTER=@vxture/bff-opera",
  },
  {
    name: "platform_bff-platform-api",
    image: ghcrImage("platform_bff-platform-api"),
    dockerfile: "deploy/docker/Dockerfile.nestjs",
    "build-args":
      "SERVICE_PATH=bff/platform-api\nPACKAGE_FILTER=@vxture/bff-platform-api",
  },
  // varda 两镜像已随 vxture-varda 独立仓迁出(2026-08-18):构建与部署归其自持。
  // model-platform 服务已退役（2026-07-28）：实现整体迁至外部 vxture-atlas 仓。
];

export const ALL_IMAGE_NAMES = IMAGES.map((entry) => entry.name);
