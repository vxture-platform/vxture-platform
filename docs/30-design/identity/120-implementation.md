# Identity 实施衔接（identity 板块 · 实施衔接层）

> 🧭 架构层见 [`identity-platform-architecture.md`](./040-architecture.md)；机制详细层见 identity-platform-{idp,account,rp-integration,access-topology,authorization,operator}。本文 = **实施衔接层**：现状→新版迁移 / rollout 进度 / 部署 runbook / 收尾。
> 数据落地/迁移见 [`data_platform_300_migration.md`](../data_platform_300_migration.md)（c）。合并自 website-rp-migration + identity-platform-workplan + identity-rebuild-deploy-runbook + operator-identity-security-workplan + p5-closeout + p3-ruyin，2026-07-01。
>
> ⚠️ **端口数字按当时值留档，不回改**（本文是实施记录）：文中的 auth-bff `3090`、accounts `3040`、website `3010`/`3011` 等是 2026-07 当时的值。现行分配 = auth-bff **3081**、accounts **3080**、website **3000/3001**、admin **3030/3031**、opera **3040/3041**，权威见 [`10-port-allocation.md`](../../40-implementation/ai/10-port-allocation.md)（2026-08-10 重排，本地=生产同一套数）。

---

## 1. 现状→新版总览

**北极星（不回退）**：Identity 是干净重写（新 schema baseline，无旧→新数据迁移），全平台收敛为**唯一 OIDC IdP**（`accounts.vxture.com`）；所有应用退化为**授权码 + PKCE(S256) + RS256** 的 OIDC RP；HS256 全链路退役；双 realm（customer/workforce）严格隔离；AuthN ⟂ entitlement 分离（token 不含业务权益）。机制字段级归详细层，落地数据差量归 c；本层只讲**现状→新版怎么切、进度到哪、部署怎么走、收尾删什么**。

**三条主迁移线**（本层脉络）：

| 线                     | 现状（旧）                                                             | 新版（目标态）                                                        | 归属节 |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| **RP 化 + 同源 + SLO** | 各 portal 内嵌认证表单 / HS256 自签 / 跨源数据面 / 无 back-channel     | portal 零本地认证表单、跳 accounts 中央面；域内同源反代；统一 SSO/SLO | §2·§5  |
| **operator 身份安全**  | `ops.admin` 单表 + bcrypt + 无 MFA                                     | `ops.operator_*` 域 + Argon2id + 两步登录 + TOTP/WebAuthn/恢复码      | §4     |
| **legacy 退役 + 正名** | 一次性 token 桥 / `crossdomain.router` / HS256 secret / `bff/auth-bff` | 纯 OIDC；桥/HS256 全删；`services/identity/server`=`identity-server`  | §6     |

术语对齐：realm 取值 `tenant→customer` / `operator→workforce`（数据权威 a/b 已收敛，本文以新名为主、括注旧名）；cookie 名 `vx_sid`/`vx_sid_op` 与 `sub` 前缀 `usr_`/`opr_` 仍是现行权威标识；claim `active_tenant*` 属过渡态、随契约 v2 退役。

---

## 2. Batch/rollout 进度与验收（Identity 重建）

> 权威设计：`identity-platform-architecture.md` + 详细层；on-disk 实施依据 = `data_platform_200_schema.md`（§13 验收矩阵 / 字段级 DDL）。工作分支 `feat/identity-platform-rebuild`。执行纪律：分批推进，每任务四要素（目标/依据/概要/边界），每批用户确认，commit/push/merge 逐步确认（G6）。

### 2.1 重建 Batch 进度表

| 批次     | 范围                                                        | 状态           | commit                       |
| -------- | ----------------------------------------------------------- | -------------- | ---------------------------- |
| Batch 1  | 数据地基（data-model + `schema.prisma` + seed 三段）        | ✅ 完成        | 前序分支                     |
| Batch 2  | account 域（`@vxture/service-account` + Argon2id）          | ✅ 完成        | 前序分支                     |
| Batch 3  | organization 域迁位 + 两级 RBAC（Governance/ActiveContext） | ✅ 完成        | 前序分支                     |
| Batch 4  | 登录/session/token/OIDC 接新模型；**HS256 全退役**          | ✅ 完成        | 前序分支                     |
| Batch 5  | OIDC SSO 运行时闭环（HTTP 自动化 12/12）                    | ✅ 完成        | 前序分支                     |
| Batch 6  | 治理 API + RBAC 强制（§13.4，HTTP 10/10）                   | ✅ 完成        | 前序分支                     |
| Batch 7  | 下游 BFF 迁 RS256/OIDC-RP，退役 HS256 消费方                | ✅ 完成        | `0c0c327e`                   |
| Batch 8  | admin operator-realm 迁 RS256/OIDC-RP，IdP 登录加固         | ✅ 完成        | `cca46c6f`                   |
| Batch 9  | accounts operator-login Turnstile 接入 IdP                  | ✅ 完成        | `385d1d77`                   |
| Batch 10 | 退役死包 `@vxture/core-tenant`（rename 桶 F）               | ✅ 完成        | `e2aeda7c`                   |
| Batch 11 | console portal 迁 OIDC-RP 浏览器登录（HTTP 层）             | ✅ 完成        | `1bc06976`                   |
| Batch 12 | 启用 accounts 新模型手机码登录 + Turnstile                  | ✅ 完成        | —                            |
| Batch 13 | 部署线接入（签名密钥/迁移/seed/构建）                       | ✅ 完成        | `5e767ed8` + 修复 `c4e91486` |
| Batch 14 | console 域内同源拓扑（§13.7 真闭合前置）                    | ✅ 完成        | —                            |
| Batch 15 | 单点登出（SLO）接线 + 统一 post-logout 页                   | ✅ 完成        | —                            |
| Batch 16 | website OIDC-RP 迁移（16a–16d，详见 §5）                    | ✅ 完成        | 见 §5                        |
| Batch 17 | operator 手机码登录                                         | ⏸ 预留（D-AV） | —                            |
| Batch 18 | 跨域业务接入 ruyin.ai                                       | ⏸ 预留（D-AW） | —                            |
| Batch 19 | tenant→org 命名收口（技术债）                               | ⚪ 非功能必须  | —                            |
| Batch 20 | D-9 物理搬迁 `identity-server`                              | ⛔ post-MVP    | —                            |

### 2.2 §13 验收矩阵对照（schema §13）

| 验收项    | 内容                                                  | 状态                                                               |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| §13.1     | 注册/建 org/default workspace/双 owner                | ✅ HTTP 自动化（Batch 4/5）                                        |
| §13.2     | 三标识 + 密码登录、session、新 claims token           | ✅ HTTP 自动化                                                     |
| §13.3     | OIDC `authorize→code→token→userinfo`                  | ✅ HTTP 12/12（Batch 5）                                           |
| §13.4     | 治理 API + 两级 RBAC 强制（按实时 DB 角色）           | ✅ HTTP 10/10（Batch 6）                                           |
| §13.5     | refresh 轮换 + replay 拒绝                            | ✅ HTTP 自动化                                                     |
| §13.6     | 同域 SSO（二次免登）                                  | ✅ HTTP 自动化                                                     |
| **§13.7** | **真人浏览器闭环（RP 真接入 + 登录 UI + 跨域 flow）** | ✅ console 真闭合 = Batch 14(同源)+15(SLO)；全租户含 website = +16 |

> 里程碑：§13.1–13.6 HTTP 层全绿 = Identity MVP「能登录」+ 治理闭环达成；§13.7 真人浏览器闭合经 Batch 14/15（console）+ 16（website）落地。

### 2.3 剩余分层判断（哪些是 identity 必须）

- **①§13.7 真人闭环** = MVP 必须；已由 Batch 14/15/16 达成。
- **③-SMS 手机码真实化** = identity IN 功能补全（手机强锚点 B3 核心）——Batch 12 已由「建 SMS」collapse 为「验证+启用+补 Turnstile 缺口」（`@vxture/service-sms` 早已真实实现，见 §5.4 SMS 演进）。
- **③-deploy / ④ Turnstile flip** = 上线 infra/ops 配置，非代码完成度，并入部署批（Batch 13）。
- **②tenant→org 改名**（Batch 19）= 命名/契约技术债，语义已对、token 已携带 org，非功能必须。
- **⑤D-9 物理搬迁**（Batch 20）= post-MVP，明确推迟（legacy 零流量后搬迁最干净）。

---

## 3. 首次部署 runbook + 踩坑录

> 依据 v0.16.0 首次把重建（`feat/identity-platform-rebuild`）部署到 `VXTURE_DEPLOY_HOST` 的实战。**重建 = 干净重写（新 schema baseline，无旧→新数据迁移）**；首次上任何环境按本节走。数据落地字段级见 c。

### 3.1 关键认知（首次部署为何特殊）

- **CI/CD 默认只发 `main`**：`docker-build` 仅在 `main` push 或 `v*.*.*` tag 触发；`deploy-production` 经 `workflow_dispatch`（ref/image_tag/target/confirm_production）SCP+SSH。发 feat → **打 semver tag**（避开 main 全量晋升）。
- **regular-upgrade 不跑 migration/seed**：`30-deploy` 只拉镜像+起容器+health 等待。migration（`22`）/ seed（`23`）是首次/人工独立执行（`CONFIRM_MIGRATE` / `CONFIRM_SEED`）。
- **baseline 是全新建表**（`0000_baseline`，假设空库）→ 无法叠加旧库。旧环境库必须**重置到新 baseline**（或换新库名）。
- 容器 `healthy` 只是存活探针，**不代表库 schema 对**。

### 3.2 首次部署正确顺序

1. **预检**（§3.3 checklist）：lockfile 干净、env 来自最新 example、回调/凭据/Turnstile/nginx 就绪。
2. **打 tag** `vX.Y.Z`（feat HEAD）→ 等 `docker-build` 全绿（镜像入 ghcr）。
3. **触发 `deploy-production`**（`gh workflow run deploy-production.yml --ref main -f ref=vX.Y.Z -f target=VXTURE_DEPLOY_HOST -f image_tag=X.Y.Z -f confirm_production=true`）。
4. **DB 首次初始化（人工）**：reset/baseline → **`27-provision-client-secrets`** → `22-migrate` → `23-seed` → **`25-provision-signing-key`**（`24-first-deploy` 已按 `21→22→27→23→25→30→40` 编排）。
5. **nginx**：确认 `/auth/` 反代到 auth-bff、reload。
6. **验证**：env-audit strict 全绿 → `/oidc/jwks` 有 key → `iam.oidc_client.client_secret_hash` 三行非空 → `oauth_provider` 三行 `is_enabled=t` + 新回调 → curl 自检 → 浏览器验收（社交登录 token 交换 200）。

### 3.3 预检 checklist（杜绝低级错）

- [ ] **lockfile 与 package.json 同步**：`pnpm install --frozen-lockfile --lockfile-only` 本地必过（删依赖未重生成 lockfile = frozen 构建必挂）。
- [ ] **env 文件最新**：服务器 `.env.*` 由 `12-generate` 从最新 example 生成；`12-generate` 只**追加缺键、不覆盖已有值、不删废弃键**——旧值（如旧回调 URI）会保留，须手核。
- [ ] **OAuth 回调 URI = canonical**：`https://accounts.vxture.com/auth/oauth/<provider>/callback`（env `*_REDIRECT_URI` = provider 控制台白名单 = auth-bff 路由，三处一致）。**不是**旧 `api.vxture.com/auth-api/*`。
- [ ] **OAuth 凭据填真值**（6 个 id/secret），非 CHANGEME。
- [ ] **Turnstile**：`CF_TURNSTILE_ENABLED=true` 则 `CF_TURNSTILE_TENANT_SECRET_KEY` / `CF_TURNSTILE_ADMIN_SECRET_KEY` 必须真值（strict audit 拒 CHANGEME；tenant 密钥缺 → bind-phone 发码 401）；测试可 `false`（仍不能留 CHANGEME）。
- [ ] **admin-bff env 无 Turnstile 键**（Batch 8 起 admin-bff RP-only；`.env.admin-bff` 残留 `CF_TURNSTILE_*` = forbidden ERROR）。
- [ ] **env-audit strict 先过**：`VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR=/srv/vxture/deploy VX_RUNTIME_DIR=/srv/vxture/runtime node deploy/guardrails/39-audit-env.mjs`（裸跑会误报 `.env.example missing` = cwd 假象）。
- [ ] **nginx `accounts.vxture.com` 有 `location /auth/` → auth-bff**（社交 callback + 16c reset + 12 手机码都走 `/auth/*`）。
- [ ] **RP env 有 `OIDC_ISSUER=https://accounts.vxture.com`**（website/console/admin-bff）：RP 用它拼浏览器 authorize 重定向 + discovery；缺 → 默认 `localhost:3090`，authorize URL host 错。
- [ ] **机密客户端密钥已 provision**（坑 #13）：`27-provision-client-secrets` 已写 `OIDC_CLIENT_SECRET`（三 RP）+ `OIDC_CLIENT_SECRET_HASH_*`（`.env.auth-bff`），且 `23-seed` 已把 hash 写进 `iam.oidc_client.client_secret_hash`（三行非空）。缺 → RP 换 token 401 `invalid_client`。
- [ ] **签名密钥已 provision**（坑 #12）：`curl -s https://accounts.vxture.com/oidc/jwks` 有 key（非 `{"keys":[]}`）；`platform-identity.env` 非 CHANGEME。缺 → token 端点 400 `temporarily_unavailable`。改 env 后必 **recreate**（非 restart）auth-bff。
- [ ] **端口认知**：生产 `accounts.vxture.com` 后 nginx 分流 `/oidc`+`/auth`+`/.well-known`→`vx-auth-bff:3090`（IdP）、`/`→`vx-accounts:3000`（登录 UI）。3040 仅本地 dev 端口。`OIDC_ISSUER`=域名（非端口）。

### 3.4 DB 首次初始化 / 重置

> 旧库 schema 不兼容新 baseline → 必须重置（**销毁旧数据**，仅适用于数据可弃环境）。
>
> **一次性脚本（推荐）**：`CONFIRM_RESET_DB=yes bash scripts/26-reset-platform-database.sh` —— 停应用容器 → 从 `DATABASE_URL` 解析库名+超级用户 → drop+recreate 空库 → 21 检查 → 22 migrate(baseline) → 23 seed → `docker start` 重启现有容器（`30` 不跑：`VX_IMAGE_TAG` 默认 `latest` 手动跑会拉错镜像）。
>
> **⚠️ 密钥 provision 必须确认（坑 #12/#13 根因）**：reset/seed **不会**自动具备两类密钥——
>
> - **签名密钥（25）**：仅当 `platform-identity.env` 的 `OIDC_ACTIVE_KID`/`OIDC_SIGNING_PRIVATE_KEY` 已是有效真值（`curl /oidc/jwks` 有 key）才可跳过 25；首发即 CHANGEME → 必跑 `25-provision-signing-key` 再 recreate auth-bff，否则 token 端点 400 `temporarily_unavailable`。
> - **机密客户端密钥（27）**：`OIDC_CLIENT_SECRET`（三 RP）+ `OIDC_CLIENT_SECRET_HASH_*`（`.env.auth-bff`）须已 provision 且 seed 已把 hash 写进 `iam.oidc_client`，否则 RP 换 token 401 `invalid_client`。`27-provision-client-secrets` 幂等生成；reset 后**必须重跑 23-seed** 让 hash 进库。

等价手动步骤：

```bash
cd /srv/vxture/deploy
# a) 停 DB-连接的应用容器
docker stop vx-auth-bff vx-console-bff vx-website-bff vx-admin-bff
# b) drop+recreate 空库（经 template1，超级用户=POSTGRES_USER，本环境=vxture）
docker exec vx-platform-pg psql -U vxture -d template1 -c \
  "DROP DATABASE IF EXISTS platform_main WITH (FORCE); CREATE DATABASE platform_main OWNER vxture;"
# c) 21 检查（含 env 审计）
bash scripts/21-prepare-platform-database.sh
# d) 22 migrate(baseline) + 23 seed(catalog)
env SKIP_DB_CHECK=1 CONFIRM_MIGRATE=yes bash scripts/22-run-platform-migrations.sh
env SKIP_DB_CHECK=1 CONFIRM_SEED=yes bash scripts/23-seed-platform-database.sh
# e) 重启现有应用容器（同一镜像）
docker start vx-auth-bff vx-console-bff vx-website-bff vx-admin-bff
```

**验证**：`23-seed` 日志 `SSO provider 凭证注入：9 项` + 逐行 `✓ oauth_provider — google/feishu/dingtalk (is_enabled=true)`、无 ROLLBACK；`select code,is_enabled,redirect_uri from identity.oauth_provider` 三行 `is_enabled=t` + 新回调。

### 3.5 踩坑录（postmortem，根因 + 已修）

| #   | 现象                                                                    | 根因                                                                                                                                           | 修复                                                                                                                 |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `docker-build` `ERR_PNPM_OUTDATED_LOCKFILE`                             | Batch 11.3 删 console-bff `@nestjs/jwt` 没重生成 lockfile（tag 构建 frozen 首次暴露）                                                          | `pnpm install --lockfile-only`（`04f2608c`）                                                                         |
| 2   | 社交 callback / 16c reset / 12 手机码生产 404                           | `accounts.vxture.com` nginx 只反代 `/oidc`，没 `/auth/`                                                                                        | 加 `location /auth/`（`609fbe00`）                                                                                   |
| 3   | `.env.auth-bff.example` 回调旧路径 + 缺 Google                          | 例子陈旧（api.vxture.com/auth-api，无 Google 块）                                                                                              | 改 canonical + 补 Google（`609fbe00`）                                                                               |
| 4   | seed 后 google 永 `is_enabled=false`                                    | `23-seed` 投影 SSO 密钥的硬编码 list 漏 Google 3 个                                                                                            | 补 Google（`d3e952ac`）                                                                                              |
| 5   | 部署 env-audit gate 拦                                                  | `.env.admin-bff` 残留 Turnstile 键（forbidden）；`.env.auth-bff` `CF_TURNSTILE_ADMIN_SECRET_KEY=CHANGEME`                                      | 手修运行时文件                                                                                                       |
| 6   | audit 漏报缺 `OIDC_ISSUER`                                              | `39-audit` auth-bff requiredKeys 漏 `OIDC_ISSUER`/`LOGIN_UI`/portal URLs                                                                       | 补（`8b9c27cc`）                                                                                                     |
| 7   | seed `column "code" of relation "permission" does not exist`            | `VXTURE_DEPLOY_HOST platform_main` 是旧 schema，新 baseline 从没应用                                                                           | §3.4 reset → 22-migrate → 23-seed                                                                                    |
| 8   | `vx-admin-bff` unhealthy（bootstrap 卡在 OidcRpModule 后无 listen）     | commerce `ProvisioningModule`/`Dispatcher` 域泄漏致 Nest bootstrap 死锁（详见 operator §4 P0.1）                                               | 删 admin-bff 残留 `Provisioning` deps + 同步 lockfile（P0.1 已修，生产已恢复 healthy）                               |
| 9   | 浏览器 authorize URL host = `http://localhost:3090`                     | RP env example（website/console/admin-bff）没设 `OIDC_ISSUER` → schema 默认 localhost:3090                                                     | RP example 补 `OIDC_ISSUER=https://accounts.vxture.com` + audit requiredKeys                                         |
| 10  | seed `凭证注入：N 项` 里 google 缺失                                    | 旧 23-seed 投影循环漏 Google（"N 项"=key×2 数组元素）                                                                                          | 循环补 Google 3 键 → 重跑 seed（18 项=9key）                                                                         |
| 11  | authorize 报 `invalid_redirect_uri`（host 已对）                        | `23-seed` 没投影 `*_BASE_URL` → seed-catalog 用 localhost 默认拼 `oidc_client` redirect_uris                                                   | 23-seed 投影 WEBSITE/CONSOLE/ADMIN/ACCOUNTS_BASE_URL（ACCOUNTS 兜底 LOGIN_UI）→ 重跑                                 |
| 12  | 社交 RP `/auth/callback` 500，底层 token 400（temporarily_unavailable） | **签名密钥从没 provision**：`OIDC_ACTIVE_KID`/`OIDC_SIGNING_PRIVATE_KEY` 仍 CHANGEME，`/oidc/jwks` 返 `{"keys":[]}`；reset 时误跳过 25         | 跑 `25-provision-signing-key` → 填 KID+私钥进 `platform-identity.env` → **recreate**（非 restart）auth-bff           |
| 13  | 社交 RP `/auth/callback` 500，底层 token 401（invalid_client）          | **机密客户端密钥从没接入**：三 RP `OIDC_CLIENT_SECRET` 全空、DB `client_secret_hash` 全 NULL；`23-seed` 投影列表漏 `OIDC_CLIENT_SECRET_HASH_*` | 新增 `27-provision-client-secrets`；23-seed 补投影 3 hash；example+audit 补键；db-init 加 `provision-secrets` action |

**教训**：① 删依赖必同步 lockfile；② 改路由/端点必同步 nginx + example + seed 投影三处；③ 首次部署=先 migrate+seed 再验，别假设 regular-upgrade 会建库；④ env example 改动后运行时文件靠 `12-generate` **只追加不覆盖**——旧值要手核；⑤ **首发必 provision 两类密钥**（签名密钥 25 + 机密客户端密钥 27）——都不在镜像里、首发从不自动有值，缺任一在 token 交换炸（400/401），容器 healthy 不暴露；⑥ `env_file` 改动只在容器 **recreate** 时加载，`docker restart` 不重读。

---

## 4. operator 安全实施任务（workforce realm）

> `docs/30-design/identity-platform-operator.md`（权威设计）的可落实执行计划。纪律：**P0 是其余相位硬前置**；每相位单独验收；走 CI/CD `feature/operator-identity-security → develop → beta → main → VXTURE_DEPLOY_HOST`，每跳确认。全部 `ops.operator_*`，对 `identity/iam` 零 FK。字段级全表见 **b§14**。

### 4.1 相位总览

| 相位   | 主题                                        | 依赖 | 任务数 | 状态 |
| ------ | ------------------------------------------- | ---- | ------ | ---- |
| **P0** | 前置解阻（boot + 登录 bug）                 | —    | 2      | ✅   |
| **P1** | operator 数据模型重建（`ops.operator_*`）   | P0   | 5      | ✅   |
| **P2** | MFA 核心（两步登录 + TOTP + 策略 + 恢复码） | P1   | 6      | ✅   |
| **P3** | WebAuthn/Passkey（高权限抗钓鱼）            | P2   | 4      | ✅   |
| **P4** | 会话加固 + step-up + 检测                   | P2   | 4      | ✅\* |

> rollout 现状：P0–P3 已上 develop + beta（`22e49219`）；P4 在分支 `feature/operator-session-hardening`（未 push），可选 P4.4 延后；活体 e2e 待部署真人验。部署前置 env：`OPERATOR_TOTP_ENC_KEY`/`WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`/`OPERATOR_SESSION_TTL`/`AUTH_INTERNAL_TOKEN` + `transports text[]` 迁移。

### 4.2 关键任务

- **P0.1 修 admin-bff bootstrap 死锁** ✅：核心已于 #273（`648a527a`）合入 develop；删 `package.json` 残留 deps `@nestjs/schedule`/`@vxture/service-provisioning` + 同步 lockfile。admin-bff src 零 `Provisioning` 引用，`type-check` 绿。（与踩坑录 #8 同源。）
- **P0.2 修 admin「二次登录」bug** ✅：session 自检改打 `/auth/session`（轻量 RP 探针），区分 transient(5xx/网络) vs 未登录(401)，加一次重试；`AdminSessionProvider` 的 `restoreSession().then` 补 `.catch`。
- **P1（数据模型重建）** ✅：写 `ops.operator_*` Prisma 模型 11 表（`account`/`credential`/`mfa`/`webauthn_credential`/`recovery_code`/`verification`/`login_attempt`/`refresh_token`/`role`/`permission`/`role_permission`）+ 镜像 `deploy/database/prisma/schema.prisma`；重建单一干净 baseline（对 `identity.*`/`iam.role|permission` 零 FK）；统一 seed（`operator_account` + `operator_credential` **Argon2id** + 角色权限 + `operator_mfa` 默认策略 `ops.setting operator.mfa.policy`）；repo/service 切新表（`PgOperatorRepository`/`PlatformAuthService`，**bcrypt→Argon2id**）；修跨域泄漏（`refresh`/`login_attempt`/`verification` 改写 `ops.operator*_`，停写 `identity._`）。
- **P2（MFA 核心）** ✅\*：MFA 策略解析 `effective = max(平台默认, 角色下限, 个人覆盖)`（取最严）；两步登录状态机 Step1 首因子→`mfa_pending`（Redis 快照含 challenge）→Step2 `/oidc/authorize/mfa/verify`；TOTP enroll（otpauth+二维码、首码确认、secret **AES-256-GCM 落库**）+ verify（±1 窗、限流锁定、写 `operator_login_attempt`）；恢复码（生成 10×128bit → SHA-256 哈希落库、单次、仅展示一次、`consumeRecoveryCode` 原子置 `used_at`）；登录 UI（accounts `OperatorMfaFlow` verify/enroll/recovery 三步 + `TotpQrCode`，不改 design-system）；`amr`/`acr` + 独立审计（token+会话写 `amr`，`support.audit_log(actor_type=operator)` 落 `OperatorLogin`/`MfaVerify`/`MfaEnroll`）。活体 e2e 随 UI/部署。
- **P3（WebAuthn/Passkey）** ✅\*：`@simplewebauthn` v13；注册（challenge→attestation'none' 校验→存 `operator_webauthn_credential`，rpID/origin 来自 env fail-closed，`transports`→`text[]` 单一 baseline 0 drift）；断言第二因子（`sign_count` 防克隆回退，`isWebauthnCounterRegression`）；高权限强制（`operator_mfa.webauthn_required` → `decideMfa` 强制仅 passkey，WebAuthn enroll-on-login 解死锁，seed flag 留 false opt-in）；凭据管理 UI（`OperatorPasskeyManager` + `/security/passkeys`，防自锁 `last_webauthn_credential` 不可删）。真机 Windows Hello/Touch ID 活体随部署。
- **P4（会话加固+step-up+检测）** ✅\*：operator 短会话 TTL（`OPERATOR_SESSION_IDLE_TTL`=1800 / `OPERATOR_SESSION_ABS_TTL`=28800，tenant 不变）；高危 step-up 重认证（IdP `/internal/operator/stepup/totp` 签短时 step-up JWT `aud=admin`/`stepup`/`exp300`，admin-bff `@RequireStepUp` guard 校验并**绑 session sub**，挂 `admin-roles PUT :id/permissions`）；异常检测（`detectLoginAnomalies` new_ip/new_device 首登不报 + `evaluateFailureSpike` 5/15min → `support.audit_log`(AnomalousLogin/LoginFailureSpike) + `MailService` 邮件，best-effort 不阻断）；P4.4 会话镜像 + trusted-device **⬜ deferred**（起步阶段最小化，按需后续）。

### 4.3 隔离红线（每相位回归）

operator token 到租户 RP 被拒、反之亦然；operator 登录不静默进 console；`ops.operator_*` 对 `identity/iam` 零 FK。刻意取舍：不采用 mTLS/Cf-Access 作登录层、不用短信作唯一 MFA、不联邦第三方 IdP（operator 身份只留 vxture，决策 OP-V2）。

---

## 5. website RP 迁移（认证面归属 + 拆分）

> 目标态：website 与 console 一样**自身不渲染认证表单**——登录/注册走 accounts 中央面，website-bff 退化为纯 OIDC RP，进入统一 SSO/SLO。决策 D-AZ：先出方案不动手；本轮范围 = 16a+16b+16c，16d 社交独立批。机制规则见 [`identity-platform-access-topology.md`](./110-access-topology.md)（SSO/SLO/同源/跨域）。

### 5.1 现状（website vs console 模板）

website 的 RP **后端已就绪但未启用**，前端仍 legacy，且比 console 多很多认证面：

| 件                                              | website 现状                                                                         | console 模板                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| website-bff `oidc-rp.module`/`oidc-auth.router` | ✅ 在，但 `OIDC_RP_ENABLED=false` 默认关；无 back-channel；logout POST 本地清        | ✅ 启用、有 back-channel、GET logout→end_session |
| website-bff `auth.middleware`                   | ✅ 非阻断 RP-aware                                                                   | ✅ 阻断 RP-only                                  |
| portal signin                                   | ❌ 内嵌 `LoginForm`（密码+手机 tab）                                                 | 跳 accounts（`buildRpLoginUrl`）                 |
| portal middleware                               | ⚠️ 按 legacy `vx_tenant_*` cookie                                                    | 按 `vx_rp_session`                               |
| **额外内嵌面**                                  | signup / phone / bind-phone(社交) / reset-password / set-nickname / verify(租户类型) | 无                                               |

### 5.2 各认证面新模型归属

| 认证面                       | 新模型归属                                | website 处置                              |
| ---------------------------- | ----------------------------------------- | ----------------------------------------- |
| 登录（3 标识+密码 / 手机码） | **accounts 中央面**                       | signin 跳 accounts，退役 `LoginForm`      |
| 注册                         | **accounts**（手机码即注册 D-BA）         | 退役 `SignupForm`；无需显式 register 表单 |
| 手机登录                     | accounts（手机 tab）                      | 退役内嵌 phone                            |
| 社交登录 + bind-phone        | **随社交联邦**（16d）                     | 内嵌 bind-phone 退役/冻结，随社交批次重做 |
| 重置密码                     | **accounts**（16c）                       | 收编到 accounts `/reset-password`         |
| set-nickname（登录后补料）   | **RP-local 登录后页**（非认证面）         | 保留为 website 登录后普通页               |
| verify（注册后租户类型）     | **废弃**（D-BC，PLG 自动建 personal org） | drop                                      |

### 5.3 迁移子批次（Batch 16 实施）

- **16a ✅ 完成（2026-06-15，真人验收）— 登录 RP 迁移 + 同源 + SLO**（= console 11+14+15 的 website 版）：
  - website-bff：`RpRuntime` 加 `postLogoutRedirectUri`；`oidc-rp.module` **移除 `OIDC_RP_ENABLED` 读取、`enabled:true` 硬置（D-BD）**；logout 由 POST 本地清改 `GET→buildEndSessionUrl`（post_logout=accounts `/logout?client=website`）；新增 `POST /auth/backchannel-logout`（verifyLogoutToken→destroyBySid）。
  - website portal：`signin` 跳 `buildRpLoginUrl`（退役 `LoginForm`）；`middleware` 改按 `vx_rp_session`、matcher 排除 `/auth/*`；`Header` 退出统一 `buildLogoutUrl()` top-level SLO。**偏离记录**：会话展示**保留 `/api/me`**（未改读 `/auth/session`）——非阻断 `auth.middleware` 已从 RP 会话填 `req.user`，`/api/me`(MeRouter) 走 RP 会话且返 DB 实时 `AuthUserDto`（比 claims 更全），store 零改动。
  - 同源+构建：`vxture.com.conf` 加 `/auth`+`/api`→`vx-website-bff:3011`（`=/api/health`→portal）；`Dockerfile.nextjs` + `images.mjs` 加 `NEXT_PUBLIC_WEBSITE_BFF_URL=https://vxture.com`；`next.config` dev 同源 shim（`LOCAL_BFF_PROXY_URL`）。数据面由 `api.vxture.com` 网关切到同源 website-bff。
  - 真人验收 ✅：A 未登录 website→accounts 登录→回；B **跨 RP 同登录**（一次登录 website+console 同在线，中央 `vx_sid`）；C **跨 RP 同登出**（website 退出→accounts 统一退出页→console back-channel 已登出）。
  - e2e 启动须知：本地 issuer(3090)≠accounts(3040)，RP-BFF 须注入 `OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3040/logout`（prod issuer==accounts 时默认即可）；DB=`identity_e2e`；website 客户端登记 redirect 3010 / post_logout 3040 / back-channel 3011。
- **16b ✅ 完成（2026-06-15）— 注册收编 accounts**：`signup`/`register`/`login`(别名) 改重定向 accounts RP 登录（`buildRpLoginUrl`，登录即注册 D-BA）；`verify` 按 **D-BC 废弃**（重定向首页）；删 `SignupForm`/`VerifyForm`/`LoginForm` + 注册入口链接由 `/signup` 改指 `/signin`。
- **16c ✅ 完成（2026-06-15）— 重置密码**（D-BB；**D-BE=A 邮箱链接**）：IdP 后端 `password-reset.repository`（`identity.password_reset_token`：token=randomBytes(32)→存 sha256/TTL 15min、**原子一次性 consume**）+ `AuthnService.requestPasswordReset`（查邮箱→签 token→`${LOGIN_UI_BASE_URL}/reset-password?token=`→`MailService.sendPasswordReset`，投递失败吞掉）+ `resetPassword`（→`AccountService.setPassword` Argon2id）+ `AuthnController` `POST /auth/forgot-password`（**恒 200 防枚举**）+ `POST /auth/reset-password`（缺字段/弱密码/坏 token→400）。accounts 前端 `/forgot-password`+`/reset-password?token=` + 登录面「忘记密码？」（仅 tenant realm，复用 design-system panel 未改 DS）。实测：happy 200 + Argon2id 实证改密、replay/expired/unknown/missing/short 全 400；邮件本地无 SMTP 不真发（prod 配置）。
- **16d ✅ 代码完成（2026-06-15）— 社交登录 + bind-phone**（D-BF 三 provider；D-BG 凭据；D-BH 按钮 accounts 本地）：IdP 经纪式 OAuth——`OAuthProviderRegistry`（表驱动 `oauth_provider` 按 code 实例化适配器）+ Redis `vx:oauth:state`(带 login_challenge)/`vx:oauth:bind` 一次性 store + `GET /auth/oauth/:provider/start`+`/callback`（命中登录 / 带手机自动建号+绑定 / 无手机签 bindToken→bind-phone）+ `POST /auth/oauth/bind-phone`（先验码后销 token）+ `/auth/oauth/providers` + `OidcService.completeLoginWithUser`；email 绝不自动并号，建号只写 phone+name。accounts `SocialLoginButtons`（接 `OidcLoginForm` social 槽，仅 tenant）+ `/bind-phone?binding_token=` 页 + `BindPhonePanel`（复用 `AuthPhoneLoginPanel`）。后端 commit `3cffb6de`；沿用现状：适配器 state-only CSRF（无 PKCE），state/bind 用 Redis 非 `oauth_state` 表。自动化实测全过；**16d.5 真实 provider 真人 e2e 待用户凭据**（D-BG）。

> 16d.5 生产闭合（2026-06-17，worker01）与 SMS 演进见 §5.4。社交登录账号合并/邮箱回填细节见 [`identity-platform-account.md`](./050-account.md)。

### 5.4 收尾留项与关联演进

- **legacy `/api/auth/*` seam 退役 ✅（2026-06-15，`4ef1031f`）**：删 website-bff `auth.router`/`phone-auth.router`/`verifycode.router`（`/api/auth/*`、`/api/send-code`、`/api/verify-code` 全 404）+ 注销（含 `MailModule`）+ 清 `auth.middleware` 死白名单；删 website 旧页 `reset-password`/`bind-phone`(+表单) + `useAuth`；裁 `auth.api`（仅留 `buildAuthUrl`+RP-backed `/api/me*`）+ store `login/signup/logout` action。**保留**：`MeRouter`、`getProfile`、`restoreSession`/`AuthSessionBootstrap`、`set-nickname` 登录后页、`WebsiteAuthService`（middleware 用）。boot 实测：`/api/auth/*` 404、`/api/me` 401、`/auth/login` 302。
- **console legacy reset 清退 ✅（2026-06-22，Batch C1）**：删 console `(auth)/reset-password` 页 + `ResetPasswordForm` + `console-bff.ts` `resetPassword` wrapper。至此 **website/console/admin 三 portal 零本地认证表单**。
- **16d.5 worker01 社交登录闭合（2026-06-17）**：feishu+dingtalk 在 website+console 真人实测正常（Google 暂缓——纯网络出海，auth-bff 容器境内连不上 google，需改服务器网络，非代码可解，见 [`identity-platform-idp.md`](./070-idp.md) 关联 Google egress）。修三类首发部署坑对应踩坑录 #12/#13/#14。
- **SMS 演进**：Batch 12 由「建 SMS」collapse 为「验证+启用+补 Turnstile」（`@vxture/service-sms` 早已真实实现并接入 IdP）；2026-06-29（PR #519）改用号码认证服务 Dypnsapi 并上生产（弃 Dysmsapi 自管码→托管 `SendSmsVerifyCode`/`CheckSmsVerifyCode`），真机 send=OK/verify=PASS。

### 5.5 决策记录（已定 2026-06-15）

- **D-AZ-scope** = 本轮 16a+16b+16c 同批，16d 社交 future。
- **D-BA** = 仅手机码即注册（维持现状），website `SignupForm` 退役。
- **D-BB** = 本轮建 accounts reset。
- **D-BC** = 废弃 verify/租户类型（注册即自动 personal org；默认租户属 console active-org，post-MVP）。
- **D-BD** = 移除 `OIDC_RP_ENABLED` 灰度开关（恒 on、legacy 退役）。
- **D-BE = A 邮箱链接**（行业标准）：标识=邮箱，一次性链接；手机码注册的无密码/无邮箱用户不适用 reset（其用手机码登录本无密码）；手机短信码重置（B）留后续可选。
- **D-BF** = 16d 三 provider 全做（Google 触发 bind-phone；Feishu/DingTalk userinfo 带手机号自动建号）。
- **D-BG** = 真实凭据真人验收（16d.5 待凭据单独验）。
- **D-BH** = 社交按钮放 accounts 本地（不进 design-system，守工作线隔离）。

---

## 6. 收尾与退桥（归档要点：p5-closeout / p3-ruyin）

> 以下两稿为 P0–P5 相位框架下的完成计划稿，已被实际 Batch 1–16 执行取代（HS256 全退役已于 Batch 4 完成），仅存残留计划项与历史价值。原稿 `identity-sso-p5-closeout` / `identity-sso-p3-ruyin` 已并入本节、源文件已删。

### 6.1 P5 收尾——退役旧链路 + 文档收口

**前置（硬门槛）**：console/website/admin/ruyin/xuanzhen/hermes 全部 OIDC RP 上线且验证通过；**指标确认旧链路零流量**（不靠推断）。**P5 是「删」与「对齐」，不加新功能；是 legacy 不可逆点**——此前回退开关（`OIDC_RP_ENABLED=off` 等）删除后失效。

退役清单：

| 类         | 旧物                                                                                     | 由谁取代 / 处理                                              |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 代码/路径  | auth-bff 旧自定义 JWT 端点（`/auth/login`/`/signup`/`/refresh`/`/logout`/`/tenant/*`）   | IdP `/authorize`…`/token` + RP-BFF                           |
| 代码/路径  | `/auth/internal/sign`（admin delegate-sign）、`crossdomain.router`                       | admin OIDC RP / ruyin OIDC（**crossdomain 已删**）           |
| 代码/路径  | HS256 签名 + `JwtAuthGuard` HS256 验签、RP-BFF 双读中间件 legacy 分支、`OIDC_RP_ENABLED` | RS256+JWKS / 单一 OIDC RP 会话 / 恒 on                       |
| cookie     | `vx_tenant_*`、`vx_admin_*`、`ry_*`                                                      | 停写 + 清理逻辑移除                                          |
| Redis      | `vx:refresh:tenant:*`、`vx:refresh:operator:*`、`vx:crossdomain:*`                       | 停用；新路径用 `vx:oidc:rt:*`/`vx:sess:*`                    |
| Redis 保留 | `vx:blacklist:*`、`vx:oauth:state/bind:*`                                                | **保留**（OIDC 仍用：jti 吊销、入站 broker）                 |
| secret     | `JWT_SECRET`、`JWT_REFRESH_SECRET`、`AUTH_INTERNAL_TOKEN`                                | HS256 路径下线后移除；RS256 私钥（`OIDC_SIGNING_KEY_*`）保留 |

**安全退役顺序**（零流量门槛 + 金丝雀，逐项一 PR）：① 全平台 `OIDC_RP_ENABLED=on` → ② 观测窗确认旧端点/cookie/HS256 零流量（持续 N 天）→ ③ 删 RP-BFF 双读 legacy 分支 → ④ 删 auth-bff 旧 JWT 端点 + HS256 + `/auth/internal/sign` → ⑤ 删旧 Redis key 用法 → ⑥ 移除 `OIDC_RP_ENABLED` → ⑦ 下线 secret → ⑧ 文档收口。每步前用真实指标确认零流量（不靠推断），先停用后删除。

**D-9 认证服务正名归位**（属「对齐」不引入新逻辑，post-MVP，= Batch 20）：`bff/auth-bff` → `services/identity/server` = `identity-server`——legacy 下线后它只剩 OIDC IdP，此刻搬迁最干净（改 `SERVICE_PATH`/包名/镜像名 `identity-server`/compose `vx-identity-server`/nginx 上游；accounts 反代落点不变；`Dockerfile.nestjs` 按 `SERVICE_PATH` 参数化，无结构改）。硬前置 = 所有 RP 切 OIDC 且旧链路零流量（实测）。

**文档收口（D-8）**：`docs/30-design/db/schemas/*.sql` 校正/标废弃指向 Prisma baseline；`docs/30-design/auth.md`/`session.md` 标 superseded；ADR-001 补记 HS256→RS256 演进；glossary 补 `oidc_client`/`realm`/`vx_sid`/RP session/`sub` 命名空间（`usr_`/`opr_`）。

### 6.2 P3 ruyin——跨域接入 + 退桥（已完成，ruyin 已迁出外部仓）

> 一次性 token 桥已退役、ruyin 已迁出至外部仓 `vxture/agentstudio-ruyin`。对外契约见 [`identity-platform-ruyin-contract.md`](./140-ruyin-contract.md)（仍生效）+ [`identity-platform-rp-integration.md`](./080-rp-integration.md)。此处仅存跨域机制要点。

- **跨域 vs 子域差异**：`vx_sid` 在 `.vxture.com`，浏览器**不发给 ruyin.ai**；SSO 靠**顶级跳转落 IdP 域**（`ruyin.ai → /auth/login → accounts.vxture.com/authorize`，此时浏览器对 accounts 是第一方，`vx_sid`(SameSite=Lax) 携带 → 静默发码 → 回 ruyin）。**必须顶级跳转**（非 iframe/非 XHR，三方 cookie 限制）。RP 会话 cookie = `__Host-vx_rp_session`（`ruyin.ai` host-only，独立）。
- **back-channel logout = ruyin 唯一登出联动手段**：全局登出销毁 `.vxture.com` 的 `vx_sid` 清不掉 ruyin 跨域 RP cookie → 杀 ruyin 会话**唯一**途径是 OIDC back-channel（IdP→ruyin 服务端）。`oidc_client(ruyin).back_channel_logout_uri = https://ruyin.ai/auth/backchannel-logout`（**必填**）。对比子域 RP 的 back-channel 是兜底（另有父域 cookie 失效），ruyin 是唯一。
- **business-app 特性**：entitlement 硬门控（per-app，`status∈{active,trial,past_due}` 且未过期放行，否则跳订阅页）——这是 ruyin 与 console/website（平台界面无门控）的关键区别；`active_tenant`=个人租户恒定、无切租户；业务角色（任务负责人/审核员）在 ruyin 自有库、不进 token；业务库只引用 `tenant_id`/`user_id`(=`sub`)。
- **退桥（B2，已完成）**：并存上线（双读新 `__Host-vx_rp_session` 优先、回落 `ry_*`）→ 灰度切换（`OIDC_RP_ENABLED=on`）→ 验证全绿 → 删 `crossdomain.router`（`/auth/crossdomain/token`、`/verify`）+ `vx:crossdomain:*` + ruyin `ry_*` cookie + console→ruyin 一次性 token 触发。注意：退役的是**桥**；HS256 共享密钥旧链路随 P5 一起退（§6.1）。

---

## 附. 关联文档

- 架构层：[`identity-platform-architecture.md`](./040-architecture.md)（板块定位/模型/拓扑/边界/ADR 索引）。
- 详细层：[`identity-platform-idp.md`](./070-idp.md)（IdP 机制）/ [`identity-platform-account.md`](./050-account.md)（账号与认证）/ [`identity-platform-access-topology.md`](./110-access-topology.md)（SSO/SLO/同源/跨域）/ [`identity-platform-authorization.md`](./060-authorization.md)（RBAC 执行）/ [`identity-platform-rp-integration.md`](./080-rp-integration.md)（RP 接入）/ [`identity-platform-operator.md`](./090-operator.md)（operator 安全权威）。
- 数据落地：[`data_platform_300_migration.md`](../data_platform_300_migration.md)（c）；字段级 a/b。
- 归档：[`identity-platform-decisions.md`](./130-decisions.md)（决策台账）；`identity-sso-p5-closeout` / `identity-sso-p3-ruyin` 已并入本文 §6。
