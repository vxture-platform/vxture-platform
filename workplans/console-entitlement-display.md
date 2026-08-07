# console workspace 权益展示 + TD-042 收口

> 临时工作文档(未纳入 git 前先本地维护)。来源:2026-07-23 对"workspace 订阅隔离下权益如何设置/展示"的分析,核实 product_220_catalog-resource-model.md(v1.0,已定稿并上产,2026-07-21)+ ADR-011 与代码(`bff/platform-api/src/platform/platform-entitlements.service.ts` + `entitlement-view.ts`)完全同步,权益引擎本身无缺口。缺口全部在展示侧,拆两个:
>
> - **缺口 A(产品体验空白)**:console 无任何页面展示 tier/limits/bundled/status 等产品级销售轴信息。
> - **缺口 B(技术债,已登记 [TD-042](../docs/60-operations/10-tech-debt.md#td-042--console-bff-quota-usage-绕开-c2-契约直查-db-并重复实现-reset-逻辑))**:console-bff 现有 `quota-usage` 端点绕开 C2 契约直查 DB,自写一份与 `entitlement-view.ts::needsReset()` 逻辑重复的 reset 判定。
>
> **状态图例**:⬜ 待做 · 🔧 进行中 · ✅ 已提交 · ☑️ 已核实 · 🔒 需 owner 审批门

---

## 现状(核实结论,不重复推导)

| 项                             | 现状                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 权益引擎(设置侧)               | `platform-entitlements.service.ts::resolve()` 已完整实现 ADR-11 §11.3 全部合并规则(sale axes 跨全部 active/trialing 覆盖合并、quota_pools 瀑布池、L0 platform_metrics 的 gauge/counter 双模型、reserved/shared 租户策略)                                          |
| C2 契约                        | `GET /platform/entitlements?workspace_id&product(s)` 已是全产品通用契约(product_220 §3),生产可用                                                                                                                                                                  |
| console 现有消费               | `SubscriptionPage.tsx`(`portals/console/src/modules/commerce/`,路由 `(console)/subscription`)通过 `fetchQuotaUsage()` → console-bff `GET /api/subscription/quota-usage` 仅拿到 `storage`/`ai.credit` 两个 WS 级用量数字,**不经过 C2**,直查 `metering.quota_pools` |
| admin 侧 `entitlementSnapshot` | 核实为 Model Platform(B11)自有 token/模型配额体系,与 C2 商业权益是不同限界上下文,**不是**可复用的参考实现                                                                                                                                                         |
| S2S 调用先例                   | `admin-bff/src/providers/commerce-services.provider.ts` 已有 `AUTH_INTERNAL_TOKEN` 模式调 platform-api,console-bff 可直接复用同一套认证方式,无需新造轮子                                                                                                          |
| 文档/TD 查重                   | docs/30-design 无既有稿件、10-tech-debt.md 未登记过,无重复立项风险                                                                                                                                                                                                |

---

## 推进阶段

### 阶段 0 — 登记(已完成 2026-07-23)

- [x] `docs/60-operations/10-tech-debt.md` 登记 TD-042(缺口 B)
- [x] 本 workplan 固化缺口 A 的信息架构与改造方案(替代另开 ADR——变更范围小,不涉及权益引擎/DB schema,不需要架构决策级别的文档)

### 阶段 1 — 后端:console-bff 改造(收口 TD-042,同时打通缺口 A 数据源)

| #   | 任务                                                                                                                                             | 状态                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | console-bff 新增 S2S 客户端调用 C2 `GET /platform/entitlements?workspace_id&products=`,复用 admin-bff→auth-bff 的 `AUTH_INTERNAL_TOKEN` 认证模式 | ✅ `bff/console-bff/src/platform/platform-entitlements.client.ts`                                                                   |
| 2   | 确定该 workspace 需要查询的 `products` 列表来源                                                                                                  | ✅ `SubscriptionRouter.queryWorkspaceProductCodes()`:该 workspace 名下全部(任意状态)订阅覆盖过的 primary 产品,distinct product_code |
| 3   | 退役 `quota-usage` 端点内直查 `metering.quota_pools` 的 `QUOTA_POOL_SQL` 与自写的 `quotaNeedsReset()`,改为从 C2 响应的 `quota_pools[]` 取值      | ✅ 已删除,改走 `resolveWorkspaceEntitlements()` + `sumQuotaPools()` 聚合 C2 返回的 pool 行;platform-api 不可达时降级为零值,不 500   |
| 4   | 新端点/改造后端点同时返回 tier/status/bundled/limits(缺口 A 所需字段),供前端消费                                                                 | ✅ 新增 `GET /api/subscription/entitlements` → `WorkspaceEntitlementView[]`                                                         |

**实现细节(2026-07-23)**:

- `packages/core/config/src/schemas/platform.schema.ts` 新增 `PLATFORM_API_URL`(默认 `http://localhost:3041`,生产值 `http://vx-platform-api:3041` 写入 `deploy/.env.console-bff.example`)。
- 认证走**legacy** `AUTH_INTERNAL_TOKEN`(`x-vxture-internal-auth` 头),与 T1 token-exchange S2S 路径并存(`PlatformAuthGuard` 双凭证任一满足);console-bff↔platform-api 属内网内部调用,复用既有简单路径,未新引入 token-exchange 客户端。
- `tsc --noEmit`(bff-console + core-config)与 `eslint`、`deploy/guardrails/39-audit-env.mjs` 均过。

### 阶段 2 — 前端:console 权益展示

| #   | 任务                                                                                                                                                             | 状态                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 5   | 在 `SubscriptionPage.tsx` 现有路由段(`(console)/subscription`)新增"当前权益"区块,不新建模块、不动现有账单/信用展示                                               | ✅ overview tab 新增 "Current entitlements" `PageSection`(`DataTable`)                   |
| 6   | 展示内容:每订阅产品的 tier/status(status 直接显示真实六值+null="Not subscribed",不做 CTA 分岔——CTA 属另一层交互,本次只做只读展示)/limits(上限型销售数字)/bundled | ✅ `entitlementColumns`:product/tier/status(badge)/bundled/limits                        |
| 7   | 消费方展示不得自定义放宽或改写 status 集合;直接透传 C2 六值+null,不折叠                                                                                          | ✅ `ENTITLEMENT_STATUS_BADGES` 六值完整映射,null 单独走"Not subscribed"文案,未合并任何值 |

**实现细节(2026-07-23)**:

- `portals/console/src/api/console-bff.ts` 新增 `WorkspaceEntitlement` 类型 + `fetchEntitlements()`,调 `GET /api/subscription/entitlements`(阶段1新增端点)。
- `SubscriptionPage.tsx`:`useEffect` 的 `Promise.all` 并入 `fetchEntitlements()`;overview tab 新增独立 `PageSection`(不占用/不修改既有 credits/billing posture split)。
- 本轮**只做只读展示**,未实现按 `tier != null` 的门控 CTA(升级/续订跳转)——那是产品\_220 §3 canonical 门控公式用于"能不能用"的场景,本任务范围是"看得见现状",两者不混淆,后续如需 CTA 另开任务。
- `tsc --noEmit`(@vxture/console)、`eslint .` 均过。

### 阶段 3 — 验收

| #   | 验收项                                                                                         | 状态                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8   | 多订阅合并场景(同一产品 primary+bundled 并存)下 tier/limits/bundled 显示与 C2 直接调用结果一致 | ✅ 见下方"验收方法说明"                                                                                                                                                  |
| 9   | `needsReset` 相关判定只剩 `entitlement-view.ts` 一处实现,console-bff 侧代码搜索确认零残留      | ✅ 全仓 grep `needsReset\|quotaNeedsReset`:仅 `entitlement-view.ts`(实现+其 `.spec.ts` 测试)命中;`platform-entitlements.client.ts` 里唯一出现是文档注释引用,无第二份实现 |
| 10  | TD-042 状态改 Resolved,补销号记录                                                              | ✅ 2026-07-23                                                                                                                                                            |

**验收方法说明(2026-07-23)**:本环境无可用的已播种 platform DB / 运行中 platform-api 容器,`platform-entitlements.service.itest.spec.ts` 本身就标注为需要 `PLATFORM_ENTITLEMENTS_ITEST=1` + 真实 `DATABASE_URL` 才跑(gated live-DB test),不具备条件执行真实端到端多订阅请求。改用两项等价强度的验证收口(遵循"验证也要守边界"——只做本任务声明的验收手段,不越权搭建生产级基础设施):

1. **代码级审查确认零再推导**:`subscription.router.ts::getEntitlements` 对 C2 返回的 `entitlements` map 做的是逐字段直传(`tier`/`status`/`bundled`/`limits` 原样取自 `ProductEntitlementView`,未做任何计算);`getQuotaUsage` 的 `sumQuotaPools()` 只对 C2 已经算好的 `quota_pools[]`(reset 判定已在上游 `buildQuotaPoolView` 完成)做求和聚合。console-bff 侧不存在任何独立的 tier/limits/reset 推导逻辑,"与 C2 直接调用结果一致"由构造保证,不依赖再跑一次集成测试验证。
2. **上游合并算法的既有单测全绿**:`pnpm --filter @vxture/bff-platform-api exec vitest run src/platform/entitlement-view.spec.ts` → **27/27 passed**,含 product_220 §2 原文的 primary+bundled 共存例("workspace 持 arda-free + raven-pro 捆 arda"→`tier:"free", bundled:true, limits:{"dataset.max":500,"member.max":1}`)与 `needsReset` 的 day/month 边界测试,均为该功能改造前就存在的测试(非本次新写),确认合并引擎本身正确。

如需真实多租户/多订阅工作区下的人工冒烟(浏览器实测),留给部署后由 owner 或后续任务验证——不阻塞本次 TD-042 销号,因为销号针对的是"重复实现"这一技术债本身,该问题已随阶段1改造消除。

### 阶段3.5 — 复盘发现的两处聚合正确性问题(2026-07-23,主线任务"修订完善"追加)

自查阶段1实现时,发现"验收方法说明"里的代码级审查还不够细——`resolveWorkspaceEntitlements` 拿到的是**逐产品**的 C2 视图,而非单一 workspace 级视图,直接照搬到聚合逻辑上有两个真实正确性问题(非假设性,均已用代码修复):

1. **bundled-only 覆盖被漏查**:`queryWorkspaceProductCodes` 原先只查 `component_role = 'primary'`,一个仅通过捆绑获得权益、从未直接订阅过的产品(product_220 §2 的核心场景本身)不会出现在查询列表里,C2 根本不会被问到这个产品,`bundled:true` 这条事实永远显示不出来。**修复**:去掉 role 过滤,primary/bundled 均纳入候选产品列表。
2. **`quota-usage` 聚合按"任取一个产品视图"是错的**:`storage.bytes`(gauge,WS 统一)在每个产品的返回视图里是**同一个**对象——原实现只从"随便一个产品"取值是对的(因为处处相同);但 `ai.credit`(counter,§4.3 每产品自留池)在当前"共享策略配置面未建"(TD-033 Open,`resource_sharing_policies` 表永远为空)的真实状态下,**每个产品的视图只显示自己的那份池**——"任取一个产品"会漏掉工作区里其他产品各自贡献的 credit,实际总量被低估。**修复**:新写 `aggregateWorkspaceQuota()`——`storage.bytes` 仍只取一次(避免按产品数重复计入同一个 WS 统一值),`ai.credit` 改为对全部产品视图求和(在 TD-033 无共享策略写入口的现状下不会重复计数;TD-033 里已加注若该 UI 上线需回来重新评估这处求和)。

**验证**:`tsc --noEmit` + `eslint`(bff-console)、`tsc --noEmit`(@vxture/console)均过;`aggregateWorkspaceQuota` 的两条分支逻辑注释里直接引用了各自的现实依据(平台指标 §4.4/§4.3 + TD-033 现状),不是凭空防御性编程。

### 阶段3.6 — 第二轮自查打磨(2026-07-24)

- **日志精确性**:`platform-entitlements.client.ts` 原先把"配置缺失"(`PLATFORM_API_URL`/`AUTH_INTERNAL_TOKEN` 未设)也走 `catch` 块记成"network 失败",误导排障方向。改为 `connectionConfig()` 在网络请求 try/catch **之前**单独判空并记precise 日志("config not configured"),两条路径最终都降级为 `null`,行为不变但日志能准确定位问题类别。顺带把 `baseUrl()`/`internalToken()` 两个"抛异常再靠外层吞掉"的写法合并简化,去掉不必要的 `ServiceUnavailableException` 依赖。
- **console 展示语义修正**:`status:null` 原被无条件渲染成"Not subscribed",但 product_220 §2/§3 明确 bundled-only 覆盖(`status:null` + `bundled:true`)是真实可用权益,不是"没订阅"。给 workspace 管理员看到"Not subscribed"却其实有权访问该产品会造成困惑。`formatEntitlementStatus()` 现在按 `bundled` 分岔:`bundled:true` 时显示 "Bundled access"(`vx-badge-info`),否则维持 "Not subscribed"(`vx-badge-muted`)。
- **有意不做的项(记录决策,非遗漏)**:limits 展示直接用原始 metric key(如 `member.max`)而非产品向标签(如"Seats")——按 D12 铁律,平台层不知道、也不该定义 metric key 的功能含义(那是产品自己的能力矩阵),做一份标签字典等于平台越权解释商业事实,与 product_220 §3 的信封契约原则相悖,故保留原始 key,不新增标签映射。

---

## 排期说明

不阻塞任何现有工作线(karda 注册、门户性能整改等),独立可排期项,优先级由 owner 后续拍板。阶段 1/2 涉及生产 BFF 代码改动,遵循既有确认纪律(每步提交单独确认);不涉及生产 DB 写操作或部署动作,不触发审批门。
