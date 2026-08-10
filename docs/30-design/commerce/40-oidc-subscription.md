# Vxture 全产品 OIDC × 订阅体系设计

> ⚠️ **SUPERSEDED · 标记删除（2026-07-06，ADR-12）——本文档已被取代，仅存档待删，不得作为实施依据。**
> 取代关系：产品清单/定位 → [`product_100_matrix.md`](../product_100_matrix.md) v1.0（本文 `arda`=平台 shell、`vault`/`cortex` 候选名等表述**作废**；`ruyin` 对接方现名 **umbra**，域名 ruyin.ai 不变，改名规划见 `product_300_naming-migration.md`）；接入通道/claim 解析 → [`product_200_integration.md`](../product_200_integration.md) v1.0（本文 tenant×app 粒度的 `TenantSubscription` resolver 与 workspace×product 权益引擎冲突，以 ADR-11 为准）。
> 删除前置：§五 UUID 分配表与 §六 Phase 实施清单如仍有效，须先迁入接替文档或 seed 注释；确认无引用后执行删除（删除为独立动作，须 owner 确认）。

**版本**: 1.0  
**日期**: 2026-06-26  
**状态**: ~~已确认，待实施~~ → **superseded（见顶部 banner）**

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md] + [-schema.md]（本文不重述平台 DDL，只述本板块内容）。

---

## 一、产品目录 (Application Catalog)

### 1.1 产品清单

| app_code | 显示名   | app_type | 用户域名          | OIDC 客户端  | 订阅计划 | 备注                         |
| -------- | -------- | -------- | ----------------- | ------------ | -------- | ---------------------------- |
| arda     | Arda     | platform | —                 | 否           | 否       | 平台门户，内部 shell         |
| ruyin    | Ruyin    | saas     | ruyin.ai          | 是（仅正式） | 是       | 跨域 RP，仅正式环境，无 beta |
| runos    | Runos    | saas     | runos.ai          | 是           | 是       | —                            |
| vault    | Vault    | saas     | vault.vxture.com  | 是           | 是       | —                            |
| cortex   | Cortex   | saas     | cortex.vxture.com | 是           | 是       | —                            |
| ontos    | Ontos    | saas     | ontos.vxture.com  | 是           | 是       | —                            |
| raven    | Raven    | saas     | raven.vxture.com  | 是           | 是       | —                            |
| anlan    | Anlan    | saas     | anlan.ai          | 是           | 是       | —                            |
| forge    | Forge    | saas     | forge.vxture.com  | 是           | 是       | —                            |
| xuanzhen | Xuanzhen | saas     | xuanzhen.ai       | 是           | 是       | —                            |
| hermes   | Hermes   | internal | —                 | 否           | 否       | 平台内部服务，不暴露用户登录 |

> **ruyin 说明**：仅有正式环境（ruyin.ai），无 beta-ruyin.ai 域名，无 beta 变体 OIDC redirect_uri。  
> **hermes 说明**：内部服务类型（`app_type = 'internal'`），不需要 OIDC 客户端，不需要订阅计划。  
> **arda 说明**：平台级 shell，用户通过平台身份访问，无独立订阅。

### 1.2 OIDC 客户端拓扑

已存在客户端（seed 中保持）：

| client_code | 类型         | redirect_uri                                   |
| ----------- | ------------ | ---------------------------------------------- |
| website     | same-site    | /api/auth/callback                             |
| console     | same-site    | /api/auth/callback                             |
| admin       | same-site    | /api/auth/callback                             |
| ruyin       | cross-domain | https://ruyin.ai/callback（无 beta，无第二条） |

新增客户端（Phase D，seed 扩展）：

| client_code | redirect_uris                                                               |
| ----------- | --------------------------------------------------------------------------- |
| runos       | https://runos.ai/callback, https://beta.runos.ai/callback                   |
| vault       | https://vault.vxture.com/callback, https://beta.vault.vxture.com/callback   |
| cortex      | https://cortex.vxture.com/callback, https://beta.cortex.vxture.com/callback |
| ontos       | https://ontos.vxture.com/callback, https://beta.ontos.vxture.com/callback   |
| raven       | https://raven.vxture.com/callback, https://beta.raven.vxture.com/callback   |
| anlan       | https://anlan.ai/callback, https://beta.anlan.ai/callback                   |
| forge       | https://forge.vxture.com/callback, https://beta.forge.vxture.com/callback   |
| xuanzhen    | https://xuanzhen.ai/callback, https://beta.xuanzhen.ai/callback             |

> prod + beta 共享同一 client_id，通过多条 redirect_uri 区分；ruyin 例外，仅单条正式 URI。

---

## 二、订阅计划结构

### 2.1 单品计划（Per-Product Plans）

每个 saas 类型的应用（8 个新应用 + ruyin + xuanzhen）各有 4 个计划：

| 计划代码规则            | 显示名     | level | billing_cycle |
| ----------------------- | ---------- | ----- | ------------- |
| `{app_code}-free`       | Free       | 0     | none          |
| `{app_code}-starter`    | Starter    | 1     | monthly       |
| `{app_code}-pro`        | Pro        | 2     | monthly       |
| `{app_code}-business`   | Business   | 3     | monthly       |
| `{app_code}-enterprise` | Enterprise | 4     | monthly       |

> xuanzhen 和 hermes 已在现有 seed 中；hermes 为 internal，无计划；ruyin 已有计划基础，按上表补全。

### 2.2 试用机制

- 每个租户、每个 app_code，终生只有一次试用资格
- 试用状态：`status = 'trial'`，`trial_end_at = created_at + 14d`
- 首次激活写入 `had_trial_at`（CAS 写，幂等）：见 b（`commerce.tenant_subscription.had_trial_at` 列及 CAS 更新为字段级权威）
- 再次订购同应用：不发放试用，直接 free 或付费

---

## 三、组合订阅（Bundle Subscription）

### 3.1 设计原则

Bundle 是**纯运营配置**，无硬编码 bundle 定义：

- 运营团队通过 Admin 控制台创建 bundle 产品和 bundle 计划
- 代码仅提供 bundle 购买的处理逻辑（fan-out），不预设任何 bundle 组合
- Bundle 可随业务演进随时新增、停售、调整，不需要代码发版

### 3.2 数据模型

commerce schema 新增的 `BundlePlanComponent`、`BundleSubscription`、`BundleSubscriptionComponent` 表及 `ComponentDisposition` enum（added | deferred | bypassed）见 b（字段级权威：表 DDL/列/索引/Prisma）。

### 3.3 冲突处理策略：保留增量（Strategy A）

**规则**：bundle 购买时，对每个组件产品：

1. 查询租户是否已有该产品的 **活跃** 订阅（`status IN ('active', 'trial')`）
2. **无活跃订阅** → `disposition = added`：按 bundle 组件计划新建 `TenantSubscription`
3. **有活跃订阅，tier ≥ bundle 组件 tier** → `disposition = bypassed`：保留现有订阅，不新建，不计费
4. **有活跃订阅，tier < bundle 组件 tier** → `disposition = deferred`：保留现有订阅不降级，bundle 权益记录备用

> **核心原则**：保留已有订阅 > 不重复计费 > 不降级。bundle 只填充用户还没有的部分。  
> **计费**：bundle 价格已在产品定价时扣除组件折让；`deferred`/`bypassed` 组件不额外退款，bundle 整体价格不变——运营定价时已考虑此因素。

**权益解析不变**：OIDC claim 仍从 `TenantSubscription` 读取，`BundleSubscription` 不参与 claim 解析。bundle 仅是购买入口，最终都落到 `TenantSubscription`。

---

## 四、通用订阅 Claim 解析

### 4.1 现有问题

目前 `oidc.service.ts` 为每个产品单独写 `resolveXxxScopeClaim`，重复代码。

### 4.2 通用解析器

```typescript
// packages/service-platform-identity/src/oidc/resolvers/app-scope.resolver.ts

const APP_SCOPE_CODES = [
  "ruyin",
  "runos",
  "vault",
  "cortex",
  "ontos",
  "raven",
  "anlan",
  "forge",
  "xuanzhen",
] as const;

async function resolveAppScopeClaim(
  tenantId: string,
  appCode: (typeof APP_SCOPE_CODES)[number],
  db: PrismaClient,
): Promise<AppScopeClaim> {
  const sub = await db.tenantSubscription.findFirst({
    where: {
      tenantId,
      application: { appCode },
      status: { in: ["active", "trial"] },
    },
    include: { plan: true },
    orderBy: { currentPeriodEnd: "desc" },
  });

  if (!sub) return { subscribed: false };
  return {
    subscribed: true,
    plan: sub.plan.code,
    status: sub.status,
    ...(sub.status === "trial" && {
      trial_end_at: sub.trialEndAt?.toISOString(),
    }),
  };
}

// 在 buildTenantIdentityClaims 中批量调用
const appClaims = Object.fromEntries(
  await Promise.all(
    APP_SCOPE_CODES.map(async (code) => [
      code,
      await resolveAppScopeClaim(tenantId, code, db),
    ]),
  ),
);
```

> `arda` 和 `hermes` 不进入 claim 解析：arda 是平台 shell，hermes 是 internal service。

---

## 五、UUID 分配表

seed 中固定 UUID 前缀：`00000000-0000-0000-0000-`

### Applications

| app_code | UUID 尾缀             |
| -------- | --------------------- |
| arda     | 0000000003a3          |
| runos    | 0000000003a4          |
| vault    | 0000000003a5          |
| cortex   | 0000000003a6          |
| ontos    | 0000000003a7          |
| raven    | 0000000003a8          |
| anlan    | 0000000003a9          |
| forge    | 0000000003aa          |
| xuanzhen | 0000000003a1 (已存在) |
| hermes   | 0000000003a2 (已存在) |
| ruyin    | 0000000003a0 (已存在) |

### Plans（每应用 4 个，尾缀格式 `{app_offset}{plan_offset}`）

Plan 固定 UUID 规则：`00000000-0000-0000-0000-{app_base}{plan_slot}`

| plan_slot | 含义     |
| --------- | -------- |
| 01        | free     |
| 02        | starter  |
| 03        | pro      |
| 04        | business |

App base（12 位）：

| app_code | base         |
| -------- | ------------ |
| ruyin    | 000000030001 |
| runos    | 000000030101 |
| vault    | 000000030201 |
| cortex   | 000000030301 |
| ontos    | 000000030401 |
| raven    | 000000030501 |
| anlan    | 000000030601 |
| forge    | 000000030701 |
| xuanzhen | 000000030801 |

示例：runos-pro = `00000000-0000-0000-0000-000000030103`

---

## 六、实施阶段

### Phase A — 产品目录扩展（seed-catalog.mjs）

**A1** 更新 `hermes` 的 `app_type` 为 `'internal'`（现有记录）  
**A2** 更新 `ruyin` OIDC 客户端：确认 redirect_uri 只有 `https://ruyin.ai/callback`，无 beta 条目  
**A3** 新增 Applications：arda、runos、vault、cortex、ontos、raven、anlan、forge（xuanzhen 已存在）  
**A4** 新增订阅计划：每个 saas 应用各 4 个（free/starter/pro/business）  
**A5** 新增 OIDC 客户端：runos、vault、cortex、ontos、raven、anlan、forge、xuanzhen（每个 prod+beta redirect_uri）

依赖：无（纯 seed 扩展）

### Phase B — 试用记录列

**B1** Prisma migration：`TenantSubscription` 加 `had_trial_at DateTime?` 列  
**B2** 更新 `resolveAppScopeClaim` 逻辑：CAS 写入 `had_trial_at`

依赖：Phase A

### Phase C — 通用 Claim 解析

**C1** 实现 `resolveAppScopeClaim` 通用解析器  
**C2** 在 `buildTenantIdentityClaims` 中替换各产品独立 resolver，改为 `APP_SCOPE_CODES` 循环调用  
**C3** 更新 allowed_scopes：各产品 OIDC 客户端 scope 覆盖 `{app_code}:subscription`

依赖：Phase A

### Phase D — Bundle 订阅

**D1** Prisma migration：新增 `BundlePlanComponent`、`BundleSubscription`、`BundleSubscriptionComponent` 表，加 `ComponentDisposition` enum  
**D2** 实现 `BundlePurchaseService.fanOut(tenantId, bundlePlanId)`：按 Strategy A 逻辑处理冲突  
**D3** Admin 控制台：bundle 计划配置 UI（运营侧）  
**D4** 权益校验：在 `fanOut` 前校验 `BundlePlanComponent` 存在且 bundle plan 处于 active 状态

依赖：Phase A、Phase B

### Phase E — 新 OIDC 客户端接入（各产品侧）

各产品 RP 集成（独立排期，不阻塞 A–D）：

- 配置 `AUTH_BFF_URL`、`OIDC_CLIENT_ID/SECRET`、`BASE_URL`
- 实现 `/api/auth/callback` handler（参考 `identity-platform-rp-integration.md`）
- `allowed_scopes` 包含 `openid profile email {app_code}:subscription`

---

## 七、开放问题（已关闭）

| #   | 问题                     | 决策                                          |
| --- | ------------------------ | --------------------------------------------- |
| Q1  | ruyin 是否需要 beta 环境 | ❌ 无 beta，仅正式 ruyin.ai                   |
| Q2  | hermes appType           | ✅ internal                                   |
| Q3  | bundle 维护方式          | ✅ 纯运营配置，无硬编码                       |
| Q4  | 冲突处理策略             | ✅ Strategy A：保留已有，只增不覆，不重复计费 |

---

## 八、不在本设计范围内

- ruyin 侧（worker-04/umbra）的 allowed_scopes 更新及 active_org 读取改造：见 `project_identity_sso.md` 剩余项
- 各产品 E2E 接入验证：各产品 Phase E 独立排期
- bundle 定价模型：运营决策，admin 配置
- 退款、降级、取消逻辑：Phase D 后续迭代
