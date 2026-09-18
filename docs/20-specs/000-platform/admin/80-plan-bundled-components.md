# 套餐版本的捆绑组件：基础设施配额怎么进池（admin · product）

> 状态：v1.1（2026-09-17）。**裁定已换代，写接口与约束不变，变的是「谁能被绑」。**
>
> - **旧（owner 2026-08-30，已作废）**：「atlas / runos 是基础设施产品，不设客户套餐；它们的配额只能经订阅产品套餐版本里的 bundled 组件进入工作区」。
> - **新（owner 2026-09-17）**：「模型和能力**不再绑定**，这是基础支撑能力 L1；绑定的是 arda、karda 这些 **L2**；vxtpl 是 L3，**L3 不绑定**（指不能*被*绑——L3 自己的套餐仍可绑 L2）」。
>
> 换代的理由不是偏好，是 L1 的额度本来就不走这条路：`ai.credit` 登记在 `product.platform_metrics`（平台级度量键），而 `95_triggers.sql` 的 `trg_product_metrics_no_platform_shadow` 明确禁止任何产品在自己的 `product_metrics` 里声明平台已有的键。套餐里写一行 `ai.credit` 配额 → 进平台级池 → atlas 消费时扣，**全程不需要把 atlas 当成一个 bundled 组件**。
> 实现：`bff/admin-bff/src/routers/products.router.ts`（`replaceBundledComponents` + `loadPlanVersionDetail`）；门户 `portals/admin/src/modules/products/PlanVersionsPage.tsx`「捆绑组件」区；测试 `products-bundled-components.spec.ts`。
> 模型权威：`docs/30-design/product_220_catalog-resource-model.md` §2（role 轴）/ §4.2（burn 顺序）；DDL `deploy/database/ddl/40_product.sql`（`plan_components` 三条 CHECK）+ `95_triggers.sql`（锁守卫、优先级守卫）。
> 起因：`plan_components.component_role = 'bundled'` 自 product_220 起就在模型里，`bff/platform-api` 的 C2 视图也早已按它算 `bundled` 布尔与 `quota_pools`——但 seed 只写 primary 行，admin 只有 `PATCH /plan-versions/:id`（改 primary 配额）和 `publish`，**没有任何入口能给一个版本挂上 bundled 组件**。裁定落地后这就是唯一的缺口：宿主套餐要把**被绑 L2 产品**（arda / karda / terra）的后台能力带给客户，运营却无处可配。（v1.0 时这里写的是「把 atlas、runos 的配额带给客户」——那随 2026-08-30 那条裁定一并作废。）

---

## 1. 原则

1. **捆绑件长在宿主套餐版本里，不在被捆绑产品自己那边。** product_220 §2 钉死：谁拥有 plan，谁配它的 bundled 支撑件；被绑产品（arda / karda / terra）不 seed 自己的 bundled 行、也不感知谁捆了它，只消费 C2 合并结果。所以入口挂在「套餐版本」页，而不是产品目录页。
2. **bundled 不是 free，也没有档位。** 它的价值折在宿主产品定价里；`tier` 恒 `NULL`（`chk_plan_components_role_tier`），它的"档位"就是 quota 里那几个数字。
3. **版本冻结规则不变。** 只有 `status = 'draft' ∧ is_locked = false` 的版本能改，与 `PATCH /plan-versions/:id` 同一判据；发布 / 锁定后要改，开新版本。
4. **一个版本一份清单，PUT 全量替换。** 与 `PUT /solutions/:code/products` 同一语义（`30-management-api.md` §1）：送什么就是什么，空数组 = 清空。没有逐条增删的端点，也没有 DELETE 路由。
5. **步进验证。** 捆绑件是售卖内容（改的是客户买到的配额），与套餐版本发布、方案绑定同一风险级 → `@RequireStepUp()`。

## 1b. 谁能被绑：按层，不按「能不能单独卖」

候选集的判据是**产品分层**（`product.products.layer`，值域权威 `@vxture-platform/shared` 的 `PRODUCT_LAYERS`，DDL `chk_products_layer`）：

| 层              | 谁                                        | 能不能被绑   | 为什么                                                                                                                    |
| --------------- | ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **L1** 基础支撑 | `atlas`（模型）、`runos`（能力）          | **不能**     | 它是底座能力，不靠套餐逐档分配；额度走平台级度量键（`platform_metrics`），见上方状态行                                    |
| **L2** 域平台   | `arda`、`karda`、`terra`                  | **能**       | 它有实打实的后台能力可以接给别人，而它自己的界面另行订阅                                                                  |
| **L3** 智能体   | `vxtpl`、raven / anlan / forge / xuanzhen | **不能被绑** | 它卖的就是那套界面，抽掉前端什么都不剩。但 **L3 的套餐可以去绑 L2**（`product_220 §2` 的 `raven-pro` 捆 `arda` 仍然成立） |

**绑定不是订阅，这是这一节的全部要害。** 绑进来的是「没有前端、用户无感」的后台能力——用户只觉得主产品变强了，并不知道底下还有个 arda；想要 arda 的界面与完整功能，得**单独订阅 arda**。两者不是同一个东西的两种数量：

|              | 绑进别人的套餐                               | 客户单独订阅                            |
| ------------ | -------------------------------------------- | --------------------------------------- |
| 用户看得见吗 | **看不见**                                   | 看得见：启动台有磁贴、有自己的入口      |
| 给的是什么   | 后台能力的额度                               | 前端界面 + 完整功能                     |
| 钱怎么算     | 价值计进主产品售价——**不是白送**             | 自己那档套餐的价                        |
| 库里怎么落   | `component_role='bundled'`，`tier` 为 `NULL` | 自己的 plan + `primary` 组件，带 `tier` |

> **已知缺陷（不在本轮范围，单独开条）**：console 启动台的磁贴查询 `HELD_PRODUCT_TILES_SQL`（`console-bff/src/lib/product-app-tiles.ts`，走 `GET /api/me/apps`）**不过滤 `component_role`**，它 join 的是 `plan_components` 的全部行。所以绑进来的产品现在**会**作为磁贴出现在用户启动台，带 `home_url`、点得进去——「用户无感」这半代码还做不到。那行注释自陈的理由是「bundled 同样是这个工作空间持有的」：**「持有」是对的，「该有前端入口」是另一回事**。判据现成，不用新字段——`entitlement.types.ts` 已经区分 bundled-only 覆盖（`status: null` + `bundled: true`），那条 SQL 加一条 `pc.component_role = 'primary'` 即可。

## 2. 写接口（`platform.product.manage` + step-up；RW 池 + 事务 + `support.audit_logs`）

**`PUT /api/products/plan-versions/:versionId/bundled-components`**

```jsonc
{
  "components": [
    {
      "productCode": "arda",
      "quota": { "dataset.max": 500, "service.api.call": 200000 },
      "features": ["dataset.read"],
    },
    {
      "productCode": "karda",
      "quota": { "karda.search": 100000 },
      "priority": 20,
    },
  ],
}
```

| 字段          | 必填 | 规则                                                                                                  |
| ------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `productCode` | 是   | 目录可视码；同一请求内不得重复（重复 = 送了两份配额，不猜哪份算数 → 400，不静默去重）                 |
| `quota`       | 是   | JSON 对象（键归属目录决定池作用域，product_220 §4）；空对象合法                                       |
| `features`    | 否   | 字符串数组 ≤64，去重；缺省 `[]`                                                                       |
| `priority`    | 否   | 非负整数；缺省 **50**。必须 **小于** 该版本 primary 组件的 priority（seed 写 100）——§7 触发器的硬约束 |

事务内顺序：`FOR UPDATE` 锁版本行 → 读 primary 组件（product_code / priority）→ 解析目录 → 读旧 bundled 集（审计 before）→ `DELETE … WHERE component_role = 'bundled'` → 逐条 `INSERT`（`tier = NULL`，`component_role = 'bundled'`，`sort_order` = 数组下标）→ 审计。任一步失败整体回滚。

| 情形                                               | 响应                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 版本不存在                                         | 404                                                                                           |
| 版本已发布或 `is_locked`                           | **409**（消息点名 `plan_code@vN` 与状态；PATCH 走的是 400，这里是「存在但状态冲突」，用 409） |
| `productCode` 不存在 / 已软删                      | **404**，响应体带 `field: "components[i].productCode"`                                        |
| `productCode` = 该版本 primary 产品                | 400（一个版本不能把自己卖的产品再捆给自己）                                                   |
| 同码重复 / `quota` 不是对象 / `priority` ≥ primary | 400（先于任何 DB 访问，或在事务内校验后回滚）                                                 |
| §7 触发器仍 RAISE（并发发布 / primary 同时被改）   | 409（`P0001` 统一映射；不是 500）                                                             |

审计：`action = product.plan_version.bundled.replace`，`resource_type = product_plan_version`，`resource_id = ${plan_code}@v${version_no}`（可视码，不是 UUID），`before` / `after` 各为 `[{productCode, quota, features, priority}]`。

返回 = `GET /api/products/plan-versions/:versionId` 同一形状（`PlanVersionDetail`），门户直接替换本地态。

## 3. 读接口的变化

`GET /api/products/plan-versions/:versionId`（`PlanVersionDetail`）新增两个字段，旧字段不动：

| 字段          | 含义                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `productCode` | primary 组件所指产品的可视码；版本没有 primary 时 `null`。门户用它把 primary 从捆绑候选里排除                                    |
| `components`  | 该版本全部组件 `[{productCode, productName, componentRole, tier, quota, features, priority}]`，primary 在前，其余按 `sort_order` |

`quota`（primary 配额的平铺）保留给既有的 `PATCH` 编辑器。

## 4. 门户

`/plan-versions` 版本编辑区新增「捆绑组件」板块（`PlanVersionsPage.tsx`，`planVersionsPage.bundled.*` 命名空间，zh-CN / en-US）：

- 列出该版本的 bundled 行：产品名 + 产品码，配额用与 primary 同款的 JSON 文本域编辑；
- 添加：下拉取 `GET /api/products/capabilities`，**按层过滤只留 `layer = 'L2'`**（active 在前）；排除版本自身的 primary 产品和已在列表里的。
  - v1.0 这里写的是「取**全目录**，不按类型过滤——atlas / runos 必须能选到」，**随 2026-08-30 那条裁定一并作废**。
  - 该端点的 `PRODUCT_CATALOG_SQL` 已回 `product_type`；`p.layer` 随**分层落库**那一批上线（PR #383 / v0.26.205，2026-09-17），前端过滤所需的字段现已齐备。
  - 写侧**已按层收口**（2026-09-18）：`resolveBundledComponents` 现在只放行 `layer = 'L2'`，L1 基础支撑（额度走平台级度量键，不当组件绑）、L3 智能体（卖的就是那套界面）、未分层一律 400 带 `field: "components[N].productCode"`。此前「界面是唯一护栏」的状态就此结束——界面过滤是体验，写侧拦截才是保证。
- 移除：行尾按钮，只改本地态；
- 「保存捆绑组件」：整表 PUT，`runWithStepUp` 包裹，取消即静默返回；成功后用返回的详情替换本地态；
- 版本已发布 / 已锁定：列表只读，添加 / 移除 / 保存全部隐藏。
- features / priority 本轮不提供编辑：已有行的值原样回送（重存不丢），新行 features 为空、priority 走服务端默认。

## 5. 不在本轮范围

- bundled 组件的 features / priority 在门户上可编辑（现只透传）。
- 从 seed 写入 bundled 行——按裁定，捆绑件是运营配置，不进 seed。
- 被捆绑产品侧（L2 产品仓）的任何改动：它们只消费 C2 视图，本轮零改动。
