> ⚠️ **数据模型引用已过时（2026-07-01）** — 数据架构权威见 **[`../design/data_platform_100_architecture.md`](../../30-design/data_platform_100_architecture.md)**。本文的 BFF 数据访问**分层规则**拟迁入其 §17 后再退役；迁移完成前分层部分仍可参考，**数据模型部分勿据此实施**。

# BFF 数据访问与前端对接指南

> 版本：1.0.0 | 2026-05-15
> 读者：AI 编码工具（Claude / Cursor / Copilot）
> 目的：在 `bff/*` 层添加或修改接口时的完整参考
>
> 关联文档：
>
> - 架构目标态：[`docs/30-design/data-access.md`](../../30-design/platform/30-data-access.md)
> - API 契约：[`docs/40-implementation/packages/bff/admin.md`](../packages/bff/10-admin.md)
> - BFF 层架构：[`docs/30-design/architecture/05-bff-layer.md`](../../30-design/architecture/05-bff-layer.md)

---

## 0. 当前状态说明（重要）

`docs/30-design/data-access.md` 描述的是**目标架构**（Domain Service 层独立部署、PG 角色隔离等）。
**当前实现处于过渡期**，与目标态有以下已知偏差：

| 组件             | 当前实现                                                    | 目标态                       |
| ---------------- | ----------------------------------------------------------- | ---------------------------- |
| admin-bff 读操作 | 持 `ADMIN_BFF_RO_POOL`（reporting_ro 只读连接）直连 DB      | 调 service HTTP API          |
| admin-bff 写操作 | 持 `ADMIN_BFF_RW_POOL` 直连 DB（事务）                      | 调 service HTTP API          |
| auth-bff         | 打包 `@vxture/service-iam` + `@vxture/service-organization` | 调 identity-service HTTP API |
| Domain Service   | 未独立部署（代码壳存在）                                    | 完整实现并部署               |

**AI 编码时必须以当前实现为准**，不得假设 service API 已存在，也不得擅自跳级实现目标态。

---

## 1. 前端 ↔ BFF 通信约定

### 1.1 各 BFF 端口与 Cookie

| BFF         | 端口         | Cookie 名                                     | 服务前端                        |
| ----------- | ------------ | --------------------------------------------- | ------------------------------- |
| auth-bff    | 见端口登记表 | （无固定 Cookie，由调用方指定 source 后转发） | —                               |
| admin-bff   | 见端口登记表 | `vx_admin_access_token`                       | portals/admin                   |
| console-bff | 见端口登记表 | `vx_session`                                  | portals/console                 |
| website-bff | 见端口登记表 | `vx_session`                                  | portals/website                 |
| varda-bff   | 见端口登记表 | 透传宿主 Cookie                               | portals/admin + portals/console |

### 1.2 请求格式

- Content-Type: `application/json`
- 认证：HTTP-only Cookie（浏览器自动携带，无需手动附加 Authorization header）
- 前端不感知 JWT 内容，Cookie 由 auth-bff 以 HTTP-only + Secure 模式写入

### 1.3 错误响应格式

```typescript
// 所有 BFF 统一格式
{ code: string; message: string; requestId?: string }

// 常见 HTTP 状态码
// 400 — 请求参数错误（BadRequestException）
// 401 — 未认证（UnauthorizedException）
// 403 — 无权限（ForbiddenException）
// 429 — 限速（HttpException + TOO_MANY_REQUESTS）
// 500 — 内部错误
// 502 — 上游服务不可达（BadGatewayException）
```

---

## 2. 认证上下文

### 2.1 req.user 结构（admin-bff）

```typescript
// bff/admin-bff/src/types/console.types.ts
interface ConsoleUser {
  id: string; // UUID，ops.admin.id
  name: string; // display_name
  displayName?: string | null;
  email: string;
  roleLabel: string; // 角色 i18n key
  roleCode: string; // 如 'super_admin' / 'ops_manager'
  roleI18nKey: string;
  roleNameEn: string;
  username?: string;
  phone?: string | null;
}

interface RequestContext {
  user?: ConsoleUser;
  capabilities?: string[]; // 目录里的三段式能力码，如 ['tenant:profile.read', 'support:ticket.manage', ...]
}
```

### 2.2 capabilities 守卫模式

```typescript
// 在 router 方法顶部做能力断言，不要用 @UseGuards（admin-bff 的能力守卫是函数断言形式）。
// 用 ../auth/capability 的 assertAnyCapability：401 无会话、403 缺码。
// 读门收 .read | .manage（manage 蕴含 read），写门只收 .manage。
import { assertAnyCapability } from "../auth/capability";

function assertCanReadTenants(req: Request & RequestContext): void {
  assertAnyCapability(req, ["tenant:profile.read", "tenant:profile.manage"]);
}
function assertCanManageTenants(req: Request & RequestContext): void {
  assertAnyCapability(req, ["tenant:profile.manage"]);
}

// 在 handler 首行调用
@Get()
async listTenants(@Req() req: Request & RequestContext) {
  assertCanReadTenants(req);
  // ...
}
```

遗留扁平串（`platform.tenant.manage` / `platform.product.manage` …）与 auth.service 里把目录码合成成
它们的 `LEGACY_CAPABILITY_BRIDGE` 已于 2026-10-04 全部退役：`req.capabilities` 就是
`admin.operator_role_permission` 里的 `perm_code`，没有任何运行时合成的码。

### 2.3 能力码速查

| capability code（目录三段式，权威在 `deploy/database/seed/seed-catalog.mjs`）               | 控制范围                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `tenant:profile.read` / `.manage`、`tenant:verification.review`、`tenant:lifecycle.suspend` | 租户 / 实名审核 / 停用恢复                              |
| `user:profile.read`、`user:pii.read`、`user:account.manage`、`user:avatar.reset`            | 账号读 / 明文 PII / 生命周期 / 头像重置                 |
| `support:ticket.read` / `.manage`                                                           | 工单                                                    |
| `commerce:subscription.*` / `order.*` / `billing.*` / `invoice.*` / `payment.*`             | 订阅 / 订单 / 账单 / 发票 / 收款（TD-027）              |
| `product:capability.*` / `product:solution.*` / `product:plan.*` / `product:price.manage`   | 产品目录 / 解决方案 / 套餐 / 定价第二道门               |
| `pricing:model.read`、`pricing:price_rule.*`、`pricing:policy.*`                            | 模型计价策略（/atlas）                                  |
| `operator:*`、`audit:*`、`config:*`（arche）与 `model:*`、`ops:*`、`integration:*`（opera） | 不归 admin 判——三平台严格隔离，见 check-operator-planes |

---

## 3. admin-bff 数据访问（当前实现）

### 3.1 双 Pool 架构

```
ADMIN_BFF_RO_POOL  ←  REPORTING_RO_DATABASE_URL（只读副本，降级用 DATABASE_URL）
ADMIN_BFF_RW_POOL  ←  DATABASE_URL（主库，读写）
```

| Pool    | 符号常量            | 用途                                                             |
| ------- | ------------------- | ---------------------------------------------------------------- |
| RO Pool | `ADMIN_BFF_RO_POOL` | **全部 GET 端点**（`this.roPool` 或 `this.pool` 注入自 RO_POOL） |
| RW Pool | `ADMIN_BFF_RW_POOL` | **事务写操作**（`this.rwPool.connect()` → BEGIN/COMMIT）         |

### 3.2 注入方式

```typescript
import type { Pool } from 'pg';
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from '../tokens';

// ── 只读 Router（全部 GET，只需 RO Pool）
constructor(
  @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
) {}

// ── 读写混合 Router（有 GET + 事务写）
constructor(
  @Inject(ADMIN_BFF_RO_POOL) private readonly roPool: Pool,
  @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
) {}
```

> 注意：`auth.service.ts` 因需强一致性（读完即写），统一注入 RW Pool 命名为 `this.pool`。
> 普通 router 的只读操作**必须**使用 RO Pool。

### 3.3 添加只读端点（模板）

```typescript
// bff/admin-bff/src/routers/foo.router.ts

import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/console.types";

interface FooRow {
  id: string;
  name: string;
  created_at: Date;
}

// ── SQL ────────────────────────────────────────────────────────────────────

const FOO_LIST_SQL = `
  SELECT f.id, f.name, f.created_at
  FROM ops.foo f
  WHERE f.deleted_at IS NULL
  ORDER BY f.created_at DESC
`;

// ── Router ─────────────────────────────────────────────────────────────────

@Controller("api/foos")
export class FooRouter {
  constructor(@Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async listFoos(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");

    const rows = await this.pool.query<FooRow>(FOO_LIST_SQL);
    return rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
```

### 3.4 添加写端点（事务模板）

```typescript
// 写操作必须用 RW Pool，通过 connect() 获取事务连接

@Post(':id/actions')
@HttpCode(HttpStatus.OK)
async doAction(
  @Param('id') id: string,
  @Body() body: ActionDto,
  @Req() req: Request & RequestContext,
) {
  if (!req.user) throw new UnauthorizedException('No active session');

  const client = await this.rwPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE ops.foo SET status = $1, updated_at = now() WHERE id = $2`,
      [body.action, id],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 读取最新状态用 RO Pool
  const updated = await this.roPool.query<FooRow>(
    'SELECT * FROM ops.foo WHERE id = $1', [id],
  );
  return updated.rows[0];
}
```

### 3.5 查询范围（admin-bff 可访问的 Schema）

admin-bff 通过 `reporting_ro`（只读）或 `DATABASE_URL`（读写）连接，可直接 JOIN 以下 Schema：

| Schema     | 典型表                                                                       | 读/写                             |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `identity` | `account`, `account_credential`, `account_profile`, `login_attempt`          | RO                                |
| `iam`      | `role`, `permission`, `capability`, `member_role_binding`, `plan_capability` | RO                                |
| `tenant`   | `tenant`, `tenant_member`, `tenant_setting`, `tenant_invitation`             | RO（写：未来走 service API）      |
| `commerce` | `tenant_subscription`, `tenant_invoice`, `tenant_payment`, `tenant_credit`   | RO（写：订阅/账单操作走 RW Pool） |
| `product`  | `plan`, `feature`, `plan_feature`, `agent`                                   | RO                                |
| `model`    | `model`, `provider`, `model_grant`, `model_policy`                           | RO                                |
| `ops`      | `admin`, `role`, `permission`, `feature_flag`, `announcement`                | RO + RW（运营操作走 RW）          |
| `support`  | `ticket`, `ticket_event`, `audit_log`                                        | RO                                |

**禁止**：admin-bff 不得查询 `model_platform.*`（旧表，已过渡至 `model.*`）。

---

## 4. auth-bff 委托签发流程【历史，已退役】

> **本节描述的 `/auth/internal/sign` 委托签发链路已退役**：auth-bff 里没有这个 controller（`grep -rn 'internal/sign' bff/auth-bff/src` 为空；退役清单见 `docs/30-design/identity/120-implementation.md`），admin / console 今天都是 OIDC RP，登录走 IdP `/authorize` → `/token`。保留本节只为读懂旧代码与旧讨论，**不要按它配任何调用方**。
>
> **今天 auth-bff 的内部面**只有 `/internal/*` 四个 controller（`internal/operator/accounts`、`internal/account/users`、`internal/operator/sessions`、`POST internal/operator/stepup/totp`），由 `InternalAuthGuard` 守着：头 `x-vxture-internal-auth` 的值 = `IDP_INTERNAL_TOKEN`（2026-10-04 起只认这把，`secrets/platform-idp-internal.env`，只注入 auth / admin / arche / opera 四个容器）；拿产品面的 `AUTH_INTERNAL_TOKEN` 来是 401 `invalid_internal_auth`。发送方的写法看 `bff/admin-bff/src/auth/operator-stepup.service.ts`（读 `config.auth.IDP_INTERNAL_TOKEN`，不回落）。

### 4.1 完整登录链路（历史）

```
前端 POST /api/auth/login (admin-bff)
  → admin-bff: 限速 → 验证码 → DB 密码校验
  → admin-bff: fetch POST http://auth-bff:3081/auth/internal/sign          ← 已退役的端点
      Header: x-vxture-internal-auth: <当时的共享口令 AUTH_INTERNAL_TOKEN>   ← 历史写法；今天内部面 /internal/* 只认 IDP_INTERNAL_TOKEN
      Body: { sub, email, username, displayName, role, roleLabel, permissions, source: 'admin' }
  → auth-bff: 签发 JWT → Set-Cookie: vx_admin_access_token
  → admin-bff: 透传 Set-Cookie header 给浏览器
  → 前端: 收到 Cookie（HTTP-only，JS 不可读）
```

### 4.2 共享口令：两把钥匙、一个比较函数（2026-10-04 起的写法）

`@vxture/core-auth` 里曾有 `resolveInternalAuthToken` / `assertInternalAuth` / `InternalAuthGuard`——`!==` 比较、非生产硬编码回落值、零消费方，`150-security.md` §3.2 点名的错误形态。**2026-10-04 已删**（PR B）；不要再 import 这三个名字，也不要在 BFF 里自己写一份。新代码一律按 `150-security.md` §3.1 走换票；下面只管「确需共享口令」的存量两张面。

同一个请求头 `x-vxture-internal-auth` 后面有**两把钥匙**，各开一张面、互不认、不回落：

| 面     | 收方                                                             | 读的键                            | 发方                              | 住哪                                            |
| ------ | ---------------------------------------------------------------- | --------------------------------- | --------------------------------- | ----------------------------------------------- |
| 内部面 | auth-bff `/internal/*`（`InternalAuthGuard`，auth-bff 自己的类） | `config.auth.IDP_INTERNAL_TOKEN`  | admin-bff / arche-bff / opera-bff | `secrets/platform-idp-internal.env`，只四个容器 |
| 产品面 | platform-api C2/C3（`PlatformAuthGuard`）                        | `config.auth.AUTH_INTERNAL_TOKEN` | console-bff、各产品后台           | `secrets/platform.env`                          |

谁读哪把由 `scripts/guardrails/check-internal-auth-key-usage.mjs` 精确钉住（多一个读者、少一个读者都红）。**发送方**的写法看 `bff/admin-bff/src/auth/operator-stepup.service.ts`：从 `config.auth` 读键、未配置就 503 `operator_*_unavailable`，不写默认值。

**接收方**两个 guard 类分开（2026-07-12 的 guard-scope 事故是理由），但比较只有一个实现——`@vxture/core-auth` 的 `sharedSecretMatches(presented, expected)`：`expected` 为空 / 未配置 → false（fail-closed）、`presented` 不是字符串 → false、字节长度不等 → false、其余 `timingSafeEqual`。它不读 env、不认键名。

```typescript
import { sharedSecretMatches } from "@vxture/core-auth";

// 收方 guard 里（auth-bff internal-auth.guard.ts / platform-api platform-auth.guard.ts 都是这个形状）
const expected = this.config.auth.IDP_INTERNAL_TOKEN; // 产品面读 AUTH_INTERNAL_TOKEN
if (!expected) throw new UnauthorizedException("internal_auth_unavailable");
if (!sharedSecretMatches(req.header("x-vxture-internal-auth"), expected)) {
  throw new UnauthorizedException("invalid_internal_auth");
}
```

### 4.3 auth-bff 接收方守卫（历史写法，已退役）

旧文在这里教人 `import { InternalAuthGuard } from '@vxture/core-auth'` 挂到 `internal/sign` 上。那个共享 guard 已删（§4.2）；今天 auth-bff 的 `/internal/*` 用的是它**自己的** `bff/auth-bff/src/authn/internal-auth.guard.ts`（凭据过了之后还有一道路由准入，`@InternalRoute` 声明，deny-by-default）。

### 4.4 跨域 SSO（外部业务 BFF，以 Ruyin 为例）

```
vxture.com → 生成 one-time token
  → 跳转 ruyin.ai/auth/callback?token=xxx
  → Ruyin 外部业务 BFF GET /api/auth/callback
      → fetch POST auth-bff /auth/crossdomain/verify   (验证 token)
      → fetch POST auth-bff /auth/internal/sign         (签发 Cookie)
  → Ruyin 外部业务 BFF 转发 Set-Cookie → 重定向到 ruyin 首页
```

---

## 5. Varda 数据访问

Varda 使用独立 Prisma Client，公共 schema（`public`）下的 3 张表：

| 表              | 用途                                                  |
| --------------- | ----------------------------------------------------- |
| `VardaSession`  | 对话会话（userId + surface）                          |
| `VardaMessage`  | 消息记录（含 `toolCallId` 字段）                      |
| `VardaAuditLog` | 工具调用审计（三态：pending / confirmed / cancelled） |

`VardaAuditLog` 三态判断：

```typescript
// pending   : confirmed === false && cancelledAt === null
// confirmed : confirmed === true
// cancelled : cancelledAt !== null
```

Varda BFF 不直接查询 `platform_main` 数据库，通过 varda-server 内部 API 访问。

---

## 6. 数据库与代码映射速查

### 6.1 Schema 物理位置

```
PostgreSQL: vxturestudio_platform_main
├── identity  — account*, sso_connection, oauth*, login_attempt, account_session, account_verification
├── iam       — role, permission, role_permission, member_role_binding, capability, plan_capability
├── tenant    — tenant, tenant_member, tenant_setting, tenant_domain, tenant_organization,
│               tenant_ownership_transfer, tenant_invitation
├── commerce  — tenant_subscription*, tenant_invoice*, tenant_payment*, tenant_refund,
│               tenant_transaction, tenant_credit, tenant_billing_address,
│               tenant_payment_method, tenant_subscription_quota,
│               tenant_usage_event, tenant_usage_summary
├── product   — plan, feature, plan_feature, plan_price, agent, agent_feature, plan_agent
├── model     — model, provider, model_grant, model_price_rule, model_policy   ← 新架构目标
├── ops       — admin, role, permission, role_permission, setting, feature_flag,
│               announcement, maintenance, governance_record
├── support   — ticket, ticket_event, audit_log, notification_log
├── model_platform— ai_model, ai_provider, ai_model_grant, ai_model_cost_rate     ← 过渡期旧表
└── public    — VardaSession, VardaMessage, VardaAuditLog                        ← Varda 私有表
```

### 6.2 Prisma 文件 ↔ Schema 归属

| Prisma 文件                                    | 管理 Schema                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/core/database/prisma/schema.prisma`  | identity, iam, tenant, product, commerce（12张核心表）, model, ops, support |
| `services/model/platform/prisma/schema.prisma` | commerce（3张用量表）+ model（只读代理）                                    |
| `agent-server/varda/prisma/schema.prisma`      | public（Varda 3张表）                                                       |

### 6.3 环境变量

| 变量                        | 用途                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | 主库读写连接（RW Pool + Prisma migrations）                                                                      |
| `REPORTING_RO_DATABASE_URL` | 只读副本（RO Pool，未设置时降级用 DATABASE_URL）                                                                 |
| `AUTH_BFF_URL`              | auth-bff 地址，默认 `http://localhost:3081`                                                                      |
| `AUTH_INTERNAL_TOKEN`       | 产品面共享口令（platform-api 收、console-bff 发），生产必填                                                      |
| `IDP_INTERNAL_TOKEN`        | IdP 内部面口令（auth-bff `/internal/*` 收、admin/arche/opera-bff 发），只注入这四个容器；≠ `AUTH_INTERNAL_TOKEN` |
| `MODEL_PLATFORM_URL`        | Model Platform 地址（admin-bff model-platform 路由透传用）                                                       |

---

## 7. 添加新端点的完整步骤

以 admin-bff 添加一个新只读端点为例：

```
1. 在 bff/admin-bff/src/routers/ 下新建 {domain}.router.ts
   （或在已有文件中新增方法）

2. 定义 SQL 常量（大写，放文件顶部）

3. 定义 RowType interface（SQL 查询结果的 DB 字段类型）

4. constructor 注入 ADMIN_BFF_RO_POOL（只读）或同时注入 RO + RW

5. 在 AppModule / 对应 Module 注册 Router（imports + providers）

6. 更新 docs/40-implementation/packages/bff/admin.md 的接口契约表
```

---

## 8. 禁止项（AI 编码硬约束）

| 禁止操作                                    | 原因                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 在 BFF 中自己写共享口令比较或读口令的默认值 | 比较只用 `@vxture/core-auth` 的 `sharedSecretMatches`（常量时间、fail-closed）；口令从 `config.auth` 读、未配置即关门，禁止回落默认值（§4.2） |
| 在 router 文件中 `new Pool()`               | 只允许 `pools.module.ts` 创建 Pool，router 只能 @Inject                                                                                       |
| 用 RW Pool 做纯读操作                       | RW Pool 是主库连接，读压力必须走 RO Pool                                                                                                      |
| 在 BFF 中直接签发 JWT                       | auth-bff 是唯一签发者，其他 BFF 只能调 internal/sign                                                                                          |
| 查询 `model_platform.*` 表                  | 旧表，admin-bff 应查 `model.*` 表                                                                                                             |
| 在 service 层 import `bff-*`                | 层违反，dep-cruiser 会 blocking                                                                                                               |
| 跨 BFF 直接 import                          | BFF 之间通信只能通过 HTTP                                                                                                                     |
