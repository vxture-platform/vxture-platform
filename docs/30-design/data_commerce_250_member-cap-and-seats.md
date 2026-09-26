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

> **v4（2026-09-27）**：四条待定 owner 已全部裁定。**同时查出本文 v3 有一半已经过时**——`seat.max` 与 `member.max` 退役在 2026-10-27/28 就实现了，v3 仍把它们写成「待定」，因为当时没查代码。§5 已改成「裁定 × 实况」对照表，并记下一个在那两条迁移之间丢掉的档位梯度（business 的 5 席变成了 1）。**本文从此陈述实况，不再陈述目标态**。

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

## 5. 四条裁定与**实况对照**（owner 2026-09-27）

四条已全部裁定。但落笔前查了一遍代码，发现**其中两条早已实现**——本文 v3 写成「待定」是
因为当时没查。下表左边是裁定，右边是 2026-09-27 查到的实况。

|     | 裁定                                                                    | 实况                                                                                  |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ①   | **要明细表**：「每个产品清楚谁在当前使用」                              | ❌ **未建**。`metering.product_seats` 全仓不存在                                      |
| ②   | **硬拦 409**「席位已满」，不做超额计费                                  | ❌ **未接**。全仓无执行点，`seat.max` 没有任何读者                                    |
| ③   | 订阅页撤 `member.max`、上 `seat.max`；Business 发布席位数、个人版默认 1 | ⚠️ **一半**：`member.max` 已退役、`seat.max` 已登记且默认 1；但**档位梯度丢了**，见下 |
| ④   | 全面迁移到 `seat`，各归其位                                             | ✅ **已做**（`2026-10-27` 退役 + `2026-10-28` 登记）                                  |

### 键名早就定了：键 `seat.max`，单位 `seats`

owner 2026-09-23 已裁，理由记在 `2026-10-28-seat-max.sql` 的头注：`product_220` 成文的
`limits` 键规范是「键 = `merge_strategy='max'` 的 metric_key，惯例 `{entity}.max`」，裸
`seats` 看不出是上限类、进不了那条规范。与 `member.max` / `dataset.max` /
`service_endpoint.max` 同形。

**「行业是单数还是复数」这个问题，答案是两个都用、用在不同位置**：行业的产品术语是
**seats**（GitHub / Slack / Atlassian 的账单页都这么说），而**限额字段**普遍是单数 +
上限后缀（`maxSeats`、`seat_limit` 这一类）。本仓正落在这个分工上——**键名表意用单数、
单位表量纲用复数**，两回事。

### ⚠️ 一个真问题：档位梯度在迁移中丢了

`member.max` 退役前的值是：

```
arda-free 1 · arda-starter 1 · arda-pro 1 · arda-business 5 · arda-enterprise -1 · arda-beta-trial 1
```

而 `2026-10-27` 是**摘掉**这个键，`2026-10-28` 是给所有缺键的组件**一律补 1**。两条合起来的
净效果：**business 的 5 与 enterprise 的 -1（无限）没有被继承，全都变成了 1。**

那两条迁移各自都对（退役一个不生效的占位、给必须项补默认值），**错在它们之间没有人负责
把梯度接过去**——这正是 owner 2026-09-27 ④「各归其位」想要的东西，而当时并没有发生。

**2026-09-27 生产只读核实**（`reporting_ro`）：**22 个套餐组件的 `seat.max` 全部是 1**，
`arda-business`、`arda-enterprise` 也是 1；`member.max` 已清干净（22 行全无残留）。

```
arda-beta-trial 1 · arda-business 1 · arda-enterprise 1 · arda-free 1 · arda-pro 1
arda-starter 1 · karda-* 1 · umbra-* 1 · vxtpl-* 1        （含 draft 版本）
```

与 ③ 直接冲突：**Business 是按席位卖的单位，它现在是 1 席；Enterprise 原本的「无限」
（-1）也变成了 1。**

补法不是再写一条「把 business 改成 5」的迁移就完：**5 这个数字本身是从退役的占位里继承来
的，它当初是不是认真定的？** 定档位数字是定价决定，留给 owner。查清生产现值是第一步。

### 所以真正还没做的是三件

1. **`metering.product_seats`**（① 的明细表）——含指向 `workspace_memberships` 的级联外键，
   「人走席位留」靠库兜住；建表 + 列锁 + 迁移。
2. **执行点**（②）——加入 / 移出工作区成员时写占用；读 `seat.max` 硬拦 409「席位已满」。
   在 ① 之前做不了：硬拦需要「现在占了几个」这个权威数。
3. **档位梯度**（③ 的后半 + 上面那个真问题）——先查生产现值，再由 owner 定各档席位数。

顺序判据仍是「先有权威，再有执行点，最后才动客户看得见的东西」：1 → 2 → 3。
订阅页那一步已经不欠了——`member.max` 早已撤下，`seat.max` 也在展示。

## 6. 不在本文范围

- 席位的**计价**（按席位收费 vs 含在档位里）——归 [`data_commerce_210_billing`](./data_commerce_210_billing.md)。
- 跨工作区的席位共享——现有共享走 `sharing.grants`，与席位是两条线。
