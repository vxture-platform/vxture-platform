# Commerce 域细化设计：产品席位（附：成员上限防滥用闸）

<!-- data-architecture: target-state -->

> 状态：v5 · 编号 `data_commerce_250`（细化设计层）· **陈述实况** · 四条裁定三条已落地，只欠执行点（§5）
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 姊妹文件：[`data_commerce_200_metering.md`](./data_commerce_200_metering.md)（计量内核）、[`product_220_catalog-resource-model.md`](./product_220_catalog-resource-model.md)（销售轴合并规则）
> 缘起：owner 2026-09-22「成员上限是工作区可以加入的成员数，租户应该也有这个限额，如 100 人；席位是针对产品来说的，如销售智能体 10 席位、方案智能体 5 席位，都来自这 100，可能还有重叠」。

---

## 版本说明：v3 为什么比 v2 短一半

v2 把「成员上限」和「席位」当成两件并列的设计。owner 随后裁定成员上限「当前简单处理，
设定一个比较高的上限，防止恶意爆仓就行」——**它因此整个离开了 commerce 域**：不走产品
订阅、不进 `quota_pools`、不进套餐 `limits`、不上订阅页。已按防滥用闸实现，见 §4 附录。

本文主体因此只剩**席位**一件事。

v2 还有一处是没查表就写的，一并更正：「移出租户要连带移出全部工作区」——
`fk_workspace_memberships_tenant_member` 带 `ON DELETE CASCADE`，**数据库已经做了**。

> **v4（2026-09-27）**：四条待定 owner 已全部裁定。**同时查出本文 v3 有一半已经过时**——`seat.max` 与 `member.max` 退役在 2026-10-27/28 就实现了，v3 仍把它们写成「待定」，因为当时没查代码。§5 已改成「裁定 × 实况」对照表，**本文从此陈述实况，不再陈述目标态**。
>
> **v5（2026-09-27）**：① 的明细表已建（`2026-11-14-product-seats.sql`），§2/§3 改成实况。同时**攒回 v4 的一条误判**：v4 把「各档位席位数」写成「梯度丢了、要 owner 定数字、且阻塞硬拦」——owner 更正：那是**发布档位时的配置，默认最小值 1**，不是写死的值，也不阻塞任何工作。

## 0. 席位是什么

**席位（seat）**：某个**产品**在某个工作区里，允许多少个自然人使用。

与成员上限的关系（owner 原话「都来自这 100，可能还有重叠」）：

- 席位的候选人必须先是成员 ⇒ **单个产品的席位数 ≤ 该容器的成员数**
- 同一个人可同时占多个产品的席位 ⇒ **各产品席位数之和不设上限**

第二条最容易写反：销售 10 + 方案 5 = 15，**不需要** ≤ 100；只有单个产品要 ≤ 100。

## 1. 席位正好落在现成机制上

席位**是**产品卖出去的东西，所以不需要新规则：

- 目录侧：`product_metrics` 增加 `seat.max`，`merge_strategy='max'`，符合
  [`product_220`](./product_220_catalog-resource-model.md) 的 `limits` 键规范（`{entity}.max` 命名惯例）
- 套餐侧：各档位在 `limits` 里给出 `seat.max`（-1 = 无限哨兵）
- 生效侧：`metering.quota_pools`，`product_id` = 该产品，`metric_key = 'seat.max'`

**键名统一为 `seat.max`，不做 `karda.seat` / `arda.seat`。** 按产品分的是 `product_id` 这一列，
不是键——与 2026-09-22 已落地的「计量项命名是**键**的属性、不是 (产品, 键) 的属性」同一条道理。

容器取**工作区**：`metering.subscriptions` 同时挂 `tenant_id` 与 `workspace_id`（租户掏钱、
工作区消费），而计量主表一律以 `workspace_id` 为成本中心（见
[`data_commerce_200`](./data_commerce_200_metering.md) §0）。席位是订阅权益的一部分，跟着消费侧走。

## 2. 席位需要一张占用表

成员数能直接数成员表；**席位数数不出来**——「谁在用哪个产品」这条关系库里不存在。
`end_user_id` 只出现在 `metering.usage_events`（消费日志，事后），那是「谁用过」，不是「谁被授权」。

**已建**（2026-09-27，`2026-11-14-product-seats.sql`）：

```
metering.product_seats
  id              uuid        pk
  workspace_id    uuid        not null   ┐ 复合外键 → tenancy.workspace_memberships
  user_id         uuid        not null   ┘ (workspace_id, user_id) ON DELETE CASCADE
  product_id      uuid        not null   → product.products
  subscription_id uuid        not null   → metering.subscriptions（谁授予的这个席位）
  granted_by      uuid                   -- 裸值；NULL = 随订阅开通自动授予
  granted_at      timestamptz not null
  revoked_at      timestamptz            -- 软撤销：回收要留痕，否则查不出谁占过
  revoked_by      uuid                   -- 裸值；NULL = 系统撤销（退订/降档）
  unique (workspace_id, product_id, user_id) where revoked_at is null
```

占用数 = 该 `(workspace_id, product_id)` 下 `revoked_at is null` 的行数。

**为什么同时挂 `subscription_id` 与 `(workspace_id, product_id)`**——与 `quota_pools` 同形。
席位是订阅权益的一部分，所以要知道是哪条订阅给的（退订即释放按它筛）；而**套餐可以捆多个
产品**，`subscriptions.product_id` 只是主组件，被授权的那个产品必须自己一列。升级不动本表：
`product_330`「升级/续订改本行、不新增行」⇒ `subscription_id` 稳定。

**外键指向 `tenancy.workspace_memberships (workspace_id, user_id)` 并带 `ON DELETE CASCADE`**，
理由见 §3。指向成员表而不是 `workspaces` + `users` 两条单列外键：后者只能保证「工作区存在」
和「这个人存在」，保不住**这个人是这个工作区的成员**。

> **一个已知缺口（有意的取舍，不是疏漏）**：`revoked_at` 是软撤销，为的是留痕；但级联是
> **硬删**，成员被移出时那些行连痕迹一起消失。冲突时选级联——占用数正确比留痕重要
> （幽灵席位的后果是新人加不进来），而「谁用过」仍可查 `usage_events`。

> 不复用 `metering.subscription_entitlement_overrides`：那张表一行代表一条**配额调整**，
> 不代表一个人。把人塞进去，同一张表就有了两种行。

## 3. 在哪执行

判据落在**写入那一刻**，不是读取时提示——否则超限是既成事实。

| 动作               | 执行点                                             | 超限 / 结果             |
| ------------------ | -------------------------------------------------- | ----------------------- |
| 授予某人某产品席位 | 席位授予端点（**未建**，见 §5）                    | 409「该产品席位已满 N」 |
| 重复授予同一人     | `uidx_product_seats_live`（**已建**）              | 23505，库里拦住         |
| 移出工作区 / 租户  | `fk_product_seats_ws_member` CASCADE（已建）       | 席位自动消失            |
| 退订               | `trg_subscriptions_revoke_seats_on_cancel`（已建） | 席位整批软撤销          |

**人走了席位不会自己消失**，这是席位模型最容易漏的一件事。成员那条已有先例可循：
`fk_workspace_memberships_tenant_member` 带 `ON DELETE CASCADE`，所以移出租户时工作区成员
自动清掉。`product_seats` 照此把外键指向 `workspace_memberships` 并级联——移出工作区
（`removeWorkspaceMember`）与移出租户（`removeOrgMember`）**两处都是硬 DELETE**，
所以级联真的会触发，不是纸面约定。

**退订即释放放触发器而不是写路径**：订阅状态有两个写入方（service 走 `repo.update`、
运营动作走 admin-bff 裸 SQL），挂在任何一条上都会给另一条留门——与 2026-11-13
「退订即退役配额池」同一条不变式的另一半。同样只认 `cancelled`，不动 `expired` /
`suspended`：那两种订阅还会回来，回来时席位要在原位。

授予端点还要挡一条：**被授人必须是该工作区成员**。外键会保证这一点（同上），
但错误消息要由应用层给，DB 抛的外键错没有上下文。

## 4. 附录：成员上限（已实现，不属本文主体）

owner 2026-09-22：「当前简单处理，设定一个比较高的上限，防止恶意爆仓就行」。

因此它是**安全闸**，不是售卖配额：

|            |                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- |
| 平台默认   | `admin.settings` 的 `tenancy/tenant.member_limit`（500）、`tenant.workspace_limit`（200）    |
| 单租户覆盖 | `tenancy.tenants.member_limit` / `workspace_limit`，可空，NULL = 随默认                      |
| 执行点     | `addOrgMember` / `acceptInvitation` / `createWorkspace`（同事务内、insert 之前、已锁租户行） |

**只在租户一层设成员闸**：`fk_workspace_memberships_tenant_member` 强制工作区成员必须先是
租户成员，恒有「任一工作区成员数 ≤ 租户成员数」，再设一层拦不到新东西。

工作区**数量**也堵了：2026-09-05 三号解耦退役 `workspace_counter` 时把唯一的闸（999）一并
去掉了，此后无上限；而建工作区不需要对方有账号，比加成员更好刷。

## 5. 四条裁定与**实况对照**（owner 2026-09-27）

四条已全部裁定。落笔前查了一遍代码，发现**其中两条早已实现**（v3 写成「待定」是因为当时没查），
① 已于 2026-09-27 建成。下表左边是裁定，右边是实况。

|     | 裁定                                                                    | 实况                                                                                                  |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ①   | **要明细表**：「每个产品清楚谁在当前使用」                              | ✅ **已建**（2026-09-27，`metering.product_seats` + 三条库级不变式）                                  |
| ②   | **硬拦 409**「席位已满」，不做超额计费                                  | ❌ **未接**。全仓无执行点，`seat.max` 没有任何读者                                                    |
| ③   | 订阅页撤 `member.max`、上 `seat.max`；Business 发布席位数、个人版默认 1 | ✅ **已做**：`member.max` 已退役、`seat.max` 已登记，默认下限 1；各档位填多少是**发布时的配置**，见下 |
| ④   | 全面迁移到 `seat`，各归其位                                             | ✅ **已做**（`2026-10-27` 退役 + `2026-10-28` 登记）                                                  |

### 键名早就定了：键 `seat.max`，单位 `seats`

owner 2026-09-23 已裁，理由记在 `2026-10-28-seat-max.sql` 的头注：`product_220` 成文的
`limits` 键规范是「键 = `merge_strategy='max'` 的 metric_key，惯例 `{entity}.max`」，裸
`seats` 看不出是上限类、进不了那条规范。与 `member.max` / `dataset.max` /
`service_endpoint.max` 同形。

**「行业是单数还是复数」这个问题，答案是两个都用、用在不同位置**：行业的产品术语是
**seats**（GitHub / Slack / Atlassian 的账单页都这么说），而**限额字段**普遍是单数 +
上限后缀（`maxSeats`、`seat_limit` 这一类）。本仓正落在这个分工上——**键名表意用单数、
单位表量纲用复数**，两回事。

### ③ 的后半：档位席位数是**发布时的配置**，不是代码里的值

owner 2026-09-27 更正了 v4 在这里的写法：「**3 是发布档位的配置，不是写死的，默认最小值是 1。**」

v4 把它写成了「档位梯度在迁移中丢了，要 owner 定数字，且它阻塞硬拦」——两个判断都错：

- **不是丢了，是回到了默认值。** `seat.max` 住在 `plan_components.quota`，是**套餐版本的一个
  字段**，运营在 admin 的套餐版本编辑器里直接填（`PlanVersionsPage.tsx`，quota 以 JSON 录入）。
  `2026-10-28` 给所有缺这个键的组件补的是**默认下限 1**，并且明确「已经写了的不动」——
  它的职责就是保证每个组件都有值，不是替运营定数字。business 要 5、enterprise 要无限，
  发布那一版时填进去即可，随时可改，不需要迁移、不需要改代码。
- **不阻塞硬拦。** 硬拦读的是「这一版套餐写了多少」，填多少拦多少。默认 1 是一个正确的、
  安全的下限（个人版本来就是 1），不是「待定」。

因此本文不再把它当成一个工作项：它是发布流程里的一次录入，和填价格、填周期同一性质。

**2026-09-27 生产只读核实**（`reporting_ro`）：22 个套餐组件的 `seat.max` 全部是 1，
`member.max` 已清干净（22 行全无残留）。这是现值，不是结论——要多少由发布时填。

### 所以还没做的只剩一件

**执行点（②）**：加入 / 移出工作区成员、以及「把某产品授予某人」时写占用；读该订阅所在
套餐版本的 `seat.max`，满了回 409「席位已满」。①（明细表）与三条库级不变式已随
`2026-11-14-product-seats.sql` 落地，`seat.max` 在那之前**全仓没有任何读者**——
执行点是它的第一个读者。

## 6. 不在本文范围

- 席位的**计价**（按席位收费 vs 含在档位里）——归 [`data_commerce_210_billing`](./data_commerce_210_billing.md)。
- 跨工作区的席位共享——现有共享走 `sharing.grants`，与席位是两条线。
