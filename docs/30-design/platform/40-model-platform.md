# Vxture Model Platform - Architecture And Current Model Platform Implementation

**Version**: 1.3.0
**Updated**: 2026-06-07
**Scope**: Unified model access, model control plane, model runtime, technical authorization, quota check, usage metering, and provider cost tracking.

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md](../data_platform_100_architecture.md)（架构/§3.4）+ [data_platform_200_schema.md](../data_platform_200_schema.md)（字段级权威，全表 DDL/列/索引/触发器/Prisma §4–§15）；落地见 [data_platform_300_migration.md](../data_platform_300_migration.md)。本文不重述平台 DDL，只述本板块（Model Platform）内容。

---

## 1. Positioning

Model Platform is Vxture's platform-level model capability domain. It solves two related but different problems: Vxture needs to centrally manage which models can be used, and runtime callers need one stable interface for upstream or self-hosted models.

The current implementation is still named `@vxture/service-model-platform` and deployed as `vx-model-platform`. That name is retained for compatibility. Architecturally, it is an early combined implementation of Model Platform, not the final domain name.

> 📌 **终态产品名 = Atlas**（2026-07-06 定名，[`product_100_matrix.md`](../product_100_matrix.md) v1.0，L1 模型平台）：统一模型接入/路由/配额/用量治理，大模型与**专用小模型**唯一宿主、唯一 LLM 出口与计量口径（[`product_110_sharing-isolation.md`](../product_110_sharing-isolation.md) v1.0 §6.6/§13）。注意与 schema 迁移工具 `ariga/atlas`（`data_platform_320` 引用）同名不同物。
>
> **2026-07-24 更新：Atlas 已拆分为独立仓 `vxture-atlas`**（历史随 `git filter-repo` 迁移，`services/model/platform` 在本仓的定位改为待退役）。本仓与 Atlas 的对接关系（platform 运营台/varda/karda 及同构 L2/L3 agent 各自怎么接 Atlas）见 [`41-atlas-integration-topology.md`](./41-atlas-integration-topology.md)；Atlas 自身的 S2S 供给面契约（embedding/parse/rerank/generation）正本在 `vxture-atlas` 仓 `docs/30-design/200-s2s-provider-surface.md`，不在本仓维护。
>
> **2026-07-27 更新：真实 provider 注册表规划（命名规范/域内优先/境外 registered-closed/出境路径）见 [`42-model-provider-registry-plan.md`](./42-model-provider-registry-plan.md)**，落地在本文 §10 引用的 `deploy/database/seed/seed-catalog.mjs`。

Target naming:

```text
model-platform
  ├── model-control-plane   # 配置、授权、策略、配额、价格
  └── model-runtime         # 调用、路由、Provider adapter、计量
      └── model-router      # runtime 内部的模型选择模块
```

Important boundary:

- `model-platform` is the capability domain.
- `model-control-plane` manages provider/model registry, authorization, policy, quota rule references, pricing, and future key management.
- `model-runtime` executes calls, enforces technical gates, selects providers/models, adapts provider protocols, and writes usage facts.
- `model-router` is only an internal module inside `model-runtime`; it is not the whole service and should not be used as the umbrella service name.

Long-term capability boards:

```text
model-platform
  ├── model-control-plane      # 配置、授权、策略、价格、Key 引用
  ├── model-runtime            # 调用、路由、Provider adapter、fallback
  ├── model-observability      # trace、指标、健康度、告警、Dashboard
  ├── model-metering-billing   # token 计量、成本计算、预算消耗、账单对接
  └── model-governance         # 安全、审计、合规、数据保留、内容策略
```

The first two boards are execution-critical. The last three boards should be planned from day one, but they do not need independent services until volume, audit requirements, or operational complexity justify the split.

The customer does not buy "Doubao tokens" or "Claude SDKs" directly from Vxture. The customer buys Vxture product plans, quotas, private-model access, and business agents. Vxture then pays upstream model providers according to provider contracts and tracks those costs internally.

The system is therefore split into three layers:

| Layer             | Owner                                        | Main Question                                                   | Data Location          |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------- | ---------------------- |
| Upstream provider | Doubao, Claude, private/self-hosted endpoint | Which model endpoint does Vxture call and what does Vxture pay? | `model` + target `key` |
| Vxture platform   | Vxture                                       | Which models are connected, routed, authorized, and costed?     | `model` + `product`    |
| Customer tenant   | Vxture customer                              | Which plan, quota, application, and fee does the customer see?  | `commerce` + `product` |

No business-domain data is stored in Model Runtime. Business records stay in their own domains. Runtime metering only writes technical usage facts such as tenant, application, feature, model code, token counts, latency, request id, and business id.

### 1.1 Tenant And Application Management Dimensions

Model governance must be managed from two dimensions:

| Dimension         | Meaning                                                                                          | Current State                                            | Target State                                               |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| Tenant            | Customer-level commercial, authorization, and quota boundary.                                    | `tenant_id` is required in grants, quota, metering       | Tenant policy remains the upper bound for all model usage. |
| Application       | Tenant-owned consuming app, business agent, workflow, API client, or internal service.           | `agent_id` exists only as a legacy agent-specific input. | Use `application_id` + `application_type`.                 |
| Request / Session | One model call or conversation session assembled by the business side before runtime invocation. | Runtime is stateless and stores no prompt content.       | Runtime remains stateless; request metadata drives audit.  |

Rules:

- Tenant grant, policy, and quota are the upper bound.
- Application grant and policy can narrow tenant access but cannot expand beyond tenant limits.
- Usage must be attributable to both tenant and application when the caller provides the application scope.
- `application_type` values are `agent`, `workflow`, `api_client`, and `internal_service`.
- Legacy `agent_id` maps to `application_id` with `application_type = agent` during migration.

### 1.2 Capability Coverage

| Area                      | Target Owner           | Current Coverage                                                                                                  | Gap / Next Step                                                        |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Provider registry         | model-control-plane    | Designed in Platform DB `model.provider`; current runtime reads platform model data.                              | Move provider credentials to target `key` schema.                      |
| Model registry            | model-control-plane    | Designed in Platform DB `model.model`.                                                                            | Keep platform-facing model definition separate from runtime key.       |
| Tenant model grant        | model-control-plane    | Designed in `model.model_grant` and implemented in current Model Platform flow.                                   | Keep as tenant upper bound.                                            |
| Application grant         | model-control-plane    | `model.model_grant` supports `application_id` + `application_type`; legacy `agent_id` maps to agent applications. | Add application-level policy table after runtime contract stabilizes.  |
| Policy and routing config | model-control-plane    | Tenant-level `model.model_policy` is designed.                                                                    | Application-level policy is pending.                                   |
| Pricing / provider cost   | model-control-plane    | Designed in `model.model_price_rule`; commerce owns customer-facing fee.                                          | Add real provider contract values before production billing.           |
| Runtime execution         | model-runtime          | Implemented by current `services/model/platform` with structured runtime errors and request id propagation.       | Rename or split only after boundaries stabilize.                       |
| Model routing             | model-runtime/router   | Implemented as current `src/router`; provider resolution is isolated from runtime orchestration.                  | Keep as internal module, not domain name.                              |
| Provider adapter          | model-runtime/provider | Implemented as current `src/providers`; fallback can be configured by model `config.fallbackModelCodes`.          | Add retry policy and provider health scoring after observability work. |
| Metering                  | model-runtime          | Writes successful usage facts to `commerce.tenant_usage_event` and summary rows.                                  | Usage aggregation job and dashboards remain pending.                   |
| Quota check               | commerce + runtime     | Runtime checks commerce quota before calling provider.                                                            | Keep commerce as source of commercial quota truth.                     |
| Observability             | model-observability    | Basic runtime logs only.                                                                                          | Add trace, metrics, health, alert, and queryable dashboards.           |
| Metering / billing bridge | model-metering-billing | Current usage event is basic and commerce-facing.                                                                 | Add provider cost, budget, overage, and billing export contract.       |
| Governance                | model-governance       | Not implemented.                                                                                                  | Add retention, redaction, safety, audit, and compliance policies.      |

---

## 2. 隔离模型

平台使用统一的 Provider API Key，但必须保证不同租户、不同应用、不同会话的内容完全隔离，互不可见。

### 隔离维度

| 维度                    | 隔离由谁保证  | 机制                                                                                                                                                |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **租户（Tenant）**      | model-runtime | `model_grant` 鉴权：每次调用必须通过租户级技术授权 + `tenant_subscription_quota` 配额校验；计量数据以 `tenant_id` 为主键独立写入                    |
| **应用（Application）** | 调用方服务    | `application_id + application_type` 标识调用来源；Agent 是 `application_type = agent` 的一种应用类型，workflow / api_client / internal_service 同理 |
| **会话（Session）**     | agent-server  | 每个 session 的对话历史独立存储于数据库；发起 LLM 调用时由 agent-server 从当前 session 组装 messages 数组，Gateway 本身无状态，不持有任何对话历史   |

### API Key 隔离机制

```
tenant / application
    │  只知道 modelCode，不接触 API Key
    ▼
model-runtime（current: services/model/platform）
    │  当前从运行环境读取 API Key；目标态从专属 key schema 读取加密 Key
    │  Key 不入库，不暴露给 agent-server
    ▼
Provider（Doubao / Claude / 私有模型）
```

同一个 API Key 对应多个租户的请求，隔离由以下保证：

- LLM API 是**无状态 HTTP 接口**：每次请求携带完整 messages，Provider 不在调用间保留任何上下文
- messages 数组由 agent-server 组装，只包含当前 session 的历史，天然隔离其他 session
- 计费和配额在 model-runtime 层按 `tenant_id + application_id + application_type` 独立统计，串不到其他租户

---

## 3. Runtime Flow

```text
business agent / app
  -> @vxture/model-runtime-client
  -> services/model/platform (current Model Platform combined implementation)
     -> model-control-plane registry / grant / policy
     -> commerce quota check
     -> model-runtime model-router
     -> model-runtime provider adapter
     -> commerce usage event + usage summary
  -> upstream provider or self-hosted model
```

The agent only needs the SDK request contract. It should not know provider API keys, provider billing rules, or routing details.

---

## 4. Package Layout

```text
packages/ai/model-runtime-client
  src/llm/client.ts
  src/llm/types.ts

services/model/platform
  prisma/schema.prisma
  prisma/migrations/20260425_model_platform_control_plane/migration.sql
  prisma/seeds/20260425_initial_platform_seed.sql
  scripts/db-seed.mjs
  src/runtime
  src/metering
  src/providers
  src/quota
  src/registry
  src/router
  src/types
```

Platform operations management is exposed through:

```text
bff/admin-bff/src/routers/model-platform.router.ts
portals/admin/src/modules/ai/ModelPlatformPage.tsx
```

Tenant operations visibility is exposed through:

```text
bff/console-bff/src/routers/model-platform.router.ts
portals/console/src/app/[locale]/(console)/model-platform/page.tsx
```

Admin and Console share the same Model Platform capability domain, but they do not share the same authority:

| Surface | Role              | Allowed Scope                                                                                                       |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Admin   | Platform operator | Provider/model registry, tenant grant, policy, provider-cost metadata, platform diagnostics.                        |
| Console | Tenant operator   | Tenant-visible models, tenant grant state, quota state, usage summary, application-level preferences where granted. |

Admin BFF and Console BFF must remain separate entrypoints. Console must never proxy platform-wide provider, credential, or cross-tenant mutation APIs.

---

## 5. Database Split

Model Platform spans three Platform DB schemas; **字段级权威见 schema-b §model / §product / §commerce，架构概览见 a §3.4**。本文只述各 schema 在 Model Platform 中的角色：

- **`model`**（control plane，非机密模型配置）：provider 注册、model 注册、`model_grant`（技术授权白名单/灰度）、`model_price_rule`（Vxture 对上游的成本费率）、`model_policy`（租户级运行策略）。
- **`product`**（Vxture 售卖/暴露的能力）：feature、agent、plan、plan_price、plan_feature、plan_agent。
- **`commerce`**（客户订阅/配额/用量/账单）：`tenant_subscription`、`tenant_subscription_quota`（有效配额/allowed_models/私有模型开关）、`tenant_usage_event`（成功调用的 append-only 用量事件）、`tenant_usage_summary`（配额校验与看板的聚合缓存）。

Model Platform 特有边界：

- API keys 不以明文入 Platform DB。当前部署从 runtime env 读取 provider key；目标态存入 Model Platform / Model Runtime 专属 `key` schema 的加密 key。
- Customer quota 不存于 `model_grant`；customer billing 不存于 `model`；失败的 runtime 调用不写为 customer usage event。
- Current quota check reads `tenant_usage_summary` summary rows for the current cycle. Metering writes both detailed and tenant-level summary rows after successful model calls.

---

## 6. Cost And Fee Model

There are two different prices and they must not be mixed:

| Topic         | Meaning                                                                                        | Stored In                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Provider cost | What Vxture pays to Doubao, Claude, or another provider.                                       | `model.model_price_rule`                                                     |
| Customer fee  | What the customer pays Vxture for plans, quotas, private model access, and agent applications. | `product.plan_price`, `product.plan_feature`, `commerce.tenant_subscription` |

Customer-visible fees are expected to include:

- Base plan fee: monthly/yearly SaaS subscription.
- Included model quota: token quota included in the plan.
- Overage or expansion fee: later priced through commerce rules or custom contract.
- Private/self-hosted model access: implementation, hosting, maintenance, or private deployment service fee.
- Business agent fee: included agents, add-on agents, or industry solution packages.
- Optional service fee: industry implementation, data governance, integration, and support.

The phase-1 seed only provides initial product and provider cost records. Contract-specific prices should replace seed values before production.

---

## 7. Request Contract

`@vxture/model-runtime-client` sends a normalized request to the current Model Platform endpoint. Architecturally, this is the Model Runtime request contract:

```ts
export interface ChatRequest {
  modelCode: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tenantId: string;
  applicationId?: string;
  applicationType?: "agent" | "workflow" | "api_client" | "internal_service";
  agentId?: string; // deprecated compatibility alias
  userId?: string;
  featureId?: string;
  requestId?: string;
  businessId?: string;
  usageType?: "normal" | "retry" | "test";
}
```

`requestId` is used for idempotent usage-event protection when provided. `businessId` is retained for business-side traceability and duplicate analysis.

Contract rules:

- New callers should provide `applicationId + applicationType`.
- `agentId` is deprecated and only maps to `applicationId = agentId` with `applicationType = agent`.
- `applicationId` without `applicationType` is rejected by runtime validation.
- If no application scope is provided, runtime records the call as `internal_service` with the sentinel UUID.

---

## 8. Authorization And Quota

Runtime checks two independent gates:

1. Technical grant: `model.model_grant`
   - Is the model enabled for this tenant?
   - Is there a tenant-wide grant or an application-specific grant?
   - Is the grant active and not expired?

2. Business quota: `commerce.tenant_subscription_quota`
   - Is the quota effective for the tenant?
   - Is the requested model allowed by `allowed_models`?
   - If it is a private model, is `allow_custom_model` enabled?
   - Is the current cycle usage still under `period_tokens`?

This keeps platform routing control separate from what the customer purchased.

Control-plane writes must preserve that separation:

- `model.model_grant` controls technical allowlist and gray release.
- `model.model_policy` controls operational runtime policy such as rate, concurrency, routing preference, and future safety settings.
- `model.model_price_rule` controls Vxture upstream provider cost. It is not customer-facing price.
- `commerce.tenant_subscription_quota` controls customer commercial entitlement and quota consumption.
- Provider credentials are never returned by control-plane API responses.
- Console APIs may show whether a model is available to the tenant, but not the platform-wide provider key, upstream contract price, or other tenants' grants.

Runtime routing:

- The requested `modelCode` is the primary candidate.
- A model can define `config.fallbackModelCodes` as an ordered list of fallback model codes.
- Runtime only enters fallback when the provider path is unavailable or fails.
- Grant and quota checks are still executed before every candidate provider call.
- Usage is written only for the model candidate that successfully returns.

Structured runtime error codes:

| Code                           | Meaning                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `MODEL_NOT_ROUTABLE`           | Model is missing, inactive, unsupported, or not streamable. |
| `GRANT_DENIED`                 | Tenant/application has no active technical grant.           |
| `QUOTA_EXCEEDED`               | Tenant has no active quota or quota is exhausted.           |
| `PROVIDER_UNAVAILABLE`         | Provider API, provider key, or upstream endpoint failed.    |
| `MODEL_RUNTIME_REQUEST_FAILED` | Generic runtime failure fallback.                           |

---

## 9. Metering

Successful calls write:

- `commerce.tenant_usage_event`: one append-only usage record.
- `commerce.tenant_usage_summary`: detail row and tenant summary row for the current month.

The usage event captures tenant + application attribution, feature/user, token quota (used/input/output), request/business ids, usage type, cycle date/month, model code, and latency. **完整字段级定义见 schema-b §commerce（`tenant_usage_event`）。**

Model Runtime does not persist prompt content or response content in these commerce usage tables.

Both usage tables carry `application_id` and `application_type`. The legacy `agent_id` column remains for compatibility with existing product-agent reports, but the target attribution key is `tenant_id + application_id + application_type`.

---

## 10. Seed（统一权威源）

> Model Platform 的初始数据（providers / models / price rules / grants）已**并入平台统一 seed**，
> 不再由服务侧单独维护。原 `services/model/platform/prisma/seeds/*` 与服务 `prisma/migrations/*`
> 已退役（命名脱节、与生产 schema 不兼容）；DB 结构由部署 baseline 拥有，服务仅保留
> `prisma/schema.prisma` 供 client 生成。

统一 seed 文件与运行：

```text
deploy/database/prisma/seed.mjs
```

```bash
# 首次部署链路自动调用（24-first-deploy → 23-seed-platform-database.sh）
CONFIRM_SEED=yes bash deploy/scripts/23-seed-platform-database.sh
```

统一 seed 初始化（幂等）：

- `model`：providers（doubao / anthropic / openai）+ 3 个 active 模型 + price rules + 对示例租户的 grants（使 readiness 的 `modelRegistry` 通过）。
- `product`：free 套餐 + features + plan_feature + plan_price。
- `iam`：租户域 RBAC（owner/admin/member）+ 权限目录 + role_permission + member_role_binding + capability/plan_capability。
- `ops` / `identity` / `tenant`：平台管理员 + 示例 zhangsan 账号/租户。
- `commerce`：示例订阅（free）+ 配额快照。

---

## 11. Evolution Plan

Model Platform should evolve by capability maturity, not by premature service count.

### Stage 1 - Combined Implementation

Current service:

```text
@vxture/service-model-platform
```

Scope:

- Holds the current combined implementation.
- Allows control-plane, runtime, and basic metering to live in one service while the contracts are still moving.
- Must document target board ownership even when code is still combined.

Exit criteria:

- Model Platform target boards are documented.
- `application_id + application_type` replaces `agent_id` as the target application dimension.
- Provider/model/grant/policy/usage concepts have stable names.
- Runtime request contract is stable enough for callers.

### Stage 2 - Control Plane / Runtime Boundary

Target services:

```text
@vxture/service-model-control-plane
@vxture/service-model-runtime
```

Scope:

- `model-control-plane` owns provider registry, model catalog, grants, policies, price rules, and credential references.
- `model-runtime` owns runtime API, model-router, provider adapters, quota/budget precheck, fallback, streaming, and usage event emission.
- Runtime should consume control-plane data through internal API, versioned config snapshot, or cache contract. It should not own model configuration writes.

Exit criteria:

- Control-plane write API and runtime read contract are defined.
- Runtime no longer directly owns model registry mutation.
- Application-scoped grant and policy contract is implemented.
- Provider credential storage is moved out of plain runtime env or has a documented migration path.
- Basic usage event schema supports tenant + application attribution.

### Stage 2A - Control Plane MVP In Current Combined Service

Current implementation step before splitting services:

```text
services/model/platform
  src/runtime/model-admin.controller.ts
  src/runtime/model-admin.service.ts
```

Scope:

- Keep the combined `@vxture/service-model-platform` deployment.
- Harden platform-level provider/model/grant/policy/price management APIs.
- Keep admin APIs under `/model-platform/admin`.
- Keep Admin BFF public routes under `/api/model-platform`.
- Keep Console BFF public routes under `/api/model-platform`, but restrict them to tenant-scoped read / allowed tenant operations.
- Make application-level grant and policy visible in contracts before portal-heavy work.
- Do not introduce plaintext provider key persistence.

Implementation order:

1. Audit current service admin endpoints and close missing provider/model/grant/policy/price gaps.
2. Stabilize DTOs and structured error responses in Model Platform service.
3. Harden Admin BFF permission checks and request forwarding.
4. Harden Console BFF tenant scoping and permission checks.
5. Update Admin portal only after API contract stabilizes.
6. Update Console portal last, focused on tenant-visible models, quota, and usage.

Exit criteria:

- Admin can manage platform model metadata and tenant/application grants without direct database edits.
- Console can view tenant-visible model availability, grant state, quota state, and usage summary without platform-wide authority.
- Provider credential values are not returned to portals, BFF logs, browser bundles, or test snapshots.
- Runtime read path remains compatible with the P2 runtime contract.

### Stage 3 - Observability Board

Target service or board:

```text
@vxture/service-model-observability
```

Scope:

- Runtime trace collection.
- Provider/model health.
- Latency, error, token, cost, fallback, and quota metrics.
- Tenant/application/model/provider dashboards.
- Alert rules for budget risk, provider failure, abnormal traffic, and quota pressure.

Entry criteria:

- Stage 2 boundary is stable.
- Runtime emits structured events with request id, tenant id, application id, model code, provider code, status, latency, token usage, and error class.
- Metrics are useful enough to aggregate without scraping runtime internals.
- There is a clear dashboard and alert owner.

Current decision:

> Enter Stage 3 as P4 planning and combined-service implementation only. Do not split `@vxture/service-model-observability` yet.  
> P4 已在当前合并服务内完成健康链路、结构化日志、部署告警边界的基础实现，下一步进入 P5 生产级观测（指标体系、告警规则与接入面）增强。

P4 target baseline:

```text
model-platform-v0.5-prod-baseline
```

P4 must answer four operational questions:

| Question                     | Required Answer                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Is the process alive?        | Liveness endpoint responds without checking downstream dependencies.                                               |
| Is runtime ready?            | Readiness endpoint verifies DB connectivity, model registry, provider key references, quota read, and usage write. |
| Can operators diagnose load? | Structured logs carry request, tenant, application, model, provider, status, latency, fallback, and error fields.  |
| Can deployment block safely? | Deploy scripts can fail on missing config, missing container, failed health, or missing provider key references.   |

P4 does not store prompt or response content in observability output. Logs and health responses must not expose provider key values, runtime secret values, or customer prompt payloads.

### P5 - Production observability hardening

P5 is the next production-hardening wave and continues inside the same package boundary:

- Replace the lightweight metrics scaffold with a standard Prometheus instrumentation layer (`prom-client`) compatible with external scrape.
- Define a stable metric family and label policy:
  - request_total
  - request_errors_total（按 `error_code`）
  - request_duration_ms（直方图）
  - tokens_total（输入/输出/总量）
  - fallback_count（按 provider、模型）
  - quota_denied_total
  - usage_write_fail_total
- Expose `/metrics` with explicit internal access policy; no public exposure before Nginx/LB ACL is established.
- Define Service Level Objectives and alert thresholds (provider error rate、p95 latency、fallback rate、quota denied rate、usage write failure rate).
- Add a runbook for Prometheus scrape, retention, and dashboard usage.
- Keep `/metrics` values non-sensitive: 不包含 prompt、response、provider key、runtime secret、token 内容明文。

P5 Exit checks (minimum):

- `/metrics` output must be scrape-ready and aligned with the deployment data path and sampling policy.
- `model-platform` 在部署告警脚本中对高优先级观测缺失项返回阻断。
- Prometheus/Grafana 或替代告警系统配置了可执行验证项。
- `/metrics` 不通过公网匿名入口访问；内部链路有 ACL 限制。

P5 is still not a separate service split; it is production hardening implemented in `@vxture/service-model-platform` and `docs/50-deployment/11-model-platform-operations.md`.

### Stage 4 - Metering / Billing Board

Target service or board:

```text
@vxture/service-model-metering
```

Scope:

- Provider cost calculation.
- Token/request/image/audio usage normalization.
- Tenant and application usage summary.
- Budget consumption.
- Overage and commerce billing export.

Entry criteria:

- Usage event contract is stable.
- Provider price rule versioning is stable.
- Commerce billing integration needs model-specific cost detail beyond generic feature quota.

### Stage 5 - Governance Board

Target service or board:

```text
@vxture/service-model-governance
```

Scope:

- Prompt/response retention policy.
- PII redaction.
- Content safety policy.
- Tenant isolation policy.
- Enterprise audit and compliance settings.
- Private model and sensitive-data routing policy.

Entry criteria:

- Enterprise tenant requirements demand policy-level control.
- Audit, retention, or compliance requirements cannot be handled by runtime configuration alone.
- Governance policies need independent review, approval, or reporting workflows.

---

## 12. Implementation Status

Completed in phase 1:

- Current `@vxture/service-model-platform` runtime and migration.
- Gateway Prisma schema with platform `model` and `commerce` models.
- Model registry, routing, quota, metering, provider adapters, and HTTP controller.
- SDK gateway client.
- Admin BFF model-platform control-plane proxy.
- Console BFF tenant-scoped model-platform read proxy.
- Admin model-platform control-plane overview.
- Console tenant model-platform availability, grant, quota, and usage page.
- Initial seed data for provider/model/product/commerce control data.
- Runtime request contract accepts `application_id + application_type`, keeps legacy `agent_id` as an agent-only alias, and writes usage attribution on tenant + application dimensions.
- Runtime MVP adds structured errors, provider fallback by `config.fallbackModelCodes`, pre-provider grant/quota enforcement for every candidate, and usage writes only after successful provider responses.
- Control Plane MVP adds provider/model/grant/policy/price management APIs, application-scoped grant filters, structured control-plane errors, Admin BFF proxy, Console tenant boundary, and portal visibility.

Next recommended work:

- Keep `@vxture/service-model-platform` as the current package name until the split is worth the operational cost.
- Treat `model-router` as a runtime internal module, not the service name.
- Enter P4 Observability And Operations through documentation and health contract first.
- Implement liveness/readiness endpoints inside the current combined service before considering a separate observability service.
- Add structured runtime logs with request and application correlation fields.
- Extend deployment scripts to verify `.env.model-platform`, container presence, health endpoint, and high-severity runtime readiness failures.
- Add alert taxonomy for missing runtime env, provider key missing, quota write failure, upstream provider outage, and fallback pressure.
- Secret management for provider credentials instead of plain environment-only deployment.
- Real provider contract prices and currency conversion rules.
- Customer-facing billing rules for overage, add-on agents, private deployment, and implementation service.
- Streaming response support.
- Provider retry policy and provider health scoring.
- Usage dashboard and provider cost dashboard.
- Stage 4 / P5 production observability hardening for metrics, SLOs, and alert pipeline.

---

## 13. Consumer-Requested Call Types (Karda Contract Request, 2026-07-23)

Karda's liaison letter (`vxture-karda` `docs/80-liaison/70-2607232158-karda-atlas-contract-request.md`, 2026-07-23 21:58) asks Atlas for a formal contract covering four call types. Only generation is implemented today (§7 `ChatRequest`). The other three are registered here as target scope for future design, not yet built:

| #   | Call type                                                       | Current state                  | Target contract notes (from karda's request)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Embedding                                                       | Not implemented                | Batch vectorization for ingestion pipelines. Contract must expose an enumerable, pinnable model version identifier — callers lock a version per corpus/index, and a version change is a controlled rebuild, not a silent swap.                                                                                                                                                                                                                                                                             |
| A2  | Parsing small models (layout / OCR / table structure / formula) | Not implemented                | High-frequency, small-request, latency-sensitive — one document can trigger dozens to hundreds of calls. Needs (a) a batch endpoint accepting multiple pages/regions per request, and (b) deployment affinity (parsing endpoint colocated with the calling worker's domain), so throughput is bounded by the model rather than network round trips. If neither is feasible, that must be stated explicitly so callers can rebudget throughput and concurrency-tier design around per-call round-trip cost. |
| A3  | Rerank (cross-encoder)                                          | Not implemented                | v1 candidate pool cap 100. Caller's stated P95 budget for this hop is < 400ms — Atlas should flag early if that is unrealistic at 100 candidates so the caller can shrink pool size instead of discovering it in production.                                                                                                                                                                                                                                                                               |
| A4  | Generation                                                      | Implemented (§7 `ChatRequest`) | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Cross-cutting semantics any of A1-A3 must confirm or correct once designed (not decided yet):

- Credential posture for background/batch processing: service-mode call, tenant/workspace attribution = the asset-owning workspace, not the triggering caller, so processing cost lands on the asset owner.
- Metering stays single-sourced in Atlas; the caller only aggregates for its own dashboards, no double counting.
- Rate-limit vs quota-exhaustion must be distinguishable in the error response, so a caller can choose retry-with-backoff (rate limit) vs suspend-until-renewal (quota exhausted) instead of guessing from a bare `429`.

This section records requirement scope from a specific consumer. It is not a committed design — the actual contract (endpoint / auth / schema / error envelope / rate-limit semantics) is added here only once A1-A3 are designed and, per §11, likely lands after Atlas splits out of the combined `@vxture/service-model-platform` implementation.
