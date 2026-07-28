# Vxture Service Layer Architecture

**Version**: 1.4.0
**Last Updated**: 2026-05-14

## Overview

The **Service Layer** contains **shared platform domain services**.

Domain directories represent bounded contexts in the platform's
domain-driven architecture.

These are stable, reusable domain modules consumed by the BFF Layer and Agent Server Layer.
They represent business logic that has been **proven and promoted** from agent-server backends,
or platform capabilities that are shared across multiple consumers from the start.

Service directories are grouped by domain for organizational clarity,
but package names remain flat.

---

```
Example:

Directory:
services/commerce/billing

Package name:
@vxture/service-billing
```

---

# 1. Location

```
services/
├── commerce/               # Commerce domain
│   ├── billing/            # @vxture/service-billing
│   └── subscription/       # @vxture/service-subscription
├── identity/               # Identity domain
│   └── iam/                # @vxture/service-iam
├── notification/           # Notification domain
│   ├── mail/               # @vxture/service-mail
│   └── sms/                # @vxture/service-sms
├── support/                # Support domain
│   ├── ticket/             # @vxture/service-ticket
│   └── workers/            # @vxture/workers
└── tenant/                 # Tenant domain
    └── organization/       # @vxture/service-organization
```

Services live at the top level of the monorepo, not inside `packages/`,
because they are independent deployable domain modules rather than shared libraries.

The two-level structure `services/{domain}/{name}/` organizes services by business domain.
This makes domain ownership and navigability clear as the number of services grows.

---

# 2. Naming Convention

**Package names** follow a flat convention regardless of domain grouping:

```
@vxture/service-{name}
```

Examples:

```
@vxture/service-billing
@vxture/service-subscription
@vxture/service-iam
@vxture/service-mail
@vxture/service-sms
@vxture/service-ticket
@vxture/workers
@vxture/service-organization
```

The domain directory (`commerce/`, `support/`) is for **organization only**.
It does not appear in the package name. Consumers always import using `@vxture/service-{name}`.

---

# 3. Current Domain Groups

| Domain         | Directory                | Services                                                  |
| -------------- | ------------------------ | --------------------------------------------------------- |
| `commerce`     | `services/commerce/`     | `@vxture/service-billing`, `@vxture/service-subscription` |
| `identity`     | `services/identity/`     | `@vxture/service-iam`                                     |
| `notification` | `services/notification/` | `@vxture/service-mail`, `@vxture/service-sms`             |
| `support`      | `services/support/`      | `@vxture/service-ticket`, `@vxture/workers`               |
| `tenant`       | `services/tenant/`       | `@vxture/service-organization`                            |

**Adding a new service**:

1. Identify the appropriate business domain
2. Create `services/{domain}/{name}/`
3. Set `"name": "@vxture/service-{name}"` in `package.json`
4. No workspace config change needed — `services/*/*` already covers all domains

**Adding a new domain**:

1. Create `services/{new-domain}/` directory
2. Add first service inside it
3. No workspace config change needed

---

# 4. Internal Structure

```
services/{domain}/{name}/
├── package.json
├── tsconfig.json
└── src/
    ├── module/         # NestJS 模块定义 (*.module.ts)
    ├── service/        # Business logic and use cases (*.service.ts)
    ├── repository/     # Data access layer (*.repository.ts)
    ├── types/          # Domain types (*.types.ts)
    └── index.ts        # Single public export entry
```

---

# 5. Responsibilities

Service Layer handles:

- Shared business logic and domain rules
- Domain models and value objects
- Workflow orchestration within a domain
- Service APIs consumed by BFFs and agent backends

Service Layer must not handle:

- UI rendering or components
- Direct HTTP framework routing (belongs in BFF)
- AI model invocations (belongs in agent-server or ai-sdk)
- Cross-service orchestration (belongs in BFF aggregators)

---

# 6. Promotion Lifecycle

Service Layer packages originate in two ways:

**Promoted from agent-server**: Logic that starts in `agent-server/{agent}/` and proves
reusable across multiple agents or portals is extracted and promoted here.

```
Stage 1  agent-server/{agent}/              Agent-private, fast iteration
          ↓ proven reusable
Stage 2  services/{domain}/{name}/          Shared platform service with stability guarantees
          ↓ consumed via BFF
Stage 3  Any portal or agent accesses it through its own BFF
```

**Born shared**: Capabilities that are platform-wide from the start (billing, subscription, etc.)
are authored directly in `services/` without an agent-server stage.

---

# 7. Dependency Rules

Allowed:

```
@vxture/core-*
@vxture/shared
Database clients
External APIs
```

Forbidden:

```
Other @vxture/service-*   (no cross-service imports)
@vxture/bff-*
@vxture/model-runtime-client
@vxture/design-system
@vxture/platform-*
Any frontend code
```

Services must remain **isolated from each other**.
Cross-domain orchestration belongs in the BFF aggregator layer, not in services.

---

# 8. Consumers

Services are consumed by:

| Consumer         | Access pattern                             |
| ---------------- | ------------------------------------------ |
| `bff/*`          | Direct package import inside BFF server    |
| `agent-server/*` | Direct package import inside agent backend |

Services are **never imported directly by frontend code** (`portals/`, `agent-studio/`).
Frontend layers access service data through their BFF over HTTP.

---

# 9. Example Usage

```ts
// Inside bff/* or agent-server/* only
import { createTicket } from "@vxture/service-ticket";
import { getBillingStatus } from "@vxture/service-billing";
import { getSubscription } from "@vxture/service-subscription";
```

Import paths use the package name `@vxture/service-{name}` only.
The domain directory path is never referenced in import statements.

---

# 10. Workspace Configuration

The `pnpm-workspace.yaml` entry for services:

```yaml
- services/*/*
```

This single glob covers all current and future domain subdirectories.
No workspace config change is needed when adding new services or domains.

---

# 11. AI Coding Rules

AI must:

- Keep services independent — no cross-service imports under any circumstance
- Never import from bff, ai-sdk, design-system, or platform packages
- Never expose services directly to frontend code
- Place cross-domain logic in BFF aggregators, not in services
- Promote agent-server logic to services only when it is proven reusable
- Place new services in `services/{domain}/{name}/` — identify the correct domain first
- Use `@vxture/service-{name}` as the package name — domain is directory-only
- Export all public APIs via `src/index.ts`
- Use domain-specific file naming: `*.types.ts`, `*.service.ts`, `*.repository.ts`
- No `any` types

---

# 12. Repository 层约束（数据访问隔离）

Repository 是 Service 内部唯一允许访问数据库的层。其存在的唯一目的是：**让 DB schema 变化止步于 Repository，不向上传播**。

## 12.1 分层职责

```
Handler（HTTP 入口，NestJS Controller）
    │  接收请求 → 调用 UseCase → 返回响应 DTO
    ▼
UseCase / Service（业务逻辑）
    │  编排规则 → 调用 Repository → 不接触 Prisma
    ▼
Repository（数据访问层）
    │  封装所有 Prisma 查询 → 映射到领域类型
    ▼
Prisma ORM → Database
```

## 12.2 强制规则

**Repository 必须：**

- 封装该聚合根（aggregate）的所有 Prisma 查询，包括关联查询
- 将 Prisma 返回的原始类型映射为领域类型（Domain Type），再返回给 UseCase
- 每个聚合根对应一个 Repository 类（`*.repository.ts`）

**Repository 禁止：**

- 包含任何业务逻辑（条件判断、规则计算）
- 跨聚合根做复杂联查——需要多聚合数据时，由 UseCase 多次调用不同 Repository 再合并
- 直接返回 Prisma 生成类型（`Prisma.XxxGetPayload<...>`）给 UseCase

**UseCase / Service 禁止：**

- `import { PrismaClient } from '@prisma/client'` 或任何 Prisma 类型
- 直接执行 `db.xxx.findMany(...)` 等 Prisma 调用
- 感知表名、字段名、`@@schema` 等数据库细节

## 12.3 领域类型与 Prisma 类型隔离

```ts
// ✅ Repository 输出领域类型（在 src/types/ 定义）
export interface Tenant {
  id: string;
  code: string;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
}

// ✅ Repository 内部做映射
export class TenantRepository {
  async findById(id: string): Promise<Tenant | null> {
    const row = await this.db.tenant.findUnique({ where: { id } });
    if (!row) return null;
    return { id: row.id, code: row.tenantCode, status: row.status as Tenant['status'], createdAt: row.createdAt };
  }
}

// ❌ 禁止：UseCase 直接用 Prisma 类型
import type { Prisma } from '@prisma/client';               // 禁止
const tenant = await this.db.tenant.findUnique({ ... });   // 禁止
```

## 12.4 变更影响面规则

| 变化类型                      | 需要修改             | 止步层       | 前端感知 |
| ----------------------------- | -------------------- | ------------ | -------- |
| DB 列改名（`@map` 更新）      | Repository 映射逻辑  | Repository   | 无       |
| DB 表拆分 / 合并              | Repository 查询逻辑  | Repository   | 无       |
| 领域类型字段改名              | Repository + UseCase | Service 内部 | 无       |
| Service HTTP API 响应结构变更 | BFF 适配层           | BFF          | 无       |
| BFF 响应字段删除 / 改名       | 前端代码             | **前端**     | **有**   |

**结论**：只有 BFF 响应结构变化才会影响前端。Repository / UseCase 层的任何重构对前端透明。

---

# 13. BFF 响应契约稳定性

BFF 是前端唯一可见的接口。BFF 响应字段一旦被前端消费，即构成**稳定契约**，不得在无通知的情况下删除或重命名。

## 13.1 契约演进规则

**允许（向后兼容）：**

- 新增响应字段（前端可选择消费）
- 将字段值范围扩大（如枚举新增值）
- 新增可选的请求参数

**不允许（破坏性变更）：**

- 删除响应字段
- 重命名响应字段
- 改变字段数据类型
- 缩小字段值范围（如移除枚举值）
- 将可选字段变为必填

## 13.2 破坏性变更的处理流程

```
1. 新旧字段并存（deprecation 期，≥ 1 个迭代周期）
       响应同时包含 oldField 和 newField
2. 前端迁移到 newField
3. 确认无调用方使用 oldField 后，移除
```

## 13.3 内部字段 vs 契约字段

BFF 响应中部分字段是内部实现细节，不应暴露为稳定契约。区分原则：

| 类型     | 特征                                         | 处理                                 |
| -------- | -------------------------------------------- | ------------------------------------ |
| 契约字段 | 前端业务逻辑依赖的字段（展示 / 判断 / 路由） | 按规则 13.1 保护                     |
| 内部字段 | 仅用于调试 / 运维的字段                      | 通过 `_debug` 前缀标识，前端不应依赖 |

## 13.4 跨层隔离的完整路径

```
DB schema 列改名
    ↓ 只改 Repository @map + 映射函数，领域类型不变
UseCase 调用 Repository，拿到领域类型
    ↓ 领域类型字段名变化只影响 UseCase 内部
Service HTTP API 响应（DTO）
    ↓ BFF 消费此响应，可做字段重命名 / 结构重组
BFF 响应（稳定契约）
    ↓ 前端只消费 BFF 响应
Frontend
```

每一层都有机会吸收下层的变化，前端只需关注 BFF 契约。

---

# 14. 数据库迁移安全规则

Repository 层配合以下迁移原则，保证线上零停机：

| 操作                          | 允许 | 注意                                      |
| ----------------------------- | ---- | ----------------------------------------- |
| 新增列（nullable 或有默认值） | ✅   | 存量数据自动兼容                          |
| 新增表                        | ✅   | 无影响                                    |
| 列改名（双写过渡）            | ⚠️   | 先新增列 → 双写 → 迁移数据 → 删旧列       |
| 删除列                        | ⚠️   | Repository 必须先停止读写该列，再发布迁移 |
| 新增非空列（无默认值）        | ❌   | 禁止直接操作，必须先设默认值或分步迁移    |
| Platform DB 锁表超过 1 秒     | ❌   | 必须使用 `CONCURRENTLY` 或分批操作        |

---

**Version**: 1.4.0
**Last Updated**: 2026-05-14
