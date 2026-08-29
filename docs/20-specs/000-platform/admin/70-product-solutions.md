# 解决方案与服务套餐：去 mock 后的模型与接口（admin · product）

> 状态：v1.0（2026-08-31，owner 2026-08-30 裁定「上线前 admin 产品板块必须全部接活库」，推翻 TD-029 的"先不建表"）。
> 实现：`bff/admin-bff/src/routers/products.router.ts`；DDL `deploy/database/ddl/40_product.sql`（solutions 三表）+ `98_column_locks.sql`；迁移 `deploy/database/migrations/2026-08-31-product-solutions.sql`；门户 `portals/admin/src/modules/products/{ProductSolutionsPage,ProductSolutionDetailPage,ServicePlansPage,ServicePlanDetailPage}.tsx`。
> 起因：`GET /api/products/{solutions,solutions/:code,service-plans/:code/:tier,releases,model-policies}` 五个端点自 2026-04 起返回内存 mock（时间戳恒 `2026-04-25`，计数按 0.35/0.5/0.15 的比例编出来），admin「解决方案」「服务套餐」「首页产品供给」「模型授权」四处展示的是虚构数据，与真实目录（arda/ruyin/umbra/runos/…）脱节。TD-029 登记时的判断是"无表可接，先出设计"；本文就是那份设计，随实施一并落地。

---

## 1. 原则

1. **方案是运营写出来的内容，不是 seed。** 新库、新环境的 `product.solutions` 是空表，admin 列表显示「还没有方案，新建一个」——这是正确态，不是缺数据。
2. **服务套餐不是第二套定价模型。** 一个服务套餐 = 既有 `product.plans` 绑到方案的某个档位。价格、版本、组件、配额都是 plan 自己的（`plan_versions / plan_prices / plan_components`），方案只记「哪一档 → 哪个 plan」。
3. **档位就是五档商业阶梯**（`@vxture-platform/shared` `TIERS`：free < starter < pro < business < enterprise，product_220 §1）。2026-07-08 曾裁定方案档位（free/pro/enterprise/custom）与阶梯是两个概念——那是 mock 时代的展示轴；现在方案档位与 `plan_components.tier` 同源，`lint:catalog-domains` 强制两条 CHECK 与 @shared 一致。
4. **计数只报真的。** 订阅数、租户数、MRR 全部从 `metering.subscriptions` 按绑定 plan 归集；算不出来的（没有价格行、不是启用中）计 0，不用比例凑。
5. **状态机与产品目录同形**：`draft → active ⇄ inactive`，任一 → `deprecated`（终态）。守卫在 BFF（`SOLUTION_STATE_TRANSITIONS`），门户的动作菜单只是它的镜像。

## 2. 对象模型

```
product.solutions (id, solution_code UNIQUE, solution_name, industry, scenario, customer_segment,
                   owner_team, tags[], delivery_mode, delivery_boundaries[], status, is_public, …)
   │ 1                                   │ 1
   │ n                                   │ n
product.solution_products                product.solution_plans
  (solution_id, product_id, role, sort)    (solution_id, tier ∈ TIERS, plan_id UNIQUE)
   │                                       │
   ▼                                       ▼
product.products                        product.plans ──▶ plan_versions ──▶ plan_prices / plan_components
                                                               ▲
                                                metering.subscriptions.plan_version_id
```

| 表                          | 主键                        | 约束                                                                                              | 说明                                                                                      |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `product.solutions`         | `id` uuid                   | `uq_solutions_solution_code`；`chk_solutions_status`（draft/active/inactive/deprecated）          | 方案本体。`is_public` 投影为 admin 的 visibility（public/internal）；软删 `deleted_at`    |
| `product.solution_products` | `(solution_id, product_id)` | FK→solutions（CASCADE）、FK→products                                                              | 方案包含哪些产品能力；`role` 是展示文案（该产品在方案里干什么），`sort` 排序              |
| `product.solution_plans`    | `(solution_id, tier)`       | `uq_solution_plans_plan_id`；`chk_solution_plans_tier`（五档）；FK→solutions（CASCADE）、FK→plans | 一方案一档至多一个 plan；一个 plan 至多绑一处——订阅与收入按 plan 归到唯一方案，计数不重叠 |

列锁（98_column_locks.sql）：三表锚点 = PK / `created_by` / `created_at`；`solution_plans` 只有 `plan_id` 可改（换绑）。跨 schema FK：无。触发器：无。

## 3. 读接口（`platform.product.manage`）

| 接口                                          | 返回                             | 口径                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/products/solutions`                 | `ProductSolutionRecord[]`        | `deleted_at IS NULL`；`products[]` 经 solution_products→products（`product_type`→展示类型，`origin='third_party'`→`source=partner`）；`tiers[]` 经 solution_plans→plans（`tierName`=plan_name，`status`=plan.status，`priceLabel` 见 §5）；三计数见 §4 |
| `GET /api/products/solutions/:solutionCode`   | `ProductSolutionDetailRecord`    | 列表行 + `deliveryMode` / `deliveryBoundaries[]`（列）+ `relatedServicePlans[]`（= tiers）                                                                                                                                                             |
| `GET /api/products/service-plans/:code/:tier` | `ProductServicePlanDetailRecord` | 绑定 plan → 取版本（优先 `plans.current_version_id`，否则已发布最新版，否则最新版）→ 价格（§5）、`entitlements[]`（该版本组件 = included，quota JSON 紧凑渲染；方案里有但组件里没有的产品 = excluded）；计数按该 plan 全部版本归集                     |
| `GET /api/products/releases`                  | `ProductReleaseRecord[]`         | 见 §6                                                                                                                                                                                                                                                  |

## 4. 计数定义（MRR）

三处共用同一段 SQL（`products.router.ts` `MRR_MONTHLY_EXPR` / `SOLUTION_COUNTS_CTE`）：

- **subscriptionCount**：绑定 plan 任一版本上、`status IN ('active','trialing')`、未软删的 `metering.subscriptions` 行数。
- **activeTenantCount**：上述订阅 `DISTINCT tenant_id`。
- **monthlyRevenue（MRR）**：只计 `status = 'active'` 的订阅（trialing 尚未付费，不进收入；expiring/overdue/suspended/expired/cancelled 也不计）。价格取该订阅所钉版本（`s.plan_version_id`，版本冻结即当初购买价）上与订阅**同周期**（`cycle_unit` / `cycle_count` / `currency`）的 `plan_prices.price`，按周期折到月：

  | cycle_unit  | 月度折算                           |
  | ----------- | ---------------------------------- |
  | `month`     | `price / cycle_count`              |
  | `year`      | `price / (12 × cycle_count)`       |
  | `week`      | `price × 52 / (12 × cycle_count)`  |
  | `day`       | `price × 365 / (12 × cycle_count)` |
  | `perpetual` | 0（一次性买断不是经常性收入）      |

  找不到同周期价格行 → 0（不拿别的周期凑）。按面值相加、不做币种换算（目前只有 CNY；多币种出现时要先分币再合）。结果保留两位小数。

## 5. 价格标签

与 `/plans` 端点同一取法：版本上的价格行按「月付优先，其次周期数最小」取一条。

- 无价格行 → `priceLabel = 合同报价`，`periodType = contract`，`price = null`；
- 价格 0 → `免费`；
- 否则 `¥x / 月|年|N 个月|…`，`periodType` 由 `cycle_unit` 投影（daily/weekly/monthly/yearly/perpetual）。

`originalPrice` 恒 `null`——`plan_prices` 没有划线价一列，字段留着只是形状兼容。`ProductSolutionTier.priceKind ∈ {free, paid, contract}` 给筛选用，不要拿 `priceLabel` 去匹配。

## 6. 「产品发布」现在是什么

`product` schema 里没有、也不建 release 表：能"发布"给客户的东西只有 `plan_versions.status = 'published'` 的那一行（组件、配额、价格随之冻结）。所以：

- 一条 `ProductReleaseRecord` = 一个已发布 plan_version；产品 = 该版本 `component_role = 'primary'` 的组件所指产品（没有 primary 组件的版本不是任何产品的发布，直接滤掉）；
- `releaseCode = ${plan_code}@v${version_no}`，`releaseName = plan_name`，`versionLabels = primary 组件的档位`，`isCurrent = plans.current_version_id 指向它`，`isActive = plan.status = 'active'`；
- `releaseType = custom ⇔ products.origin = 'third_party'`（首页"三方产品"就按这个数，不再按产品码里含 partner/provider/third 去猜）；
- `isFree = 有价格行且全为 0`（没有价格行 = 不可售，不算免费）；`prices[].originalPrice` 恒 null；`features[]` = 组件（`code` = product_code，`type` = quota JSON 有数值则 quota 否则 function，`config` = quota 原样，`isUnlimited` = 任一值为 -1）。
- 删掉的字段：`productRegion`（平台没有地域这根轴）、`allowedAgents`（无来源）。

## 7. 写接口（`platform.product.manage`；RW 池 + 事务 + `support.audit_logs`）

| 接口                                               | 语义                                                                                         | 校验 / 错误                                                                                                                                          | 审计 action                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `POST /api/products/solutions`                     | 新建，`status = 'draft'`                                                                     | `solutionCode` kebab（`^[a-z0-9]+(?:-[a-z0-9]+)*$`，≤64）；`solutionName` 必填 ≤128；重码 409                                                        | `product.solution.create`           |
| `PUT /api/products/solutions/:code`                | 改字段；**只更新送来的键**（表单只编辑基础资料时不会把交付边界清空）                         | 一个可改字段都没送 → 400；长度上限见 `readSolutionFields`                                                                                            | `product.solution.update`           |
| `PATCH /api/products/solutions/:code/state`        | 状态迁移：`draft→active`、`active⇄inactive`、任一→`deprecated`（终态）                       | `FOR UPDATE` 锁行；同态重放不报错不写库；非法迁移 409（消息里列出允许的目标态）                                                                      | `product.solution.state`            |
| `PUT /api/products/solutions/:code/products`       | 整体替换产品清单：`[{productId \| productCode, role?, sort?}]`（也接受 `{products: [...]}`） | 任一产品解析不到（或已软删）→ 400；同产品去重；≤64 项                                                                                                | `product.solution.products.replace` |
| `PUT /api/products/solutions/:code/plans/:tier`    | 绑定 / 换绑：`{planId \| planCode}`                                                          | `tier ∈ TIERS`；plan 不存在或已软删 → 404；plan 已绑在别的方案/档位 → 409（`UNIQUE (plan_id)` 在并发下兜底）；`ON CONFLICT (solution_id, tier)` 换绑 | `product.solution.plan.bind`        |
| `DELETE /api/products/solutions/:code/plans/:tier` | 解绑                                                                                         | 该档没绑 → 404                                                                                                                                       | `product.solution.plan.unbind`      |

写路径全部返回最新的 `ProductSolutionDetailRecord`，门户直接替换本地态。resource_type 一律 `product_solution`，resource_id = `solution_code`（可视码，不是 UUID）。step-up：本轮**未**给方案写路径加 `@RequireStepUp`——它们不动价格、不动订阅，可逆或有确认框；plan 发布仍是唯一的 step-up 点。

## 8. 门户

| 页                           | 读                                                         | 写                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/product-solutions`         | 列表 + 四个筛选 + 真实计数卡                               | 「新建方案」DialogForm（建草稿后跳详情）；行菜单：启用 / 停用 /（确认框）退役                                                         |
| `/product-solutions/:code`   | 概要 + 基础资料 / 适用行业 / 产品 / 交付边界 / 五档套餐    | 「修改」DialogForm（含标签、交付模式、交付边界、是否公开）；「配置产品」（目录勾选 + 角色）；每档「绑定 / 换绑 / 解绑」；页头状态菜单 |
| `/service-plans`             | 方案 × 已绑档位；筛选：套餐状态 / 价格类型 / 可见性 / 行业 | 无（绑定在方案详情，价格配额在 `/plan-versions`）                                                                                     |
| `/service-plans/:code/:tier` | 价格、版本、组件权益、计数                                 | 无                                                                                                                                    |

空态分三种说法：读不到（Banner + 警示空态）、一个方案都没有（引导新建）、有方案但没绑套餐（引导去方案详情绑定）、筛选没命中（清空筛选）。文案全部经 `t()`（`productCatalog` / `productSolutionsPage` / `productSolutionDetailPage` / `servicePlansPage` / `servicePlanDetailPage` 五个命名空间，zh-CN / en-US）。

## 9. model-policies 去哪了

`GET /api/products/model-policies` 退役、`ProductModelPolicyRecord` 类型删除。它返回的是一份内存里编出来的「未定义 → 默认不授权」占位表。真实的模型策略是 Atlas 的（`GET /api/atlas/policies`，`atlas.router.ts` 代理并做契约断言）：

- `/model-grants` 页改读 Atlas `ModelPolicyRecord`（策略名 / 平台或租户范围 / 模型 / 速率三维 / 优先级 / 生效窗口），只读；新建编辑在 `/atlas`；
- 原「未定义策略」计数换成一个真实的对账：**有授权、无策略** = 启用中的租户授权里，没有任何一条启用策略（平台级或该租户级、同模型）覆盖到的——第三张统计卡 + 覆盖授权表的「策略覆盖」列；
- 首页「策略覆盖」卡改按 Atlas 策略的 `state` 计启用数。

## 10. 不在本轮范围

- 订阅记录到方案的反向关联（`SubscriptionSolutionAssociation.solutionCode` 仍为 null）：可经 `solution_plans` 反查，留待订阅页改造时一并做。
- 多币种 MRR。
- 方案的软删接口（`deleted_at` 列已备，退役用 `deprecated` 终态即可）。
