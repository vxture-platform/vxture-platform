# L1 产品一致性审查 · 计划

> **状态**：C1 对照表已出（2026-08-16）；C2 判定见表内一列；C3/C4 见文末。
> **配套**：opera 侧的目录重构见 [`20-opera-ia-restructure.md`](./20-opera-ia-restructure.md)（六批已完成）。

## 为什么要做

Atlas、Runos、统一平台（platform）**都是 L1 层产品**。它们各自演进出了自己的一套
词表、接口形状与界面逻辑，而消费方（opera / admin / console）要同时对着三套。每处
不一致都会在两者相接的地方还回去——已经踩到的几处：

| 已实测的不一致                                                                                         | 后果                                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Atlas `GET /capability/product-grants` 回全量并支持过滤；Runos `commerce/grants` **只能按单主体查**    | opera 同一类清单要写两套取数，能力那半是 N+1（已开 `vxture-runos#98`） |
| Atlas 的 provider 有 `console_url` / `billing_url` / `logo_url` 三列；Runos 的 capability 没有对等概念 | 「去对方控制台」这类运营动作只在模型面成立                             |
| Atlas 用 `isActive` 布尔 + `activate/deactivate`；Runos 用 `state` 枚举 + 生命周期路由                 | 同样是「停用」，两边的动作名、返回形状、审计事件都不同                 |
| Runos 有 `display_name`（locale map）；Atlas 的 provider/model **只有单语言 `*_name`**                 | 同一个控制台里，能力有中文业务名、模型没有                             |
| Atlas 写操作即时生效；Runos 走快照，撤销后**最多再放行一轮**                                           | 「撤销」在两个域里是两种语义，界面必须各写一段说明                     |

## 判据

**差异只能是业务必须的差异。** 判据是一句话：

> 如果两个上游对同一件事给出不同形状，而这个差异**无法用「它们做的事本来不同」解释**，
> 那它就是历史造成的，该收敛。

举例——

- **是业务差异**：Runos 的能力有依赖闭包（ADR-005），Atlas 的模型路由没有。所以 Runos
  的授权有 `derived` 行而 Atlas 没有，这个差异是对的。
- **不是业务差异**：一个用 `isActive` 一个用 `state`。两边表达的都是「这个对象现在算不算
  数」，形状不同纯粹是各写各的。

## 四条轴

| 轴       | 查什么                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **名称** | 同一个概念在三处叫什么。`grant` / `授权` / `权益`；`endpoint` 在 Atlas 是路由、在 Runos 是端点实例——**这两个真的是不同的东西，但名字撞了** |
| **接口** | 列表能不能过滤、能不能批量、分页是游标还是页码、错误码结构、软删 vs 状态迁移                                                               |
| **逻辑** | 停用/撤销的语义（即时 or 快照）、幂等的定义、写入是不是覆盖、审计事件的粒度                                                                |
| **风格** | 字段命名（`camelCase` / `snake_case` 边界）、时间格式、空值用 `null` 还是缺键、布尔 vs 枚举                                                |

## 做法

**先出对照表，再谈收敛**——不要一上来提改动。每一条都要有实证（源码行号、DDL、真实
数据填充率），不能是"我觉得应该一致"。这是本仓反复吃过亏的地方：
`docs/30-design/product_250_management-plane-contract.md` v0.2 的跨仓边界纪律写着
**契约是问出来的，不是推出来的**。

批次建议：

| 批  | 内容                                                                         |
| --- | ---------------------------------------------------------------------------- |
| C1  | 三方对照表：把 Atlas / Runos / platform 的**每个管理面对象**按四条轴逐列填满 |
| C2  | 标注每条差异属于「业务必须」还是「历史造成」，后者给收敛方向                 |
| C3  | 按上游分别开 liaison issue（一件事一条），platform 侧自己的部分直接改        |
| C4  | 收敛后回头复核 opera / admin 的适配层能删掉多少                              |

## 不在本计划内

- **运行面**（网关、执行器、推理路径）的一致性。这里只审**管理面**——它才是三个产品
  同时暴露给同一批运营者的那一面。
- 立即动手改上游。C1/C2 的产出是**对照表与判定**，改不改、什么时候改由各仓 owner 定。

---

# C1 · 三方对照表（2026-08-16 实测）

**取数方式**：直接枚举三方的 HTTP 面与源码，不引用文档。行号为当日实测。
（atlas `runtime/model-admin.controller.ts`、runos `registry|governance/*.controller.ts`、
platform 侧取 `bff/opera-bff/src/routers/*`——platform 的管理面对外就是这一层。）

## 0 · 管理面对象清单

| 产品                                  | 对象                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atlas** `@Controller("capability")` | `protocols` / `providers` / `endpoints` / `models` / `product-grants` / `grants` / `price-rules` / `policies` / `quotas` / `usage-summaries`，另有 `api-keys`、`provider-keys` 两个独立 controller |
| **Runos**                             | `capability/capabilities`（含 versions、certification、official、reembed）、`capability/endpoints`、`commerce/grants`（含 quota）、`governance/credentials`、`audit/*`                             |
| **platform**（opera-bff）             | `product/catalog`（含 webhook、checklist）、`oidc-client`、`maintenance-windows`、`tenancy-directory`                                                                                              |

## 1 · 接口轴

| 项               | Atlas                                                                           | Runos                                                                                                                                                         | platform                                                                           | C2 判定                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CRUD 形状**    | **七类对象完全同形**：`GET {o}` / `POST {o}` / `PUT {o}/:id` / `DELETE {o}/:id` | **无统一形状**：`PATCH capabilities/:id` + 动词子资源 `/promote`、`/certification`、`/official`、`/reembed`、`/versions/:v/lifecycle`、`endpoints/:id/status` | 混合：`PUT :id` + `PATCH :id/status` + `POST :id/start\|complete\|cancel`          | **历史造成**。三方都在表达「改一个对象」，形状不同纯粹是各写各的                                                                                                   |
| **启停**         | 统一 `POST :id/activate` + `POST :id/deactivate`，**七类对象都有**              | **没有这对路由**，改走 `PATCH .../lifecycle`、`PATCH endpoints/:id/status`                                                                                    | `PATCH :id/status`（产品、客户端）/ `POST :id/start\|complete\|cancel`（维护窗口） | **部分业务差异**：runos 的版本生命周期确有 `deprecated`（仍可解析）这类中间态，不是布尔能装下的；但**能力与端点的启停**与 atlas 的 provider 启停是同一件事，该收敛 |
| **反向查询**     | 查询参数：`GET product-grants?endpointCode=`                                    | **路径段**：`GET grants/by-capability/:capabilityId`                                                                                                          | 查询参数：`GET oidc-client?productId=`                                             | **历史造成**。同一个「反查持有者」，一个是参数一个是路径                                                                                                           |
| **批量按主体查** | `GET product-grants?productCode=&endpointCode=`，可不带参回全量                 | `GET grants?subjectRefs=`（逗号列表，**上限 100**，**必填**——刻意不给无过滤全量）                                                                             | `GET catalog?origin=&status=`，可不带参回全量                                      | **业务差异**：runos 的「不给裸全量」是有意的资源保护，atlas/platform 的对象基数小。**但上限值与超限行为该对齐**（runos 超限整批 400，不是截断）                    |
| **分页**         | 管理面**全不分页**（全量回，前端分页）；观测面 `cursor` + `limit`               | 管理面不分页；`audit/*` 只有 `limit`（钳制，无 cursor）                                                                                                       | 管理面**全不分页**                                                                 | **半业务差异**：管理面基数小、不分页合理；但**审计/日志面一个 cursor 一个纯 limit**，同样是无界流水，该收敛                                                        |

## 2 · 风格轴

| 项                      | Atlas                                                                                                                                 | Runos                                                                                      | platform                                                                    | C2 判定                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **错误码**[^atlas-code] | 管理面 `SCREAMING_SNAKE` **带模块前缀**（`OBSERVABILITY_INVALID_CURSOR` 等）；**消费面 `/v1` 有 25 处裸字符串异常，一个 code 都没有** | `lower_snake` **无前缀**：`missing_subject_refs`、`too_many_subject_refs`、`executor_busy` | **没有 code**，抛裸字符串：`BadRequestException("isSatisfied is required")` | **历史造成，且这条最贵**。消费方要按错误分支处理时，三方要写三套：一套匹配前缀常量、一套匹配裸 snake、一套**只能匹配文案**——文案一改就断 |
| **字段命名**            | 出参 `camelCase`（`consoleUrl`/`billingUrl`），DDL `snake_case`                                                                       | 同                                                                                         | 同                                                                          | **一致**，无需动                                                                                                                         |
| **ID 参数名**           | `:providerId` / `:modelId` / `:endpointId` / `:priceRuleId`（**带类型前缀**）                                                         | `:id` / `:grantId` / `:bindingId`（**混用**）                                              | `:id` / `:clientId` / `:itemCode`（混用）                                   | 历史造成，但**低价值**——不影响消费方                                                                                                     |

## 3 · 逻辑轴

| 项                     | Atlas                        | Runos                                                                             | platform                           | C2 判定                                                                                       |
| ---------------------- | ---------------------------- | --------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| **「算不算数」的表达** | `isActive` 布尔              | `state` / `status` / `lifecycle` **三个词**分别用在 grant / endpoint / version 上 | `status` 枚举                      | **历史造成**。runos 内部三个词就已经不统一——这一条不用等跨仓，仓内先收敛                      |
| **撤销语义**           | 即时生效                     | **快照**：撤销后最多再放行一轮；`revoke` 是状态迁移不是删除，**不级联** derived   | 即时                               | **业务差异**，是对的（ADR-005 闭包 + 网关快照）。但**界面必须各写一段说明**，这个成本记在账上 |
| **删除**               | `DELETE` = 软删（`incr/10`） | `DELETE grants/:grantId` = 撤销（状态迁移）                                       | `PATCH :id/status` 到 `deprecated` | **历史造成**：同一个 HTTP 动词在两边一个是软删一个是状态迁移                                  |

[^atlas-code]:
    **2026-08-17 更正（由 atlas 在 [`atlas#203`](https://github.com/vxture/vxture-atlas/issues/203) 指出）。**
    原文写的是「Atlas 的错误封套**形状已经符合**……本条以它为基准」，**这是错的**。
    我取证时扫的是 `code:` 字面量，所以只看见合格的那批样本；扫不到的是**根本没有 `code`**
    的那些——atlas `/v1` 面上有 25 处裸字符串 `BadRequestException`，Nest 渲染成
    `{statusCode, message, error}`。也就是说，本表判 platform「没有 code、三家最差」时，
    **同一个毛病 atlas 消费面也有，只是被合格的部分盖住了**。
    取证方法本身有缺陷：**扫「符合的样子」只能证明存在合规样本，证明不了不存在违规样本**
    ——而要找的正是后者。
    atlas 另报告一处本表没查到的：已发布词表与实际抛出的词表**两个方向都对不上**（3 个声明了
    从不抛、2 个抛了从不声明），其中 `QUOTA_EXHAUSTED` 与实际的 `QUOTA_EXCEEDED` 不符，
    使 karda 那条「挂起任务等配额恢复」的分支永不命中。两处均已由 atlas 修复（#199）并加 CI 守卫。

## 4 · 名称轴 —— **最需要先解决的一条**

| 词              | Atlas                                                                                           | Runos                                        | platform                           |
| --------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| **`grants`**    | **两个都叫这个**：`product-grants`（产品→模型入口）与 `grants`（租户→模型，带 `applicationId`） | `commerce/grants`（产品→能力）               | 商业面 grants 归 admin，opera 不碰 |
| **`endpoints`** | 模型**路由**（`chat/default` 这类，指向 primary/fallback 模型）                                 | 能力的**端点实例**（版本 + 环境 + Base URL） | —                                  |

`grants` 一个词在同一个控制台里指**三件不同的事**，且 atlas 自己就占了两个。
`endpoints` 两边真的是不同的东西——**这条是名字撞了，不是概念不一致**，收敛方向应当是
改名而不是合并语义。

---

# C3 · 收敛动作

> **要求已规范化**：每条差异「最终该怎么办」见
> [`product_251` 管理面 API 规范](../30-design/product_251_management-api-conventions.md)
> （正文 artifact 见该文件头部链接）。本节只记推进状态，**不重复规则内容**。

**上游部分不在本仓决定**，按纪律逐条走 liaison issue 且需 owner 授权（见
`docs/70-workplan/40-entitlement-data-and-closeout.md` E4 的做法）。**本仓能自己做的先做。**

| #    | 动作                                                          | 归属                                    | 状态                                                                                                                                                              |
| ---- | ------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3-1 | 收掉 `grants/summary` 的 N+1 扇出                             | platform（本仓）                        | ✅ 2026-08-16                                                                                                                                                     |
| C3-2 | 错误码三方统一（`SCREAMING_SNAKE` + 模块前缀，即 atlas 现状） | 三方                                    | platform ✅ 2026-08-16；[`atlas#203`](https://github.com/vxture/vxture-atlas/issues/203) / [`runos#117`](https://github.com/vxture/vxture-runos/issues/117) 已发  |
| C3-3 | runos 仓内先统一 `state`/`status`/`lifecycle` 三个词          | runos                                   | [`runos#118`](https://github.com/vxture/vxture-runos/issues/118) 已发                                                                                             |
| C3-4 | 审计/日志面分页对齐（cursor）                                 | runos（atlas 已符合，取其观测面为基准） | [`runos#120`](https://github.com/vxture/vxture-runos/issues/120) 已发                                                                                             |
| C3-5 | `grants` 一词三义——改名方案需三方同时定                       | 三方                                    | 提案已出：[`atlas#206`](https://github.com/vxture/vxture-atlas/issues/206) + [`runos#121`](https://github.com/vxture/vxture-runos/issues/121)，**定案前不动代码** |

## C3-1 完成记录

`vxture-runos#98`（我方 2026-08-15 提出）**已落地并关闭**：`GET /commerce/grants?subjectRefs=`
（逗号列表，上限 100，必填）。opera-bff 的 `grants/summary` 从「一个产品一次、服务端并发」
换成一次批量调用——**21 个产品 21 次 → 1 次**。

当初把这个接缝放在 BFF 而不是页面里，图的就是这一刻：**端点形状与调用方一行都没动，
只换了内脏**（原注释里就是这么写的承诺）。

两侧语义等价不是近似：单主体的 `listActiveForSubject` 与批量的 `listActiveForSubjects`
都是 `state:"active"` 全集（direct ∪ derived），差别只在 `where` 是等值还是 `in`。

**按 100 分片**：上游超限不是截断而是**整批 400**。今天只有 21 个产品，但不写分片的话，
产品数长过 100 那天的表现是汇总页整页空白。

---

# C4 · 适配层能删多少

C3 逐条落地后回头复核。目前只完成 C3-1，删掉的是 opera-bff 里的 fan-out 循环；
**页面侧零改动**——这本身就是接缝位置选对了的证据。

---

# C6 · platform 侧全面执行（2026-08-16）

上游 atlas / runos 同步开始整改，platform 这一侧一次性做完自己那一列。
**顺序不是随意的**：规范当时还是未签署的提案，而提出方正是 platform——由提出方先自证，
比拿一份文档去要求别人更站得住。

## 做了什么

| 条款               | 动作                                                                                                                                                                    | 落点                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **X-1** 错误封套   | 新建 `errors/api-error.ts`（四拒绝码 + 构造帮手）与 `filters/all-exceptions.filter.ts`（出口保证）；**78 处裸字符串异常全部换码**，`retryable` 全量补齐                 | opera-bff 全部 router + guard/service         |
| **X-1** OAuth 封套 | `product_210` §7 的 `{error, error_description}` 与 `quota_exhausted` 作废，并入 X-1                                                                                    | `docs/30-design/product_210_tool-protocol.md` |
| **X-1** 手写响应   | OIDC 回调三处 `res.json()` 不经过滤器，就地补齐封套（原来两处**连 message 都没有**）                                                                                    | `oidc-auth.router.ts`                         |
| **X-3** 审计记录   | `id/time/actor/result/resourceType/resourceId` → `eventId/occurredAt/actorName/outcome/objectType/objectId`；新增 `actor_console` 列并由 opera-bff/admin-bff 各自填常量 | BFF + DDL + Dashboard/审计页                  |
| **M-B3** state     | `status` → `state`（产品目录 / OIDC 客户端 / 维护窗口）；OIDC 客户端是二元开关，改 `POST :id/activate\|deactivate`；`disabled` → `inactive`                             | BFF + DDL + seed + 4 个页面                   |
| **X-2 / G-1**      | `product_210` 补 §4.4 请求元数据：`task_id` 必备、其余永远可选，形状取 runos 的 `_meta.vxture`                                                                          | `product_210`                                 |
| **R-4**            | 两份「210」的关系写进头部；改号需两仓同时定，未改成之前引用一律带仓名                                                                                                   | `product_210`                                 |

## 三条判断，值得记下来

**封套的保证放在出口，语义的来源放在抛出点。** 只改 78 处 throw 是不够的——Nest 自己造的
错误（路由不存在、请求体不是合法 JSON）一行代码都碰不到。「封套齐全」如果只在我写的分支上
成立，消费方仍然要写两套解析。

**上游透传不覆盖上游的码。** atlas 的 `MODEL_ADMIN_HAS_DEPENDENTS` 带着 `blockedBy` 明细，
重写成本地码等于把它扔了。过滤器只在缺 `retryable` 时补一个。

**改名只发生在接口层。** `product.products.status`、`admin.maintenance_windows.status` 这些列
一个都没动——规范管的是边界形状，DDL 是另一层。唯一连库一起改的是
`appoidc.oidc_clients` 的 `disabled` → `inactive`：那不是列名，是**值**，而值就在词表里。

## 需要一次协同部署

有两处代码依赖新的库结构，**必须先 apply DDL 再重建 BFF**，否则：

| 改动                                    | 不先 apply 的后果                                         |
| --------------------------------------- | --------------------------------------------------------- |
| `support.audit_logs` 加 `actor_console` | 审计 insert 失败 → 审计在写事务内，**所有写操作跟着回滚** |
| `oidc_clients` CHECK 改 `inactive`      | 「停用客户端」写入被 CHECK 拒                             |

活库另需一次数据订正（本仓不代跑）：

```sql
update appoidc.oidc_clients set status = 'inactive' where status = 'disabled';
```

## B-1 / D-1 后补（2026-08-16 同日）

首轮四条落地后，platform 那一列还剩这两条。它们不是补代码，是**先定语义再改实现**，
所以单独记一段。产出是一份新文件：
[`20-specs/000-platform/opera/30-management-api.md`](../20-specs/000-platform/opera/30-management-api.md)
——platform 的**符合性自陈**（规范 D-3 要求各产品 owner 自陈），同时是仓内口径。

### B-1 查出两处真实的静默丢弃

**这条本来看着像命名问题**（「`PUT` 与 `PATCH` 混用，语义未声明」），实测下来是两处 P3 级缺陷：

| 位置                                                | 症状                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH :id/checklist/:itemCode`                     | 无条件写 `remark = EXCLUDED.remark`，而控制台的 `toggleChecklistItem` **只送 `{ isSatisfied }`**——自动接入检查刚写进去的 `remark: "自动检查：…"`，被运营者手动勾一下就**抹掉**，返回 200，界面上看不出区别 |
| `PUT /api/maintenance-windows/:id`（`in_progress`） | `title` / `severity` / `startAt` / `affectedServices` **直接丢弃**并返回 200                                                                                                                               |

两处都已修。第二处的修法值得记：**只拦「要改」，不拦「提到了」**——控制台在 live 模式下把
那几个输入框设为 `disabled` 但仍然提交原值，把「送了原值」也拦掉会让人根本存不下描述。
判据是「你要不要改」，不是「你提没提」。

### D-1 的诚实答法：豁免有范围，不是不算数

本轮改了路由、改了字段名、改了两处语义，**一个并存期都没给**。D-1 明写破坏性变更 MUST 与
新形状并存至少一个版本周期。

处置不是「这不算破坏性变更」，而是**登记一条有边界的豁免**：`/api/*` 的消费方是且仅是
`portals/opera`，同仓同批部署，没有来不及一起改的调用方——并存期保护的正是那种调用方。
**豁免的失效条件写死在自陈文档里**：一旦出现第二个消费方（另一个前端、一个运维脚本、
另一个产品直接调 `/api/*`），这条豁免立即失效，加消费方的那个人有义务回来改那一节。

七条破坏性变更**逐条列在 §5.2**。列出来是为了它们**被数过，而不是被忽略过**——
并存期为零不等于没发生。

## 联调（2026-08-16 当日，真库 + 真会话）

DDL 走**定点 ALTER 不 reset**（25571 行审计一行没少），BFF 换新包重起，门户 `next dev` 本就热更新。

**过了的**：X-1 三条通路（中间件 401 / 框架自造 404 兜底 / OIDC 回调手写响应）· 完整封套
`code+message+retryable+field` · X-3 全部新字段名 + `actor_console='opera'` 逐笔落库 ·
B-3 三个面全 `state`、`?state=` 过滤、`activate`/`deactivate` 动作端点 · 旧 `/status` 路由已 404 ·
非法状态迁移 409 · **checklist 备注在真实界面勾选后活了下来**（那个静默丢弃的界面级复验）。

### 联调改了两处判断

**① `affectedServices` 按集合比，不按顺序。** 我在联调前就存疑并说要验——结果证伪了原实现：
送 `['beta','alpha']` 而库里是 `['alpha','beta']` 被 409 拒，而运营者一个服务都没改。已改为
去重排序后比较；真改了（`beta`→`gamma`）仍然拒。**误拒比漏拒更伤**：漏拒是少挡一次，误拒是
让人对着一个自己没做过的改动找半天。

**② 中间件的 401 绕过出口过滤器。** curl 一个不存在的路由查出来的：`operator-auth.middleware`
自己写响应，在过滤器之前，回的是 `{code:"UNCLASSIFIED"...}`——有 code 没 `retryable`，而且那个码
与 router 层的 `AUTH_NO_SESSION` 是同一件事的两种写法。已统一，并**把这一类补进守卫脚本第 ⑤ 条**。

### 一条查出来当天就补掉的未达标

**platform 的 `outcome` 事实上只有 `success`。** 列在、CHECK 允许三值，但审计行写在事务内的
成功路径上——**凡是没走到 COMMIT 的，一条记录都没有**。实测三次被拒 → 0 行审计；全库
`denied` 为零。

**而我们当天刚用同一件事去要求 runos**（`runos#119`：「谁试图做但被拒了当前答不出来」）。
Runos 是没那个字段，platform 是有字段但不写——**对消费方是同一个盲区**。「有列」不等于
「有记录」，符合性看的是后者。

**已补**（owner 当日拍板口径：授权与状态机拒绝留痕，纯格式校验不留）：`audit/denied-audit.ts`

- 出口过滤器，403/409 留痕，400/401/404/5xx 不留。实测 `AUTH_STEP_UP_REQUIRED` 与
  `CATALOG_INVALID_STATE_TRANSITION` 各落一行，同批 400／404／GET 一行没多，全库 `denied`
  由 0 → 2。取舍与保真度说明见 `30-management-api.md` §4.1。

### 那两页转圈：不是缺陷

`/product/clients` 与 `/ops/maintenance` 当时一直转圈。**不是应用问题**：换新标签页后两页
全部正常渲染（含一个本次 dev server 从没访问过的冷路由 `/model/keys`，9 秒内出 119 行），
服务端连打三轮稳定 200 / 300–550ms / 51KB。原标签页在整个过程里反复报旧 URL、navigate
报成功而 tab 停在前一页——**是那个自动化标签页卡住了**。

不能 100% 证死，但证据一边倒。**留一句给下次**：再遇到先换标签页；如果新标签页也转，
那才是真问题。

# C7 · 上游收敛回冲（2026-08-16 晚 → 08-17）

**10 条 issue 里 8 条已关**——上游没有讨价还价，把活干完了。而这在我这边**产生了新的一批工作，其中一部分是活着的故障**。

## 两处更正 —— 上游指出，我们判错了

**① 「Atlas 的错误封套形状已符合，本条以它为基准」是错的。** 详见 C1 风格轴那条脚注。
根因是取证方法：**扫「符合的样子」只能证明存在合规样本，证明不了不存在违规样本**，
而要找的正是后者。atlas `/v1` 面 25 处裸字符串异常就这么被合格的那批盖住了。

**② 「『谁试图做但被拒了』三家里只有 platform 答得出」是错的，而且两头都错。**
这句写在发给 atlas 的 `#204` 里。事实是：

|              | 审查当时能不能答                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Atlas**    | **能**——`audit.change_records.outcome` 从一开始就有，且由中间件**按客户端实际拿到的 HTTP 状态**推导，不是业务代码自报 |
| Runos        | 不能——没有这个字段（已在 `#119` 修）                                                                                  |
| **platform** | **也不能**——列在、CHECK 允许三值，但审计行只写在事务内的成功路径上（联调才发现，当日补齐）                            |

所以正确的说法是：**当时只有 atlas 答得出**，而我把它写成了唯一答不出的一方之一。
「有列」不等于「有记录」这条判据是对的——只是我把它用反了方向。

**这两处都不是措辞问题，是取证问题。** 记在这里而不是悄悄改掉表格：一份被追改成
「当时就看准了」的审查报告，下次就没人信它。

## runos 已上生产（v0.8.0），旧路由当天 404

| 改了什么                                                                                  | opera 受影响处                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `/commerce/grants*` → `/commerce/capability-grants*`                                      | 代理层 7 处调用，**能力授权面全 404** |
| `/capability/endpoints*` → `/capability/endpoint-instances*`                              | 端点注册 / 状态切换                   |
| `PATCH .../status` → `.../state`（B-3）                                                   | 端点写入体字段                        |
| `PATCH .../versions/:v/lifecycle` → `.../state`                                           | 版本退役                              |
| `DELETE grants/:id` → `POST .../revoke`（B-4）                                            | 撤销授权                              |
| `by-capability/:id` 路径段 → `?capabilityId=`（A-2）                                      | 反向索引                              |
| 审计三流：裸数组 → `{rows, nextCursor}`（A-3 keyset）                                     | 两个页面的取数                        |
| `capability_call.status` → `outcome`、`mgmt_event.event_type` → `action` + 新增 `outcome` | 两个页面的字段与筛选                  |

**全部已适配并实测通过**（2026-08-17）：`/api/runos/grants/product/arda` 回 `[]` 而不是 404 封套；
`mgmt-events` 回 `{"rows":[{…"action":"mgmt.capability_version.promote","outcome":"success"…}],"nextCursor":"…"}`；
`grants/summary` 回 `{"byProduct":{…},"failed":[]}`。

**opera-bff 对外的路径一个都没动。** 页面调的仍是 `/api/runos/grants/...`——适配层存在的理由
正是把这类改动吸收在一处。本层自己那套名字要不要跟着改，等三方改名定案后一并做，
**不半边改**：atlas 侧还没改名，现在只改 runos 那半会让控制台处于「一半新名一半旧名」，比全旧更难读。

## atlas 适配：不等他们部署，在适配层归一（2026-08-17）

atlas 合并了 B-3（`isActive` → `state`）与 X-3（审计字段更名）但**尚未部署**——实测活着的
容器仍回 `isActive`、`PATCH` 回 404。

**两条路都不好走**：改成读新名，今天读不到；不改，他们部署那天读到的是 `undefined`，
而 `undefined` 是假值——**每一行显示成「停用」，不报任何错**。后者比断掉更糟：断了有人喊，
显示错的没人喊。

所以在 `bff/opera-bff/src/routers/atlas-compat.ts` 做归一，挂在适配层的**单一出口**
（`AtlasRouter.request()`）。对两代都成立，**不需要与 atlas 的部署对表**；页面只见一种形状。

实测（对着活着的旧 atlas）：同一行里旧名新名并存——
`"operatorSub":"unknown"` 与 `"actorId":"unknown"`、`"isActive":true` 与 `"state":"active"`。

### 一个把设计推翻了的细节：`state` 有第三个值

最初写的是单向归一（只补 `state`，不补 `isActive`），理由是「反向补等于让旧字段在新世界里
复活」。**这个判断错了**——atlas 的 `state` 有 `deprecated`（仍可解析、不再推荐），而它的
`is_active` 是 **true**。

所以 `isActive` 与 `state === "active"` **不等价**。若只补一个方向，页面那 30 多处 `isActive`
就得立刻迁移，而机械替换会让**已弃用但仍在服务的模型显示成「停用」**——又一次静默语义错。

改成双向补齐：代价是旧字段多活一阵，收益是**页面迁移可以按语义逐处做，而不是被部署时点
逼着一次性做完**。删除条件分两步写在文件头。

### 单测抓到第二个 bug

`{items:[{models:[…]}]}` 里最内层没被归一——**数组白占了一层深度**，正好越过封顶。
表现同样是「这一列全是停用」，不报错。数组是容器不是嵌套层级，不该计数。已修。

### 页面 `isActive` → `state`：先判暂不做，当天条件到位后做了模型那一档

**第一次判断：暂不做。** 理由是查证发现 `deprecated` 根本不会出现在 opera 读的那个面上——

原计划把页面那 60 余处 `isActive` 迁到 `state`，理由是「今天 opera 表达不了 `deprecated`」。
**读了 atlas 的代码之后这个理由不成立**，改判：

|                                          | `state` 怎么算                       | `deprecatedAt`   |
| ---------------------------------------- | ------------------------------------ | ---------------- |
| `/v1/models`（agent 消费面）             | `toModelState()` — **三值**          | 有               |
| `AiModelAdminRecord`（opera 读的管理面） | `toObjectState(isActive)` — **两值** | **没有这个字段** |

也就是说 **`deprecated` 根本不会出现在我们读的那个面上**。现在建「已弃用」这一档 UI，
就是写一条永不触发的分支——**而这正是 atlas 在 `#203` 说服我们的那条理由**（他们据此拒绝加
`APPROVAL_REQUIRED`：加一个没有发射点的码，消费方会写一条永不触发的分支）。同一条理由
反过来对我们也成立。

那么剩下的价值只有「改个名」。而 **B-3 管的是 API 边界形状，opera-bff 的出参已经是 `state`
——契约已经合规**；页面内部读 `isActive`（同一份归一层也保证有）不违反任何条款。
60 余处逐处判语义的改动，换一个不影响契约的内部命名，不划算。

**触发条件写在这里**：atlas 把管理面的 `state` 改用 `toModelState()` 并补 `deprecatedAt`
之后（已在 [`atlas#205`](https://github.com/vxture/vxture-atlas/issues/205) 提出），
这件事同时有了数据和理由，那时一起做。

### 条件当天到位，做了（2026-08-17）

atlas 合并 [`#236`](https://github.com/vxture/vxture-atlas/pull/236)——提交标题就是这件事：
_「the plane that deprecates a model could not see it was deprecated」_。管理面现在
`state: toModelState(model)`（三值）并带 `deprecatedAt`。

所以「不建永不触发的分支」这条理由失效了，做了**范围收窄**的一版：

| 范围         | 动作                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **只有模型** | provider / grant / endpoint / 密钥仍是两值，它们的 `isActive` 不动——**没有第三态就没有迁移的理由**                                               |
| 状态列       | 三态 `启用 / 停用 / 已弃用`。**「已弃用」用 warning 不用 neutral**：它仍在服务，中性色会读成「已经关了、不用管」，而它恰恰是需要安排迁移的那一档 |
| 何时         | 已弃用的行把 `deprecatedAt` 带出来。运营要判断的是「还剩多久、该不该现在迁」，只答「是」回答不了那个问题——上游特意为此补了字段                   |
| 写入口       | opera-bff 补 `POST models/:id/deprecate` / `undeprecate` 两条代理。**此前完全没有**，运营者在控制台做不了这件事                                  |
| 动作可见性   | 已停用的行**不给**「弃用」——运营明确关掉的模型报 `inactive` 而非 `deprecated`（atlas 的优先级如此），给了也看不出效果                            |

**停用与弃用是两个动作，不是一个开关**：停用＝关掉它；弃用＝「别再往上建了，它还能用」。
压成一个布尔正是 B-3 立论的那句话。

其余五十余处 `isActive` 维持不动：`B-3 管的是 API 边界形状`，opera-bff 出参已是 `state`，
契约合规；页面内部读哪个名字不违反任何条款，而逐处判语义的改动换不到对应收益。

### 顺带查出一条报给 atlas 的缺陷

`POST /capability/models/:id/deprecate` 已经在了，`deprecatedAt` 也落库了——但**管理面没有
任何读口把它带出来**（`deprecatedAt` 在 `model-admin.service.ts` 里只出现在写的那一行）。

后果不是缺功能，是 **P3**：运营者调用弃用之后，管理面那一行**没有任何变化**，唯一能看见
这件事的是 agent 读 `/v1/models`。他无法确认是否生效、看不出哪些已弃用、也无从决定要不要
撤销——**做得了，但做完看不出来**。已报 `atlas#205`。

### `PUT` → `PATCH` 仍然不能提前

同一个请求发不出两种方法；试完一个再试另一个会把写操作变成「可能执行两次」。
这条必须与 atlas 的部署**严格排序**，已在 `atlas#206` 请他们部署前后知会一声。

## 一个当场复现的静默失败

改 `callTone(status)` → `callTone(outcome)` 时，函数体里还剩三处 `status === "..."`。
**这在浏览器里编译得过**——`status` 是 DOM 全局变量，比较永远为假，色调永远 neutral，
不报任何错。

tsc 抓到它**只是因为「参数未使用」这条规则**；只要 `outcome` 在函数里别处被用过一次，
这个洞就会一路进生产。这正是 atlas 在 `#203` 里警告的那类——他们改 `GRANT_DENIED` 时
`if (code === "GRANT_DENIED")` 同样会静默编译通过，把每次授权拒绝重分类成上游故障。
**他们的结论「先收窄类型再改名」是对的，顺序反过来的代价是静默的。**

已核 opera 侧的错误码比较：只有两处（`features/atlas/lifecycle.ts`），且已抽成命名常量；
`GRANT_DENIED` 全仓无比较，atlas 那次改名打不到我们。

## 还没做的

- **C3-2..C3-5 与 R-1/R-2/R-3/R-5** 落在 atlas / runos——owner 2026-08-16 全部授权，
  **已逐条开出 10 个 issue**（atlas `#202`–`#206`、runos `#117`–`#121`，见
  [`80-liaison/00-index.md`](../80-liaison/00-index.md)）。逐条开不打包：规范自己的纪律是
  「逐条签署，不是全有全无」，打成一个 issue 就没法只签一半。
- **admin-bff 的 `risk_records` / `compliance_events`** 仍用 `status`——它们不在 opera 管理面，
  留待 admin 侧一并收敛，不在这里改一半。
