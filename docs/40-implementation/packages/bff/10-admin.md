# @vxture/bff-admin

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项     | 值                  |
| ------ | ------------------- |
| 包名   | `@vxture/bff-admin` |
| 路径   | `bff/admin-bff/`    |
| @layer | `Application`       |
| 框架   | NestJS              |

| 服务对象 | `portals/admin` |

## 职责

平台运营后台 BFF，覆盖租户管理、账单、订阅、产品、Model Platform、运营人员权限等域。
middleware 顺序：`auth → capabilities → router`

**不签发 JWT**。登录流程：IP+账号限速 → Cloudflare Turnstile admin surface 校验 → DB 密码校验 → 委托 `auth-bff POST /auth/internal/sign` 签发 Cookie。

通用约束见 [bff/index.md](./00-index.md)。

---

## 接口契约

> 所有接口（auth 类除外）均需携带 Cookie `vx_admin_access_token`。
> 各路由根据 `req.capabilities` 做能力守卫，缺少能力返回 403。
> 错误响应格式：`{ code: string; message: string; requestId?: string }`

---

### `/api/auth` — 运营认证

**POST `/api/auth/captcha/challenge`** — 获取滑块验证码挑战（遗留兼容，无鉴权）

```typescript
// Response 200：CaptchaChallengeDto
{
  token: string; /* 遗留滑块挑战令牌，当前登录页不再使用 */
}
```

**POST `/api/auth/send-phone-code`** — 发送手机验证码（无鉴权）

```typescript
// Request
{
  phone: string;
  turnstileToken?: string; // Cloudflare Turnstile admin token
}
// Response 200
{
  message: "验证码已发送，请在 10 分钟内输入";
}
// 手机号未绑定运营账号时静默成功（不暴露账号状态）
```

**POST `/api/auth/login`** — 密码 + Cloudflare Turnstile 登录（无鉴权）

```typescript
// Request
{
  identifier: string; // 用户名或邮箱
  password: string;
  turnstileToken?: string; // Cloudflare Turnstile admin token
}

// Response 200（Set-Cookie: vx_admin_access_token）
{
  userId: string;
  status: "authenticated";
}

// Error
// 429：登录频率超限（IP + 账号双维度限速）
// 401：人机验证未通过
// 401：用户名或密码错误
```

**POST `/api/auth/login-with-phone`** — 手机验证码登录（无鉴权）

```typescript
// Request
{
  phone: string;
  code: string;
  turnstileToken?: string; // Cloudflare Turnstile admin token
} // code 为 6 位数字

// Response 200（Set-Cookie: vx_admin_access_token）
{
  userId: string;
  status: "authenticated";
}

// Error 400：手机号格式错误 / 验证码格式错误 / 验证码错误或过期
// Error 401：手机号未绑定运营账号
```

**POST `/api/auth/logout`** — 登出

```typescript
// Request：无 body，读取 Cookie
// Response 200（代理 auth-bff，清除 Cookie）
```

**GET `/api/auth/session`** — 会话状态（本地，不代理）

```typescript
// Response 200
{
  status: "active";
  userId: string;
}
// Response 401
{
  code: "UNAUTHORIZED";
}
```

---

### `/api/me` — 当前运营账号

**GET `/api/me`** — 当前运营账号信息

```typescript
// Response 200：运营账号基本信息（username、displayName、roleCode 等）
```

---

### `/api/tenants` — 租户运营管理

**需要能力：`platform.tenant.manage`**

**GET `/api/tenants`** — 租户列表（全量聚合）

```typescript
// Response 200：TenantOperationRecord[]
// 每条记录包含：
{
  id, tenantCode, tenantName, tenantType, status, verifiedStatus,
  riskLevel,                  // 'normal' | 'follow_up' | 'high'
  region, industry, scale,
  ownerName, ownerEmail, contactName, contactPhone,
  memberCount, activeMemberCount, adminCount,
  subscriptionCount, productCount,
  monthlyRevenue, monthlyCost, grossMarginRate,
  tokenUsed, tokenQuota,
  members: TenantOperationMember[],
  subscriptions: TenantOperationSubscription[],
  usage: TenantOperationUsageMetric[],   // tokens + seats
  modelPolicies: TenantOperationModelPolicy[],
  auditEvents: TenantOperationAuditEvent[],
  tags: string[],
}
```

---

### `/api/accounts` — 账号运营管理

**需要能力：`platform.tenant.manage`**

**GET `/api/accounts`** — 账号列表（含租户绑定关系）

```typescript
// Response 200：AccountOperationRecord[]
// 每条记录包含账号基本信息 + tenantBindings（租户角色列表）+ 最后登录信息
```

---

### `/api/subscriptions` — 订阅运营管理

**需要能力：`platform.pricing.manage` 或 `platform.tenant.manage`**

**GET `/api/subscriptions`** — 订阅列表

```typescript
// Response 200：SubscriptionOperationRecord[]
// 按状态排序：trial → active → suspended → overdue → cancelled
// 包含：租户信息、套餐信息、配额（席位+Token）、用量、月收入
```

**GET `/api/subscriptions/:subscriptionId`** — 订阅详情

```typescript
// Response 200：SubscriptionOperationDetailRecord
// 在列表记录基础上额外包含：
// - solutionAssociation：关联业务方案（按行业规则推断）
// - entitlementSnapshot：权益快照
// - operationTimeline：操作历史时间线
```

**POST `/api/subscriptions/:subscriptionId/actions`** — 订阅操作

```typescript
// Request
{
  action: "renew" | "suspend" | "resume" | "cancel";
  reason: string; // 必填，至少 4 个字符
}

// Response 200：SubscriptionOperationDetailRecord（操作后状态）
// Error 400：操作原因为空 / 操作不合法（如续期已取消订阅）
// 副作用：写入 commerce.tenant_subscription_history
```

---

### `/api/billing` — 账单运营管理

**需要能力：`platform.pricing.manage` 或 `platform.tenant.manage`**

**GET `/api/billing`** — 账单列表

```typescript
// Response 200：BillingRecord[]
// 按状态排序：overdue → unpaid → partial → paying → paid → cancelled
// 包含：账单号、租户信息、账期、金额（总额/减免/应收/已收）、发票状态
```

**GET `/api/billing/:billId`** — 账单详情

```typescript
// Response 200：BillingDetailRecord
// 额外包含：invoiceItems（账单明细）、paymentRecords（收款记录）、
//           invoiceReceipts（发票领取记录）、operationTimeline（时间线）
```

**POST `/api/billing/:billId/offline-invoice-sync`** — 登记线下发票

```typescript
// Request
{
  invoiceNo: string;          // 发票号码（唯一键）
  invoiceType: 'special_vat' | 'normal_vat' | 'electronic' | 'paper' | 'other';
  invoiceTaxType: 'enterprise' | 'individual' | 'government' | 'other';
  invoiceTitle: string;       // 发票抬头
  taxNo?: string;             // 税号
  invoiceAmount: number;      // 发票金额（> 0）
  taxAmount?: number;         // 税额（≥ 0）
  invoiceStatus: 'issued' | 'sending' | 'finished';
  statusRemark: string;       // 登记说明（≥ 4 字符）
  invoiceCode?: string;
  invoiceElectronicNo?: string;
  invoiceFileUrl?: string;    // 电子发票文件 URL
  issuedAt?: string;          // ISO 开票时间
  expressCompany?: string;    // 快递公司
  expressNo?: string;         // 快递单号
  sendAt?: string;
}

// Response 200：BillingDetailRecord
// 冲突处理：同一 invoiceNo 已存在时更新（UPSERT）
```

**POST `/api/billing/:billId/actions`** — 账单处理操作

```typescript
// Request
{
  action: 'cancel' | 'discount' | 'mark_overdue' | 'create_adjustment' | 'create_supplement';
  reason: string;          // 处理说明（≥ 4 字符）
  discountAmount?: number; // action=discount 必填（> 0）
  amount?: number;         // action=create_adjustment/create_supplement 必填（> 0）
  itemName?: string;       // 账单项目名（2-128 字符）
  cycleStartDate?: string; // 账期开始
  cycleEndDate?: string;   // 账期结束（≥ cycleStartDate）
}

// Response 200：BillingDetailRecord（create_* 操作返回新账单详情）
// Error 400：金额校验失败、已取消账单继续操作、减免超过应收等
```

**POST `/api/billing/:billId/invoice-receipts/:receiptId/actions`** — 发票后续操作

```typescript
// Request
{
  action: 'update_shipping' | 'finish' | 'red';
  statusRemark: string;     // 操作说明（≥ 4 字符）
  expressCompany?: string;  // update_shipping 必填
  expressNo?: string;       // update_shipping 必填
  sendAt?: string;
}

// Response 200：BillingDetailRecord
```

---

### `/api/products` — 产品目录管理

**需要能力：`platform.product.manage`**

**GET `/api/products/plans`** — 套餐计划列表（读 DB）

```typescript
// Response 200：ProductPlanRecord[]
// 含：planCode、planType、prices、features（配额项）、agents（可访问 Agent）
```

**GET `/api/products/capabilities`** — 能力目录（读 DB：`product.products` + `product_metrics` + `product_webhooks`）

**GET `/api/products/capabilities/:productCode`** — 能力详情

**GET `/api/products/releases`** — 产品发布列表（读 DB，2026-08-31 起 = 已发布的套餐版本：一条 = 一个 `plan_versions.status='published'`，产品取 primary 组件；见 `docs/20-specs/000-platform/admin/70-product-solutions.md` §6）

**GET `/api/products/solutions`** — 解决方案列表（读 DB：`product.solutions` + `solution_products` + `solution_plans`；订阅数 / 租户数 / MRR 从 `metering.subscriptions` 按绑定 plan 归集）

**GET `/api/products/solutions/:solutionCode`** — 解决方案详情（+ 交付模式 / 交付边界 / 关联套餐）

**POST `/api/products/solutions`** — 新建方案（草稿；`solutionCode` kebab 唯一）

**PUT `/api/products/solutions/:solutionCode`** — 改字段（只更新送来的键）

**PATCH `/api/products/solutions/:solutionCode/state`** — 状态迁移（draft→active⇄inactive，任一→deprecated 终态；`FOR UPDATE` + 非法迁移 409）

**PUT `/api/products/solutions/:solutionCode/products`** — 整体替换产品清单 `[{productId|productCode, role?, sort?}]`

**PUT `/api/products/solutions/:solutionCode/plans/:tier`** — 绑定 / 换绑既有 plan 到档位（`tier ∈ TIERS`；plan 已绑别处 409）

**DELETE `/api/products/solutions/:solutionCode/plans/:tier`** — 解绑

> 写路径：RW 池 + 事务 + `support.audit_logs`（`product.solution.*`，resource_id = solution_code），全部返回最新 `ProductSolutionDetailRecord`。

**GET `/api/products/service-plans/:solutionCode/:tierCode`** — 服务套餐详情（读 DB：方案档位上绑的 plan 的当前版本）

```typescript
// Path：solutionCode='flood-regulation', tierCode='pro'（tierCode ∈ free/starter/pro/business/enterprise）
// Response 200：ProductServicePlanDetailRecord
// 含：价格（当前版本月付优先）、版本号 / 版本状态、权益快照（entitlements：组件=included、方案里有但组件里没有=excluded）、计数
```

**PUT `/api/products/plan-versions/:versionId/bundled-components`** — 整体替换草稿版本的 bundled 组件集 `{components: [{productCode, quota, features?, priority?}]}`（`@RequireStepUp`；已发布 / 已锁 409、产品不存在 404 带 `field`、primary 产品当捆绑件 / 同码重复 / priority ≥ primary 400；`tier = NULL`；审计 `product.plan_version.bundled.replace`，resource_id = `plan_code@vN`；返回 `PlanVersionDetail`——见 `docs/20-specs/000-platform/admin/80-plan-bundled-components.md`）

**GET `/api/products/agents`** — Agent 目录

~~**GET `/api/products/model-policies`**~~ — 已退役（2026-08-31）：模型策略是 Atlas 的，走 `GET /api/atlas/policies`

---

### `/api/model-platform` — Model Platform 模型管理

**需要能力：`platform.model.manage`**

> 所有接口透传到 Model Platform HTTP API（`MODEL_PLATFORM_URL`），不直接操作数据库。
> 上游业务错误按原 HTTP 状态码和结构化错误体返回；只有上游不可达才返回 502。

**GET `/api/model-platform/providers?includeInactive=true`** — Provider 列表

**POST `/api/model-platform/providers`** — 创建 Provider

**PUT `/api/model-platform/providers/:providerId`** — 更新 Provider

**POST `/api/model-platform/providers/:providerId/activate`** — 激活 Provider

**POST `/api/model-platform/providers/:providerId/deactivate`** — 停用 Provider

**DELETE `/api/model-platform/providers/:providerId`** — 删除 Provider（软删除）

**GET `/api/model-platform/models?includeInactive=true`** — 模型列表

**POST `/api/model-platform/models`** — 创建模型

**PUT `/api/model-platform/models/:modelId`** — 更新模型

**POST `/api/model-platform/models/:modelId/activate`** — 激活模型

**POST `/api/model-platform/models/:modelId/deactivate`** — 停用模型

**DELETE `/api/model-platform/models/:modelId`** — 删除模型

**GET `/api/model-platform/grants?tenantId=&modelId=&applicationId=&applicationType=`** — 模型授权列表

**POST `/api/model-platform/grants`** — 创建授权

**PUT `/api/model-platform/grants/:grantId`** — 更新授权

**POST `/api/model-platform/grants/:grantId/activate`** — 激活授权

**DELETE `/api/model-platform/grants/:grantId`** — 停用/删除授权

**GET `/api/model-platform/price-rules?modelId=&includeInactive=`** — Provider 成本价格规则列表

**POST `/api/model-platform/price-rules`** — 创建 Provider 成本价格规则

**PUT `/api/model-platform/price-rules/:priceRuleId`** — 更新 Provider 成本价格规则

**POST `/api/model-platform/price-rules/:priceRuleId/activate`** — 激活价格规则

**POST `/api/model-platform/price-rules/:priceRuleId/deactivate`** — 停用价格规则

**GET `/api/model-platform/policies?tenantId=&modelId=&includeInactive=`** — 模型策略列表

**POST `/api/model-platform/policies`** — 创建模型策略

**PUT `/api/model-platform/policies/:policyId`** — 更新模型策略

**POST `/api/model-platform/policies/:policyId/activate`** — 激活模型策略

**POST `/api/model-platform/policies/:policyId/deactivate`** — 停用模型策略

**GET `/api/model-platform/quotas?tenantId=&includeExpired=`** — 租户模型配额列表

**GET `/api/model-platform/usage-summaries?tenantId=&applicationId=&applicationType=&cycleMonth=&statType=`** — 租户模型用量汇总列表

---

### `/api/runos` — Runos 能力目录（只读）

**需要能力：`capability:runos.read` 或 `capability:runos.manage`（任一即可，与 opera-bff 的 `assertCanRead` 同判据）**

> admin「技能市场」（`/skills`）的数据源。所有接口透传到 Runos 的 `/capability/*` HTTP 面（`RUNOS_API_URL`，外部主机 worker-02），认证走 operator-OBO（product_250 M-1：会话 access token 换成 aud=runos 的短时管理令牌再转发，BFF 从不以自己的身份调上游）。
> **只读**：owner 2026-08-30 裁定 admin 只看目录，注册 / 晋升 / 退役 / 认证留在 opera「能力注册」（opera-bff 自己的 `runos.router.ts`，两个 BFF 零交叉引用）。本路由刻意不留写路由骨架。
> 每条读在出口按 `runos-contract.ts` 校验必有字段，缺了直接 502 `RUNOS_CONTRACT_FIELD_MISSING` 并点名字段（同 atlas 的 `atlas-contract.ts`）；上游业务错误按原状态码与错误体透传；上游不可达 502 `Runos is unavailable`。
> 此前的 `/api/skills`（`skills.router.ts`）是返回字面量 `[]` 的空桩，2026-08-30 随本路由接入一并删除。

**GET `/api/runos/capabilities?category=&tag=&tag=`** — 能力目录列表（`registry.capability` 整行：`capabilityId` / `primitiveType` / `providerId` / `ownerRef` / `title` / `displayName` / `admissionTier` / `category` / `tags` / `createdAt` / `updatedAt`）。`category` 精确匹配；`tag` 可重复、全部命中（AND），透传时保留重复参数。上游没有分页与关键字检索，页面在前端过滤。

**GET `/api/runos/capabilities/:capabilityId`** — 单条详情，在列表字段之上多 `versions[]` / `aliases[]` / `endpoints[]` 三组关联（`versions[]` 带上游全量 include 的 `embedding`，本层不裁剪）。

**GET `/api/runos/management-entry`** — `{ url }`：「去 opera 能力注册管理」的链接（`OPERA_BASE_URL` + `/capability/registry`）。不读上游，只回配置；与目录读同一道能力门。

**运行时配置**：`RUNOS_API_URL`、`OPERA_BASE_URL` 两个键在 `deploy/.env.admin-bff.example` 登记，并被 `deploy/guardrails/39-audit-env.mjs` 列为 admin-bff 必填——不填则落回 zod 默认 `localhost`，前者让本路由全部 502，后者让链接指向 `localhost:3040`。

---

### `/api/platform-admins` — 运营账号管理

**需要能力：`platform.admin.manage`**

**GET `/api/platform-admins`** — 运营账号列表

```typescript
// Response 200：PlatformAdminRecord[]
// 含：username、displayName、roleCode、statusCode、lastLoginAt、lastLoginIp
```

---

### `/api/admin-roles` — 运营角色管理

**需要能力：`platform.admin.manage` 或 `platform.tenant.manage`**

**GET `/api/admin-roles`** — 运营角色列表（含权限明细）

```typescript
// Response 200：PlatformRoleRecord[]
// 每条含：roleCode、adminCount、permissionCount 统计、permissions[]
```

**PUT `/api/admin-roles/:roleId/permissions`** — 全量替换角色权限

```typescript
// Request
{ permissionIds: string[] }  // 权限 ID 列表（最多 1000 个）

// Response 200：PlatformRoleRecord（更新后）
// Error 400：包含无效 / 禁用 / 缺少父级的权限 ID
// Error 403：不能从当前操作者自身角色移除 platform.admin.manage
```

---

### `/api/tickets` — 工单管理

**需要能力：`platform.tenant.manage`**

**GET `/api/tickets`** — 工单列表（按优先级排序）

```typescript
// Response 200：SupportTicketRecord[]
// 含：title、status、priority（p0-p3）、tenantId、tenantRiskLevel
// 注意：support.ticket 表不存在时返回 502
```

---

### `/api/audit-logs` — 操作审计日志

**GET `/api/audit-logs`** — 审计日志（占位，暂返回 `[]`）

---

### `/health` — 健康检查

**GET `/health`** — 无鉴权

```typescript
// Response 200
{
  status: "ok";
}
```

---

## 能力守卫汇总

| 能力 code                 | 保护范围                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `platform.tenant.manage`  | tenants / accounts / subscriptions / billing / tickets / admin-roles |
| `platform.pricing.manage` | subscriptions / billing（与 tenant.manage 任一即可）                 |
| `platform.product.manage` | products                                                             |
| `platform.model.manage`   | model-platform                                                       |
| `capability:runos.read`   | runos（只读目录；`capability:runos.manage` 亦可）                    |
| `platform.admin.manage`   | platform-admins / admin-roles                                        |

---

## 依赖约束

**允许：**

- `@vxture/core-auth` / `@vxture/core-tenant` / `@vxture/core-config` / `@vxture/shared`
- `@vxture/service-sms`（手机验证码发送）
- NestJS / class-validator / pg（直连 DB 聚合查询）
- auth-bff（HTTP internal，登录时委托签发 Cookie）

**禁止：** `@vxture/model-runtime-client` / `design-system` / `platform-*` / 跨 BFF 导入 / 直接签发 JWT / 业务逻辑
