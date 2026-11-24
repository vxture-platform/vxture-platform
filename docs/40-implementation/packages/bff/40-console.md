# @vxture/bff-console

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项     | 值                    |
| ------ | --------------------- |
| 包名   | `@vxture/bff-console` |
| 路径   | `bff/console-bff/`    |
| @layer | `Application`         |
| 框架   | NestJS                |

| 服务对象 | `portals/console` |

---

## 核心定位

console-bff 是租户工作台（`portals/console`）的专属 BFF，负责：

- **认证代理**：所有认证端点透传至 auth-bff，Set-Cookie 原样转发（同 website-bff 模式）。**本 BFF 不签发 JWT，只 verify。**
- **租户数据聚合**：成员管理、角色权限、账单、订阅、用户 Profile
- **模型平台状态读取**：租户账号读取当前租户可用模型、授权、配额和用量状态；平台级模型管理必须走 Admin BFF

### 中间件顺序

```
auth → tenant → permission → router
```

比其他 portal BFF 多一级 `permission` middleware，负责将当前账号的能力集（Capability[]）注入 `req.capabilities`，供路由层做精细鉴权。

---

## 接口契约

> 所有接口（公开路径除外）需携带 Cookie `vx_tenant_access_token`。
> 统一错误响应格式：`{ message: string; statusCode: number }`

### `/api/auth` — 认证（代理至 auth-bff）

公开路径（无需认证）：`/api/auth/login`、`/api/auth/logout`、`/api/auth/refresh`、`/api/auth/send-phone-code`、`/api/auth/login-with-phone`、`/api/auth/forgot-password`、`/api/auth/reset-password`

**POST `/api/auth/reset-password`** — 重置密码

```typescript
// Request body
{
  token: string;
  newPassword: string;
}

// Response 200
{
  status: "ok";
}
// Response 400 — token 无效或已过期
```

---

**POST `/api/auth/login`** — 密码登录

```typescript
// Request body（BFF 固定注入 source='console'）
{ identifier: string; password: string; turnstileToken?: string }

// Response 200（Set-Cookie 透传：vx_tenant_access_token / vx_tenant_refresh_token）
// 同 auth-bff AuthUserDto 格式
```

**POST `/api/auth/logout`** — 登出

```typescript
// Response 200（清除 Cookie）
{
  status: "logged_out";
}
```

**POST `/api/auth/refresh`** — 续期

```typescript
// Response 200（更新 Cookie）
{
  status: "refreshed";
}
```

**POST `/api/auth/tenant/switch`** — 切换租户

```typescript
// Request body
{
  tenantId: string;
}
// BFF 固定注入 source='console'

// Response 200（重新签发包含新 tenantId 的 JWT，更新 Cookie）
```

**POST `/api/auth/forgot-password`** — 发送密码重置邮件

```typescript
// Request body
{
  email: string;
}
// BFF 固定注入 source='console'，重置链接指向 CONSOLE_BASE_URL/reset-password

// Response 200 — 始终成功（防枚举）
{
  status: "ok";
}
```

**POST `/api/auth/send-phone-code`** — 发送手机验证码（代理至 auth-bff）

**POST `/api/auth/login-with-phone`** — 手机验证码登录（代理至 auth-bff）

**GET `/api/auth/session`** — 会话状态（本地，依赖 auth middleware）

```typescript
// Response 200
{
  status: "active";
  userId: string;
}
// Response 401
```

---

### `/api/me` — 当前用户

**GET `/api/me`** — 当前账号基本信息 + 租户成员信息聚合

**GET `/api/me/profile`** — 完整用户 Profile

**PUT `/api/me/profile`** — 更新 Profile

**PUT `/api/me/password`** — 修改密码

```typescript
// Request body
{
  currentPassword: string;
  nextPassword: string;
}
// Response 200
{
  status: "ok";
}
```

---

### `/api/iam` — 成员与角色管理（需租户上下文）

**GET `/api/iam/summary`** — IAM 统计概览

```typescript
// Response 200
{
  members: number;
  activeMembers: number;
  primaryOwners: number;
  roles: number;
}
```

**GET `/api/iam/members`** — 成员列表

**GET `/api/iam/members/:memberId`** — 成员详情

**POST `/api/iam/members`** — 创建成员

**POST `/api/iam/members/invite`** — 邀请成员（发送邀请邮件）

**PUT `/api/iam/members/:memberId`** — 更新成员信息

**POST `/api/iam/members/:memberId/disable`** — 禁用成员

**POST `/api/iam/members/:memberId/reset-password`** — 重置成员密码

```typescript
// Request body
{
  nextPassword: string;
}
```

**DELETE `/api/iam/members/:memberId`** — 移除成员

**GET `/api/iam/roles`** — 租户角色列表

**GET `/api/iam/permissions`** — 租户权限列表

**POST `/api/iam/roles`** — 创建角色

**PUT `/api/iam/roles/:roleId`** — 更新角色

**DELETE `/api/iam/roles/:roleId`** — 删除角色

---

### `/api/subscription` — 订阅管理（需租户上下文）

**GET `/api/subscription/my`** — 当前租户所有订阅

**POST `/api/subscription/actions`** — 执行订阅变更

```typescript
// Request body
{
  subscriptionId: string;
  action: 'upgrade' | 'pause' | 'resume' | 'cancel';
  planId?: string;      // upgrade 必填
  reason?: string;      // pause / cancel 可选
  immediate?: boolean;  // cancel 是否立即生效，默认 false
}
// Response 200：变更后的 Subscription
// 副作用：成功后向账号邮箱发送确认邮件（失败不阻断主流程）
// Error 400 / 401
```

---

### `/api/billing` — 账单查询（需租户上下文）

**GET `/api/billing/invoices`** — 发票列表

```typescript
// Query: ?limit=20（默认 20，最大 100）
// Response 200：Invoice[]
```

**GET `/api/billing/overview`** — 账单概览统计

```typescript
// Response 200：BillingStats（发票总数、已付/待付/逾期数量、总收入、活跃订阅数）
```

---

### `/api/capabilities` — 租户能力列表

**GET `/api/capabilities`** — 获取当前 session 可用能力

```typescript
// Response 200：string[]
// 由 permission middleware 在请求上下文中预先填充
// 示例：['platform.model.manage', 'tenant.user.manage', ...]
```

---

### `/api/tenant-context` — 租户上下文

**GET `/api/tenant-context`** — 当前租户信息（从 JWT + DB 解析）

**GET `/api/tenant-context/options`** — 当前账号可访问的所有租户（切换租户下拉列表）

---

### `/api/model-platform` — 租户模型平台状态

**所有端点要求已认证且具备当前租户上下文。** Console BFF 不暴露平台级 Provider、模型、价格、策略写操作。
本域只代理当前 `req.tenant.id` 范围内的只读查询到 `MODEL_PLATFORM_URL`（现指向外部 Atlas 主机，2026-07-28 本仓 model-platform 服务退役后的目标）。

---

**GET `/api/model-platform/models`** — 当前租户可用模型列表

```typescript
// Response 200：AiModelRecord[]

interface AiModelRecord {
  id: string;
  providerId: string | null;
  modelCode: string; // 如 'gpt-4o'
  modelName: string; // 如 'GPT-4o'
  provider: string; // 如 'openai'
  endpointUrl: string;
  protocol: string; // 如 'openai'
  capabilities: string[]; // 如 ['chat', 'vision']
  keyReference: {
    source: "env";
    name: string;
    configured: boolean;
  } | null;
  isActive: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
```

**GET `/api/model-platform/grants`** — 当前租户模型授权列表

```typescript
// Query: ?modelId=&applicationId=&applicationType=
// Response 200：AiModelGrantRecord[]

interface AiModelGrantRecord {
  id: string;
  modelId: string;
  tenantId: string;
  applicationId: string | null; // null 表示租户级别授权（不限应用）
  applicationType:
    | "agent"
    | "workflow"
    | "api_client"
    | "internal_service"
    | null;
  priority: number;
  reason: string | null;
  expiresAt: string | null; // ISO 时间戳，null 表示永不过期
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**GET `/api/model-platform/quotas`** — 当前租户模型配额

```typescript
// Query: ?includeExpired=true|false
// Response 200：TenantQuotaRecord[]
```

**GET `/api/model-platform/usage-summaries`** — 当前租户模型用量汇总

```typescript
// Query: ?applicationId=&applicationType=&cycleMonth=&statType=
// Response 200：TenantUsageSummaryRecord[]
```

> 写操作必须通过 Admin BFF `/api/model-platform/*` 完成，Console BFF 不提供模型、授权、Provider、价格、策略的创建、更新、删除接口。

---

### `/health` — 健康检查

```
GET /health  →  { status: 'ok' }   无鉴权
```

---

## 目录结构

```
bff/console-bff/src/
├── routers/
│   ├── auth.router.ts           ← 认证代理（login / logout / refresh /
│   │                               tenant/switch / forgot-password / session）
│   ├── phone-auth.router.ts     ← 手机验证码代理
│   ├── model-platform.router.ts     ← 当前租户模型平台状态只读代理
│   ├── me.router.ts             ← 当前用户 Profile
│   ├── iam.router.ts            ← 成员 / 角色 / 权限管理
│   ├── subscription.router.ts   ← 订阅操作
│   ├── billing.router.ts        ← 账单查询
│   ├── capabilities.router.ts   ← 能力列表
│   ├── tenant-context.router.ts ← 租户上下文
│   └── health.router.ts
├── aggregators/
│   └── session.aggregator.ts
├── auth/
│   └── auth.service.ts          ← JWT verify + 当前用户查询
├── middleware/
│   ├── auth.middleware.ts        ← 公开路径白名单 + Cookie 解析
│   ├── tenant.middleware.ts      ← tenantId 解析
│   └── permission.middleware.ts  ← capabilities 注入（req.capabilities）
├── types/
│   └── console.types.ts          ← AiModelRecord / AiModelGrantRecord / Capability 等
├── app.module.ts
└── main.ts
```

---

## 权限约束

Console BFF 模型平台路由的权限含义：

- 依赖 `auth → tenant → permission → router` 中间件顺序
- 每个端点要求有效 `req.user` 和 `req.tenant.id`
- 请求上游时强制注入当前 `tenantId`
- 不接受前端传入 `tenantId` 覆盖当前租户上下文
- 跨租户运营管理能力由 Admin BFF 承担

---

## 环境变量

```bash
# From /srv/vxture/runtime/secrets/platform.env
DATABASE_URL=
REDIS_URL=
JWT_SECRET=                     # shared JWT verification secret
AUTH_INTERNAL_TOKEN=            # PRODUCT face only: console-bff's C2 entitlements read against platform-api. Not an IdP key — console-bff never calls auth-bff /internal/* and is NOT injected with IDP_INTERNAL_TOKEN.

# From /srv/vxture/runtime/.env.console-bff
NODE_ENV=production
CONSOLE_BFF_PORT=<见端口登记表>

# 上游服务（内部地址）
AUTH_BFF_URL=http://vx-auth-bff:3090
MODEL_PLATFORM_URL=http://vx-model-platform:3100   # Model Platform 服务内部地址

# CORS
ALLOWED_ORIGIN=https://console.vxture.com

# From /srv/vxture/runtime/secrets/platform-mail.env
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<mail-host>
SMTP_PASS=
SMTP_FROM="Vxture Studio <no-reply@<mail-host>>"
```

---

## 依赖约束

### 可选退出恢复试点（2026-11-24，本地未部署）

`oidc/oidc-rp.module.ts` 在 `RP_IDENTITY_RECOVERY_ENABLED=true` 时注入 SessionRecoveryAuthority；必须同时启用机密 OIDC RP 并设置 `RP_IDENTITY_ENVIRONMENT=prod|beta|dev`。默认 false。数据库连接使用现有 database 配置；表由 `2026-12-16-identity-logout-recovery.sql` 提供，先迁移后启动。

标准退出验签后先写 PostgreSQL scoped sid receipt，再清 Redis、再 ACK。首次请求按中心 logout-v1 快照和水位补拉，之后每请求读本地撤销；重连清进程确认，不清持久撤销。中心或本地 DB 不可用映射 503，保留 Cookie。请求恢复不修改上下文或延期 TTL；可选退出 SSE 见下节，页面轮询尚未移除。

同一客户不同环境必须独立 client/Redis namespace；RP store 现用受信 runtime.config.clientId，旧硬编码 console 的非默认客户端需重新登录或受控迁移。实施步骤、容量代价及回退边界见[退出运行手册](../../../60-operations/50-run-identity-events.md#6-logout-v1-恢复试点)。

### 可选退出 SSE（C6 本地试点）

`RP_SESSION_EVENTS_ENABLED=true` 依赖上节持久恢复和 `2026-12-17-rp-session-notifications.sql`，默认 false。`SessionEventsHub` 每实例持有一条 PG LISTEN，receipt 提交提示经 scope 过滤后唤醒本地 sid 连接。提示只触发持久复核；listener/Redis 断线关闭流并清恢复确认。Hub 实例由 Nest 管理启动/销毁，不能包装成丢失生命周期钩子的普通对象。

`SessionEventsRouter` 提供 `/auth/events`，使用现有 Cookie、自行鉴权和同源检查。先订阅后最终核验，连接寿命不超 Redis TTL/中央绝对到期；25 秒注释心跳不读身份、不续期。连接限额、背压关闭、断线恢复、状态码及帧定义以 [150 §2.3 / OpenAPI](../../../30-design/identity/150-event-sync-api.md#23-console-退出-sse本地实现默认关闭) 为准。运行参数与代理配置见[运行手册 §7](../../../60-operations/50-run-identity-events.md#7-console-退出-sse-试点)。新增模块由本包内部注入，无跨 BFF 包引用。

## 变化事件接收与视图重建（本地未发布）

`RP_IDENTITY_CHANGES_ENABLED=true` 依赖现有退出恢复与 SSE。`IdentityEventsRouter` 在 `/auth/identity-events` 接收独立 application/jwt（64 KiB），`IdentityChangesAuthority` 验证后的消息同事务写 inbox/版本后 ACK。每次权限读取检查持久授权版本，缓存回填前再核对；治理源故障返回 503。`AuthMiddleware` 与 `/auth/session` 用快照+补拉重建中央 org/workspace，清除旧令牌角色和旧上下文展示标签，不伪造新 JWT。具体业务成员/权限仍由领域服务确认。

`SessionEventsHub` 另监听 `rp_identity_changed`，按 sid/sub 唤醒后读取持久版本才向页面发 context/access 提示。掉线重置两种恢复确认，退出 receipt 仍优先。普通健康请求读本地版本，不定时请求中心。接收、并发与资源边界见 [150 §2.5](../../../30-design/identity/150-event-sync-api.md#25-changes-v1-签名投递与-console-应用本地实现默认关闭)，环境操作见运行手册 §9。新增类仅在本 BFF 内部注入。

### 包边界

```
✅ @vxture/core-auth          — JWT verify + token 吊销检查
✅ @vxture/core-config
✅ @vxture/core-mail          — 订阅操作后发邮件通知
✅ @vxture/service-iam        — 账号 / 成员 / 角色查询
✅ @vxture/service-organization
✅ @vxture/service-billing
✅ @vxture/service-subscription
✅ auth-bff（HTTP 代理）       — 认证操作委托
✅ model-platform（HTTP 代理）     — AI 模型 / 授权管理
❌ JWT 签发                    — 严禁
❌ @vxture/model-runtime-client / agent-server/*
❌ @vxture/design-system / platform-*
```

### 可协商轮询退役（N4）

`RP_SESSION_POLLING_RETIREMENT_ENABLED` 默认 false。显式启用要求 OIDC RP、recovery、changes 和 SSE 四项开关同时开启，缺少则启动失败。Router 仅在完整 changes authority 存在且已 opt-in 时返回 `X-Vxture-Session-Sync: events-v1`；旧/退出模式不声明此能力。登记、投递、展示字段迁移和目标代理验收是部署前提；响应头不是中央投递健康探针。页面需要成功重读后才停止兼容轮询。参见接口 §2.6、运行手册 §10。

### 运维与进程故障验收（N5）

使用仓库 `scripts/identity/inspect-sync.mjs` 核对 DB 作用域、接收方和触发器，部署配置样例及告警模板位于 `deploy/identity-sync/`；具体操作见[运行手册 §11](../../../60-operations/50-run-identity-events.md#11-n5-部署预检监控与独立进程验收)。DB 就绪或 SSE 心跳均不能证明中央投递健康，退役前必须接通目标队列告警。

`scripts/tests/identity-sync-acceptance.mjs` 已在两个独立 Console 进程验证 256 条真实 SSE、单实例单 sid 32 条上限、持久提交后 ACK 丢失幂等、接收进程重启且发送器未恢复时的快照版本追平、双实例标准退出。测试使用实际源码和随机隔离存储；不是完整 AppModule 部署、互动 OIDC 登录或目标容量认证。最新证据见 110 §13 / 120 进展。

## N6 基础设施提取（2026-11-24）

已验证的 recovery/changes/SSE 实现迁到 core-oidc-rp；Console 保留模块接线、PG 连接与 UUID→usr\_ 映射及权限/上下文业务投影。浏览器 session-events 迁到 core-identity-sdk，Console provider 保持其完整视图与退役协商行为。没有生产 BFF-to-BFF 包引用；共享协议不授予业务权限。最新多实例复验与平台入口覆盖见 [120](../../../70-workplan/120-identity-sync-progress.md)。
