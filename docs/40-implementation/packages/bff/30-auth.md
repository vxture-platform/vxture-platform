# @vxture/bff-auth

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)
> 认证设计全貌：[`docs/30-design/auth.md`](../../../30-design/identity/010-auth.md)

---

## 当前 OIDC 会话执行基线（2026-11-24）

本轮客户会话以 `src/authn/session.service.ts` 的 PostgreSQL 记录控制持久有效性，Redis 保存交互会话。`finishTenantLogin` 先持久创建，失败中止；`issueAuthCode`、code / refresh 换票持久绑定接收 client；状态查询核验 durable realm/owner。共享当前组织/空间持久成对更新，不延长绝对到期时间。

`session.auth_sessions` 的客户状态转移触发器与业务撤销同事务生成 `session.logout_deliveries`。`SessionLogoutRepository` 在 AuthnModule 提供并导出，`SessionLogoutJob` 在 AppModule 注入并启动；多实例租约、LISTEN 唤醒、补扫和重试向现行 OIDC 退出地址投递。workforce 独立路径保留。迁移先于应用上线，详见[运行手册](../../../60-operations/50-run-identity-events.md)。

`IdentityRecoveryRepository` 在 AuthnModule 提供并导出，`IdentityRecoveryRouter` 在 AppModule 注册 `POST /oidc/identity/snapshot` 与 `/events`。仅对显式启用、精确 customer/env/client/地址登记的机密客户端开放 logout-v1；默认无客户端可用。状态和流头同一数据库快照，事件位置在退出原事务内行锁分配；数据库失败为503，不能报告inactive。依赖 DDL25 / 第二份恢复迁移。

本地测试不等于发布完成。[接口文档](../../../30-design/identity/150-event-sync-api.md) §2.2–§2.6 和配套 OpenAPI 描述已实现的退出/变化恢复与 Console SSE 子集，完整跨产品目标仍为候选。下文 `/auth`、共享 token cookie 与 source 段落是历史接口资料，不能替代当前 OIDC `/oidc/*`、中央 sid 与 RP 本地会话接入。

### changes-v1 事实与恢复（2026-11-24，本地未发布）

同一 `IdentityRecoveryRouter/Repository` 新增 `POST /oidc/identity/changes/snapshot` 与 `/changes/events`，复用严格 Basic 认证、请求校验、MVCC 快照、游标 HMAC 与缺口检测，使用独立 changes-v1 profile/水位。仅显式登记并启用的 customer platform BFF 可读，product/workforce 不在此试点范围。logout-v1 的原请求/响应保持兼容。

DDL96 / `2026-12-18-identity-changes.sql` 在中央上下文及十类授权事实表的原事务内记录主体版本、outbox 和每客户端事件；无订阅者也保留 outbox。首次绑定共享主体/会话锁，防止绑定与事实变更之间漏消息。快照新增 authorization_version；版本与事件只能使缓存失效，不能授予权限。具体接口和范围见 [150 §2.4](../../../30-design/identity/150-event-sync-api.md#24-changes-v1客户上下文与授权变化恢复本地实现默认不登记)。

变化投递、Console 缓存失效和上下文重建已由下节接通；外部产品仍待迁移。恢复端点不用于周期轮询。部署、特权触发函数、锁成本和回退限制见运行手册 §8–§9。

## changes-v1 可靠发送与扩展事实（本地未发布）

`IdentityDeliveryRepository` 与 `IdentityDeliveryJob` 实现事务投递任务、SKIP LOCKED 租约、稳定逻辑载荷、每次重签、重试/隔离及 401/403 暂停接收方。`IDENTITY_CHANGE_DELIVERY_ENABLED` 默认 false，启用要求 RS256；不复用标准 logout URL/form。接收登记另存 `identity_change_receivers`，地址不可变。模块显式注入，auth pool 最少 3 条连接以容纳两个 LISTEN 与事务。

DDL96 新增投递/inbox/版本和扩展事实：产品/套餐配置、手工权益覆盖及订阅/覆盖的时间边界。发送 job 同时以 30 秒补扫持久到期任务，只发事件、不改商业状态。恢复接口保持独立 profile，`deliveryEvent` 仅由内部已领取任务调用。文件/契约/登记/回退详见 [150 §2.5](../../../30-design/identity/150-event-sync-api.md#25-changes-v1-签名投递与-console-应用本地实现默认关闭) 与运行手册 §9。

### 运维预检与独立进程验收（N5）

仓库工具 `scripts/identity/inspect-sync.mjs` 以只读事务检查登记、触发器和任务状态，输出脱敏 JSON / Prometheus 指标；不增加 auth 路由，也不按用户查询身份。告警模板、退出码和部署前提见[运行手册 §11](../../../60-operations/50-run-identity-events.md#11-n5-部署预检监控与独立进程验收)。`scripts/tests/identity-sync-acceptance.mjs` 使用实际 auth/Console 源码和隔离 PG/Redis，在独立 OS 进程验证签名投递、真实租约到期重试、重启恢复及标准退出；本地证据见 110 §13，未安装目标监控或部署。

## 包信息

| 项       | 值                                            |
| -------- | --------------------------------------------- |
| 包名     | `@vxture/bff-auth`                            |
| 路径     | `bff/auth-bff/`                               |
| @layer   | `Application`                                 |
| 框架     | NestJS                                        |
| 服务对象 | 所有 BFF（内部）+ portal 前端（部分直接调用） |

---

## 核心定位

**auth-bff 是 Vxture 平台唯一有权签发 JWT 的服务。**

其他所有 BFF（website-bff、console-bff、admin-bff 等）不持有 JWT 签发逻辑。
登录、注册、刷新、tenant 初始化等需要签发 token 的操作，全部由它们的前端通过各自 BFF 代理到 auth-bff 完成。

Ruyin 相关 `source`、Cookie domain 和跨域 token 仅表示平台对外 SSO 契约。Ruyin 的业务前端、BFF、Server 与 vx-worker-02 部署由 `vxture/agentstudio-ruyin` 维护，不属于本仓 `bff/*` 实现范围。

### 设计意图

- **集中化签发权**：只有 auth-bff 调用签发逻辑；`JWT_SECRET` / `JWT_REFRESH_SECRET` 由 `secrets/platform.env` 注入需要验证或委托签发的 BFF，不复制到服务专属 env
- **Cookie 写入集中化**：所有 `Set-Cookie` 由 auth-bff 写入后，经 BFF 代理透传给浏览器，前端无感
- **source 参数区分多入口**：同一 `/auth/login` 端点，通过 `source` 参数决定写哪组 cookie、使用哪个 cookie domain

### Cookie 策略

| source    | Cookie 组                                            | Domain                   |
| --------- | ---------------------------------------------------- | ------------------------ |
| `website` | `vx_tenant_access_token` / `vx_tenant_refresh_token` | `COOKIE_DOMAIN_PLATFORM` |
| `console` | `vx_tenant_access_token` / `vx_tenant_refresh_token` | `COOKIE_DOMAIN_PLATFORM` |
| `admin`   | `vx_admin_access_token` / `vx_admin_refresh_token`   | `COOKIE_DOMAIN_PLATFORM` |
| `ruyin`   | `ry_access_token` / `ry_refresh_token`               | `COOKIE_DOMAIN_RUYIN`    |

website 和 console 共享同一组 `vx_tenant_*` cookie，是同一登录态的两个入口。

---

## 接口契约

> 统一错误响应格式：`{ message: string; statusCode: number }`

### `/auth` — 密码认证

**POST `/auth/login`** — 密码登录

```typescript
// Request body
{
  identifier: string;        // 邮箱或用户名
  password: string;
  source?: 'website' | 'console' | 'admin' | 'ruyin';  // 默认 'website'
  turnstileToken?: string;   // Cloudflare Turnstile 人机验证 token
}

// Response 200 — 写入对应 source 的 HttpOnly Cookie
{
  id: string;
  name: string;
  displayName: string | null;
  username: string;
  email: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  personalVerified: boolean;
  organizationVerified: boolean;
}

// Response 401 — 密码错误或账号不存在
// Response 400 — source=admin 禁止（须走 admin-bff）
```

**POST `/auth/signup`** — 邮箱注册

```typescript
// Request body
{
  email: string;
  name: string;
  password: string;
  turnstileToken?: string;
}

// Response 201 — 写入 vx_tenant_* Cookie（tenantId 为空，需后续 tenant/init）
// 同 login 返回 AuthUserDto
```

**POST `/auth/logout`** — 登出

```typescript
// Query: ?source=website|console|admin|ruyin
// Request body: 无

// Response 200
{
  status: "logged_out";
}

// 副作用：
//   - access token jti 写入 Redis 黑名单（TTL = token 剩余有效期）
//   - Redis 中 refresh token 删除
//   - 清除对应 source 的所有 Cookie（含 legacy cookie 兼容）
```

**POST `/auth/refresh`** — 续期 access token

```typescript
// Query: ?source=website|console|admin|ruyin
// Request body: 无（从 Cookie 读取 refresh token）

// Response 200
{
  status: "refreshed";
}
// 副作用：重新写入对应 source 的 Cookie，更新 Redis 中的 refresh token

// Response 401 — refresh token 不存在、已过期、Redis 中已吊销
```

**POST `/auth/forgot-password`** — 发送密码重置邮件

```typescript
// Request body
{
  email: string;
  source?: 'website' | 'console';  // 决定邮件中重置链接的 base URL
}

// Response 200 — 无论邮箱是否存在均返回，防止用户枚举
{ status: 'ok' }

// 行为：
//   - source='website' → 重置链接: ${WEBSITE_BASE_URL}/reset-password?token=xxx
//   - source='console' → 重置链接: ${CONSOLE_BASE_URL}/reset-password?token=xxx
//   - 通过 MailService.sendPasswordReset() 发送邮件
//   - 任何内部错误静默处理，对外始终 200
```

**POST `/auth/reset-password`** — 用 token 重置密码

```typescript
// Request body
{
  token: string; // 邮件链接中的 reset token
  newPassword: string;
}

// Response 200
{
  status: "ok";
}

// Response 400 — token 无效或已过期
{
  message: "Invalid or expired reset token";
}
```

---

### `/auth/tenant` — 租户操作

**POST `/auth/tenant/init`** — 注册后初始化租户（首次选择账号类型）

```typescript
// 需要有效的 vx_tenant_access_token Cookie（注册后的临时 session）

// Request body
{
  type: "individual" | "organization";
}

// Response 200 — 更新 Cookie（写入新 tenantId 的 JWT）
{
  tenantId: string;
}

// 行为：
//   - 若该账号已有租户，直接复用（幂等）
//   - 新建租户时 displayName 从 account profile 取；type='organization' → DB type='company'
//   - 重新签发带 tenantId 的 access + refresh token，写入 Cookie
//   - 更新 Redis 中的 refresh token

// Response 401 — 未携带 Cookie 或 token 已过期
```

**POST `/auth/tenant/switch`** — 切换当前租户

```typescript
// 需要有效的 vx_tenant_access_token Cookie

// Request body
{
  tenantId: string;
  source?: 'website' | 'console' | 'ruyin';  // 默认 'console'
}

// Response 200 — 重新签发包含新 tenantId 的 JWT，更新 Cookie
{ status: 'switched'; tenantId: string }

// Response 401 — 未认证 / 非 tenant_user 类型账号
```

---

### `/auth/session` — 会话查询

**GET `/auth/session`** — 验证当前 session 有效性

```typescript
// 从 vx_tenant_access_token Cookie 读取

// Response 200
{
  status: "active";
  userId: string;
  userType: string;
  tenantId: string;
}

// Response 401 — 未认证、token 过期、jti 在黑名单中、subject 已被批量吊销
```

---

### `/auth/oauth` — OAuth 社交登录

```
GET  /auth/oauth/dingtalk/start     → 302 跳转钉钉授权页
GET  /auth/oauth/dingtalk/callback  → 处理回调，签发 JWT，302 跳转 portal
GET  /auth/oauth/feishu/start       → 302 跳转飞书授权页
GET  /auth/oauth/feishu/callback    → 处理回调，签发 JWT，302 跳转 portal
```

OAuth 回调在 auth-bff 内处理，通过 gateway 层暴露给外网（`/auth-api/auth/oauth/*`）。
所有 portal 的 OAuth 流程统一入口，不在 portal BFF 中处理回调。

---

### `/auth/phone` — 手机验证码登录

```
POST /auth/send-phone-code     — 发送手机验证码（限流）
POST /auth/login-with-phone    — 手机号 + 验证码登录
```

---

### `/auth/crossdomain` — 跨域 token（ruyin.ai 双域 SSO）

```
GET  /auth/crossdomain/token?targetDomain=ruyin.ai
  — 校验当前租户登录态与 targetDomain 白名单，生成 30s 有效的一次性 token（Redis GETDEL）
POST /auth/crossdomain/verify  — 验证 token，在 ruyin domain 写入 Cookie
```

---

### `/internal/*` — 内部面（server-to-server）

今天 auth-bff 真实存在的内部面是四个 controller：`internal/operator/accounts`（运营账号管理）、`internal/account/users`（客户账号管理）、`internal/operator/sessions`（运营者会话）、`POST internal/operator/stepup/totp`（step-up）。全部由 `InternalAuthGuard` 守着：

```typescript
// Header 必须携带：x-vxture-internal-auth: {IDP_INTERNAL_TOKEN}
// 2026-10-04 起 auth-bff 的内部面只认 IDP_INTERNAL_TOKEN（secrets/platform-idp-internal.env，
// 只注入 auth/admin/arche/opera 四个容器）；AUTH_INTERNAL_TOKEN 只开 platform-api 的产品面，
// 拿它来这里是 401 invalid_internal_auth。凭据过了还要过路由准入：没有 @InternalRoute 声明的
// 路由一律 403（internal-route-policy.ts；check-internal-route-policy.mjs 把这个面钉进快照）。
// 发送方：admin-bff / arche-bff 的 operator-admin.service 与 operator-stepup.service、opera-bff 的 operator-stepup.service。
```

### `/auth/internal/sign` — 【已退役】内部签发接口

auth-bff 里**没有**这个 controller（`grep -rn 'internal/sign' bff/auth-bff/src` 为空）；它是 HS256 时代 admin delegate-sign 的接口，退役见 `docs/30-design/identity/120-implementation.md` 退役清单。下面的契约只作历史记录，**不要按它配任何调用方**：

```typescript
// （历史）POST /auth/internal/sign
// Request body
{
  sub: string;
  email: string;
  username?: string | null;
  displayName?: string | null;
  role: string;                   // 'admin' / 'tenant_admin' / 'member' 等
  roleLabel?: string | null;
  permissions?: string[];
  source?: 'website' | 'console' | 'admin' | 'ruyin';
  tenantId?: string | null;
}

// Response 200 — 签发 JWT 并写入 Cookie（source 决定哪组 cookie）
{ status: 'signed'; userId: string }
```

（历史）曾供 admin-bff 在运营账号登录后委托签发 operator token 使用；admin 今天是 OIDC RP，运营者登录走 IdP 的 `/authorize` → `/token`。
**普通 portal BFF 禁止调用此接口**（它们只代理用户密码到 `/auth/login`）。

---

### `/healthz` — 健康检查

```
GET /healthz  →  { status: 'ok' }   无鉴权
```

---

## 目录结构

```
bff/auth-bff/src/
├── routers/
│   ├── password-auth.router.ts  ← login / signup / logout / refresh /
│   │                               forgot-password / reset-password /
│   │                               tenant/init / tenant/switch / session /
│   │                               internal/sign
│   ├── phone-auth.router.ts     ← send-phone-code / login-with-phone
│   ├── oauth.router.ts          ← dingtalk / feishu OAuth 回调
│   ├── crossdomain.router.ts    ← crossdomain token 跨域 SSO
│   └── health.router.ts
├── auth/
│   └── auth.service.ts          ← 唯一调用 jwtService.sign 的地方
├── redis/
│   └── redis.service.ts         ← refresh token 存储 / jti 黑名单
├── app.module.ts
└── main.ts
```

---

## 关键约束

- **JWT 签发唯一**：仅 auth-bff 拥有签发权；共享 JWT 密钥只放 `/srv/vxture/runtime/secrets/platform.env`
- **jti 必须是 randomUUID**：每次签发必须携带唯一 jti，供黑名单机制使用
- **Redis fail-closed**：Redis 不可用时登录/刷新失败，禁止退化为无状态 token
- **Turnstile 校验**：login / signup / phone-login 需通过 Cloudflare Turnstile（未配置时静默跳过）
- **forgot-password 防枚举**：无论邮箱是否存在，始终返回 200，内部异常静默处理
- **tenant/init 幂等**：已存在租户时直接复用，不重复创建

---

## 环境变量

```bash
# From /srv/vxture/runtime/secrets/platform.env
DATABASE_URL=
REDIS_URL=
JWT_SECRET=                     # shared by BFF services, >= 32 chars
JWT_REFRESH_SECRET=             # must differ from JWT_SECRET
AUTH_INTERNAL_TOKEN=            # product face only (platform-api); NOT accepted by auth-bff /internal/* since 2026-10-04

# From /srv/vxture/runtime/secrets/platform-idp-internal.env (auth/admin/arche/opera only)
IDP_INTERNAL_TOKEN=             # x-vxture-internal-auth for /internal/* (InternalAuthGuard); must differ from AUTH_INTERNAL_TOKEN

# From /srv/vxture/runtime/.env.auth-bff
JWT_ACCESS_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=30d
AUTH_COOKIE_DOMAIN=.vxture.com

# Portal base URLs
WEBSITE_BASE_URL=https://vxture.com
CONSOLE_BASE_URL=https://console.vxture.com
ADMIN_BASE_URL=https://y.vxture.com

# Cloudflare Turnstile - tenant surface only
CF_TURNSTILE_ENABLED=true
CF_TURNSTILE_TENANT_SECRET_KEY=
CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=vxture.com,ruyin.ai

# OAuth
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_REDIRECT_URI=https://api.vxture.com/auth-api/auth/oauth/dingtalk/callback
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_REDIRECT_URI=https://api.vxture.com/auth-api/auth/oauth/feishu/callback

# From /srv/vxture/runtime/secrets/platform-mail.env
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<mail-host>
SMTP_PASS=
SMTP_FROM="Vxture Studio <no-reply@<mail-host>>"
```

admin Turnstile secret belongs to `/srv/vxture/runtime/.env.admin-bff`, because
`admin-bff` performs admin Turnstile verification before delegating token
issuance to `auth-bff`.

## N6 运营域与 Accounts 事件（2026-11-24）

WORKFORCE_IDENTITY_SYNC_ENABLED 启用后，运营登录、授权码/刷新绑定、状态/令牌验证及退出均使用 realm 隔离的持久会话。安全事实触发器同事务撤销并生成退出投递；强制退出覆盖 Redis 缺索引，在线列表同时检查持久 owner。运营授权版本独立于客户版本；无租户上下文事件。

AccountsEventsRouter 使用中央 Cookie 的 GET /oidc/session-events?realm=customer|workforce。CentralEventsHub 共享 LISTEN，通知仅触发客户端完整视图重读，25 秒心跳不读取身份。默认关闭，见 [接口](../../../30-design/identity/150-event-sync-api.md#28-n6-平台全入口与运营域v07本地实现默认关闭)与[运行手册 §12](../../../60-operations/50-run-identity-events.md#12-n6-平台全入口部署与回退)。
