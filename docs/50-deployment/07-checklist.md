# 部署检查清单

> 更新：2026-06-07
> 依赖文档：[`00-overview.md`](./00-overview.md) · [`04-services.md`](./04-services.md) · [`01-environments.md`](./01-environments.md) · [`08-code-environment-map.md`](./08-code-environment-map.md)

本检查单只覆盖 `vxture` 仓库的 平台部署。vx-worker-02 业务 beta/prod 部署由外部业务仓库维护。

---

## 一、部署前检查

### 1.1 版本基线

- [ ] 新 VXTURE_DEPLOY_HOST 目标系统为 Ubuntu 26.04 LTS
- [ ] Node / pnpm / Docker / Compose 符合 [`10-version-baseline.md`](./10-version-baseline.md)
- [ ] CI、Dockerfile、部署脚本不再使用 Node 22 历史基线
- [ ] Nginx 使用 `nginx:1.29-alpine`，不使用裸 `nginx:alpine`

### 1.2 代码与构建

- [ ] `main` 分支已合并所有计划变更，无未审核 PR
- [ ] `pnpm type-check`（各包）无类型错误
- [ ] `pnpm lint`（根目录递归）无 lint 错误
- [ ] `pnpm build`（受影响的包）本地构建成功

### 1.3 数据库

- [ ] 所有 Prisma migration 脚本已提交（`prisma migrate diff` 无未提交变更）
- [ ] 迁移在 staging / 开发环境验证通过
- [ ] 若有破坏性变更（删列/重命名），已准备数据回填脚本
- [ ] 已对 `vx-platform-pg` 做快照（阿里云云盘 → 手动快照）
- [ ] 常规升级不自动执行 migration / seed；如需迁移或补种，已安排人工维护窗口执行 `22` / `23` 或首次部署聚合脚本 `24`

### 1.4 环境变量

- [ ] VXTURE_DEPLOY_HOST `secrets/platform.env` 中以下共享密钥均已设置：
  - `DATABASE_URL`（指向阿里云 RDS 内网 endpoint）
  - `REDIS_URL`（指向阿里云 Tair 内网 endpoint）
  - `JWT_SECRET`（≥32 位）
  - `JWT_REFRESH_SECRET`（≥32 位，且不同于 `JWT_SECRET`）
  - `AUTH_INTERNAL_TOKEN`
- [ ] VXTURE_DEPLOY_HOST `secrets/tair-pw-default` 已存在且非空；`.env` 和 `secrets/platform.env` 均不含 `REDIS_PASSWORD`。
- [ ] `DATABASE_URL` 密码与 `secrets/rds-pw-platform_svc` 一致，`REDIS_URL` 密码与 `secrets/tair-pw-default` 一致。
- [ ] RDS 白名单已放行 VXTURE_DEPLOY_HOST 内网 IP；`secrets/rds-owner.env` 与 `secrets/rds-pw-*` 已置备（0600）。库数据无需保留的重建走 `scripts/26-reset-platform-database.sh`。
- [ ] VXTURE_DEPLOY_HOST `secrets/platform-mail.env` 中 `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` 均已设置。
- [ ] VXTURE_DEPLOY_HOST `.env.auth-bff` 含 tenant + operator(admin) 两套 Turnstile secret（IdP 统一校验）。
- [ ] VXTURE*DEPLOY_HOST `.env.admin-bff` 不含任何 `CF_TURNSTILE*\*`（admin-bff 已 RP-only，不校验 Turnstile）。
- [ ] VXTURE*DEPLOY_HOST `.env.website-bff` / `.env.console-bff` 不含 `CF_TURNSTILE*\_`、`DINGTALK\_\_`、`FEISHU\_\*`。
- [ ] VXTURE_DEPLOY_HOST `secrets/platform-sms.env` 中 `ALIYUN_SMS_ACCESS_KEY_ID` / `ALIYUN_SMS_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE` 均已设置（手机验证码登录；缺失则 `@vxture/service-sms` 降级 `console.log` 不真发）。
- [ ] VXTURE_DEPLOY_HOST `.env.auth-bff` 的 `OIDC_ISSUER` / `LOGIN_UI_BASE_URL` = `https://accounts.vxture.com`，`CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES` 含 `accounts.vxture.com`（租户登录面）。
- [ ] VXTURE_DEPLOY_HOST `secrets/platform-identity.env` 的 `OIDC_ACTIVE_KID` / `OIDC_SIGNING_PRIVATE_KEY` 由首次部署阶段 `25` provision 后粘贴（见 §1.6 与 §二）。
- [ ] 所有 `.env.*` 和 `secrets/platform.env` 均不含 `SMTP_*` / `ALIYUN_SMS_*` / `OIDC_SIGNING_PRIVATE_KEY`（这些各归 `platform-mail.env` / `platform-sms.env` / `platform-identity.env`）。
- [ ] `AUTH_COOKIE_DOMAIN=.vxture.com` 已在相关 BFF env 中设置。
- [ ] 新增或删除的变量已同步到对应 `.env.*.example`，并可通过 `scripts/13-prepare-runtime-env.sh` 调用 `scripts/12-generate-env-files.sh` 补齐 runtime。

### 1.5 DNS / Nginx

- [ ] Cloudflare DNS 记录正确（参考 [`subdomain-dns.md`](./06-subdomain-dns.md)）
- [ ] Nginx 配置语法检查：`nginx -t`
- [ ] SSL 证书有效期 > 30 天（Let's Encrypt 自动续期或手动确认）

### 1.6 Identity 平台密钥与凭证填值（首次部署，CHANGEME → 真值顺序）

> auth-bff 即 IdP：负责 RS256 签发、手机验证码、租户/运营 Turnstile。各项以占位 `CHANGEME`
> 起步，按下列顺序填真值。`12-generate-env-files.sh` 已从 `.example` 生成对应 runtime 文件。

1. **Cloudflare Turnstile**
   - `.env.auth-bff`：`CF_TURNSTILE_TENANT_SECRET_KEY`、`CF_TURNSTILE_ADMIN_SECRET_KEY` 填真值；保持 `CF_TURNSTILE_ENABLED=true`。
   - CI secret：设置 `CF_TURNSTILE_TENANT_SITE_KEY`、`CF_TURNSTILE_ADMIN_SITE_KEY`（site key 在 accounts 构建期 baked 进前端，见 [`05-ci-cd.md`](./05-ci-cd.md)）。
   - hostname：`CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES` 含 `accounts.vxture.com`；`CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES=accounts.vxture.com`。
2. **阿里云短信（手机验证码登录）**
   - `secrets/platform-sms.env`：`ALIYUN_SMS_ACCESS_KEY_ID/SECRET/SIGN_NAME/TEMPLATE_CODE` 填真值。缺失时非生产降级 `console.log`（不真发）；**生产 fail-closed**（发码抛错、验码全拒，2026-07-21 起）。注入 auth-bff 与 console-bff（换绑手机流程）。
3. **运营超管口令（任何 seed 之前）**
   - `.env.auth-bff`：`OPERATOR_SUPERADMIN_PASSWORD_HASH` 填 owner 自选口令的 Argon2id PHC hash（hash-wasm argon2id，m=65536 t=3 p=1），**值须单引号包裹**（seed 脚本以 shell source 读取，未加引号的 `$argon2id$...` 会被展开成垃圾）。
   - 默认口令 Admin@2026 已随公开仓公开：`NODE_ENV=production` 未填此值时 23/29 seed 脚本与 db-init preflight 直接拒绝（2026-07-21 门）。
4. **RS256 签名密钥（migrate 之后，deploy 之前）**
   - 跑 `25-provision-signing-key.sh`（或经 `24` 聚合自动调用）：公钥写入 `iam.signing_key`，终端打印 `OIDC_ACTIVE_KID` + `OIDC_SIGNING_PRIVATE_KEY`。
   - 把这两个值粘贴进 `secrets/platform-identity.env`，再重跑（`24` / `25` 幂等，已存在 active key 不轮换）。
   - ⚠️ 私钥仅存于该 secret 文件，不入库；`25` 打印到**交互式终端**（首发由人工执行，非 CI），勿把该输出留进 CI 日志或聊天记录。
5. **社交登录（DingTalk / Feishu）**：保持 `CHANGEME` —— 重建后的回调端点尚未接线，填了也不会启用（future work）。

---

## 二、部署步骤（按顺序执行）

### VXTURE_DEPLOY_HOST（平台控制面）

```bash
cd /srv/vxture/deploy

# 1. 备份运行配置
bash scripts/50-backup-runtime-env.sh

# 2. 发布前常态检查（可选；常态漂移巡检已由 platform-alerts 定时 workflow 每日执行）
bash scripts/51-check-platform-alerts.sh

# 3. 常规升级聚合链路：13 -> 20 -> 21 -> 30 -> 40
bash scripts/31-regular-upgrade-platform.sh

# 4. 发布后如需二次确认，可重复只读验证
bash scripts/40-verify-platform-runtime.sh
```

### VXTURE_DEPLOY_HOST 首次部署 / 应用层 reset 后

```bash
cd /srv/vxture/deploy

# 前置：runtime env 真值、TLS 证书和 Nginx 基础目录已准备完成
CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh
```

首次部署聚合链路：

```text
21 -> 22 -> 23 -> 25 -> 30 -> 40
```

`25`（签名密钥 provision）首次运行会打印 `OIDC_ACTIVE_KID` + `OIDC_SIGNING_PRIVATE_KEY`
后**中止**（`secrets/platform-identity.env` 仍为占位时）。按 §1.6 第 3 步把两值粘贴进该
secret，再整体重跑 `24`（各阶段幂等，第二次 `25` 通过 gate 后续 `30` / `40`）。

常规升级不得使用 `24-first-deploy-platform.sh`。

### vxture-beta（未来）

平台 beta 临时服务器尚未设计。启用前必须先补充独立检查单，明确创建、部署、验证、销毁和费用控制步骤。

---

## 三、部署后验证

### 3.1 健康检查

- [ ] `GET https://vxture.com/` → HTTP 200
- [ ] `GET https://console.vxture.com/` → 重定向到登录页
- [ ] `GET https://y.vxture.com/` → 重定向到登录页
- [ ] `GET https://vxture.com/api/health` → `{ status: 'ok' }`（gateway-bff）
- [ ] `POST https://api.vxture.com/auth-api/auth/signin` → 正常响应（不报 500）

### 3.2 核心流程验证

- [ ] 用户注册流程：发送验证码 → 收到邮件 → 注册成功
- [ ] 用户登录：正常登录，JWT Cookie 设置正确
- [ ] Console 首页加载：无接口 500 错误
- [ ] Admin 登录：operator 账号可正常登录

### 3.3 日志检查

```bash
# 检查各服务最新日志，关注 ERROR 级别
docker logs vx-website-bff --tail 100 | grep -i error
docker logs vx-auth-bff --tail 100 | grep -i error
```

---

## 四、回滚预案

### 快速回滚（镜像级别）

```bash
# 回滚到上一个镜像版本（VXTURE_DEPLOY_HOST）
docker compose -f compose.platform.yml up -d --no-deps vx-website-bff:<previous-tag>
# 其他服务同理，替换服务名和 tag
```

### 数据库回滚

- 若 migration 有破坏性变更，需预先准备 down migration 脚本
- 从阿里云云盘快照恢复 `vx-platform-pg`：
  1. 停止所有连接 `vx-platform-pg` 的服务
  2. 阿里云控制台 → 云盘 → 快照 → 回滚
  3. 重启数据库容器
  4. 重启依赖服务

### 回滚后验证

- [ ] 重跑三、健康检查部分
- [ ] 确认报警静默（若有 Sentry / 监控）

---

## 五、上线后持续监控（24h）

| 项目       | 检查方式                                                        |
| ---------- | --------------------------------------------------------------- |
| 错误率     | `docker logs` / Sentry DSN                                      |
| 邮件发送   | 测试注册/密码重置流程                                           |
| Redis 可用 | 一次性容器对 Tair `redis-cli ping`（密码经 REDISCLI_AUTH 注入） |
| DB 连接池  | 检查 BFF 日志中 pg-pool 警告                                    |
