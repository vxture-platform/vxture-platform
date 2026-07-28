# Vxture Package Boundaries

**Version**: 1.2.0
**Last Updated**: 2026-05-01

This document defines the **package boundaries and responsibilities** for the Vxture Monorepo.

It is the authoritative guide for:

- AI-assisted coding (Claude / Copilot)
- Developer onboarding
- Package architecture consistency

---

## 1. Layer Overview

| Layer                | Location                       | Responsibilities                                                           | Allowed Dependencies                                        | Forbidden Dependencies                                                                              |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Portal Web           | `portals/*`                    | Platform management UI — stable, ops-facing                                | BFF (HTTP), design-system, platform-\*, shared, core-locale | service-\*, core-api, core-auth, core-config, core-tenant, core-utils, ai-sdk, bff-\* (as packages) |
| Agent Web            | `agent-studio/*`               | Agent product UI — fast-changing, customer-facing                          | BFF (HTTP), design-system, platform-\*, shared, core-locale | service-\*, core-api, core-auth, core-config, core-tenant, core-utils, ai-sdk, bff-\* (as packages) |
| Agent Backend        | `agent-server/*`               | Agent-private backend: models, storage, workflows                          | ai-sdk, service-\*, core-\*, shared                         | design-system, platform-\*, bff-\*, other agent-server/\*                                           |
| BFF                  | `bff/*` / `@vxture/bff-*`      | Auth, tenant resolution, aggregation, response shaping                     | agent-server/\*, service-\*, core-\*, shared                | design-system, platform-\*, ai-sdk, other bff-\*                                                    |
| Service              | `@vxture/service-*`            | Shared platform domain logic (promoted from agent-server)                  | core-\*, shared                                             | other service-\*, UI, bff-\*, platform-\*, ai-sdk                                                   |
| Core                 | `@vxture/core-*`               | Platform infrastructure: config, tenant, i18n, auth, API base              | shared                                                      | service-\*, UI, bff-\*, platform-\*, ai-sdk                                                         |
| Model Runtime Client | `@vxture/model-runtime-client` | Shared Model Runtime capabilities: llm, rag, embedding, workflow (modules) | shared                                                      | service-\*, UI, bff-\*, platform-\*                                                                 |
| Platform SDK         | `@vxture/platform-*`           | Third-party client SDK wrappers — browser-only                             | shared, design-system (optional)                            | core-\*, service-\*, ai-sdk, bff-\*                                                                 |
| Design System        | `@vxture/design-system`        | Design tokens, UI components, theme, icons, density                        | shared                                                      | core-\*, service-\*, ai-sdk, bff-\*, platform-\*                                                    |
| Shared               | `@vxture/shared`               | Generic utilities, TypeScript types, constants                             | Third-party libraries only                                  | All internal packages                                                                               |

---

## 1.1 Frontend 层特殊说明：core-locale 例外规则

Frontend 层（`portals/*` 和 `agent-studio/*`）**仅允许直接引用** `@vxture/core-locale`，其他 core-\* 包仍然禁止。

**理由**：

- `@vxture/core-locale` 提供纯工具函数（formatDate、formatNumber 等）
- 无副作用、无状态管理、无安全敏感内容
- 性能敏感（简单操作通过 HTTP 调用得不偿失）
- 符合行业最佳实践（大多数公司不会为纯工具设置 HTTP 边界）

**判断标准**（什么样的 core 包可以例外）：

- ✅ 纯工具函数，无副作用
- ✅ 无状态管理
- ✅ 无安全敏感内容
- ✅ 无业务逻辑
- ✅ 性能敏感（简单操作）
- ✅ 框架无关（可在浏览器运行）

---

## 2. Shared Layer (`@vxture/shared`)

**Location**: `packages/shared/shared/`

**Responsibilities**: pure utility functions, TypeScript types, global constants, no domain logic.

**Allowed dependencies**: lightweight third-party libraries only.

**Forbidden dependencies**: all internal packages.

```ts
import { debug } from "@vxture/shared";
```

---

## 3. Core Layer (`@vxture/core-*`)

**Location**: `packages/core/{name}/`

**Packages**:

```
@vxture/core-api        # packages/core/api/
@vxture/core-auth       # packages/core/auth/
@vxture/core-config     # packages/core/config/
@vxture/core-database   # packages/core/database/  (Prisma DDL 管理，server-side only)
@vxture/core-locale     # packages/core/locale/
@vxture/core-mail       # packages/core/mail/      (nodemailer 封装，server-side only)
@vxture/core-tenant     # packages/core/tenant/
@vxture/core-utils      # packages/core/utils/
```

**Responsibilities**:

- Configuration management
- Multi-tenant support (tenant ID resolution, context propagation)
- Localization / i18n
- API base / infrastructure (request handling, interceptors, error normalization)
- Authentication primitives (token validation, session helpers)
- Database schema management and Prisma client (`core-database`)
- Transactional email sending (`core-mail`)

**Allowed dependencies**: `@vxture/shared` only.

**Forbidden dependencies**: service-\*, bff-\*, ai-sdk, design-system, platform-\*, any UI framework.

**Constraint**: Must be **framework-agnostic** — runnable in both Node.js and browser.

```ts
import { getConfig } from "@vxture/core-config";
import { validateToken } from "@vxture/core-auth";
import { getTenantId } from "@vxture/core-tenant";
```

---

## 4. Model Runtime Client (`@vxture/model-runtime-client`)

**Location**: `packages/ai/model-runtime-client/`

**Single package with internal modules**:

```
packages/ai/model-runtime-client/
└── src/
    ├── llm/          # Unified LLM client (Doubao, Claude, custom/private models)
    ├── rag/          # Retrieval-augmented generation pipeline
    ├── embedding/    # Embedding and vectorization utilities
    ├── workflow/     # Multi-step agent workflow orchestration
    └── index.ts
```

**Purpose**: Shared AI infrastructure for `agent-server/*` backends.
Each module is independently importable — agents import only the capabilities they need.
New Model Runtime capabilities are added as modules inside this package, not as new packages,
unless a capability requires independent versioning or deployment.

**Allowed dependencies**: `@vxture/shared`.

**Forbidden dependencies**: service-\*, bff-\*, design-system, platform-\*.

**Constraint**: Server-side only. Must not be imported in any frontend code.

**Agent isolation**: All shared AI logic lives in `@vxture/model-runtime-client`.
Agent backends never share logic by importing each other directly.

```ts
// Inside agent-server/* only
import { llmClient } from "@vxture/model-runtime-client"; // full import
import { llmClient } from "@vxture/model-runtime-client/llm"; // module import
import { createRagPipeline } from "@vxture/model-runtime-client/rag";
import { embed } from "@vxture/model-runtime-client/embedding";
import { defineWorkflow } from "@vxture/model-runtime-client/workflow";
```

---

## 5. Service Layer (`@vxture/service-*`)

**Location**: `services/{domain}/{name}/`

**Directory structure**: Services are grouped by business domain inside `services/`.
The domain directory is for organization and team ownership — it does not appear in the package name.

**Current domains and packages**:

```
services/
├── commerce/      billing/        → @vxture/service-billing
│                  subscription/   → @vxture/service-subscription
├── identity/      iam/            → @vxture/service-iam
├── notification/  mail/           → @vxture/service-mail
│                  sms/            → @vxture/service-sms
├── support/       ticket/         → @vxture/service-ticket
│                  workers/        → @vxture/workers
└── tenant/        organization/   → @vxture/service-organization
```

**Package naming**: Always `@vxture/service-{name}`. Never `@vxture/commerce-billing` or similar.

**Responsibilities**: shared platform business logic, domain rules, service APIs.

**Promotion path**: Logic that originates in `agent-server/{agent}/` and proves reusable
across multiple agents or portals is extracted and promoted to this layer.

**Allowed dependencies**: `@vxture/core-*`, `@vxture/shared`.

**Forbidden dependencies**: other service-\*, bff-\*, ai-sdk, design-system, platform-\*, any frontend code.

**Constraint**: Services must remain **isolated from each other**.
Cross-domain orchestration belongs in the BFF aggregator layer.

```ts
// Inside BFF or agent-server only — never in frontend code
import { createTicket } from "@vxture/service-ticket";
import { getSubscription } from "@vxture/service-subscription";
import { getBillingStatus } from "@vxture/service-billing";
```

---

## 6. BFF Layer (`@vxture/bff-*`)

**Location**: `bff/{name}-bff/`

**Packages**:

```
@vxture/bff-auth           # 唯一 JWT 签发者（所有 BFF 委托此包签发 Cookie）
@vxture/bff-gateway        # 浏览器侧统一 API 入口网关
@vxture/bff-website        # Serves portals/website
@vxture/bff-admin          # Serves portals/admin
@vxture/bff-console        # Serves portals/console
@vxture/bff-varda           # Serves embedded agent-studio/varda ↔ agent-server/varda
@vxture/bff-agent{N}       # Serves agent-studio/agent{N} ↔ agent-server/agent{N}
```

**Responsibilities**:

- Authentication token validation and session management
- Tenant context resolution and propagation
- Aggregation across `agent-server/`, `services/`, and `core-*`
- Response shaping / field projection per consumer
- Domain routing via internal router modules

The BFF is the **only entry point** between a frontend and its backend.
The frontend never knows whether data originates from `agent-server/` or `services/`.

**Internal structure**:

```
bff/{name}-bff/src/
├── routers/          # Domain router modules (user, order, product, billing…)
├── aggregators/      # Cross-domain data composition
├── middleware/       # Auth and tenant middleware
├── types/            # Consumer-facing DTO types
└── index.ts
```

**Router isolation**: Each router module catches its own errors. A failure in one router
must not crash other routers or the BFF process.

**Allowed dependencies**: `agent-server/*` (internal service calls), `@vxture/service-*`,
`@vxture/core-*`, `@vxture/shared`.

**Forbidden dependencies**: other bff-\*, design-system, platform-\*, ai-sdk, React, browser APIs.

**Critical constraint**: BFF is **server-side only**. Frontend code never imports BFF packages.
All communication is over **HTTP (REST or tRPC)** exclusively.

---

## 7. Agent Backend (`agent-server/*`)

**Location**: `agent-server/{agent}/`

Agent-private backend services. Not shared packages — each agent owns its backend independently.

**Responsibilities**:

- AI model invocations and pipelines via `@vxture/model-runtime-client`
- Agent-private storage and data access
- Workflow orchestration via `@vxture/model-runtime-client/workflow`
- Consuming platform capabilities via `@vxture/service-*` and `@vxture/core-*`

**Allowed dependencies**: `@vxture/model-runtime-client`, `@vxture/service-*`, `@vxture/core-*`, `@vxture/shared`.

**Forbidden dependencies**: other `agent-server/*` directories, bff-\*, design-system, platform-\*.

**Cross-agent sharing rules**:

- Shared Model Runtime capabilities → `@vxture/model-runtime-client`
- Shared domain logic → promote to `@vxture/service-*`
- Direct imports between agent backend directories → **forbidden**

**Lifecycle**:

```
agent-server/{agent}/  →  (proven reusable)  →  services/{domain}/{name}/
```

---

## 8. Agent Web (`agent-studio/*`)

**Location**: `agent-studio/{agent}/`

Agent product frontend. Pure frontend — no backend logic. Governed independently per agent team.

**Responsibilities**: agent product UI, user interaction, consuming its own BFF over HTTP.

**Deployment modes**:

- **Standalone**: independent web app with its own URL
- **Embedded**: loaded inside `portals/admin` or `portals/console` as a micro-frontend

**Allowed dependencies**: `@vxture/design-system`, `@vxture/platform-*`, `@vxture/shared`,
own BFF over **HTTP only**.

**Forbidden dependencies**: service-\*, core-\*, ai-sdk, bff-\* (as packages),
`agent-server/*`, other agent-studio directories, portal internals.

---

## 9. Platform SDK Layer (`@vxture/platform-*`)

**Location**: `packages/platform/{name}/`

**Packages**:

```
@vxture/platform-browser   # packages/platform/browser/（已实现）
@vxture/platform-amap      # packages/platform/amap/（计划中，尚未实现）
@vxture/platform-cesium    # packages/platform/cesium/（计划中，尚未实现）
@vxture/platform-{name}    # packages/platform/{name}/（扩展槽）
```

**Responsibilities**: encapsulate third-party client SDKs, typed React hooks and components,
browser utilities, version isolation.

**Allowed dependencies**: `@vxture/shared`, `@vxture/design-system` (optional).

**Forbidden dependencies**: core-\*, service-\*, ai-sdk, bff-\*, other platform-\*.

**Critical constraint**: Browser-only. Must not be imported in any server environment.

```ts
import { resetScrollTop, getPreference } from "@vxture/platform-browser";
```

---

## 10. Design System (`@vxture/design-system`)

**Location**: `packages/design/design-system/`

**Responsibilities**: design tokens, UI components, theme system (light/dark/system),
icon library (registry pattern), density system (compact/default/comfortable), global styles.

**Allowed dependencies**: `@vxture/shared`.

**Forbidden dependencies**: core-\*, service-\*, ai-sdk, bff-\*, platform-\*, portal or agent internals.

```ts
import { Button, Icon, ThemeProvider, useTheme } from "@vxture/design-system";
```

---

## 11. Full Dependency Graph

```
portals/*               agent-studio/*
    │                         │
    │  HTTP                   │  HTTP
    ▼                         ▼
bff/portal-bff          bff/agent{N}-bff
    │                         │
    │                         ├──► agent-server/{agent}
    │                         │         ├──► @vxture/model-runtime-client
    │                         │         ├──► @vxture/service-*
    │                         │         └──► @vxture/core-*
    │                         │
    └────────────┬────────────┘
                 ▼
        @vxture/service-*
                 │
                 ▼
         @vxture/core-*
                 │
                 ▼
         @vxture/shared


portals/* and agent-studio/* (frontend only)
    ├──► @vxture/design-system  ──► @vxture/shared
    └──► @vxture/platform-*     ──► @vxture/shared
```

---

## 12. Naming Convention

| Group                  | Location                            | Package name                                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `shared`               | `packages/shared/shared/`           | `@vxture/shared`                                                               |
| `core`                 | `packages/core/{name}/`             | `@vxture/core-api`, `core-auth`, `core-tenant`, `core-config`                  |
| `model-runtime-client` | `packages/ai/model-runtime-client/` | `@vxture/model-runtime-client`                                                 |
| `service`              | `services/{domain}/{name}/`         | `@vxture/service-billing`, `service-subscription`, `service-ticket`            |
| `bff`                  | `bff/{name}-bff/`                   | `@vxture/bff-website`, `bff-admin`, `bff-console`, `bff-varda`, `bff-agent{N}` |
| `platform`             | `packages/platform/{name}/`         | `@vxture/platform-amap`, `platform-cesium`, `platform-{name}`                  |
| `design`               | `packages/design/design-system/`    | `@vxture/design-system`                                                        |

---

## 13. AI Coding Rules

1. `portals/` and `agent-studio/` are parallel frontend layers — neither depends on the other
2. `agent-studio/` is frontend only — backend logic belongs in `agent-server/`
3. `agent-server/` and `services/` are both backend but serve different purposes — agent-server is private and fast-changing, services are shared and stable
4. No frontend code imports service, core-api, core-auth, core-config, core-tenant, core-utils, or ai-sdk — all backend calls go through BFF over HTTP. Frontend may import core-locale directly for formatting purposes
5. No frontend code imports BFF packages or agent-server code — HTTP only, no package imports
6. BFF is server-side only — no React, no browser APIs, no design-system, no platform-\*, no ai-sdk
7. `@vxture/model-runtime-client` is server-side only — import llm/rag/embedding/workflow modules as needed
8. Agent backends share AI logic via `@vxture/model-runtime-client` — never by importing other agent-server directories
9. Agent backends share domain logic by promoting to `services/` — never by cross-agent imports
10. Platform SDK is browser-only — no core-\*, service-\*, or ai-sdk imports
11. Services must remain isolated — no cross-service imports
12. BFF domain expansion means adding a router module — not creating a new BFF package
13. Core must remain framework-agnostic — no React, no Next.js, no browser-only APIs
14. Shared must remain domain-agnostic — pure utilities, types, constants only
15. All packages export via `src/index.ts` — no deep internal path imports
16. No `any` types — respect strict TypeScript configuration throughout
17. New services always go into `services/{domain}/{name}/` — identify the correct domain first
18. Service package names are always `@vxture/service-{name}` — domain prefix is directory-only

---

End of document.
