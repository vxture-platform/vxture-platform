# 产品登记与接入：单一入口模型（opera · product）

> 状态：v1.0（2026-08-30，owner 口径）。
> 实现：`bff/opera-bff/src/routers/product-catalog.router.ts`（登记）· `oidc-client.router.ts`（接入凭据）· `product-onboarding.router.ts`（单页接入的合并保存与密钥）· `product-health.router.ts`（服务状态）；DDL `deploy/database/ddl/22_appoidc.sql`；seed `deploy/database/seed/seed-catalog.mjs`；迁移 `deploy/database/migrations/2026-08-30-oidc-client-kind.sql`。
> 起因：运行监控「服务状态」与「产品目录」是两份清单（目录 21 个、监控 12 个，其中 5 个目录里不存在）。前者读 `appoidc.oidc_clients` 外加一份硬编码豁免名单，后者读 `product.products`。修法不是补数据，是把"谁是产品"这个问题收回到一张表、一个入口。

---

## 1. 原则

1. **`product.products` 是「平台上有哪些产品」的唯一权威**；「产品管理 · 产品目录」是**唯一登记入口**。产品的登记、改名、状态流转只在这里发生。
2. **其它业务面只读这张表**，各自只加与自身用途相符的状态过滤（§4）。不得另起清单，不得以硬编码的产品码集合代替查询，不得从别的表"推断"出一个产品。
3. **产品之外不存在"像产品的东西"**。任何以产品身份出现的对象——OIDC 客户端、套餐、webhook、计量指标、授权——都必须以 FK 挂在一个目录行上；挂不上的写不进库（§6）。
4. **seed 不是第二个入口**。seed 只被允许预置平台代码本身依赖的自有产品（§5），写出来的行与登记出来的行形状一致；规划中的产品不由 seed 预建，等定义完成后走入口登记。

## 2. 空平台起步：第一条产品怎么进来

新部署、`db-init` 跑完 DDL + seed 之后，目录里只有 §5 列出的自有产品；其余都是空的。接入一个新产品是下面这条线，**没有任何一步需要改代码或改 seed**：

| 步  | 在哪里                                                | 做什么                                                                                                                                                                                                                                                                                                                                                                                    | 之后各业务面看到什么                                                                                                           |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | opera · 产品目录 · 接入产品（`/product/catalog/new`） | 一页填完：产品码、类型、来源、名称；边缘与回调；按渠道添加 OIDC 客户端（`release_channel` = stable / beta / canary）。**一个事务**写入，落 `status='draft'`。签发客户端要过 step-up，client_secret 明文只在保存后显示一次                                                                                                                                                                 | 目录出现草稿行；服务状态出现同一行，有启用客户端的渠道开始探测；auth-bff token-exchange 能解析出 `act.sub`；admin 产品能力可见 |
| 2   | 同一页 · 「密钥管理」面板                             | 登记 webhook 签名密钥与引用；轮换 client_secret。两者都挂 step-up                                                                                                                                                                                                                                                                                                                         | 平台可对开通 / 停用事件签名投递                                                                                                |
| 3   | 同一页 · 「接入检查」抽屉                             | 跑复验：opera 的七项里**四项自动判定并写回**（`catalog_registered` / `c2_entitlement` / `c3_metering` / `c1_s2s`）；`c1_identity` / `data_plane` / `acceptance` 不写回（前两项人工勾，`acceptance` 只呈现）——判据见下「一项检查只有在它的全部内容都被实测覆盖时才写回」。**那三项自动检查不需要客户 / 订阅 / 套餐**：它们问的是「对方真的调过平台没有」，产品后端发起三次联调调用即可点亮 | —                                                                                                                              |
| 4   | 同一抽屉 · 确认上线                                   | 先重跑复验，全通过且**卡上线那道门**的必填项齐（`gate='launch'`，六项），才把草稿转为已上线（`status='active'`）。`acceptance` 归发布门，不卡这一步——见下「两根轴」                                                                                                                                                                                                                       | console / website 目录可见；auth-bff 接受它作为 token-exchange 目标                                                            |
| 5   | admin · 套餐 / 版本 / 方案                            | 为产品建套餐并发布                                                                                                                                                                                                                                                                                                                                                                        | console 订阅、权益、计量按套餐工作                                                                                             |
| 6   | opera · 模型授权 / 能力授权                           | 把模型路由、能力授给产品                                                                                                                                                                                                                                                                                                                                                                  | 权益配置页汇总                                                                                                                 |

**检查项的两根轴（2026-09-17，owner 提出的循环自锁）**：`product.launch_checklist_items`
上有 `owner`（opera | admin）与 `gate`（launch | publish）两列，**正交**。

- `owner` 回答「这一项归谁勾」——opera 的抽屉只读写 `owner='opera'` 的项（七项），
  商业前置两项归 admin。
- `gate` 回答「这一项卡哪一道门」——上线门槛（`draft→active`）只看 `gate='launch'`
  的必填项（六项）。

`acceptance` 是唯一 `owner='opera'` 而 `gate='publish'` 的项：它的判据是
`login → provision → gate → consume → invalidate` 全链路，而 provision 需要客户订阅、
订阅需要 console 可见（`status='active'`）——卡在上线门上就是**环**。移到发布门之后，
那条链在 `active + developing` 下本来就走得通。

**接入方式轴（`integration_mode`，2026-09-24）**：`platform_managed`（收平台下发：开通 / 权益 / 用量回调）/ `login_only`（只用统一登录，平台不向它下发任何东西）。值域权威源在 `@vxture-platform/shared` 的 `PRODUCT_INTEGRATION_MODES`，`lint:catalog-domains` 锁它与 `chk_products_integration_mode` 一致。写侧是 opera 产品页的「接入方式」下拉。

> **为什么要有这一根轴。** admin 的接入态（「已接入 / 联调中 / 待配置 / 无需接入」）原先**靠「有没有 `product_webhooks` 行」去推**，而那是**沉默**，沉默同时兼容两件相反的事：「还没配」与「按设计不需要」。2026-09-24 一天之内两种猜法都上线过，各错一批产品：先一律判 `not_required`，12 个只填了信息什么都没建的智能体被说成不需要接入（owner：「很多产品仅仅填写了信息，还没有开发和部署任何内容，应该谈不上接入」）；改成一律判 `config_required` 之后又冤了 umbra——它只做账号统一登录，其余全在它自己那边，**没有任何配置在等人做**，而界面在催一件不存在的工作。**缺的不是更好的推断，是一处声明。**
>
> **不拿 `origin` 当代理**：实测 umbra 是唯一 `origin='third_party'` 的产品，所以「按来源判」当天恰好只框中它——那是巧合。合作方产品照样可以收平台下发，自建产品也可以只用统一登录；接入方式是**接入契约**的属性，不是**来源**的属性。
>
> **声明与事实焊在写入面**：`login_only` 的产品登记回调地址被拒（409 `CATALOG_PRODUCT_LOGIN_ONLY`，两个入口都拦：`PUT :id/webhook` 与合并保存的 `upsertEdgeTx`）。否则声明就是摆设——admin 照声明说「无需接入」，而库里躺着一个投递地址。逃生口在同一个页面上：先把接入方式改成「完整接入」，报错正文明写这条路。只拦 `webhookUrl`；`home_url` 对仅登录产品照样有意义（console 应用中心的「进入」读它）。

**承诺等级轴（`release_stage`，2026-09-17 装上状态机）**：`preview`（预览版）/ `beta`（公测版）/ `stable`（正式版）/ `sunset`（停售中），四态与标签的权威源在 `@vxture/core-utils` 的 `release-stage.ts`。它与 `status`（生命周期）、`is_customer_visible`（上不上站）**仍然正交**——DDL 里「独立轴，不派生」那句话没有改。

> 这一行原写着三态 `ga / beta / developing`，**两处都已过时**：2026-10-29 改名为 `stable` / `preview` 并补了 `sunset`。而 `developing` 这个词自 2026-09-24 起归**生命周期轴**（见下），两根轴用同一个词是这一批要拆掉的混淆之一——对外说承诺等级最低那一档一律用「预览版」。

- **只向前走**：`developing → beta → ga`，可跨级，同态重放不报错；倒退一律 409。判据在 `isForwardReleaseStageMove`，执行在 admin-bff 的 `PATCH capabilities/:code/content`（事务内、写之前）。**不开倒退口**：要把产品从客户面前收回去，该动的是可见性或生命周期，那两根轴各自有出口；拿成熟度当开关使是在说「它变不成熟了」。
- **「开发中不可订」已下沉到服务端**：此前它只长在官网卡片上（`ProductCatalogCard` 判 developing 就隐掉订阅按钮），而服务端从头到尾没有一处读 `release_stage`，权威源里的 `isReleaseStageSubscribable` 没有调用者。现在 console-bff 的 `POST /api/subscription/orders` 拒 `PRODUCT_NOT_RELEASED`（409），推荐位也不再出开发中产品。
- **套餐阶梯故意不卡**：开发中产品的阶梯照常返回，由下单那一步明确拒。静默回空阶梯会让页面显示「无可用套餐」，用户不知道为什么。
- **顺带修掉的归属缺口**：`productCode` 与 `planVersionId` 是下单请求里各自独立的两个字段，此前全程无一处校验它们属于同一产品（查价只看 plan，查在途单只看产品）。不合一不仅能绕过成熟度门，订单落库时产品与套餐也对不上；现在合并成一次查库，不匹配回 `PLAN_PRODUCT_MISMATCH`（400）。

归属此前是 opera-bff 里的代码常量（`ADMIN_OWNED_ITEM_CODES`），而「卡哪道门」根本
没有表达处；两列随 `2026-10-07-checklist-gate-owner.sql` 落库后常量已删。

**步 3 的自动验证（2026-08-31）**：上线检查（`portals/opera/src/features/product/launch-checks.ts`）读平台自己的存储判七项——目录登记、OIDC 客户端、Atlas / Runos 授权、webhook 登记，以及对方接通后留下的两条痕迹：**C2** 每次成功的 `GET /platform/entitlements` 由 platform-api 在 Redis 记一个按产品码的「最近一次」键（`<REDIS_KEY_PREFIX>integration:c2:<code>`，30 天过期，每产品每分钟至多写一次，Redis 故障不影响响应），**C3** 取 `metering.usage_events` 最近 90 天内该产品的最后一行；两者经 `GET /api/products/:id/integration-signals` 读出，C2 / C3 与 `catalog_registered` 一起写回检查单。C2 是最近一次而不是台账（不答「调了多少次」）；走共享内部令牌的调用没有身份，按请求里的产品码归因；S2S 调用按 `act.sub` 归因。`c1_identity`（对方的 RP 实现）仍由操作员按回报勾；`data_plane` 与 `acceptance` 平台观测不到，保持人工。

**单页接入（2026-09-14，owner 口径）**：步 1–4 原本分散在五个入口——目录页「登记产品」弹窗、详情页「保存设置」（两次串行 PUT）、「接入凭据」页「注册客户端」、详情页凭据抽屉里的「回调地址」与「授权页展示」两个弹窗，外加独立的「产品上线」页。现在收成**一张页 + 一个密钥面板**：写入走 `bff/opera-bff/src/routers/product-onboarding.router.ts` 的合并保存（`POST /api/products/onboarding` · `PUT /api/products/:id/onboarding`，产品 / 边缘与回调 / 客户端同一事务），step-up **按改动判**——只改展示不打扰，触及回调 / 登出回跳白名单、scopes、PKCE、签发新客户端，**或翻转对客可见性**（2026-09-17：把产品推上官网 / 从官网撤下都算，与 admin 侧 `PATCH capabilities/:productCode/content` 拉齐）才要求；密钥只从面板写（`PUT /api/products/:id/webhook-secret`、`POST /api/oidc-clients/:clientId/rotate-secret`）。「接入凭据」页保留为全部产品客户端的**只读**总览；`/product/launch` 保留为跳转。产品码 `new` 是保留字（被 `/product/catalog/new` 占用）。

**写入口已收口（2026-09-17）**：产品字段的写入只剩合并保存一条路。旧的 `POST /api/products` 与 `PUT /api/products/:id` 已退役——它们自 2026-09-14 起就没有调用方，却绕过了合并保存那道按改动判的 step-up。退役而不是给旁路也挂一把锁：门只有一道，才不存在“有一侧是虚的”。

产品状态机（`portals/opera/src/features/product/lifecycle.ts`）：`draft → developing → active ⇄ inactive`，任一 → `deprecated`（终态）。`draft → active` 与 `active → developing` 两条边也在（后者带「卖过就拒」）。值域权威源在 `@vxture-platform/shared` 的 `PRODUCT_STATUSES`，`lint:catalog-domains` 锁它与 `chk_products_status` 一致；逐条判据见 `portals/opera/docs/opera-navigation-design.md` §6.4。

**退役 vs 删除（2026-08-31）**：两条不同的出口，别混。**退役**（`deprecated`）是可见的终态——产品曾合法、现下线，老订阅照付、历史留档。**删除**（软删 `deleted_at`，所有列表都过滤它）是「本不该在册」的出口，产品从目录彻底消失，给误发布的产品用。删除是两步（`GET /api/products/:id/deletion-preview` 预览影响面 → `DELETE /api/products/:id` 带 `confirm:true`，`@RequireStepUp` + 审计 `support.audit_logs`），判据是**无客户足迹即可删**：有用量（`metering.usage_events`）/ 账单（`billing.invoice_items`）/ 开通（`provisioning.provisionings`）/ 权益（`entitlement_caches` · `quota_pools` · `subscription_entitlement_overrides`）/ 上游生效授权任一者 → 409 `PRODUCT_HAS_CUSTOMER_FOOTPRINT`（或 `PRODUCT_HAS_ACTIVE_GRANTS`），只能退役。删除**不阻塞**于登录客户端：同事务把该产品 `product` 型 OIDC 客户端停用（登录中断，是结果不是阻塞项），并连带软删其 primary 套餐。列锁（`98_column_locks.sql`）已放行 `platform_svc` 写 `products.deleted_at` / `plans.deleted_at` / `oidc_clients.status`。

**退役有前置（2026-08-31）**：写 `deprecated` 要求这个产品在 Atlas 的模型授权（`product_endpoint_grants`）与在 Runos 的能力授权（`capability_grant`）都为零。两个上游按 `product_code` 字符串挂授权、没有 FK，目录退役不会替人撤——此前退役一个产品，上游的授权原封不动地活着，一个目录里已不存在的主体仍然能换票、能调路由。闭合立在目录这一侧、立在写终态的那条边上（§6）。其它跃迁（上线 / 停用 / 恢复）不受影响：它们不减少任何东西。

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
| opera 模型授权 / 能力授权 / 权益配置 | `GET /api/products`              | 无                                                                       | 授权主体是产品                                                       |
| admin 产品能力                       | `GET /api/products/capabilities` | 无，`active` 排前                                                        | 商业封装的起点                                                       |
| admin 套餐 / 版本                    | `GET /api/products/plans…`       | 经 `product.plans.product_id` FK                                         | 不单独枚举产品                                                       |
| console 目录 / 推荐                  | `/api/subscription/*`            | `status='active' AND is_customer_visible`                                | 面向客户                                                             |
| website 目录                         | `GET /api/products/catalog`      | `status IN ('active','developing') AND is_customer_visible`              | 公开营销；`developing` 只预告不可订（2026-09-24）                    |
| auth-bff token-exchange              | —                                | 调用方产品来自 `oidc_clients.product_id`；目标产品要求 `status='active'` | `product_id NULL` 的产品级客户端不再可能存在（§3）                   |
| auth-bff app-scope claim             | `APP_SCOPE_CODES`                | 遗留豁免集，**只减不增**，成员必须有目录行                               | 2026-08-30 去掉了 6 个无目录行的码；SQL 本就按码 JOIN 目录，行为不变 |

**不再存在的东西**：`product-health.router.ts` 里的 `PENDING_CATALOG_CLIENT_IDS` 与 `LAYER_FALLBACK_BY_CODE`（两份按产品码的硬编码），以及 seed 里事后按 `client_id` 后缀猜 `product_id` 的回填循环。

## 5. seed 政策：什么可以被预置、凭什么

seed 是**平台自举**的一部分，不是登记入口的替代品。一行产品能进 `seed-catalog.mjs` 的 `PRODUCTS`，必须满足下面 A 或 B 之一，并且满足 C：

| 条件 | 内容                                                                                                                              | 当前命中                                                                                                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | **代码依赖**：平台代码以字面量引用该 `product_code`——token-exchange 的 audience、opera 的模块挂载前缀、app-scope 豁免集           | `umbra`（app-scope）。**atlas / runos 自 2026-09-23 起不在此列**：它们是平台基础环境，OIDC 客户端降为 `client_kind='platform'`（与 opera/admin/console 同类），换票受众改由 auth-bff 的 `PLATFORM_LEVEL_S2S_TARGETS` ∩ active 平台级客户端认定——**代码依赖仍在，但落点不再是产品目录**；opera 的 `/atlas` `/runos` 模块挂载与权限码一概不动 |
| B    | **seed 内 FK 依赖**：同一 seed 里别的行以 FK 指向它（套餐、webhook、计量指标、OIDC 客户端、KYC 策略）                             | `arda`、`karda`、`vxtpl`、`umbra`（`ruyin` 已移出——见本节末）                                                                                                                                                                                                                                                                               |
| C    | **形状一致**：与目录页写出的行同形——`status`、`origin` 显式写，不靠列默认值；`product_type` 取矩阵词表；`created_by` = 系统操作员 | 全部                                                                                                                                                                                                                                                                                                                                        |

禁止项：

- **D1** 只建客户端不建产品。产品级客户端在 seed 里必须以 `product: "<code>"` 指向 `PRODUCTS` 里的一行；不在的直接抛错（seed 在写库前校验，DB CHECK 是第二道）。
- **D2** 预建规划中的产品。`product_100_matrix.md` 里 ontos / terra / raven / anlan / forge / xuanzhen 是规划产品，产品定义空白，**不进 seed**——定义完成后由运营者在产品目录登记。它们此前被 seed 预建的客户端已由 2026-08-30 迁移删除，相关 env 键（`*_BASE_URL` / `OIDC_CLIENT_SECRET_HASH_*`）同批从 example 与 env 审计里移除。
- **D3** 用 seed 改已登记产品的登记字段。`PRODUCTS` 的插入是 `on conflict do nothing`；产品的名字、状态、来源一旦登记，归目录页管。

平台级客户端（`kind: "platform"`，`product_id` 必为 NULL，不是产品、不受 A/B 约束）有两类：**平台自有门户** website / console / admin / opera（`platform` 级并不绑 realm——website / console 本就是 customer realm），以及 **first-party 客户端应用**——目前是 `ruyin` / `ruyin-beta`。新增一个平台门户或 first-party 应用是平台代码的事，随代码一起进 seed。

### ⚠️ ruyin 不是目录产品，别把它加回 `PRODUCTS`（owner 2026-08-31）

`ruyin`（如影）是与平台侧平级的**桌面原生端**：一个 OAuth 公共客户端（RFC 8252，loopback 回调 + PKCE，`auth=none`），和 Claude Code 之于 Anthropic 同构——**桌面 app 是登录客户端，不是可订阅 / 退役 / 挂套餐的目录 SKU**（客户端产品本就不进权益引擎，`product_100 §5`）。

它此前被同时建成了 OIDC 客户端**和** `product.products` 里一行 SaaS 商品，这正是「ruyin 退役不掉、删不掉」的根源：`product` 级客户端经 `fk_oidc_clients_product`（RESTRICT）把产品行钉住，且不变式「产品目录之外不存在产品」要求它必须挂着一行。2026-08-31 迁移 `deploy/database/migrations/2026-08-31-ruyin-declassify.sql` 把 `ruyin` / `ruyin-beta` 由 `product` 级降为 `platform` 级、`product_id` 置空，产品行软删；`seed-catalog.mjs` 同步（`ruyin` 移出 `PRODUCTS`、两个客户端条目改 `kind: "platform"`）。**登录机制一字未改**：realm 仍是 `customer`、`auth=none`、loopback 回调不变，如影桌面登录照旧。

**若你正想「补一行 ruyin 产品」，或把它的客户端改回 `product` 级 / 加回 `PRODUCTS`：停。** 它是客户端不是产品。真要给如影卖订阅，那是**另立一个 SaaS 产品**的事（在目录页登记一行新产品码），不是把这个桌面客户端塞回目录。迁移与 seed 必须成对——只改一边，一次 reseed 就会用旧 seed 把产品行和 `product` 级客户端重建、抵消迁移。

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

**ruyin 降级（2026-08-31）**：`deploy/database/migrations/2026-08-31-ruyin-declassify.sql`，同一 `28d` 通道、幂等，与新版 seed 成对（理由见 §5 的 ⚠️ 段）。把 `ruyin` / `ruyin-beta` 由 `product` 级改判 `platform` 级、`product_id` 置空，ruyin 产品行软删；内建断言：跑完这两个客户端必须是 `platform` 且 `product_id IS NULL`，否则 `RAISE EXCEPTION`。已于 2026-08-31 应用到生产并过 30-verify（`client ruyin/ruyin-beta → platform-kind`、`soft-deleted 1 ruyin product row`）。

## 8. 已知遗留（不在本次范围）

2026-08-31 已闭合（产品唯一真源分析四缺口）：

- ~~admin-bff `products.router.ts` 的 solutions / releases / model-policies 仍是静态数组~~ → solutions 落库为 `product.solutions` / `solution_products` / `solution_plans`（`admin/70-product-solutions.md`），能力目录的 `relatedSolutions` / `solutionCount` 与订阅的方案归属都从表实算；releases / model-policies 仍无表，返回空而不是编造。
- ~~website 营销页硬编码 arda / ontos / karda 的 slug~~ → `/products`、`/appcenter`、`/products/[slug]` 逐请求读 `GET /api/products/catalog`（§4），不在目录里的 slug 是真 404；ontos / terra 不再有页。
- ~~`services/platform/product` 的 `createProduct()`~~ → 整目录删除（无 package.json、无引用者）。登记入口只有 opera 目录页一处。
- 退役与上游授权的闭合见 §2 / §6（退役闸门 + 未登记产品的授权报表）。

仍开着：

- **`dispatch.itest.spec.ts`** 用 `xuanzhen` 当测试产品码，与矩阵保留码撞名；`on conflict (id)` 挡不住 `product_code` 唯一冲突。
- **`baseline-assertions.sql`** 的 `appoidc.oidc_clients ≥ 10`：seed 现在写 11 行（2026-08-31 后为 6 平台 = website / console / admin / opera / ruyin / ruyin-beta + 5 产品；ruyin 降级只改归类不减行数），仍满足；若再减产品需同步。
