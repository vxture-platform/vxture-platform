# Varda 部署 Runbook（worker-02）

> 版本：v1.0 · 日期：2026-07-11
> 对象：把 **Varda 助手栈**（`varda-bff` + `varda-server`）部署到 **worker-02**（独立业务箱，Tailscale `100.76.219.48`）。
> 配置：[`deploy/worker-02/compose.varda.yml`](../../deploy/worker-02/compose.varda.yml) · 工作流 [`.github/workflows/deploy-varda.yml`](../../.github/workflows/deploy-varda.yml)
> 关联：varda 定位/架构见记忆与 `docs/20-specs/agents/varda/`；**worker-02 属外部箱**，本 runbook 走 **CI/CD 部署（GitHub Actions runner SSH），不手连 worker-02**。
>
> **2026-07-27 更正**：§1/§3 里的 `MODEL_PLATFORM_URL=http://100.100.197.42:3100`（worker-01）已过期——
> Atlas 拆仓后（2026-07-24）实际部署在 **worker-02:3100**（`100.76.219.48:3100`，见
> `docs/50-deployment/13-infra-allocation-registry.md` §3），`deploy/worker-02/.env.varda-server.example`
> 已同步更正。下方 §3 的 2026-07-11 验证记录是**当时**真实发生过的事，予以保留，但据此配置生产
> env 的值已不再正确——**若 worker-02 上的真实 `.env.varda-server` 仍是旧值，需 owner 带外更正 +
> recreate 容器**（同 karda B 段密钥转运的处理方式，本仓无 worker-02 写权限）。

---

## 0. 拓扑与设计

```
用户 → admin/console 前端 → (worker-01 nginx /varda/ 直连 Tailscale) → worker-02:3121 varda-bff
                                                                          └→ varda-server:3122 (同栈)
worker-02 varda 栈（自包含）：
  varda-bff(3121, 发布 0.0.0.0) · varda-server(3122, 仅内网) · varda-pg(私有) · varda-redis(私有)
唯一跨主机硬依赖：varda-server → Atlas（LLM 网关，worker-02:3100，2026-07-27 更正，见 §3；虽同机部署仍走 tailnet IP）
```

- **自包含**：会话数据（Vela\* 表）在本栈私有 `varda-pg`；jti 撤销黑名单在本栈私有 `varda-redis`。
- **跨主机**：仅 `MODEL_PLATFORM_URL`（LLM 必需）。外加共享密钥 `JWT_SECRET`（拷贝，非网络）。
- varda-server 无 join 平台表（Vela\* 的 userId/tenantId 是纯字符串），故私有 pg 成立、无需连平台库。

---

## 1. 一次性：GitHub Secrets（Repo → Settings → Secrets）

工作流 `deploy-varda.yml` 需要：

| Secret                                                 | 说明                                                                             | 状态    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | ------- |
| `VARDA_DEPLOY_HOST`                                    | worker-02 SSH 地址 = `100.76.219.48`（Tailscale）                                | ✅ 已设 |
| `VARDA_DEPLOY_USER`                                    | worker-02 部署用户 = `stone`                                                     | ✅ 已设 |
| `VARDA_DEPLOY_SSH_KEY` / `VARDA_DEPLOY_SSH_PASSPHRASE` | worker-02 现有部署密钥 + passphrase                                              | ✅ 已设 |
| `TAILSCALE_OAUTH_CLIENT_ID`                            | Tailscale OAuth client id（runner 加入 tailnet；与 deploy.yml 同款）             | ✅ 已设 |
| `TAILSCALE_OAUTH_CLIENT_SECRET`                        | Tailscale OAuth secret；tag 变量 = `vars.TAILSCALE_OAUTH_CLIENT_TAG`             | ✅ 已设 |
| 复用平台既有                                           | `ALIYUN_ACR_*`（build+pull `varda_bff`/`varda_agent` 镜像）+ `vars.ALIYUN_ACR_*` | ✅ 已有 |

> worker-02 只在 Tailscale 上（无公网 SSH）。workflow 已加 `tailscale/github-action` 步骤让 runner 加入 tailnet（ACL 已放 `tag:ci` → worker-02:22）。**上表 GitHub Secrets 已全部就位。**
> SSH 用 worker-02 现有部署密钥（`stone` 用户，公钥已在 worker-02，无需再装）。

## 2. 一次性：worker-02 本机 env / secret（长驻，不经 CI）

**Docker daemon 镜像加速（一次性，先于其他步骤做）**：worker-01 早就配了
`registry-mirrors`（`deploy-manual-init/bootstrap/11-bootstrap-host.sh`），
worker-02 一直没有对应配置，`postgres:18-alpine`/`redis:8-alpine` 等
docker.io 基础镜像直连拉取，慢且偶尔超时。跑一次：

```
sudo bash deploy/worker-02/bootstrap-docker-mirror.sh
```

会 `systemctl restart docker`，短暂中断本机所有容器（`restart: unless-stopped`
会自动拉起，之后用 `docker compose -f /srv/md0/varda/deploy/compose.varda.yml ps`
核实）。建议低峰期执行，一次性动作，幂等可重跑。

在 worker-02 上准备 `/srv/md0/varda/deploy/`，从 `*.example` 复制并填 `CHANGE_ME`：

```
/srv/md0/varda/deploy/
  .env.varda-bff            ← 拷 .env.varda-bff.example，填 JWT_SECRET 等
  .env.varda-server         ← 拷 .env.varda-server.example，填 DATABASE_URL/MODEL_PLATFORM_URL/VARDA_PLATFORM_LLM_TENANT_ID
  secrets/varda-pg-password ← 拷 secrets/varda-pg-password.example，填强口令（须与 .env.varda-server 的 DATABASE_URL 口令一致）
```

必填要点：

- **`JWT_SECRET` + `JWT_REFRESH_SECRET`**：均为 auth.schema **必填**（≥32 字符），与平台 `platform.env` 同值（owner 转运）。两个 env 文件、两个键都必须一致——缺 `JWT_REFRESH_SECRET` 容器 boot 即 exit(1)。
- **`MODEL_PLATFORM_URL`**：`http://100.76.219.48:3100`（Atlas，worker-02 本机 tailnet IP，见 §3 2026-07-27 更正）。
- **`VARDA_PLATFORM_LLM_TENANT_ID`**：真实平台租户 UUID（LLM 计费归属；admin surface 的回落租户）。
- **`VARDA_DEFAULT_MODEL_CODE`**：必须是 `model.models` 里 `is_active` 的 `model_code`且 ARK key 实际可调用（生产已注册 `doubao-seed-2-0-lite-260215`；seed 的 doubao-pro-32k 在该 ARK 账号不可调用），否则聊天 404 `MODEL_NOT_ROUTABLE`。
- **完整必填字段**以 `packages/core/config/src/schemas/{app,auth,redis,platform,varda}.schema.ts` 为准；VxConfig **fail-fast**，缺字段容器启动即退，首部署看 `docker logs`。（注：`APP_ENV` 不被任何 schema 消费，起作用的是 `NODE_ENV`。）

## 3. 跨主机 model-platform 可达（2026-07-27 更正：现指向 Atlas / worker-02，非旧 worker-01 model-platform）

**现状（2026-07-27）**：LLM 网关已是独立仓 `vxture-atlas`，部署于 **worker-02 本机**（`100.76.219.48:3100`，
登记见 `docs/50-deployment/13-infra-allocation-registry.md` §3）。对应 `.env.varda-server` 的
`MODEL_PLATFORM_URL=http://100.76.219.48:3100`。虽与 varda-server 同机，Atlas 与 varda 栈是两个独立
compose 栈/docker network，无 Docker DNS 名互通，仍须走 tailnet IP。

> **历史记录（2026-07-11，已被上面取代）**：方案 B 曾是 `compose.platform.yml` 给 worker-01 上的旧
> `model-platform` 绑 `ports: ["100.100.197.42:3100:3100"]`；晋级 main → deploy-production 后，
> worker-01 `docker port vx-model-platform` = `100.100.197.42:3100`，`curl .../model-platform/health/live`
> = 200 —— **这条验证在当时是真实的，但该服务与地址已随 Atlas 拆仓（2026-07-24）作废，不要再据此配置**。
> 若 Atlas 需要内部鉴权 token，varda-server 侧对应 env 也要补（按 model-runtime-client 要求）。

## 4. 首部署：建 Vela\* 表（用仓内迁移 SQL，勿用 db push）

`varda-pg` 首次起来是空库。**agent-varda 镜像只含 esbuild bundle + Prisma Client 运行时，不含 prisma CLI 与 schema——容器内 `db push` 不可行。** 仓内迁移 SQL 完整且幂等（IF NOT EXISTS），直接管道灌入：

```
cat agent-server/varda/prisma/migrations/20260501_vela_persistence/migration.sql \
    agent-server/varda/prisma/migrations/20260502_vela_audit_cancelled_at/migration.sql \
  | (传输到 worker-02 后) docker exec -i vx-varda-pg psql -U varda -d varda -v ON_ERROR_STOP=1
```

两份合并 = 当前 schema 全量（3 表 + 5 索引 + FK ON DELETE CASCADE）。服务启动不依赖建表（healthcheck 为 TCP/HTTP），先起栈后建表亦可。验证：`docker exec vx-varda-pg psql -U varda -d varda -c '\d "VelaMessage"'` 应见 `VelaMessage_sessionId_fkey`。

## 4b. 一次性：model-platform 数据预配（否则聊天 403/503）

model-platform 对每次 chat 有三道 DB 门（数据在 worker-01 `platform_main`），首次接入 varda 前须预配：

| 门           | 要求                                                                                                                                                 | 缺失时错误                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 模型目录     | `model.models` 有 active 的 `VARDA_DEFAULT_MODEL_CODE` 行                                                                                            | 404 `MODEL_NOT_ROUTABLE`                       |
| API key 映射 | 该行 `config.apiKeyEnvVar`（如 `"DOUBAO_API_KEY"`）指向 model-platform env 里存在的 key                                                              | 空 key → 上游 401 → 503 `PROVIDER_UNAVAILABLE` |
| 授权         | `model.model_grants` 有该 (model, tenant) 的 tenant-wide active 行（application 双 NULL）                                                            | 403 `GRANT_DENIED`                             |
| 配额         | `metering.quota_pools` 有 `workspace_id = <租户 UUID>` 的 active 行（`quota_limit=-1`=无限；`pool_source='manual_override'`, `reset_period='none'`） | 403 `QUOTA_EXCEEDED`                           |

> 结构性注记（B11 待办）：quota 门以 `workspace_id = tenantId` 为键（stand-in），而 grant FK 到 `tenancy.tenants`——同一 UUID 须同时存在于 tenants 与 workspaces。预配做法 = 建一个**合成 workspace**（`id = 租户 UUID`，无成员、不出现在任何 C2/console 查询里）承载配额行。2026-07-11 已按此对租户 `2a4271d4-…` 预配（模型 doubao-seed-2-0-lite-260215 + 无限池；已实测 chat 201）。B11/计量映射落地后应回收此 stand-in。

## 5. 跨主机依赖与取舍（须知）

| 依赖                            | 现状                                              | 处置                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **model-platform**（LLM，必需） | ✅ 已暴露 live（tailscale `100.100.197.42:3100`） | 见 §3                                                                                                                                                                                  |
| **JWT_SECRET**（验 cookie）     | 平台持有                                          | 拷贝到 worker-02 两个 env（值一致）                                                                                                                                                    |
| **jti 撤销一致性**（可选强化）  | 本栈私有 redis                                    | 默认：撤销仅 varda 本地、access cookie 短寿命限制窗口。若要与平台强一致：`REDIS_URL` 改指 worker-01 平台 redis（需暴露 + 密码），并接受"跨主机 redis 断链=varda 鉴权 fail-closed 全挂" |

## 6. worker-01 nginx `/varda/` 路由

已在仓库配好（`deploy/nginx/templates/admin.vhost.template` 的 `/varda/` → `100.76.219.48:3121`；该文件 20-sync-nginx-config.sh 渲染为 `sites-enabled/admin.conf`,真实域名不入仓）。若尚未在 worker-01 生效，随平台 nginx 同步/ reload 即可（平台侧动作）。

## 7. 常规部署（CI/CD）

前置（§1/§2/§3/§4）就绪后，每次发布 = **打 `varda-*` tag**（varda 独立发布线，与平台 `v*.*.*` 互不干扰）：

```
git tag varda-YYYYMMDD.N && git push origin varda-YYYYMMDD.N
```

`deploy-varda.yml`（`varda-*` tag 触发）两段：

1. **build**：build+push `varda_bff` + `varda_agent` 镜像到 ACR（tag = `github.ref_name`）。
2. **deploy**（`environment: varda`，**独立审批门** = owner 在 GitHub 点批准，与平台生产门分开 = 两次审核）：
   runner 解析 registry → tailscale → scp `compose.varda.yml` 到 worker-02 → SSH `docker compose pull varda-server varda-bff && up -d` → 等健康（3121/health=200）。**不覆盖** worker-02 本机 `.env.varda-*` / `secrets`（缺则 fail-fast 报错，不起坏栈）。

> 平台线（`docker-build.yml`/`deploy.yml`）已去掉 `varda-*`；打平台 tag 不会 build/部署 varda，反之亦然。

## 8. 验证

- 工作流日志末尾应显示 `varda-bff=healthy varda-server=healthy`。
- 从 worker-01 探活：`curl -s -o /dev/null -w '%{http_code}' http://100.76.219.48:3121/health` → 期望 **200**。
- 真人：admin/console 打开 Varda 助手对话，能出 token 流（走 SSE）。

## 9. 排障

- **容器起后即退**：VxConfig fail-fast，`docker logs vx-varda-bff` / `vx-varda-server` 看缺哪个必填 env。
- **varda-bff healthy 但对话 500**：多半 `MODEL_PLATFORM_URL` 不可达（§3）或 `VARDA_PLATFORM_LLM_TENANT_ID` 非法。
- **鉴权全 401**：`JWT_SECRET` 与平台不一致，或 redis 不可达（fail-closed）。
- **`/varda/` 502**（从公网）：worker-02 栈没起 / 3121 未发布 / UFW 未放行 Tailscale 子网。

---

> 边界：本 runbook 的一切执行均经 **CI/CD 或 owner 手动**在 worker-02 完成；平台侧改动（§3 暴露 model-platform、§6 nginx）须 owner 单独授权。
