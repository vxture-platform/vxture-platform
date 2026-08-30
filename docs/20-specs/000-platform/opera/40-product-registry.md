# 产品登记与接入：单一入口模型（opera · product）

> 状态：v1.0（2026-08-30，owner 口径）。
> 实现：`bff/opera-bff/src/routers/product-catalog.router.ts`（登记）· `oidc-client.router.ts`（接入凭据）· `product-health.router.ts`（服务状态）；DDL `deploy/database/ddl/22_appoidc.sql`；seed `deploy/database/seed/seed-catalog.mjs`；迁移 `deploy/database/migrations/2026-08-30-oidc-client-kind.sql`。
> 起因：运行监控「服务状态」与「产品目录」是两份清单（目录 21 个、监控 12 个，其中 5 个目录里不存在）。前者读 `appoidc.oidc_clients` 外加一份硬编码豁免名单，后者读 `product.products`。修法不是补数据，是把"谁是产品"这个问题收回到一张表、一个入口。

---

## 1. 原则

1. **`product.products` 是「平台上有哪些产品」的唯一权威**；「产品管理 · 产品目录」是**唯一登记入口**。产品的登记、改名、状态流转只在这里发生。
2. **其它业务面只读这张表**，各自只加与自身用途相符的状态过滤（§4）。不得另起清单，不得以硬编码的产品码集合代替查询，不得从别的表"推断"出一个产品。
3. **产品之外不存在"像产品的东西"**。任何以产品身份出现的对象——OIDC 客户端、套餐、webhook、计量指标、授权——都必须以 FK 挂在一个目录行上；挂不上的写不进库（§6）。
4. **seed 不是第二个入口**。seed 只被允许预置平台代码本身依赖的自有产品（§5），写出来的行与登记出来的行形状一致；规划中的产品不由 seed 预建，等定义完成后走入口登记。

## 2. 空平台起步：第一条产品怎么进来

新部署、`db-init` 跑完 DDL + seed 之后，目录里只有 §5 列出的自有产品；其余都是空的。接入一个新产品是下面这条线，**没有任何一步需要改代码或改 seed**：

| 步  | 在哪里                        | 做什么                                                                           | 之后各业务面看到什么                                                 |
| --- | ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | opera · 产品管理 · 产品目录   | 登记产品：产品码、类型、来源、名称。落 `status='draft'`                          | 目录出现草稿行；服务状态出现同一行，标「未接入」；admin 产品能力可见 |
| 2   | opera · 产品目录 · 接入检查单 | 跑上线检查：八项里七项自动判定并写回，`data_plane` / `acceptance` 人工勾（见下） | —                                                                    |
| 3   | opera · 产品管理 · 接入凭据   | 为该产品按渠道签发 OIDC 客户端（`release_channel` = stable / beta / canary）     | 服务状态该渠道开始探测；auth-bff token-exchange 能解析出 `act.sub`   |
| 4   | opera · 产品目录 · 上线       | 草稿 → 已上线（`status='active'`）                                               | console / website 目录可见；auth-bff 接受它作为 token-exchange 目标  |
| 5   | admin · 套餐 / 版本 / 方案    | 为产品建套餐并发布                                                               | console 订阅、权益、计量按套餐工作                                   |
| 6   | opera · 路由授权 / 能力授权   | 把模型路由、能力授给产品                                                         | 权益配置页汇总                                                       |

**步 2 的自动验证（2026-08-31）**：上线检查（`portals/opera/src/features/product/launch-checks.ts`）读平台自己的存储判七项——目录登记、OIDC 客户端、Atlas / Runos 授权、webhook 登记，以及对方接通后留下的两条痕迹：**C2** 每次成功的 `GET /platform/entitlements` 由 platform-api 在 Redis 记一个按产品码的「最近一次」键（`<REDIS_KEY_PREFIX>integration:c2:<code>`，30 天过期，每产品每分钟至多写一次，Redis 故障不影响响应），**C3** 取 `metering.usage_events` 最近 90 天内该产品的最后一行；两者经 `GET /api/products/:id/integration-signals` 读出，C2 / C3 与 `catalog_registered` 一起写回检查单。C2 是最近一次而不是台账（不答「调了多少次」）；走共享内部令牌的调用没有身份，按请求里的产品码归因；S2S 调用按 `act.sub` 归因。`c1_identity`（对方的 RP 实现）仍由操作员按回报勾；`data_plane` 与 `acceptance` 平台观测不到，保持人工。

产品状态机（`portals/opera/src/features/product/lifecycle.ts`）：`draft → active ⇄ inactive`，任一 → `deprecated`（终态）。软删（`deleted_at`）只在极端情况下用，所有列表都过滤它。

**退役有前置（2026-08-31）**：写 `deprecated` 要求这个产品在 Atlas 的模型路由授权（`product_endpoint_grants`）与在 Runos 的能力授权（`capability_grant`）都为零。两个上游按 `product_code` 字符串挂授权、没有 FK，目录退役不会替人撤——此前退役一个产品，上游的授权原封不动地活着，一个目录里已不存在的主体仍然能换票、能调路由。闭合立在目录这一侧、立在写终态的那条边上（§6）。其它跃迁（上线 / 停用 / 恢复）不受影响：它们不减少任何东西。

## 3. 对象模型

```
product.products (id, product_code UNIQUE, product_type, status, origin, deleted_at, …)
   │ 1
   │
   │ n
appoidc.oidc_clients (client_id UNIQUE, product_id FK, client_kind, release_channel, status, …)
```

- **`client_kind`**（2026-08-30 新增）把「这行归谁」写成显式列：
  - `platform` — 平台自有门户（website / console / admin / opera）。`product_id` 必为 NULL。只由 seed 建，密钥由 `27-provision` 转运。「接入凭据」页看不到、也动不了它们。
  - `product` — 某个已登记产品的接入凭据。`product_id` 必非 NULL。
  - `chk_oidc_clients_kind_product`：`(client_kind = 'platform') = (product_id IS NULL)`。默认 kind=product，所以漏传 `product_id` 的插入直接失败，而不是静默变成一个"平台级"客户端——这正是此前五个孤儿客户端的成因。
- **渠道 = `release_channel`**，一产品一渠道一客户端（同渠道多个活跃客户端时，服务状态取最早登记的）。stable 客户端 `redirect_uris` 里的第二个地址**不是** beta——回调白名单里多一个地址不等于登记了一个渠道。
- **产品类型 → 层级**只有一处判定（`product_100_matrix.md` §2）：`model_platform`/`capability_platform` → L1，`data_platform`/`knowledge_platform` → L2，`agent` → L3，`client`，`external`；其它显示「未分类」。没有按产品码的回退表。

## 4. 各消费面的读取口径

所有面都 `FROM product.products … WHERE deleted_at IS NULL`，差别只在状态过滤——由该面的用途决定，不由数据来源决定：

| 面                                   | 接口                             | 状态过滤                                                                 | 说明                                                                 |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| opera 产品目录                       | `GET /api/products`              | 无（草稿、正式全出，可按 `?state=` 筛）                                  | 登记台账本身                                                         |
| opera 接入凭据                       | `GET /api/oidc-clients`          | `client_kind='product'`（客户端表），产品下拉来自 `/api/products`        | 平台门户不在列表里                                                   |
| opera 服务状态                       | `GET /api/product-health`        | 无；LEFT JOIN `client_kind='product' AND status='active'` 的客户端       | 无客户端 = 「未接入」，**不是不显示**；带产品状态徽标                |
| opera 路由授权 / 能力授权 / 权益配置 | `GET /api/products`              | 无                                                                       | 授权主体是产品                                                       |
| admin 产品能力                       | `GET /api/products/capabilities` | 无，`active` 排前                                                        | 商业封装的起点                                                       |
| admin 套餐 / 版本                    | `GET /api/products/plans…`       | 经 `product.plans.product_id` FK                                         | 不单独枚举产品                                                       |
| console 目录 / 推荐                  | `/api/subscription/*`            | `status='active' AND is_customer_visible`                                | 面向客户                                                             |
| website 目录                         | `GET /api/products/catalog`      | `status='active' AND is_customer_visible`                                | 公开营销                                                             |
| auth-bff token-exchange              | —                                | 调用方产品来自 `oidc_clients.product_id`；目标产品要求 `status='active'` | `product_id NULL` 的产品级客户端不再可能存在（§3）                   |
| auth-bff app-scope claim             | `APP_SCOPE_CODES`                | 遗留豁免集，**只减不增**，成员必须有目录行                               | 2026-08-30 去掉了 6 个无目录行的码；SQL 本就按码 JOIN 目录，行为不变 |

**不再存在的东西**：`product-health.router.ts` 里的 `PENDING_CATALOG_CLIENT_IDS` 与 `LAYER_FALLBACK_BY_CODE`（两份按产品码的硬编码），以及 seed 里事后按 `client_id` 后缀猜 `product_id` 的回填循环。

## 5. seed 政策：什么可以被预置、凭什么

seed 是**平台自举**的一部分，不是登记入口的替代品。一行产品能进 `seed-catalog.mjs` 的 `PRODUCTS`，必须满足下面 A 或 B 之一，并且满足 C：

| 条件 | 内容                                                                                                                              | 当前命中                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A    | **代码依赖**：平台代码以字面量引用该 `product_code`——token-exchange 的 audience、opera 的模块挂载前缀、app-scope 豁免集           | `atlas`（opera `/atlas` 模块、`ATLAS_AUDIENCE`）、`runos`（同）、`umbra`（app-scope） |
| B    | **seed 内 FK 依赖**：同一 seed 里别的行以 FK 指向它（套餐、webhook、计量指标、OIDC 客户端、KYC 策略）                             | `arda`、`karda`、`vxtpl`、`ruyin`、`umbra`                                            |
| C    | **形状一致**：与目录页写出的行同形——`status`、`origin` 显式写，不靠列默认值；`product_type` 取矩阵词表；`created_by` = 系统操作员 | 全部                                                                                  |

禁止项：

- **D1** 只建客户端不建产品。产品级客户端在 seed 里必须以 `product: "<code>"` 指向 `PRODUCTS` 里的一行；不在的直接抛错（seed 在写库前校验，DB CHECK 是第二道）。
- **D2** 预建规划中的产品。`product_100_matrix.md` 里 ontos / terra / raven / anlan / forge / xuanzhen 是规划产品，产品定义空白，**不进 seed**——定义完成后由运营者在产品目录登记。它们此前被 seed 预建的客户端已由 2026-08-30 迁移删除，相关 env 键（`*_BASE_URL` / `OIDC_CLIENT_SECRET_HASH_*`）同批从 example 与 env 审计里移除。
- **D3** 用 seed 改已登记产品的登记字段。`PRODUCTS` 的插入是 `on conflict do nothing`；产品的名字、状态、来源一旦登记，归目录页管。

平台级客户端（`kind: "platform"`）只有 website / console / admin / opera 四个，它们不是产品，不受 A/B 约束；新增一个平台门户是平台代码的事，随代码一起进 seed。

测试数据 seed（`seed-demo` / `seed-bulk` / `seed-bulk-core`）不受本节约束，但它们**拒跑生产**（各自的 `assertNotProduction()`），并且从不写 `appoidc`——`demo-*` 产品在服务状态页显示「未接入」是对的：它们是没有服务的演示行。

## 6. 不变式与守卫

| 层   | 守卫                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 挡住什么                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| DB   | `chk_oidc_clients_client_kind`、`chk_oidc_clients_kind_product`、`fk_oidc_clients_product`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 无产品的产品级客户端；指向不存在产品的客户端           |
| BFF  | `oidc-client.router.ts` 创建时先查产品存在且 `deleted_at IS NULL`；list / rotate / activate 只触达 `client_kind='product'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 挂在软删产品上的客户端；从产品页动平台门户的密钥       |
| seed | 每个客户端条目必须声明且只声明 `kind:"platform"` / `product:"<code>"` 之一；code 必须能在 `PRODUCTS` 解析                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 再次出现孤儿客户端                                     |
| BFF  | **退役闸门**（2026-08-31）：`PATCH /api/products/:id/state` 目标态 `deprecated` 时，先读 Atlas `GET /capability/product-endpoint-grants?productCode=<code>&includeInactive=false` 与 Runos `GET /commerce/capability-grants?subjectType=product&subjectRef=<code>`（`lib/upstream-grants.ts`，operator-OBO，与 atlas/runos 两个 router 同一份底座）。任一边有 `state=active` 的行 → 409 `PRODUCT_HAS_ACTIVE_GRANTS`，体带 `{ atlas: {count, sample}, runos: {count, sample} }`；任一边读不到（连不上、回错、形状不对）→ 502 `UPSTREAM_UNAVAILABLE`，**fail closed**，退役不执行。检查在 RW 事务之外（网络调用不进 `FOR UPDATE`），检查与写之间的窗口由下一行的报表事后兜住。只有 `deprecated` 这条边挂闸门 | 退役后上游仍挂着活授权；上游查不到时被当成「没有」     |
| 报表 | **未登记产品的授权**（opera · 权益配置页底部）：Atlas 全量 `product-grants?includeInactive=true` 与 Runos 全量（`GET /api/runos/grants/all`，按能力目录扇出反向索引 `?capabilityId=`——runos 刻意没有无条件 dump，这是唯一不需要预知主体的过滤轴）里 `productCode` / `subjectRef` 在 `/api/products` 中**根本不存在**的行；草稿 / 停用 / 退役都算登记过。每行带既有的停用 / 撤销动作；Runos 侧读不到时页面明说「没查到」，不写成「没有」                                                                                                                                                                                                                                                                    | 闸门之前退役的产品、直连上游写进去的授权，长期无人可见 |
| 守卫 | `pnpm lint:seed`（幂等）、`pnpm lint:column-locks`（新列进 98 列锁）、`product-health.spec.ts`（清单以目录为主表、渠道只认 `release_channel`、层级只认 `product_type`）、`product-catalog-retirement.spec.ts`（闸门：有授权 409 / 无授权放行 / 上游不可达 502 / 其它跃迁不打上游）、`upstream-grants.spec.ts`（两条上游查询的确切形状、只数 active、fail closed）                                                                                                                                                                                                                                                                                                                                          | 回归                                                   |

## 7. 存量迁移（2026-08-30）

`deploy/database/migrations/2026-08-30-oidc-client-kind.sql`，幂等，按 `28d-apply-migrations.sh` 的常规通道执行，**必须先于新版 seed**（新 seed 直接写 `client_kind` 列，列不存在会停下——有意）。

1. 加列 `client_kind`（默认 `product`）。
2. website / console / admin / opera → `platform`。
   2b. 产品客户端若 `product_id` 从未回填（取决于该库当年跑 seed 的先后），按旧 seed 同一条 T1 规则补上（`client_id` 去掉 `-beta`/`-canary` = `product_code`）；对不上目录行的不猜。迁移因此不依赖 seed 历史。
3. **删除**存量孤儿客户端 ontos / raven / anlan / forge / xuanzhen / nocus（`product_id IS NULL`），每行 `RAISE NOTICE` 留痕；`oidc_consents` 随 `ON DELETE CASCADE` 清掉。选择删除而不是补目录行：产品目录是唯一入口，迁移替它们预建行等于绕过入口；它们从未能完成 token-exchange（`invalid_client`），删除不改变任何在用行为。
4. 断言库里不再有 `client_kind='product' AND product_id IS NULL` 的行，否则停下并逐条报出。
5. 加两条 CHECK；同步 98 列锁。

`28b-restore-appoidc.sh`（reset 通道的备份恢复）同批改：按归属推导 `client_kind`，备份里既非平台门户又无 `product_id` 的行跳过并 NOTICE；顺带把恢复语句里早已不合 CHECK 的 `'disabled'` 改回 `'inactive'`。

## 8. 已知遗留（不在本次范围）

2026-08-31 已闭合（产品唯一真源分析四缺口）：

- ~~admin-bff `products.router.ts` 的 solutions / releases / model-policies 仍是静态数组~~ → solutions 落库为 `product.solutions` / `solution_products` / `solution_plans`（`admin/70-product-solutions.md`），能力目录的 `relatedSolutions` / `solutionCount` 与订阅的方案归属都从表实算；releases / model-policies 仍无表，返回空而不是编造。
- ~~website 营销页硬编码 arda / ontos / karda 的 slug~~ → `/products`、`/appcenter`、`/products/[slug]` 逐请求读 `GET /api/products/catalog`（§4），不在目录里的 slug 是真 404；ontos / terra 不再有页。
- ~~`services/platform/product` 的 `createProduct()`~~ → 整目录删除（无 package.json、无引用者）。登记入口只有 opera 目录页一处。
- 退役与上游授权的闭合见 §2 / §6（退役闸门 + 未登记产品的授权报表）。

仍开着：

- **`dispatch.itest.spec.ts`** 用 `xuanzhen` 当测试产品码，与矩阵保留码撞名；`on conflict (id)` 挡不住 `product_code` 唯一冲突。
- **`baseline-assertions.sql`** 的 `appoidc.oidc_clients ≥ 10`：seed 现在写 11 行（4 平台 + 7 产品），仍满足；若再减产品需同步。
