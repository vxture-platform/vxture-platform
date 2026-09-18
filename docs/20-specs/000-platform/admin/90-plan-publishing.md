# 套餐发布台（产品 × 五档矩阵）

> 状态：已实现（2026-09-01）。页面 `/plan-versions`（菜单码 `plan_version` 不变，label 改「套餐发布」）。
> 端点契约速查见 `docs/40-implementation/packages/bff/10-admin.md`；数据模型见 `deploy/database/ddl/40_product.sql`（§7 版本冻结触发器）。

## 1. 为什么重构

旧「套餐版本」页是方案下拉 + 版本按钮列 + 裸编辑器，三件事它都回答不了：

1. **平台是多个产品的发布**——运营看不到「哪个产品发布了哪些套餐」，入口是一张不分产品的 plan 平铺表；
2. **每个产品至多五档（可少）**——tier 概念完全不在页面上，档位占用、缺档、同档撞车都不可见；
3. **plan_version 要清晰可查**——版本列表是一排按钮，无日期轴、无当前指针语义、发过 v1 之后**再也开不出 v2**（锁冲突报错让人 "open a new draft version"，但那个端点从未存在——#96 也记过 admin 没有新建套餐入口）。

## 2. 信息架构

```
套餐发布
├─ 发布矩阵（页面主体）
│    行 = 每个 standalone_subscribable 产品（atlas/runos 等基础设施产品不列：
│          它们只作 bundled 组件进入别人的版本）
│    列 = 五档商业阶梯 free / starter / pro / business / enterprise（TIERS 权威值域）
│    格 = 该产品该档的套餐：当前发布版 vN + 价格 + 在途草稿标记
│         空格 = 未发布档（可少不可多），带「新建套餐」入口
│         同档多套餐（历史遗留）= 警示徽章显形
└─ 版本史（点选套餐后展开）
     v1…vN 时间线：状态（草稿/已发布/当前）、价格、创建日期
     草稿 → 编辑价格/配额/bundled 组件 → 发布（step-up，冻结 + 设为当前）
     已发布 → 只读；「开新草稿版本」自当前版本克隆（components + prices + trial）
```

套餐轴（产品 × 档位）的解析规则：**当前版本的 primary 组件**，未发布骨架回退到最新版本——draft-only 套餐必须占格可见，`/releases` 只见已发布版所以不够。

## 3. 五档纪律的三道门

| 门   | 位置                              | 规则                                                                                     |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| 值域 | DDL `chk_plan_components_tier`    | tier 只能是五档之一（`@shared` TIERS，lint:catalog-domains 锁 DDL 一致）                 |
| 建档 | `POST /plans`                     | 同产品同档已有非 deprecated 套餐（草稿骨架也算占格）→ 409                                |
| 发布 | `POST /plan-versions/:id/publish` | 同产品同档已有**其他套餐的当前发布版** → 409（先退役旧套餐）；同套餐 v2 覆盖 v1 不受影响 |

## 4. 端点（全部 `platform.product.manage`）

- `GET /api/products/plan-matrix` — 矩阵读模型（一条 SQL，LEFT JOIN LATERAL 保空产品行）
- `POST /api/products/plans` — 空档建骨架：plan + v1 草稿 + primary 组件一个事务；不 step-up（发布前不可售，发布才是危操作）
- `POST /api/products/plans/:planId/versions` — 开下一个草稿（克隆；每套餐同时至多一个在途草稿，否则「那个草稿」对每个编辑端点都歧义）
- 既有 `PATCH /plan-versions/:id`（草稿价格/配额）、`PUT …/bundled-components`、`POST …/publish`（step-up）不变，publish 加档位守卫
- `DELETE /api/products/plan-versions/:versionId` — 删草稿（step-up；只放行 `draft AND NOT is_locked`；`plan_versions` 无 `deleted_at` 故为物理删；事务内复核「恰好是 current」）
- `GET /api/products/plans/:planId/deletable` — 可删性预检（只读，**不** step-up；`deletable` + `blockers[]` + 三个计数）
- `DELETE /api/products/plans/:planId` — 软删套餐（step-up；要求 `confirm=true`；事务内 `FOR UPDATE` 后复核判据挡 TOCTOU）
- `POST /api/products/plans/:planId/deprecate` — 退役一档（step-up；让开档位占用）
- `GET /api/products/products/:productCode/metric-options` — 配额候选（平台键 + 该产品自有键，带归属标注）
- `plan-matrix` 加 `?include=deprecated`——默认收起已退役的套餐；开关写成 `($1::bool OR p.status <> 'deprecated')` 的**静态**形态（SQL 一插值 `lint:anchor-writes` 就抽不到列名、当场变瞎且恒绿）

> **所有删除都挂 step-up**（owner 2026-09-18），包括删草稿——它看着「发布前不可售、删了无害」，但闸门是给**动作**挂的，不按后果轻重分级。上面 `POST /plans` 那条「不 step-up（发布前不可售）」的理由**不可外推到删除**。预检是只读路由，不 gate。

> **两个 `subscriptionCount` 口径不同，别互相套用**：版本列表里那个只数**还钉着的**（`deleted_at IS NULL`），用来把「当前在售 / 仍在服务 / 已停用」分开呈现；删除判据那个问的是**卖过没有**（不滤 `deleted_at`）。

审计线：`product.plan.create` / `product.plan_version.create` / `product.plan_version.delete` / `product.plan.delete` / `product.plan.deprecate` 汇入既有 `support.audit_logs`（与 `product.plan_version.bundled.replace`、`product.solution.*` 同线）。

## 5. 刻意不做

- **不建 release 表**（`/releases` 注释的裁定不变：能发布出去的只有版本）；
- **不做第二套定价模型**——矩阵格里的价格就是 plan_version 的 plan_prices；
- **不迁移旧路由**——`/plan-versions` 路径与菜单码 `plan_version`（已入权限树）保持不动，改的是 label 与页面本体；
- **同档多套餐不硬清**——历史数据显形为警示，收敛动作（弃用旧套餐）由运营决定。
