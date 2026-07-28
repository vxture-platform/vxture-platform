# 容器构建规范

> Dockerfile 模板、构建顺序、服务调用拓扑、资源规格
> 更新：2026-06-10

相关文档：[`00-overview.md`](./00-overview.md) · [`04-services.md`](./04-services.md) · [`08-code-environment-map.md`](./08-code-environment-map.md) · [`../ai/port-allocation.md`](../40-implementation/ai/10-port-allocation.md)

---

## 一、服务调用拓扑

```
外网流量
    │
    ▼
[Cloudflare WAF / Proxy]
    │
    │
    ▼
[vx-nginx :443  VXTURE_DEPLOY_HOST]
    │
    ├──▶ vx-website  :3010  (Next.js)
    ├──▶ vx-console  :3020  (Next.js)
    ├──▶ vx-admin    :3030  (Next.js)
    └──▶ vx-gateway-bff :8000
                │
         /website-api ──▶ vx-website-bff :3011
         /console-api ──▶ vx-console-bff :3021
         /admin-api   ──▶ vx-admin-bff   :3031
         /auth-api    ──▶ vx-auth-bff    :3090

──── VXTURE_DEPLOY_HOST 内部（vxture-prod 网络）──────────────────────────

[vx-website-bff / vx-console-bff / vx-admin-bff / vx-auth-bff]
    ├──▶ vx-platform-pg    :5432  (identity/iam/tenant/commerce/product/model/ops/support schema)
    ├──▶ vx-platform-redis :6379  (会话/限流/Token)
    ├──▶ Atlas（外部，`vxture-atlas`，模型注册/授权/配额/计量）
    └──▶ 外部服务（SMTP / OAuth provider / 业务 SSO 调用方）
```

vx-worker-02/03/04/05 等业务 worker 内部拓扑由外部业务仓库维护，本仓不定义。业务服务如需使用平台 AI 能力，应通过受控 HTTP/API 调用 Atlas，不得在业务 worker 部署本仓网关容器。

---

## 二、外部依赖（非容器）

| 依赖        | 用途                                  | 相关服务                                         | 关键环境变量                                    |
| ----------- | ------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| 阿里云 SMTP | 验证码/重置邮件/运营通知（465 SSL）   | auth-bff / website-bff / console-bff / admin-bff | `secrets/platform-mail.env` 中的 `SMTP_*`       |
| 飞书 OAuth  | 租户用户登录                          | website-bff                                      | `FEISHU_APP_ID` / `FEISHU_APP_SECRET`           |
| 钉钉 OAuth  | 租户用户登录                          | website-bff                                      | `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET`      |
| Tailscale   | GitHub Actions SSH VXTURE_DEPLOY_HOST | deploy-production                                | 节点 IP 见 [`00-overview.md`](./00-overview.md) |

---

## 三、构建顺序

所有容器从 **workspace 根目录**构建，利用 pnpm workspace 依赖图。

```
Step 1（并行）
  @vxture/shared
  @vxture/core-locale

Step 2（并行，依赖 shared）
  @vxture/core-auth
  @vxture/core-config
  @vxture/core-api
  @vxture/core-utils
  @vxture/core-tenant
  @vxture/core-mail

Step 3（并行，依赖 core-*）
  @vxture/design-system
  @vxture/model-runtime-client
  @vxture/service-iam
  @vxture/service-organization
  @vxture/service-billing
  @vxture/service-subscription
  @vxture/service-mail
  @vxture/service-ticket

Step 4（并行，依赖 service-* / design-system）
  @vxture/website          @vxture/bff-website
  @vxture/console          @vxture/bff-console
  @vxture/admin            @vxture/bff-admin
```

Agent / 业务相关目录如需继续构建，必须先在 [`08-code-environment-map.md`](./08-code-environment-map.md) 中明确是否仍属于本仓平台职责；默认不得把它们纳入 vx-worker-02 部署。

---

## 四、Dockerfile 模板

### NestJS BFF / Server

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ── 依赖层（利用缓存）
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# 仅复制目标服务及其依赖的 package.json（减少无关 cache miss）
COPY packages/shared/package.json             packages/shared/
COPY packages/core/config/package.json        packages/core/config/
COPY packages/core/auth/package.json          packages/core/auth/
COPY packages/core/api/package.json           packages/core/api/
COPY bff/website-bff/package.json             bff/website-bff/
# … 按服务调整
# B7: pnpm content-addressable store 走 BuildKit cache mount，源码改动触发 install
# 重跑时依赖从持久 store 取（downloaded 0），免重复下载/解压。
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ── 构建层
FROM deps AS builder
COPY . .
RUN pnpm --filter @vxture/shared build \
 && pnpm --filter @vxture/core-config build \
 && pnpm --filter @vxture/core-auth build \
 && pnpm --filter @vxture/service-iam build \
 && pnpm --filter @vxture/bff-website build

# ── 运行层（最小镜像）
FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/bff/website-bff/dist         ./dist
COPY --from=builder /app/bff/website-bff/node_modules ./node_modules
COPY --from=builder /app/bff/website-bff/package.json .
ENV NODE_ENV=production
EXPOSE 3011
CMD ["node", "dist/main.js"]
```

### Next.js Portal（standalone 模式）

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS builder
COPY . .
# B7: pnpm store + Next .next/cache 走 BuildKit cache mount，源码改动重跑 install 时
# 依赖从持久 store 取（downloaded 0），Next 编译复用增量缓存，免冷编译。
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,id=next-website,target=/repo/portals/website/.next/cache \
    pnpm --filter @vxture/website build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# standalone server.js 绑 $HOSTNAME（Docker 默认设成容器 ID）→ 必须绑全网卡，loopback 探活才可达
ENV HOSTNAME=0.0.0.0
# standalone 输出已包含所有运行时依赖
COPY --from=builder /app/portals/website/.next/standalone            ./
COPY --from=builder /app/portals/website/.next/static                ./portals/website/.next/static
COPY --from=builder /app/portals/website/public                      ./portals/website/public
EXPOSE 3010
CMD ["node", "portals/website/server.js"]
```

> `next.config.js` 中需声明 `output: 'standalone'`，否则 standalone 目录不会生成。

---

## 五、健康检查约定

### 5.1 现状（以 `compose.platform.yml` 为准，2026-06-09 校正）

11 个服务均配置了 `healthcheck`，生产 40-verify 全 `(healthy)`。各服务实际探测命令与参数：

| 服务                               | 实际探测端点（H3 起用 node 运行时 fetch）     | interval / timeout / retries | start_period |
| ---------------------------------- | --------------------------------------------- | ---------------------------- | ------------ |
| vx-gateway-bff                     | `node fetch http://127.0.0.1:8000/healthz`    | 30s / 5s / 3                 | 15s          |
| vx-auth-bff                        | `node fetch http://127.0.0.1:3090/healthz`    | 30s / 5s / 3                 | 15s          |
| vx-website-bff                     | `node fetch http://127.0.0.1:3011/healthz`    | 30s / 5s / 3                 | 15s          |
| vx-console-bff                     | `node fetch http://127.0.0.1:3021/healthz`    | 30s / 5s / 3                 | 15s          |
| vx-admin-bff                       | `node fetch http://127.0.0.1:3031/healthz`    | 30s / 5s / 3                 | 15s          |
| vx-website / vx-console / vx-admin | `node fetch http://127.0.0.1:3000/api/health` | 30s / 5s / 3                 | 20s          |
| postgres                           | `pg_isready -U vxture -d platform_main`       | 10s / 5s / 5                 | 10s          |
| redis                              | `redis-cli -a <secret> ping`                  | 10s / 5s / 5                 | 10s          |

约定：node 服务（门户/BFF/model）的 healthcheck 用 **node 运行时 fetch**（`node -e "fetch(...).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`，H3，去掉对镜像内 curl 的依赖，探 `127.0.0.1` 避免 IPv6 歧义）；BFF 用浅层 liveness `/healthz`（不查依赖，正确）；门户用 dependency-free `/api/health`（H2，`app/api/health/route.ts`）。所有服务已配 `start_period`（H1）。pg/redis 用原生 `pg_isready`/`redis-cli`。`restart: unless-stopped`（注意：unhealthy **不会**触发重启，运行时自愈见 H4）。unhealthy 由 `51-check-platform-alerts.sh` 每日巡检 `inspect .State.Health` 告警。

### 5.2 健康探测进一步 backlog

遵循 playbook（`docs/10-standards/container-healthcheck-standard.md`）纪律：一项一 PR、改 compose 后经晋升+部署验证、`docker inspect .State.Health` 实测。

| 编号      | 任务                                                                                | 价值                                       | 优先级                     |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| H5        | 本节现状校正（端点/参数/告警/自愈与实现一致）                                       | 文档不漂移                                 | 高（本次）                 |
| ~~H1~~ ✅ | 所有 healthcheck 补 `start_period`（门户 20s / model 20s / BFF 15s / pg·redis 10s） | 消除启动期 unhealthy 误判抖动              | 高（#206）                 |
| ~~H2~~ ✅ | 门户加 `app/api/health/route.ts` + healthcheck 改探 dependency-free `/api/health`   | 真 liveness、更轻、与设计一致              | 中                         |
| ~~H3~~ ✅ | 探测改 node 运行时 fetch（去掉对镜像内 curl 的隐性依赖，探 127.0.0.1）              | 探测更稳、不依赖 curl                      | 中低                       |
| ~~H4~~ ⛔ | 评估 autoheal 边车（unhealthy 自动重启）                                            | 运行时自愈；但 2C2G 加边车需权衡，告警已有 | 中（评估，暂不做，见 5.3） |

> 进度：H5/H1/H2/H3 ✅（已部署验证，见 5.3）、H4 ⛔（评估暂不做）。健康探测流即时项收口。

### 5.3 部署验证与 H4 评估（2026-06-09）

#### H1+H2+H3 部署验证

加固批经 develop->beta->main 晋升 + deploy run `27211035946` 上线。**11 个容器全部 `Recreated -> Started`**（healthcheck 配置变更触发重建，含 pg/redis——H1 给其也加了 `start_period`；app 无状态、pg/redis 数据在卷，均短暂重启不丢数据），deploy 40-verify 报 **`readiness=ready` + `Verification OK`**（health 端点 / readiness / nginx / 公网 HTTPS 全过）。node 运行时 fetch 探测生效（否则 40-verify 不会通过），门户 `/api/health`、BFF `/healthz`、`start_period` 均已上线。

#### H4 autoheal 评估：暂不实施

`restart: unless-stopped` 不因 unhealthy 重启；运行时自愈需 autoheal 边车（如 `willfarrell/autoheal`，监听 unhealthy 事件重启容器）。**评估结论：暂不实施**——

1. **价值边际**：单节点 2C2G、低流量；H1 起 healthcheck 已配 `start_period`，启动期不再误判 unhealthy，真正 unhealthy 罕见。
2. **成本/风险**：autoheal 边车需挂载 `docker.sock`（高权限，安全面扩大），且在小节点常驻一进程。
3. **告警已有**：`51-check-platform-alerts.sh` 每日巡检 unhealthy 并报 high，已覆盖"发现"。
4. **复议门槛**：若出现真实 unhealthy 未自愈事件、或要求 24/7 无人值守，再引入 label 门控的 autoheal 边车（并评估 docker.sock 只读代理等收敛权限的方案）。

执行序：**H5 → H1 → H2 → H3 → H4**。H1/H2/H3 改 compose 同一批 healthcheck 块，可合并为一次「healthcheck 加固」改动一起晋升验证。

---

## 六、资源规格

### VXTURE_DEPLOY_HOST（2C 2G，平台层）

> 内存紧张，建议开启 2G swap。详见 [infrastructure.md § 内存优化](./02-infrastructure.md)。

| 容器                                           | `--memory` 上限 |
| ---------------------------------------------- | --------------- |
| vx-platform-pg                                 | 400MB           |
| vx-platform-redis                              | 128MB           |
| vx-nginx                                       | 64MB            |
| vx-website / vx-console / vx-admin             | 各 256MB        |
| vx-website-bff / vx-console-bff / vx-admin-bff | 各 192MB        |
| vx-auth-bff                                    | 128MB           |
| vx-gateway-bff                                 | 64MB            |
| **合计**                                       | **~2,100MB**    |

### vxture-beta（未来临时平台 beta）

未来若启用平台 beta，资源规格按 平台服务集合重新估算。不得套用 vx-worker-02 业务资源表，也不得在 vx-worker-02 上混放平台 beta。

---

## 七、数据库迁移

本仓只负责平台数据库迁移。

```bash
# 平台数据库（VXTURE_DEPLOY_HOST vx-platform-pg）
pnpm --filter @vxture/core-database migrate:deploy
```

首次上线平台数据库时，如已有历史数据，需先 resolve baseline：

```bash
npx prisma migrate resolve --applied "0001_schema_migration" \
  --schema=packages/core/database/prisma/schema.prisma
```
