# 服务部署

> Docker Compose 编排结构与服务分配
> 更新：2026-06-01

---

## Compose 文件布局

```
deploy/
├── compose.platform.yml      ← 平台服务（门户 + 平台 BFF + 平台数据库）
```

> **设计原则**：本仓只维护 平台 Compose。Atlas（AI 接入网关，原 model-platform）已拆仓 `vxture-atlas`，不再随本仓平台栈部署；vx-worker-02 业务执行面属于外部业务仓库。P7b 已删除本仓 `deploy/vx-worker-02` 历史资产，不得重新新增为本仓部署入口。

---

## VXTURE_DEPLOY_HOST：compose.platform.yml

所有平台服务共享平台 Docker 网络。`auth-bff` 可按平台认证契约对外提供 HTTP/SSO 能力。外部业务如需调用平台认证或 AI 能力，必须通过网络和鉴权策略显式接入 Atlas，不得引用本仓内部包。

```yaml
# deploy/compose.platform.yml
name: vx-platform

networks:
  vxture-prod:
    external: true

services:
  # ── 数据层 ────────────────────────────────────────────────────────────────

  postgres:
    image: postgres:18-alpine
    container_name: vx-platform-pg
    restart: unless-stopped
    networks: [vxture-prod]
    environment:
      POSTGRES_USER: vxture
      POSTGRES_DB: platform_main
      POSTGRES_PASSWORD_FILE: /run/secrets/platform_pg_password
    secrets: [platform_pg_password]
    volumes:
      - /data/platform/db/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vxture -d platform_main"]
      interval: 10s
      timeout: 5s
      retries: 5
    # 不暴露端口到宿主机，仅 vxture-prod 网络内访问

  redis:
    image: redis:8-alpine
    container_name: vx-platform-redis
    restart: unless-stopped
    networks: [vxture-prod]
    secrets: [platform_redis_password]
    volumes:
      - /data/platform/db/redis:/data
    command:
      [
        "sh",
        "-c",
        'redis-server --appendonly yes --requirepass "$$(cat /run/secrets/platform_redis_password)"',
      ]
    healthcheck:
      test:
        [
          "CMD-SHELL",
          'redis-cli -a "$$(cat /run/secrets/platform_redis_password)" ping',
        ]
      interval: 10s
      timeout: 5s
      retries: 5
    # 不暴露端口到宿主机

  # ── 门户层 ────────────────────────────────────────────────────────────────

  website:
    image: ghcr.io/vxture/website:latest
    container_name: vx-website
    restart: unless-stopped
    networks: [vxture-prod]
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: https://api.vxture.com
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3010/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    # 不暴露端口，nginx 通过容器网络访问

  console:
    image: ghcr.io/vxture/console:latest
    container_name: vx-console
    restart: unless-stopped
    networks: [vxture-prod]
    environment:
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3020/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  admin:
    image: ghcr.io/vxture/admin:latest
    container_name: vx-admin
    restart: unless-stopped
    networks: [vxture-prod]
    environment:
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3030/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # ── 平台 BFF 层 ──────────────────────────────────────────────────────────

  auth-bff:
    image: ghcr.io/vxture/bff-auth:latest
    container_name: vx-auth-bff
    restart: unless-stopped
    networks: [vxture-prod]
    ports:
      - "${PORT}:${PORT}" # 端口见端口登记表；UFW 限制仅 Tailscale 子网（100.64.0.0/10）可达
    env_file: [secrets/platform.env, secrets/platform-mail.env, .env.auth-bff]
    depends_on:
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3090/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  gateway-bff:
    image: ghcr.io/vxture/bff-gateway:latest
    container_name: vx-gateway-bff
    restart: unless-stopped
    networks: [vxture-prod]
    env_file: .env.gateway-bff
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    # 不暴露端口，nginx 通过容器网络访问

  website-bff:
    image: ghcr.io/vxture/bff-website:latest
    container_name: vx-website-bff
    restart: unless-stopped
    networks: [vxture-prod]
    env_file:
      [secrets/platform.env, secrets/platform-mail.env, .env.website-bff]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      auth-bff: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3011/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  console-bff:
    image: ghcr.io/vxture/bff-console:latest
    container_name: vx-console-bff
    restart: unless-stopped
    networks: [vxture-prod]
    env_file:
      [secrets/platform.env, secrets/platform-mail.env, .env.console-bff]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      auth-bff: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3021/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  admin-bff:
    image: ghcr.io/vxture/bff-admin:latest
    container_name: vx-admin-bff
    restart: unless-stopped
    networks: [vxture-prod]
    env_file: [secrets/platform.env, secrets/platform-mail.env, .env.admin-bff]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      auth-bff: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3031/health"]
      interval: 30s
      timeout: 5s
      retries: 3

secrets:
  platform_pg_password:
    file: ./secrets/pg-password
  platform_redis_password:
    file: ./secrets/redis-password
```

Nginx 由 `deploy/compose.nginx.yml` 独立管理，平台服务通过共享网络接入 `vx-nginx`。

---

## vx-worker-02 Compose 边界

P7b 已删除本仓 `deploy/vx-worker-02` 历史 compose/env/scripts 资产。vx-worker-02 业务 beta/prod 部署由外部业务仓库维护：

| 处理方向           | 要求                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 迁移到外部业务仓库 | 由业务仓库接管 compose、脚本、secrets、回滚和发布审计                                        |
| 本仓归档或删除     | 已完成：P7b 删除本仓历史资产                                                                 |
| 本仓继续使用       | 默认禁止；必须先新增 ADR 并更新 [`08-code-environment-map.md`](./08-code-environment-map.md) |

AI 不得重新创建 vx-worker-02 compose，也不得基于已删除历史文件规划 GitHub Actions 部署。

---

## 启动顺序

### VXTURE_DEPLOY_HOST

```bash
# 首次：创建网络
docker network create vxture-prod

# 启动全量平台服务
cd deploy
docker compose up -d
```

### vxture-beta（未来）

平台 beta 若启用，应在临时按量服务器上使用平台 compose 的 beta 变体或参数化配置。该方案尚未设计，不得复用 vx-worker-02。

---

## 端口

端口取号唯一源 = [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)；**本仓文档不再保存端口数值**。

此前这里有一张「端口分配总表」，值早已过时，且与它自己在文末链接的权威文档直接矛盾——2026-08-13 撤除。

vx-worker-02/03/04/05 等业务端口由外部业务仓库维护，不在本仓登记。业务服务如需调用 Atlas，应使用受控内部地址和服务凭证，不得在业务 worker 自行部署网关容器。

---

## 健康检查约定

NestJS BFF / Server 服务需实现健康检查端点（返回 200）。
所有 Next.js 门户需实现 `GET /api/health` 端点。

---

## 参考文档

- `docs/50-deployment/02-infrastructure.md` — 数据目录与底层配置
- `docs/50-deployment/01-environments.md` — env 文件职责、变量归属和重复项禁止清单
- 端口取号唯一源 = [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)；**本仓文档不再保存端口数值**。
