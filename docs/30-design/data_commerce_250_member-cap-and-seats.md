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

> **v4（2026-09-27）**：四条待定 owner 已全部裁定，见 §5。主体设计未变——裁定的结果恰好都落在本文原本主张的那一侧（要明细表、硬拦、席位归 `seat.max`、存量改名而非删除）。

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

## 5. 四条裁定（owner 2026-09-27）

四条待定已全部裁定。本节保留原问题的措辞，便于对照当时在纠结什么。

### ① 要明细表 —— 「每个产品清楚谁在当前使用」

建 `metering.product_seats`（§2 的方案），不走「只记个数」的省事路子。

owner 的原话把用途说死了：要能按产品查出**当前是谁在用**。计数列答不了这个问题，也做不了
精确回收。附带的好处是 §2 那条外键成立——`product_seats` 指向 `workspace_memberships`
并级联，**「人走席位留」由数据库兜住**，不靠应用层记得删。

### ② 超限硬拦（409），文案「席位已满」

不做超额计费。硬拦的前提是席位占用有权威来源，① 已经给了。

### ③ 订阅页撤下 `member.max`，换成 `seat.max`

owner：「订阅页撤销 `member.max`，但是需要 `seat.max`，这是产品的席位」。

- `subscription.quotaLabels` 里「席位 / Seats」这个标签**归 `seat.max`**，`member.max`
  整个从订阅页撤下——按 §4 它已不是售卖配额。
- **Business 档必须发布 `seat.max`**（它本来就是按席位卖的单位）。
- **个人版默认 1 席**。

### ④ 全面迁移到 `seat.max`，各归其位

owner：「是否要全面迁移，改为 seat，各归其位」——**是**。所以 §5-④ 那两条岔路走的是
**前者**：那些档位差异（1 / 5 / 无限）是真要卖的能力，它**本来就是席位**，只是名字错了。

迁移 = 改名 + 接上，不是删除：

```
arda-free 1 · arda-starter 1 · arda-pro 1 · arda-business 5 · arda-enterprise -1 · arda-beta-trial 1
```

这 10 个套餐组件 `quota` 里的 `member.max` 改成 `seat.max`，与 owner 的 ③ 正好吻合——
个人档（free / starter / pro / beta-trial）都是 1，business 是 5，enterprise 是 -1（无限）。
**席位模型因此一上来就有真实档位数据，不用另造。**

### 键名用单数 `seat.max`

与本仓既有键同形：`member.max`、`storage.bytes`、`ai.credit` 都是「单数名词 + 属性」，
也符合 `product_220` 的 `limits` 键规范。owner 口述时写过 `seats.max`，此处按既有规范落单数；
要改成复数的话，改的是这一处定义与 10 个组件的值，越早越便宜。

### 实施顺序（判据：先有权威，再有执行点，最后才动客户看得见的东西）

1. **建表 + 迁移**：`metering.product_seats`、外键级联、列锁；`member.max → seat.max` 改名
   迁移（10 个组件 + 指标本身）。此时行为不变，只是有了权威源。
2. **接执行点**：席位占用的写入方（加入 / 移出工作区成员时）、`seat.max` 的读取与硬拦（409
   「席位已满」）。这一步开始真的拦人。
3. **动客户可见面**：订阅页撤 `member.max`、上 `seat.max`；官网档位文案。
   放最后，因为前两步没落地时撤掉旧标签会让订阅页出现「本来有、现在没有」的空档。

## 6. 不在本文范围

- 席位的**计价**（按席位收费 vs 含在档位里）——归 [`data_commerce_210_billing`](./data_commerce_210_billing.md)。
- 跨工作区的席位共享——现有共享走 `sharing.grants`，与席位是两条线。
