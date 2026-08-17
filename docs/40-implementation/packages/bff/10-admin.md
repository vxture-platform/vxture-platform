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

**GET `/api/products/capabilities`** — 能力目录（内存聚合）

**GET `/api/products/capabilities/:productCode`** — 能力详情

**GET `/api/products/releases`** — 产品发布列表（内存）

**GET `/api/products/solutions`** — 业务方案列表（内存）

**GET `/api/products/solutions/:solutionCode`** — 业务方案详情

**GET `/api/products/service-plans/:solutionCode/:tierCode`** — 服务套餐详情

```typescript
// Path：solutionCode='flood-regulation', tierCode='pro'
// Response 200：ProductServicePlanDetailRecord
// 含：权益快照（entitlements）、定价、适用范围、销售提示
```

**GET `/api/products/agents`** — Agent 目录

**GET `/api/products/model-policies`** — 模型授权策略列表

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
| `platform.admin.manage`   | platform-admins / admin-roles                                        |

---

## 依赖约束

**允许：**

- `@vxture/core-auth` / `@vxture/core-tenant` / `@vxture/core-config` / `@vxture/shared`
- `@vxture/service-sms`（手机验证码发送）
- NestJS / class-validator / pg（直连 DB 聚合查询）
- auth-bff（HTTP internal，登录时委托签发 Cookie）

**禁止：** `@vxture/model-runtime-client` / `design-system` / `platform-*` / 跨 BFF 导入 / 直接签发 JWT / 业务逻辑
