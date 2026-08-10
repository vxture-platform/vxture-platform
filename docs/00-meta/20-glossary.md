# Glossary

> Authoritative definitions of core platform concepts, arranged alphabetically.
> Consult this file when you encounter unfamiliar terminology; do not guess from context.

---

## A

**ADR (Architecture Decision Record)**
Architecture Decision Record. Documents the background, options, outcomes, and consequences of major technical decisions. Once Accepted, it is not modified; it can only be superseded by a new ADR. See `docs/30-design/decisions/`.

**Atlas**
Final product name (2026-07-06, `docs/30-design/product_100_matrix.md` v1.0) of the L1 model platform. Sole host for all models (LLMs and specialized small models), sole LLM egress, and the single metering authority (all inference volume flows through Atlas → consume). Runs as an external service (`vxture-atlas` repo); this repo reaches it via `ATLAS_API_URL` (BFF route `/api/atlas/*`, env var and route renamed from the old `model-platform` naming 2026-07-29 — see the retired **model-platform** entry below). Disambiguation: not the schema migration tool `ariga/atlas` referenced in `data_platform_320`.

**agent-server**
Private backend for an Agent. Runs the Tool Use Loop, invokes the LLM through Atlas, and persists sessions and messages. Each Agent instance has its own agent-server; cross-instance imports are prohibited.

**agent-studio**
Agent frontend (`agent-studio/*`). A Next.js application that renders the conversation UI. Different Agents use different deployment modes:

| Agent | Deployment Mode                       | Usage                                                                                                       |
| ----- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Varda | Embedded (iframe / module federation) | Embedded in console / admin as an assistant (sidebar, floating bar, full-screen)                            |
| Ruyin | Standalone deployment                 | Independent domain, super-agent; migration and vx-worker-02 deployment belong to `vxture/agentstudio-ruyin` |

**auth-bff**
The platform's sole JWT issuer (`@vxture/bff-auth`). Platform BFFs log in directly here and issue tokens; Business BFFs read the existing Cookie and redirect to console login when unauthorized. Other BFFs that need to issue tokens must delegate through `POST /auth/internal/sign`. See ADR-001.

---

## B

**BCP47**
IETF language tag standard (RFC 5646). This platform uses two tags: `zh-CN` (Simplified Chinese) and `en-US` (American English). They are used throughout URL route segments, the `<html lang>` attribute, `Intl.*` APIs, and translation file directories. See ADR-002.

**BFF (Backend For Frontend)**
Backend services tailored for specific frontends (`bff/*`). Classified by authentication mode into three categories: Platform BFF (with its own login page), Business BFF (reuses console Cookie), and functional BFF (auth / gateway). BFFs do not call LLMs directly; they must go through Atlas.

**business/**
Historical/candidate directory for scenario-specific business applications. After P7b, this repository no longer keeps the local Ruyin implementation; Ruyin has been migrated and deployed to vx-worker-02 by `vxture/agentstudio-ruyin`. Future vertical scenario applications should go into the corresponding external business repository.

---

## C

**CallerContext**
A strongly typed security context assembled by the BFF layer, encapsulating "who is making this request and what they are allowed to do," then passed to agent-server as trusted input. It is built from JWT claims + request headers and is **re-validated** in agent-server.

```typescript
interface CallerContext {
  surface: string; // Host portal context
  userId: string; // Authenticated user
  tenantId?: string; // Tenant-user specific
  allowedTools: string[]; // Whitelisted tools
  dataScope: "global" | "tenant"; // Data access boundary
}
```

Currently implemented in varda-bff → varda-server, and it is the common pattern for all Business BFFs. Do not override CallerContext with any field from the request body.

**core layer**
Infrastructure primitive layer (`packages/core/*`). Framework-agnostic (no NestJS, no Next.js), contains no business logic, and does not reference any upper-layer dependencies. Compatible with both Node.js and browsers (exception: `core-database` is server-side only).

---

## D

**dataScope**
The data access scope in CallerContext. `global`: operators can access all tenant data; `tenant`: tenant users can only access data belonging to their own tenant. agent-server tools must filter by this value during execution and must not bypass it.

**design-system**
UI component library and design tokens (`@vxture/design-system`). Applications must not bypass DS to create their own styles, components, or icons. Violations go through the audit process in `audit/checklist-ds.md`.

---

## G

**gateway-bff**
Browser-side API gateway (`@vxture/bff-gateway`, port 8000). Routes frontend requests to the corresponding dedicated BFF by path prefix. Zero business logic, zero authentication, zero aggregation.

---

## J

**jti (JWT ID)**
Unique JWT identifier (claim: `jti`). auth-bff generates it using `crypto.randomUUID()`. On logout, jti is written to the Redis blacklist (TTL = remaining access token lifetime) to implement stateful token revocation.

---

## M

**monorepo**
Single-repository, multi-package architecture. This project uses pnpm workspaces + Turborepo, with 35+ packages coexisting and locally linked via the `workspace:*` protocol, so packages can be referenced without publishing releases. See ADR-003.

---

## O

**operator**
Operator-side user type (JWT claim: `userType: "operator"`). Corresponds to `y.vxture.com`, with `dataScope: global`, and can access all tenant data. Roles are system-configured (not hardcoded); several standard roles are preconfigured. See the admin package permission design for details.

---

## P

**product matrix (L0–L3)**
The platform's layered product structure, finalized 2026-07-06 (`docs/30-design/product_100_matrix.md` v1.0, names are final; doc family `product_{NNN}`, routing in its header): **L0** = the vxture platform itself (org/workspace/entitlement/metering/tool-protocol/sandbox; not a product, no product code); **L1** horizontal capability platforms = Atlas (models), Ontos (semantics), Runos (skills); **L2** object-domain platforms = Arda (structured data), Karda (unstructured knowledge), Terra (spatiotemporal/physical world); **L3** industry agents = Raven, Anlan, Forge, Xuanzhen. Outside the layers: Ruyin (client/desktop product, redefined), umbra (edge VPN at ruyin.ai, external), Hermes (internal). Sharing/isolation semantics: `docs/30-design/product_110_sharing-isolation.md` v1.0.

**platform-browser**
`@vxture/platform-browser`. Browser-side wrapper for third-party SDKs; currently the only implemented Platform SDK.

**PLG (Product-Led Growth)**
Product-led growth. The first social login automatically creates a Personal Tenant and grants Free Plan, enabling frictionless product entry without sales involvement. See ADR-005.

**portal**
Platform management UI (`portals/*`), including: `website` (official site), `admin` (operations console), and `console` (tenant console). Slow iteration pace, stable design.

**Prisma**
ORM tool. DDL is centralized in `@vxture/core-database` (currently 6 schema files, ⚠️ pending major refactor). `PrismaClient` instances are only used in service-layer repositories; direct database operations in BFFs or higher layers are prohibited.

---

## R

**RBAC (Role-Based Access Control)**
Role-based access control covering all platform permission management logic. Two completely isolated permission domains:

| Domain          | Corresponding Product      | Preconfigured Roles (configurable)                       |
| --------------- | -------------------------- | -------------------------------------------------------- |
| operator domain | admin (operations console) | Several standard roles, system-configured, not hardcoded |
| tenant domain   | console (tenant console)   | 3 categories: owner / admin / member                     |

See `docs/30-design/identity-platform-authorization.md`.

**refresh token**
Long-lived credential used to renew access tokens (default 7 days). Stored in Redis and deleted immediately on logout. Operators and tenants have separate Redis key prefixes (`refresh:operator:{userId}` vs `refresh:tenant:{surface}:{userId}`).

**ruyin**
Redefined 2026-07-06 (ADR-12): **Ruyin now names a client-side (desktop) product** (product definition pending; not in the workspace×product entitlement engine; interoperates only at the Atlas/Runos layer). The product previously called "ruyin" — the external integration at domain `ruyin.ai`, maintained in `vxture/agentstudio-ruyin` (worker-04 stack) — is now named **umbra** (see entry). The domain `ruyin.ai` and the existing OIDC RP contract (`docs/30-design/identity-platform-ruyin-contract.md`) are unchanged and remain valid for umbra.

---

## S

**service layer**
Domain business logic layer (`services/*/*`), grouped by domain: `ai`, `identity`, `notification`, `commerce`, `support`. NestJS modules, with Prisma in the repository sublayer. Direct cross-service imports are prohibited; cross-service calls must go through HTTP.

**shared layer**
Pure utility layer (`@vxture/shared`). Pure TypeScript, with no framework or Node.js/browser API dependencies, shared across the platform. Must not reference any internal packages.

**SharingGrant**
Org-internal sharing authorization object (`docs/30-design/product_110_sharing-isolation.md` v1.0 §8, ADR-12): resource (dataset / knowledge base / skill, owned by org×ws×product) × grantee (workspace | product | org-all) × scope (parameterized per resource type: read / retrieve / apply / use) × status/expires. Default-deny; sharing never copies data; enforced at retrieval level at each asset-plane (L2) entry; combined evaluation = grant ∧ entitlement. Policy SoT lives in the platform control plane `sharing` schema (design line `data_sharing_100/200`, pending). Cross-tenant supply uses entitlement (P-level assets), never grants.

**SSE (Server-Sent Events)**
Browser one-way push protocol based on long-lived HTTP connections. Agent streaming responses are implemented via SSE: `agent-server → BFF → browser`. The frontend consumes it with `EventSource` or `fetch streaming`.

**surface**
Context identifier for the Agent host portal, passed via HTTP Header `X-{Agent}-Surface`, and used together with JWT `userType` to determine `dataScope` and `allowedTools`.

Current values:

| Value     | Meaning                                   | Corresponding User Type |
| --------- | ----------------------------------------- | ----------------------- |
| `admin`   | Operations management side (admin portal) | operator                |
| `console` | Tenant control side (console portal)      | tenant_user             |

> ⚠️ Planned: surface will be split into two layers. The `admin` domain will be split into an operations management subdomain + a platform self-governance subdomain; the `console` domain will be split into a management subdomain + an application subdomain. The naming scheme (whether `admin` will be renamed to `ops`, etc.) will be determined in the next version design.

---

## T

**Tailscale**
Zero-configuration VPN mesh. The `vxture` repository currently only maintains the GitHub Actions deployment channel to VXTURE_DEPLOY_HOST, as well as the external contracts for platform auth-bff / SSO / Atlas against. Business worker internal network calls are maintained by external business repositories.

**tenant**
Data boundary for multi-tenant isolation. Each tenant_user belongs to at least one tenant and may belong to multiple tenants. Current authoritative model is the four-layer structure **User → Tenant (personal/organization) → Workspace → two-level Membership** (`data_platform_100_architecture.md` §3.4; ADR-11): the tenant/org is the **absolute isolation boundary and billing/settlement subject**; the **workspace** is the subscription/entitlement/isolation subject. Plan tiers are per-product 5 levels (free → starter → pro → business → enterprise, ADR-11); the older Free/Pro/Enterprise 3-tier table is obsolete.

**tenant_user**
Tenant-side user type (JWT claim: `userType: "tenant_user"`). Corresponds to `console.vxture.com` and Agent products, with `dataScope: tenant`, and can only access data belonging to their own tenant.

**Tool Use Loop**
AI Agent reasoning loop: LLM decides to call a tool → tool executes → result returns to LLM → continue or terminate. Implemented in agent-server. All LLM calls **must go through Atlas** (unified billing, quota, and authorization control); directly importing provider SDKs (Anthropic / Doubao, etc.) is prohibited, otherwise control is bypassed and metering/auditing become impossible.

**ToolRegistry**
Agent tool whitelist registry (`agent-server/*/tools/tool-registry.ts`). Tools must be whitelist-validated before execution; `allowedTools` comes from CallerContext, not accepted from the frontend.

---

## U

**umbra**
Edge VPN product at domain `ruyin.ai` (external repository, worker-04 stack; read-only write boundary for this repo). It is the actual counterparty of the OIDC RP contract formerly labeled "ruyin" (`identity-platform-ruyin-contract.md`, still valid; **client_id switched to `umbra` on 2026-07-07** — one-shot rename per `docs/30-design/product_300_naming-migration.md` §2 v1.1, executed and verified; the freed `ruyin` client_id now belongs to the client-side product's web RP at `ruyin.vxture.com`). Keeps its current tenant-level subscription mode; exempt from the workspace×product entitlement engine and excluded from the sharing/isolation model (ADR-12 D7).

---

## V

**varda**
Embedded intelligent assistant (`agent-studio/varda`, @vxture/agent-studio-varda). Embedded micro-frontend loaded into admin and console, providing conversation UI + Tool Use feedback display (sidebar / floating bar / full-screen). Three ends: `agent-studio/varda` + `agent-server/varda` + `bff/varda-bff`. Future migration target is `vxture/agentstudio-varda`, but planning must wait until Ruyin in `vxture/agentstudio-ruyin` completes business workflow templates.

---

## W

**workspace**
Isolation and commerce subject under a tenant/org (four-layer model: User → Tenant → **Workspace** → two-level Membership). Holds subscriptions, entitlements, quota pools, and bills (cost center; the org is the billing account) — ADR-11. `workspace_id` is the authoritative business-plane isolation key: every product's agent-db isolates data by it (issued by the platform entitlement system, never self-declared by products). Also the org-internal sharing unit for SharingGrant. Note: legacy code paths and `CallerContext` still carry only `tenantId`; workspace propagation is part of the integration target state (`docs/30-design/product_200_integration.md`).

---

## @

**@layer**
Annotation in a code file header declaring its architectural layer (e.g., `@layer Application`). It is a required file header field (see `docs/40-implementation/ai/03-coding-comments.md`), and is also the basis for AI agents to judge file responsibility boundaries.

---

## AI Infrastructure

**model-platform** (retired naming — see **Atlas**)
Unified AI model access layer. Final product name: **Atlas** (see entry). The implementation (`@vxture/service-model-platform`) was extracted into the standalone `vxture-atlas` repo (2026-07-24 split, service retired from this repo 2026-07-28). The naming itself lingered a bit longer in this repo's own plumbing — env var `MODEL_PLATFORM_URL`, BFF route `/api/model-platform/*`, frontend route/page — and was fully renamed to `ATLAS_API_URL` / `/api/atlas/*` on 2026-07-29 (kept causing "is there still a repo-local model-platform service" confusion otherwise). It is the sole entry point for all LLM calls and is responsible for: model routing, billing metering, quota control, and Provider abstraction. agent-server / business services call it through controlled HTTP/API, and must not bypass it to connect directly to providers. Business workers must not hold platform Provider Keys.
