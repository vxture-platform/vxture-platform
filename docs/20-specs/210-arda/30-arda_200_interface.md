# Arda 对接接口契约（arda_200_interface）

> 版本：**v2.0** · 状态：定稿（契约收缩定型）· 受众：**线 B（arda 独立仓）开发**
> v2.0 = 契约收缩：C2 信封 v2（§2.2，capabilities 退役、limits 独立块、时间戳四件套）、值域六值（§5）、`arda:subscription` scope + `arda` claim 退役（§1）。
> 文档族：产品交接包 `arda_{NNN}`，本文 = **200**（接口契约位）；命名规范见 [`000_handoff-package-convention.md`](../10-000_handoff-package-convention.md)
> 性质：**接口契约本体**——只表述"arda ↔ 平台"的接口（端点、请求/响应形状、值域、鉴权、事件）。范围/边界 = [`arda_100_handoff.md`](./20-arda_100_handoff.md)；最终义务与决策留痕 = [`arda_300_integration-final.md`](./40-arda_300_integration-final.md)。
> 权威回指：语义以各权威文档为准（见 §6）；本文是"面向 arda 实现"的合并视图，与权威冲突以权威为准。

---

## 0. 通用

| 项             | 值                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 IdP         | `accounts.vxture.com`（OIDC，RS256，已上生产）                                                                                                 |
| C2/C3 平台 API | **仅内网可达**（公网 nginx 不路由 `/platform/*` 与 `/usage/*`）；base = 平台内网地址（owner 转运）                                             |
| C2/C3 鉴权     | 请求头 `x-vxture-internal-auth: <AUTH_INTERNAL_TOKEN>`（过渡 S2S 凭证，owner 手动转运；`product_210` token exchange 落地后迁移，端点契约不变） |
| 值域权威       | `@vxture/shared`（`^1.2.2`+，现最新 `1.3.1`）导出 = DB CHECK = 契约值域；见 §5                                                                 |
| 路由前缀注意   | **C2 = `/platform/entitlements`**；**C3 = `/usage/consume`、`/usage/gauge`（无 `/platform` 前缀）**                                            |

---

## 1. C1 · 身份（OIDC RP）

arda 作为 RP 接入 `accounts.vxture.com`。五端点/PKCE/RS256 验签/服务端会话/back-channel logout —— 通则见 [`identity-platform-rp-integration.md`](../../30-design/identity/080-rp-integration.md)。

**Client 注册参数：**

| 项           | prod                         | beta                               |
| ------------ | ---------------------------- | ---------------------------------- |
| client_id    | `arda`                       | `arda-beta`                        |
| 站点         | `https://arda.vxture.com`    | `https://beta-arda.vxture.com`     |
| redirect_uri | `{站点}/auth/callback`       | 同左                               |
| post_logout  | `{站点}/`                    | 同左                               |
| realm        | `customer`                   | `customer`（release_channel=beta） |
| scopes       | `openid profile email phone` | 同左                               |

- **client secret**：owner 手动转运（明文不进聊天/CI/仓库）。
- **access_token 只承载"上下文" claim**（`active_org` / `active_workspace` / `roles` / `account_status` 等），**权益不入 token**（铁律）——订阅状态/配额一律经 C2 实时拉取。
- **`arda:subscription` scope 与 `arda` 嵌套 claim 已整体退役**（回函 06 §3 确认，平台 2026-07-14 实施：seed 摘 scope + claim 解析器摘 arda）——token 零商业字段目标态达成；退役生效于生产 reseed（cutover 同窗）。
- **back-channel logout**：平台按 RP 通则回调 arda 的登出端点，arda 据此销服务端会话。

---

## 2. C2 · 权益（entitlements）

### 2.1 请求

```
GET /platform/entitlements?workspace_id={W}&product=arda
GET /platform/entitlements?workspace_id={W}&products=arda,otherprod   # 批量
Header: x-vxture-internal-auth: <AUTH_INTERNAL_TOKEN>
```

### 2.2 响应（信封 v2「契约收缩」，单产品扁平顶层；平台实施 2026-07-14，回函 06 §1 确认形状）

```jsonc
{
  "workspace_id": "ws_...",
  "product": "arda",

  // ── 订阅事实块（单一代表订阅投影，逐字渲染） ──────────────────
  "status": "active" | "trialing" | "overdue" | "suspended" | "expired" | "cancelled" | null,  // null=从没订过（原 subscription_status 改短随块整并）
  "trial_ends_at": "2026-07-20T00:00:00.000Z" | null,      // trialing 且有排定到期时非空
  "current_period_end": "2026-08-01T00:00:00.000Z" | null, // active 且有界周期时非空
  "cancel_at_period_end": false,                            // 已预约到期不续
  "data_retention_until": "2026-10-01T00:00:00.000Z" | null,// expired 时非空：数据至少保留至此（过期+90 天，承诺下限）

  // ── 销售轴（活跃覆盖合并） ──────────────────────────────────
  "tier": "pro" | "starter" | "business" | "enterprise" | "free" | null,  // 跨活跃订阅就高；null=无活跃直购
  "bundled": true | false,                 // 来源轴：被某 agent plan 捆绑（正交于 tier）
  "limits": {                              // 上限型销售数字（merge=max，就高；-1=无限），产品动作点本地执行
    "member.max": 10, "dataset.max": 100, "datasource.max": 10,
    "service_endpoint.max": 5, "retention.days": 90
  },

  // ── 消耗型配额池（机制零变更） ──────────────────────────────
  "quota_pools": [
    { "metric": "storage.bytes",      "limit": 5368709120, "remaining": 5000000000, "priority": 0 },
    { "metric": "service.api.call",   "limit": 100000,     "remaining": 99000,      "priority": 0 },
    { "metric": "quality.check.run",  "limit": 1000,       "remaining": 1000,       "priority": 0 },
    { "metric": "ai.credit",          "limit": 50000,      "remaining": 42000,      "priority": 0 }
  ]
}
```

批量形态：`{ workspace_id, entitlements: { "arda": { …同上扁平字段 } } }`。

**v1→v2 变更**：`capabilities` 块整体退役——`features` 数组与功能键（`varda.enabled`/`varda.readonly`/`sync.frequency` 等 tiered/union 键）不再下发，档位→功能由 arda 仓内能力矩阵自持；`tier`/`bundled` 升顶层；上限数字独立 `limits` 块；`subscription_status` 改名 `status` 并入订阅事实块；新增四个时间戳/日期字段。

### 2.3 语义与门控

- **订阅事实块 = 单一代表订阅投影**：`status` 与四个时间戳/布尔来自**同一笔**订阅（代表 = 状态优先级最高，平手取周期结束最晚），不会出现 `status:"active"` 配 `trial_ends_at` 的混排——低优先级订阅的时间戳不泄漏。`data_retention_until` = 承诺下限（至少保留至该日）。
- **`status`**：订阅自身生命周期（值域 = `@vxture/shared.SUBSCRIPTION_STATUSES` 六值，见 §5）。**"从没订过" = `null`（字段缺席语义），不是某个值**——`null`→CTA「订阅」；`expired`/`cancelled`/`suspended`→CTA「续订」；`overdue`→CTA「补款」（欠费宽限，权益保留；**支付面落地前平台不产出该值**，容错预备即可）。
- **试用离开 = `null`（owner 裁定 2026-07-12，采纳回函 02 §1.3）**：试用到期未转正、试用中取消——C2 一律呈现 `null`，**不会**以 `expired`/`cancelled` 下发（平台代表选取规则排除 never-paid 试用行；`expired` 专表付费订阅被动失效）。试用被冻结例外：`suspended` 照常下发（拦停不因 null 洗白）。权威 = [`product_220`](../../30-design/product_220_catalog-resource-model.md) §3。
- **门控公式**：产品 UI 访问 = `status ∈ {active, trialing, overdue}`（`overdue` 权益保留，回函 07 §1 已按此实现）；数据取用（agent DataService）= 上式 `|| bundled === true`。
- **叠单不变量**：同一产品不允许并存档位不同的订阅（升档=变更原订阅）；`tier` 语义归就高合并侧（与 `limits` 同侧），代表订阅事实块 = `status`+时间戳。平台订阅写路径已加 guardrail 强制。
- **无订阅回落**：`{ status:null, tier:null, bundled:false, limits:{}, quota_pools:[] }`。
- **演进容错（双方义务，回函 06 §2 规则 2 配套）**：arda 须容忍信封新增字段与 `status` 新枚举值（未知即降级隐藏/保守渲染）。
- **缓存**：响应带 `Cache-Control: private, max-age=45`；arda 侧照此**短 TTL 缓存**，`subscription_changed` 事件到达时清缓存重拉（v1 亦可仅靠 TTL 自然过期）。
- **配额只读展示**：`quota_pools[].remaining` 平台为准；`ai.credit` 余量 = 该产品实际可消费口径（默认自留池；租户开共享后 = 自留+可及共享），非全 WS 同值。

---

## 3. C3 · 计量（usage）

### 3.1 `POST /usage/consume`（counter 类：`service.api.call` / `quality.check.run` / `ai.credit`）

```jsonc
// 请求
{
  "workspace_id": "ws_...",
  "product": "arda",
  "metric": "ai.credit",
  "amount": 120,
  "idempotency_key": "<uuid>",
}
```

- **200** = 扣减成功，返回瀑布扣减明细；幂等回放附 `"replayed": true`。
- **200 + `gated: true`** = 额度没覆盖住这次调用，**仍然记账**（owner 2026-08-10 裁定，取代原 409 门控）。
  本行此前写「**409** = gated」，自那次裁定起就不成立，2026-10-01 订正。
- **409 只在你显式要求时出现**：请求体带 `intent: "reserve"`（2026-10-01 增）= 「我还没做，先问能不能做」，
  此时有成本指标额度不足回 409 且**不写用量事件**（`event_id` 整个不出现，`consumed` 为 0）。
  **`ai.credit` 的「atomic 预扣（贵操作前置门控）」要的就是这一档：前置门控必须显式带
  `intent: "reserve"`，平台侧已就绪。**缺省 `report` 的行为与现状逐字一致，所以这是纯增量——
  但前置门控这件事要等这个字段补上才由平台这一侧成立。
- 解除机制**不要发明持久标志**——`gated ⇔ C2 该 metric remaining ≤ 0`，池周期翻转后 C2 读侧自动恢复，
  下次拉取门自开（[`arda_300`](./40-arda_300_integration-final.md) §1）。
- **消费模式**：`ai.credit` = atomic 预扣（贵操作前置门控）；`service.api.call`/`quality.check.run` = divisible 后报（廉操作后置记账）。
- **产品侧模式**：`local_usage.usage_raw` 缓冲 + 异步 Job 上报，**不做本地配额裁决**（用量唯一写入方 = 平台 consume）。

### 3.2 `PUT /usage/gauge`（gauge 类：`storage.bytes`）

```jsonc
// 请求（绝对水位，非增量）
{ "workspace_id":"ws_...", "product":"arda", "metric":"storage.bytes",
  "value": 4831838208, "observed_at": "2026-07-10T08:00:00Z" }
// 响应
{ "...": "...", "applied": true | false }   // applied:false = 因更旧 observed_at 被丢弃（幂等）
```

- **last-write-wins 按 `observed_at` 排序**；`value ≥ 0` bytes。**`observed_at` 必填**（缺失 → 400 `invalid_observed_at`；回函 08 §2#4 契约回传确认）。
- arda 周期/写路径节流上报 `SUM(Dataset.sizeBytes)` 绝对值。
- **storage 不进 consume**（误送 `/usage/consume` 返 400 `gauge_metric_use_put_usage_gauge`）。
- C2 里 storage 行 `remaining = limit − Σ 各产品水位`（**跨产品求和、可为负**）；arda 以 `remaining ≤ 0` 关闸、删除放行。设计见 [`data_commerce_240`](../../30-design/data_commerce_240_usage-gauge.md)。

---

## 4. 事件（arda 作接收方）

### 4.1 Provisioning webhook

| 项          | 值                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 接收端点    | `{ARDA_BASE_URL}/provisioning/webhook`                                                                 |
| 验签 secret | arda env `PROVISION_WEBHOOK_SECRET` ↔ 平台 env `ARDA_PROVISION_WEBHOOK_SECRET`（**同值**，owner 派发） |
| 验签算法    | HMAC-SHA256 over `"{t}.{raw_body}"`（原始字节）；header `x-vxture-signature: t=<ts>,v1=<hex>`          |
| 其它 header | `x-vxture-event`（类型） / `x-vxture-delivery`（投递 id）                                              |
| payload     | `{ id, type, occurred_at, seq, workspace_id, tenant_id, application:"arda", plan, data }`              |

**产品端义务**：①验签；②按 `id` 幂等；③按 `seq`（per (workspace,product) 单调）忽略陈旧事件，**不依赖到达顺序**；④`tenant.provisioned`→建该 WS 业务空间，`tenant.deprovisioned`→拆除；⑤2xx 回执（平台默认 8 次退避后死信）；⑥**按 `payload.plan` 忽略 beta plan 的开通事件**（beta 空间懒建，见 [`arda_000_definition.md`](./10-arda_000_definition.md) §5.1）。

### 4.2 `subscription_changed` / `grant.invalidated`

- **同端点、同验签、同幂等**（复用 4.1 的接收器）。
- `subscription_changed` 语义 = **清 C2 entitlement 缓存重拉**（v1 可忽略，短 TTL 兜底）。
- `grant.invalidated`（共享面，P4）= 可见集失效，按派生边 re-scope；可见集解析 API `GET /platform/sharing/visible-set?workspace_id=&product=`（鉴权同 C2/C3）。

---

## 5. 值域（value domains）

**唯一权威 = `@vxture/shared`**（`^1.2.2`+，现最新 `1.3.1`；导出即 DB CHECK 值域）。可选 `npm i @vxture/shared`（配 `.npmrc`：`@vxture:registry=https://npm.pkg.github.com` + 具 `read:packages` 的 token）直接 import；不加依赖则按下表手写同名同值（[`product_220`](../../30-design/product_220_catalog-resource-model.md) §3）。

| 导出 / 类型                                    | 取值                                                                                                         | 用于                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `TIERS` / `Tier`                               | free < starter < pro < business < enterprise                                                                 | `tier`（五档，无第六）                                                                      |
| `SUBSCRIPTION_STATUSES` / `SubscriptionStatus` | active, trialing, overdue, suspended, expired, cancelled（`@vxture/shared@1.4.0` 六值，数组顺序=代表优先级） | `status`（+ `null`=从没订过；arda 侧枚举须补齐 `suspended`+`overdue` 全集）                 |
| `COMPONENT_ROLES` / `ComponentRole`            | primary, bundled                                                                                             | plan 组件角色（平台侧；arda 只读顶层 `bundled` 布尔）                                       |
| `METRIC_KINDS` / `MetricKind`                  | counter, gauge                                                                                               | 决定走 consume（counter）还是 gauge（PUT）                                                  |
| `CONSUME_MODES` / `ConsumeMode`                | divisible, atomic                                                                                            | counter metric 的扣减模式                                                                   |
| `MERGE_STRATEGIES` / `MergeStrategy`           | max, union, pool, tiered                                                                                     | 平台侧合并策略（arda 无需实现；v2 起仅 max 键出现在 `limits`，union/tiered 功能键不再下发） |

**metric key 清单**（本产品 v1）：`storage.bytes`（gauge）、`ai.credit`（counter/atomic，L0）、`service.api.call`（counter/divisible）、`quality.check.run`（counter/divisible）。

---

## 6. 版本与上游权威

| 面                        | 权威文档                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 三通道对接契约            | [`product_200_integration.md`](../../30-design/product_200_integration.md)（§7 = 接入 checklist/验收清单）                             |
| 目录·权益·资源模型        | [`product_220_catalog-resource-model.md`](../../30-design/product_220_catalog-resource-model.md)（C2 契约 v2、L0 资源、消费方义务 §9） |
| 订阅·权益引擎             | [`ADR-11-subscription-entitlement-design.md`](../../30-design/decisions/ADR-011-subscription-entitlement-design.md) §11.7              |
| C1 RP 通则 + webhook wire | [`identity-platform-rp-integration.md`](../../30-design/identity/080-rp-integration.md)（§5 = webhook）                                |
| gauge 计量                | [`data_commerce_240_usage-gauge.md`](../../30-design/data_commerce_240_usage-gauge.md)                                                 |
| 值域                      | `@vxture/shared`（catalog value domains）                                                                                              |
| 最终义务 + 决策留痕       | [`arda_300_integration-final.md`](./40-arda_300_integration-final.md)（产品侧义务清单 + 架构级决策防回退）                             |

> 变更纪律：接口的实质变更（新端点/字段/值域/鉴权方式）→ 升本文与 handoff 版本；架构级决策（含被否决方案）落 arda_300 §2。
