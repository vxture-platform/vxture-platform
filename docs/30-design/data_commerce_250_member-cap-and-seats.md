# Commerce 域细化设计：成员上限与产品席位（两个维度）

<!-- data-architecture: target-state -->

> 状态：v2 草案 · 编号 `data_commerce_250`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 姊妹文件：[`data_commerce_200_metering.md`](./data_commerce_200_metering.md)（计量内核）、[`product_220_catalog-resource-model.md`](./product_220_catalog-resource-model.md)（销售轴合并规则）
> 缘起：owner 2026-09-22 口述「成员上限是工作区可以加入的成员数，租户应该也有这个限额，如 100 人；席位是针对产品来说的，如销售智能体 10 席位、方案智能体 5 席位，都来自这 100，可能还有重叠」。
> v2 说明：owner 2026-09-22「忽略现状包袱，重新设计」。本版按目标态写，不迁就 `member.max` 的现有挂载。

---

## 0. 两个维度

**成员上限（member cap）**：某个**容器**能装多少个自然人。与产品无关。

**席位（seat）**：某个**产品**在某个容器里，允许多少个自然人使用。与产品强相关。

owner 原话「都来自这 100，可能还有重叠」定下两条不变式：

- 席位的候选人必须先是成员 ⇒ **单个产品的席位数 ≤ 所在容器的成员上限**
- 同一个人可同时占多个产品的席位 ⇒ **各产品席位数之和不设上限**

第二条最容易写反：销售 10 + 方案 5 = 15，**不需要** ≤ 100；只有单个产品要 ≤ 100。

## 1. 容器有两层，计数口径不同

| 层     | 成员表                                                  | 上限的含义                 |
| ------ | ------------------------------------------------------- | -------------------------- |
| 租户   | `tenancy.tenant_memberships` (tenant_id, user_id)       | 该租户**去重后**能装多少人 |
| 工作区 | `tenancy.workspace_memberships` (workspace_id, user_id) | 单个工作区能装多少人       |

**去重是租户层的关键**：一个人同时在三个工作区里，对租户只算一次。否则「100 人」会被工作区数量放大，
owner 说的那个 100 就不是 100 了。

不变式：

```
任一工作区的成员数            ≤ 该工作区的成员上限
租户内各工作区成员的并集人数  ≤ 该租户的成员上限
```

## 2. 成员上限不由产品订阅给（与现模型的关键差别）

现模型把 `member.max` 做成 `merge_strategy='max'` 的**产品指标**，即
[`product_220`](./product_220_catalog-resource-model.md) §2 销售轴的 `limits` **就高合并**——
买任何一个产品的高档套餐，都会抬高这个工作区能装的人数。

**本设计不沿用这条。** 理由：owner 把两个维度分开，正是因为「容器能装多少人」与「某产品能给几个人用」
是两件事。让买 karda 抬高工作区人数上限，等于把刚分开的两个维度又揉回去；而且会产生一个说不清的
局面——退订 karda 之后，已经加进来的人怎么办。

**成员上限 = 容器自身的属性**，来源在平台侧（租户档位 / 运营设定）：

```
tenancy.tenants.member_limit      int  -- 租户去重人数上限
tenancy.workspaces.member_limit   int  -- 单工作区人数上限
```

不进 `quota_pools` 的理由：那张表的语义是**订阅 → 权益的投影**（带 `subscription_id`、带
`reset_period`、走 consume 路径）。成员上限没有周期、不被消费、也不来自某一笔订阅——
塞进去会让那张表同时是两种东西。

> 这是本设计最需要 owner 确认的一处判断，见 §6-①。

## 3. 席位由产品订阅给，复用现成的销售轴

席位**是**产品卖出去的东西，所以它正好落在既有机制上，不需要新规则：

- 目录侧：`product_metrics` 增加 `seat.max`，`merge_strategy='max'`，符合
  [`product_220`](./product_220_catalog-resource-model.md) 的 `limits` 键规范（`{entity}.max` 命名惯例）
- 套餐侧：各档位在 `limits` 里给出 `seat.max`（-1 = 无限哨兵）
- 生效侧：`metering.quota_pools`，`product_id` = 该产品，`metric_key = 'seat.max'`

**键名统一为 `seat.max`，不做 `karda.seat` / `arda.seat`。** 按产品分的是 `product_id` 这一列，不是键——
与 2026-09-22 已落地的「计量项命名是**键**的属性、不是 (产品, 键) 的属性」同一条道理。

## 4. 席位需要一张占用表

成员上限能直接数成员表；**席位数不出来**——「谁在用哪个产品」这条关系库里不存在。
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

> 不复用 `metering.subscription_entitlement_overrides`：那张表一行代表一条**配额调整**，
> 不代表一个人。把人塞进去，同一张表就有了两种行。

## 5. 在哪执行

判据落在**写入那一刻**，不是读取时提示——否则超限是既成事实。

| 动作                | 执行点                                       | 超限                       |
| ------------------- | -------------------------------------------- | -------------------------- |
| 邀请成员 / 接受邀请 | `console-bff` iam.router 的 invitations 路径 | 409「已达成员上限 N」      |
| 运营侧加租户成员    | `admin-bff` 租户成员写入                     | 同上                       |
| 把成员加进工作区    | 同 iam.router                                | 409「该工作区已达上限 N」  |
| 授予某人某产品席位  | 新的席位授予端点                             | 409「该产品席位已满 N」    |
| 移出工作区          | 同一处                                       | 连带撤销该人在本区全部席位 |
| 移出租户            | 同一处                                       | 连带移出全部工作区并撤席位 |

最后两条最容易漏：**人走了席位不会自己消失**，留下的行指向已非成员的人，占用数还虚高。

## 6. 待定项（只有 owner 能定）

**① 成员上限的来源。** §2 主张「容器属性、平台侧给」，而现模型是「产品套餐就高合并」。
选后者的话，成员上限仍是 `quota_pools` 里的一条，改动量小得多，但两个维度会继续纠缠。

**② 租户上限与工作区上限谁约束谁。** §1 写的是各查各的（并集 ≤ 租户上限、单区 ≤ 工作区上限）。
另一种做法是只设租户上限、工作区不限——少一层判据，但一个工作区可以把租户名额吃光。

**③ 席位是否要「谁占了」的明细。** §4 主张要（新增 `product_seats`）。只要个数不要人的话，
加一个计数列就够，成本小一个数量级——代价是查不出谁占着，也做不了精确回收。

**④ 超限行为**：硬拦（409）还是允许超出并计费。本文按硬拦写。

**⑤ 官网文案。** `subscription.quotaLabels` 目前把 `member.max` 显示成「席位 / Seats」，
按本设计它应当是「成员上限 / Members」，而「席位 / Seats」留给新的 `seat.max`。
这是**面向客户的改动**，会进订阅页与账单口径，按既有规矩需 owner 单独点头。

## 7. 不在本文范围

- 席位的**计价**（按席位收费 vs 含在档位里）——归 [`data_commerce_210_billing`](./data_commerce_210_billing.md)。
- 跨工作区的席位共享——现有共享走 `sharing.grants`，与席位是两条线。
- `member.max` 之外其余 18 个计量键的中文名（入口在 opera 产品接入页每行的「命名」）。
