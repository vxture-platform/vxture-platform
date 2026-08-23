# Atlas / Runos 对接：剩余补齐计划（2026-08-23 起）

> **状态（2026-08-24）：P0 / P1 / P2 全部完成，P3 是已判定不做的记录。**
> 本文保留原始判断不改写——其中 P1 第 2 条与整个 P2 分类后来都被推翻了，
> 而"当时为什么这么判、后来为什么错"比一份改干净的清单有用。

本轮做完之后还欠什么，按**风险**排。同批的复核与实测记录见
[`2026-08-23-opera-atlas-runos-contract-audit.md`](./2026-08-23-opera-atlas-runos-contract-audit.md)。

判据沿用 owner 2026-08-23 的口径：**按上游完整契约建，不裁字段；按生产标准建；允许出错，
但错要精准可行动，不许用降级把失败伪装成正常；剩下的缺口列成计划，而不是先搭一个将就的
过程产品。**

---

## ~~P0 · admin 的 atlas 页面正在读一个上游已经不发的字段~~ —— 已完成（2026-08-23）

> 做的时候发现范围远不止 `isActive`：两个记录整个形状是旧版，三条更新路由发 PUT 而
> atlas 只有 PATCH（实测 404）。全部记录在
> [审计文档 §8](./2026-08-23-opera-atlas-runos-contract-audit.md)。**真实登录点检已完成**
> （§8.7），点检时又逼出两条：模型平台页被一个 501 拖垮整页（既有缺陷）、编辑授权
> 404→400→200 三级缺陷。

<details><summary>原始记录</summary>

**这是本轮在 opera 修掉的那个缺陷，在 admin 里还原封不动地活着。** 不是推测，两步实证：

1. **atlas 不再发 `isActive`。** 拿掉 opera-bff 的兼容层之后实测四个资源的在产响应，
   `isActive` 全部消失，只有 `state`（`providers` / `models` / `model-routes` / `api-keys`）。
2. **admin-bff 不做任何归一。** `bff/admin-bff/src/routers/atlas.router.ts` 的 `request()`
   直接返回 `atlasRequest()` 的结果，全文件没有一处 normalize；而
   `src/types/console.types.ts` 里 `ModelProviderRecord` / `AiModelGrantRecord` 等
   **12 处**仍声明 `isActive: boolean`。

于是 admin 侧每一个 `x.isActive` 都是 `undefined`。可预期的表现：

| 位置                                 | 现在会发生什么                                          |
| ------------------------------------ | ------------------------------------------------------- |
| `modules/ai/ModelGrantsPage.tsx:433` | 每一条授权的状态徽标都渲染成「停用」                    |
| 同上 `:547`                          | 启停开关按 `!grant.isActive` 取反 → **永远发 activate** |
| `app/(admin)/page.tsx:406`           | 「生效中的授权」恒为 0                                  |
| `app/(admin)/page.tsx:1561`          | 「启用的模型」恒为 0                                    |

**为什么是 P0**：它不报错。一个把所有授权显示成「停用」的页面，会让运营去"启用"一批本来
就启用着的东西，而每一次点击都是一次真实的写。

**怎么做**：与 opera 这轮同型——把 `features/atlas/state.ts` 那套语汇（`isEnabled` /
`isServing`，见下）搬过去，类型改 `state`，逐处判断 `deprecated` 归哪边。admin 的 atlas
页面比 opera 少（grants / price-rules / policies / quotas + 仪表盘两处），估一批能做完。

> 注意 `isServing` 那条：admin 的模型下拉喂的是价格规则与策略，**弃用模型仍然要能选到**
> ——它还在服务，还在产生账单。机械替换成 `state === "active"` 会让这批模型的价格规则没法
> 维护，而它们正在计费。

</details>

---

## ~~P1 · 上游给了、门户还没接出来的~~ —— 三条全部完成（2026-08-24）

> 落点：C9（第 1 条）、C10（第 2、3 条），见
> [`docs/70-workplan/30-l1-consistency-audit.md`](../docs/70-workplan/30-l1-consistency-audit.md)。
>
> **第 2 条的判断当时是错的。** 这里写"门户接出来即可"，实际不成立：生效的 wire 是三层
> 叠加，门户自己算就得复刻上游的逐键合并语义，而那是同一个事实的第二个来源。改成
> atlas 直发 `resolvedWire`（已随 v0.2.0 上线）。

### 1. runos 三条审计流只取第一页

`RunosCallStreams.tsx` 拿到 `nextCursor` **不消费**（源码原话："本页暂只取第一页"）。
上游把 `limit` 服务端 clamp 到 1000，所以现在能看的上限就是最近 1000 条，再早的**读不到**，
而界面上没有任何东西说这件事。

按本轮的判据这是"少报而不说"——比 atlas 请求日志那侧差一档（那边有「加载更多」）。
做法照抄 atlas 侧：游标不透明、只能顺序前进，所以做「加载更多」不做页码。

### 2. atlas provider / model 的 `config`（含 `config.wire`）不可见不可编

`GET /capability/protocols` 回的 `wireDefaults` 是**管理 UI 协议下拉的唯一数据源**，
opera 已经用它喂了协议选择，但**没有把 `config.wire` 本身接出来**：一个模型实际生效的
wire 描述符只在「自检」结果里露一次（`ModelProbeResult.wire`），平时看不到、改不了。

后果是配置漂移不可见：`behaviorVersion` 会变（本轮已把它接出来了），但**变成了什么**要靠
跑一次自检。建议：模型详情里展示 `config`，wire 段按协议默认值做 diff 显示。

### 3. runos `capability_call` 的成本与配额维度没进界面

上游一行有 `costAmount` / `costUnit` / `quotaCounterBefore` / `quotaLimit` / `bytesIn/Out` /
`matchedPolicyIds` / `degradedMode`，opera 的调用流水表只呈现了时间 / 能力 / 调用方 / 计量归属 /
延迟 / 裁决 / 结果。计量与配额那几维**恰恰是运营最常被问的**（"这个产品这个月烧了多少"）。

---

## ~~P2 · 需要真实数据才能验的~~ —— 两条全部完成（2026-08-24），**而且都不是数据问题**

> 落点：C11。这个分类本身是错的，值得记下来：
>
> - **第 4 条**不是"数据碰巧没交集"，是当前能力目录里**没有任何一条端点打到 atlas**，
>   而且门户侧的接缝三处都是断的（atlas 表没有 taskId 列、runos 调用流不能按 taskId
>   过滤、两表无共享状态）——**即使有交集数据也走不通**。
> - **第 5 条**不需要预发环境：本地停一次 atlas 的库就是演练，十分钟。做了，抓出两个
>   上游缺陷（`database` 检查是唯一不查数据库的；`blocked` 时 `/readyz` 要二十秒，
>   于是 4 秒探测的控制台从来没见过它）。
>
> **「等外部条件」是一个很容易长期停在原地的分类** —— 它听起来像一个决定，实际上是一次
> 没做的检查。两条都是走过去看一眼就发现的。

### 4. `taskId` 跨产品串联没有数据可证

atlas 请求日志与 runos `capability_call` **共用 `taskId`**，本轮已经把过滤器两边都接上，
atlas 侧实测按 taskId 过滤命中 8 行。但本机 dev 数据里**两边的 taskId 没有交集**（各是各的
冒烟批次），所以"一次 agent 任务在模型面与能力面各发生了什么"这条路径**从未被真的走通过**。

要验它，需要一次真实的跨产品调用：agent 经 runos 调一个能力、该能力再经 atlas 调模型，
两条流水带同一个 taskId。这是 karda / arda 那侧的联调，不是本仓能自造的。

### 5. atlas `blocked` 时服务状态页的表现

本轮把翻译函数（`readinessFromBody`）钉进了单测，但**没有在真实 atlas 上制造过 `blocked`**
——那要停 atlas 的数据库。等有预发环境或一次计划内演练时补这一次实测。

---

## P3 · 已知但判定为不做（记录判断，避免下一个人重开）

| 项                                                        | 判断                                                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /capability/provider-keys/:id` 不代理             | 删一把 provider key 会 CASCADE 掉 `key_rotation_logs`（它的轮换史）。vault 的生命周期靠停用/轮换已经完整，加一个会抹掉审计线索的入口不符合"可靠稳定"。                     |
| `POST endpoint-instances/:id/activate\|deactivate` 不代理 | runos 端点是三态（`active`/`draining`/`disabled`），二元开关表达不了 `draining`——这正是 B-3 的判据本身。走通用的 `PATCH .../state`。                                       |
| provider `logoUrl` 不录入不展示                           | owner 既有决定；atlas 对**未出现**的键按"不改"处理，所以老数据不会被 opera 的保存抹掉。                                                                                    |
| 其余 POST 不做状态码透传                                  | 上游只有两条路由用状态码承载信息（`capability-grants` / `endpoint-instances`），已接。其余上游只有一个成功状态，"透传"一个恒定值是仪式不是契约。上游加第三条时这里跟着加。 |

---

## 本轮立下、后续要沿用的两条约定

**一、状态语汇集中在 `portals/opera/src/features/atlas/state.ts`。**
两个函数，各自说清在问什么：`isEnabled(state)`（运营把它设成开着吗）与
`isServing(state)`（它现在还能不能承接调用，`deprecated` 算能）。迁移不是把 `isActive`
替换成一个表达式，而是替换成**一个说清自己在问什么的名字**——判断只做一次，调用点只负责
选对问题。admin 那批照搬这套。

**二、上游必有字段的缺失是故障，不是显示问题。**
`bff/opera-bff/src/routers/atlas-contract.ts` 在列表读的出口断言必有字段，缺了直接
502 `ATLAS_CONTRACT_FIELD_MISSING` 并点名"哪个资源缺哪个字段"。它取代的是一批"上游落后就
换套说法"的降级分支——那些分支的共同问题是**把一个坏掉的契约渲染成一个正常的界面**。

界线要记住：**端点/整根轴不存在**（上游明确回 404/400）→ 如实转述，那是精准的错误提醒，
`STALE_ATLAS_HINT` 就是给这种情况的；**字段缺失**（上游回 200 + 一个缺胳膊的对象）→ 断言，
因为没人说不，只能由我们说。

新增断言字段时**必须反向验证**：把缺陷退回去，确认它真的报错（`atlas-contract.spec.ts`
的第二个 describe 就是干这个的）。没红过的守卫等于没有。
