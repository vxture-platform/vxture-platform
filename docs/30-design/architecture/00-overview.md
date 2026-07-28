# Vxture Platform Architecture Overview

**Version**: 1.4.0
**Last Updated**: 2026-05-12
**TypeScript**: 5.9.3
**ECMAScript**: ES2023

This document provides a **complete architectural overview** of the Vxture platform.

It is the entry point for understanding how the system is structured, how layers relate
to each other, and what principles govern the entire platform.

Read this document first. Refer to layer-specific documents for deeper detail.

---

# 1. What is Vxture

Vxture is a **TypeScript-based enterprise SaaS platform** built as a pnpm workspace monorepo.

It has two distinct product surfaces:

**Platform** — the operational backbone. Stable, slow-changing infrastructure for
operators and tenant administrators (portals, services, packages).

**Agent Studio** — the customer-facing product surface. Fast-moving AI-powered
applications delivered to end users (agent-studio, agent-server).

Both surfaces share the same platform infrastructure and are governed independently.

---

# 2. Architectural Layers at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│  APPLICATION LAYER                                              │
│                                                                 │
│   portals/              agent-studio/                          │
│   (platform UI)         (agent product UI)                     │
│   website               varda/                                  │
│   admin                 agent-template/        Frontend only   │
│   console               agent{N}/                              │
└──────────────┬──────────────────┬───────────────────────────────┘
               │ HTTP              │ HTTP
               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  BFF LAYER                                                      │
│                                                                 │
│   bff/website-bff       bff/varda-bff                           │
│   bff/admin-bff         bff/agent{N}-bff    Server-side only   │
│   bff/console-bff                                              │
│                                                                 │
│   Auth · Tenant resolution · Aggregation · Response shaping    │
└──────────┬──────────────────────┬───────────────────────────────┘
           │                      │
           │               ┌──────▼──────────────────────────┐
           │               │  AGENT SERVER LAYER             │
           │               │                                 │
           │               │  agent-server/varda              │
           │               │  agent-server/agent{N}          │
           │               │                                 │
           │               │  Private backend per agent      │
           │               │  Models · Storage · Workflows   │
           │               └──────┬──────────────────────────┘
           │                      │
           └──────────┬───────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVICE LAYER                                                  │
|                                                                 |
|   services/                                                     |
|      commerce/   billing       (@vxture/service-billing)        |
|                  subscription  (@vxture/service-subscription)   |
|      identity/   iam           (@vxture/service-iam)            |
|      notification/ mail        (@vxture/service-mail)           |
|                  sms           (@vxture/service-sms)            |
|      support/    ticket        (@vxture/service-ticket)         |
|                  workers       (@vxture/workers)                |
|      tenant/     organization  (@vxture/service-organization)   |
|                                                                 |
│   Promoted from agent-server when proven reusable               │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CORE LAYER                                                     │
│                                                                 │
│   @vxture/core-api        @vxture/core-auth                    │
│   @vxture/core-config     @vxture/core-locale   Mostly         │
│   @vxture/core-tenant     @vxture/core-utils    framework-     │
│   @vxture/core-mail       @vxture/core-database agnostic*      │
│                                                                 │
│   Platform infrastructure primitives                           │
│   * core-mail / core-database are NestJS-specific (server BFF) │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  SHARED LAYER                                                   │
│                                                                 │
│   @vxture/shared                                               │
│                                                                 │
│   Pure utilities · TypeScript types · Constants                │
└─────────────────────────────────────────────────────────────────┘


FRONTEND-ONLY BRANCHES (parallel, not in server chain)

portals/* / agent-studio/*
   ├──► @vxture/design-system     (UI components, tokens, theme, icons)
   └──► @vxture/platform-browser  (browser utilities; platform-amap / platform-cesium 计划中)


SERVER-ONLY BRANCH (agent backends)

agent-server/*
   └──► @vxture/model-runtime-client
           ├── llm       (Doubao, Claude, custom models)
           ├── rag       (retrieval-augmented generation)
           ├── embedding (vectorization)
           └── workflow  (multi-step orchestration)
```

---

# 3. Layer Summary

| Layer                | Location                           | Nature                            | Change Velocity |
| -------------------- | ---------------------------------- | --------------------------------- | --------------- |
| Portal Web           | `portals/*`                        | Platform management UI            | Slow            |
| Agent Web            | `agent-studio/*`                   | Agent product UI                  | Fast            |
| Agent Server         | `agent-server/*`                   | Agent-private backend             | Fast            |
| BFF                  | `bff/*`                            | Frontend ↔ backend bridge         | Medium          |
| Services             | `services/*/*`                     | Shared domain logic               | Slow            |
| Core                 | `packages/core/*`                  | Platform infrastructure           | Very slow       |
| Model Runtime Client | `packages/ai/model-runtime-client` | Shared Model Runtime capabilities | Medium          |
| Platform SDK         | `packages/platform/*`              | 3rd-party SDK wrappers            | Low             |
| Design System        | `packages/design/*`                | UI primitives                     | Slow            |
| Shared               | `packages/shared/*`                | Utilities and types               | Very slow       |

---

# 4. Two Product Surfaces

## Platform Surface (`portals/`)

Stable operational applications serving **platform operators and tenant admins**.

```
portals/website    Public marketing site
portals/admin      Platform operations — manage tenants, billing, config
portals/console    Tenant console — manage users, subscriptions, settings
```

- Governed by the platform team
- Slow iteration cadence
- Back-office tools, CRUD-oriented workflows
- Each portal backed by its own BFF

## Agent Studio Surface (`agent-studio/` + `agent-server/`)

Fast-moving AI-powered products serving **end customers**.

```
agent-studio/{agent}   Agent frontend (standalone or embedded in portal)
agent-server/{agent}   Agent backend (models, storage, workflows)
```

- Each agent governed independently by its own product team
- Fast iteration cadence
- AI-driven, conversational, generative in nature
- Frontend and backend kept separate, connected through dedicated BFF
- Agent backends promote proven logic to `services/` over time

---

# 5. BFF — The Central Bridge

The BFF (Backend For Frontend) layer is the **only communication path** between
frontend applications and backend services.

Every portal and every agent has exactly one dedicated BFF.

```
One portal / agent  →  One BFF  →  Multiple backends
```

What the BFF does:

- Validates authentication tokens and manages sessions
- Resolves and propagates tenant context
- Aggregates data from multiple sources (`agent-server/`, `services/`, `core-*`)
- Shapes responses for the specific needs of its frontend consumer
- Routes requests to domain-specific router modules internally

What the BFF does not do:

- Contain business logic (belongs in `services/` or `agent-server/`)
- Import UI or platform SDK packages
- Call AI models directly (belongs in `agent-server/`)
- Communicate with other BFFs

---

# 6. Agent Server Layer

The **Agent Server Layer** contains the private backend services
for individual AI agents.

Each agent may have its own server responsible for handling
agent-specific logic, model orchestration, data processing,
and integrations that are unique to that agent.

Agent servers live in the top-level `agent-server/` directory.

```
agent-server/
  varda/
  agent{N}/
```

Ruyin 已迁出到 `vxture/agentstudio-ruyin`，其前端、BFF、私有后端和 vx-worker-02 部署不再属于本仓实现范围。本仓只保留平台 SSO、auth-bff 和 Atlas（原 Model Platform，已迁至 `vxture-atlas` 仓）的对外契约说明。

Unlike platform services, agent servers are **not shared across
the entire platform**. They are designed to evolve quickly and
serve the needs of a specific agent product.

---

Agent servers are typically responsible for:

- AI model orchestration
- prompt pipelines
- RAG pipelines
- vector storage integration
- agent-specific workflows

They often depend on the shared **Model Runtime Client** and may call
platform services when needed.

---

The relationship between layers is typically:

```
Frontend
   │
   ▼
BFF
   │
   ├──► Services
   │
   └──► Agent Server
           │
           ▼
         Services
           │
           ▼
           Core
```

Agent-specific capabilities may eventually be promoted
into the **Service Layer** when they become reusable
across multiple agents or applications.

---

# 7. Service Layer

The **Service Layer** contains the platform's **shared domain capabilities**.

Services implement reusable business logic that can be consumed by
multiple applications across the platform, including BFFs, portals,
and agent backends.

While the **Core Layer** provides technical infrastructure
(configuration, tenant resolution, API primitives),
the **Service Layer** represents **business-level functionality**.

Examples include billing, subscriptions, support tickets, and
other domain services that are shared across the platform.

---

Services are organized by **business domain** and live in the
top-level `services/` directory.

```
services/
  commerce/
    billing
    subscription

  support/
    ticket
```

Each service is published internally using the naming convention:

```
@vxture/service-{name}
```

Examples:

```
@vxture/service-billing
@vxture/service-subscription
@vxture/service-ticket
```

---

The Service Layer sits **between application layers and platform infrastructure**.

Typical dependency flow:

```
Frontend
   │
   ▼
BFF
   │
   ▼
Services
   │
   ▼
Core
```

Services depend only on **Core** and **Shared** packages and must remain
independent from application-specific code.

---

# 8. Package Architecture

All shared code lives in `packages/` under a consistent two-level structure:

```
packages/{group}/{name}/   →   @vxture/{group}-{name}
```

| Group                  | Purpose                                         | Key packages                                                                                                     |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shared`               | Cross-cutting utilities and types               | `@vxture/shared`                                                                                                 |
| `core`                 | Platform infrastructure primitives              | `core-api`, `core-auth`, `core-tenant`, `core-locale`, `core-config`, `core-utils`, `core-mail`, `core-database` |
| `model-runtime-client` | Shared Model Runtime capabilities (server-side) | `@vxture/model-runtime-client` (llm, rag, embedding, workflow)                                                   |
| `platform`             | 3rd-party client SDK wrappers                   | `platform-amap`, `platform-cesium`, `platform-browser`                                                           |
| `design`               | UI design system                                | `@vxture/design-system`                                                                                          |

Dependency direction within packages is strict:

```
design-system  →  shared
platform-*     →  shared
core-*         →  shared
model-runtime-client → shared
```

---

# 9. Dependency Rules

完整依赖边界规则见 [`02-package-boundaries.md`](./02-package-boundaries.md)。

---

# 10. Agent Lifecycle

Agent-server 逻辑遵循"成熟后晋升"路径：`agent-server/{agent}/` → `services/{domain}/{name}/`，经 BFF 后供全平台使用。AI 能力成熟后作为模块加入 `@vxture/model-runtime-client`。

详见 [`04-service-layer.md`](./04-service-layer.md)。

---

# 11. Agent Deployment Modes

Agent frontends support two deployment modes without changing their codebase:

**Standalone** — deployed as an independent web application with its own URL and routing.
Suitable for agents marketed as separate products.

**Embedded** — loaded inside `portals/admin` or `portals/console` as a micro-frontend module,
sharing the portal's shell, auth session, and theme.
Suitable for agents that are integral features of a portal experience.

Current embedded example: `agent-studio/varda` is hosted by admin and console, calls
`bff/varda-bff` over HTTP/SSE, and reaches `agent-server/varda` only through that BFF.

---

# 12. Infrastructure Decisions

**Monorepo**: pnpm workspace. Unified dependency management, shared build tooling,
cross-package TypeScript path aliases.

**No API Gateway** at this stage. Nginx / CDN handles static assets and reverse proxy.
BFF handles per-consumer authentication and routing. Introduce an API Gateway
(Kong, APISIX) when centralized rate limiting, K8s traffic management,
or external API exposure is required.

**TypeScript**: Strict mode enforced across all packages. Two-level tsconfig inheritance
(`tsconfig.base.json` → per-package `tsconfig.json`).
Path aliases aligned with `packages/{group}/{name}/` structure.

**Type Imports/Exports**:

- Always use `import type` for type-only imports
- Always use `export type` for type-only exports in index files
- Never use `export *` for type-only files; explicitly list exports
- Value exports (functions, constants, classes) use regular `export`

---

# 13. Architecture Principles

**Separation of concerns** — each layer has one clear job. Business logic in services,
infrastructure in core, Model Runtime Client in packages/ai/model-runtime-client, UI in design-system.

**Dependency direction is law** — lower layers never depend on higher layers.
Violations break the architecture regardless of short-term convenience.

**BFF is the only door** — no frontend code reaches services or core directly.
The BFF is the enforced boundary between frontend and backend.

**Proven before shared** — agent-server logic is private until it proves reusable.
Premature promotion creates false stability guarantees.

**Agent independence** — each agent team owns its full stack. One agent's failure
must not affect other agents or the platform.

**Frontend/backend separation for agents** — `agent-studio/` and `agent-server/`
are kept apart by design. Different governance, deployment cadence, and dependency rules.

---

# 14. Document Map

| File                       | Contents                                |
| -------------------------- | --------------------------------------- |
| `00-overview.md`           | 本文档 — 平台架构总览                   |
| `01-monorepo.md`           | Monorepo 结构、工作区配置、各层目录规范 |
| `02-package-boundaries.md` | 各层依赖边界的权威参考                  |
| `03-core-layer.md`         | Core 层架构与职责                       |
| `04-service-layer.md`      | Service 层架构与晋升生命周期            |
| `05-bff-layer.md`          | BFF 层架构                              |
| `06-agent-server.md`       | Agent Server 层架构                     |
| `07-tech-stack.md`         | 技术栈选型与版本基线                    |

包级实现约束见 `docs/40-implementation/packages/`，其中 Design System 说明见 [`docs/40-implementation/packages/design/design-system.md`](../../40-implementation/packages/design/10-design-system.md)。编码和 TypeScript 规范见 `docs/40-implementation/ai/`，能力域设计见 `docs/30-design/`，工程合规审计见 `docs/60-operations/audit/`。

---

## Appendix: Portal Internal Architecture Notes

portals/website v2.0 架构要点（Content Registry、路由分组、Middleware 策略）见 [`docs/40-implementation/packages/portals/website.md`](../../40-implementation/packages/portals/30-website.md)。

---

End of document.
