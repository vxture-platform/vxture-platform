# Commerce 域细化设计：产品席位（附：成员上限防滥用闸）

<!-- data-architecture: target-state -->

> 状态：v3 草案 · 编号 `data_commerce_250`（细化设计层）· 待评审 · 未实施
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

```
metering.product_seats
  id            uuid        pk
  workspace_id  uuid        not null
  product_id    uuid        not null
  user_id       uuid        not null
  granted_by    uuid
  granted_at    timestamptz not null
  revoked_at    timestamptz                -- 软撤销：回收要留痕，否则查不出谁占过
  unique (workspace_id, product_id, user_id) where revoked_at is null
```

占用数 = 该 `(workspace_id, product_id)` 下 `revoked_at is null` 的行数。

**外键应当指向 `tenancy.workspace_memberships (workspace_id, user_id)` 并带 `ON DELETE CASCADE`**，
理由见 §3：这样「人走席位留」这个最容易漏的问题由数据库兜住，与成员那条的做法一致。

> 不复用 `metering.subscription_entitlement_overrides`：那张表一行代表一条**配额调整**，
> 不代表一个人。把人塞进去，同一张表就有了两种行。

## 3. 在哪执行

判据落在**写入那一刻**，不是读取时提示——否则超限是既成事实。

| 动作               | 执行点           | 超限                    |
| ------------------ | ---------------- | ----------------------- |
| 授予某人某产品席位 | 新的席位授予端点 | 409「该产品席位已满 N」 |
| 移出工作区 / 租户  | —                | **由外键级联**，见下    |

**人走了席位不会自己消失**，这是席位模型最容易漏的一件事。成员那条已经有先例可循：
`fk_workspace_memberships_tenant_member` 带 `ON DELETE CASCADE`，所以移出租户时工作区成员
自动清掉。`product_seats` 照此把外键指向 `workspace_memberships` 并级联，就能让「移出工作区
→ 席位消失」同样由数据库保证，而不是靠应用层记得删。

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

## 5. 待定项（只有 owner 能定）

**① 席位是否要「谁占了」的明细。** §2 主张要（新增 `product_seats`）。只要个数不要人的话，
加一个计数列就够，成本小一个数量级——代价是查不出谁占着，也做不了精确回收，
「人走席位留」也没法靠外键兜。

**② 超限行为**：硬拦（409）还是允许超出并计费。本文按硬拦写。

**③ 官网文案。** `subscription.quotaLabels` 目前把 `member.max` 显示成「席位 / Seats」。
按本设计「席位」应当留给 `seat.max`，而 `member.max` ——按 §4 它已不是售卖配额——
**应当整个从订阅页撤下**，不再作为档位卖点展示。这是**面向客户的改动**，需 owner 单独点头。

**④ 存量 `member.max` 怎么退役。** 它现在挂在 arda 名下、是 `merge_strategy='max'` 的产品指标、
被官网当席位展示，且**全仓零执行点**（三个 BFF、services、packages 一处不读）。

退役不是删个指标就完：**10 个套餐组件的 `quota` 里写着它**（arda 全档，enterprise 为 `-1` 无限）。

```
arda-free 1 · arda-starter 1 · arda-pro 1 · arda-business 5 · arda-enterprise -1 · arda-beta-trial 1
```

这些值现在**不生效任何东西**（无人读），但它们出现在套餐配额清单里，运营与客户都看得见。
退役要连着回答：这些档位差异（1/5/无限）是**真的要卖**的能力，还是当初照抄的占位？

- 是要卖的 ⇒ 它其实就是**席位**，应当改名 `seat.max` 并按 §1 重新接上，而不是删掉
- 是占位 ⇒ 从 10 个组件的 `quota` 里摘掉，指标一并退役

这一条与 ① 相关：若走前者，席位模型立刻有了真实的档位数据，不用另造。

## 6. 不在本文范围

- 席位的**计价**（按席位收费 vs 含在档位里）——归 [`data_commerce_210_billing`](./data_commerce_210_billing.md)。
- 跨工作区的席位共享——现有共享走 `sharing.grants`，与席位是两条线。
