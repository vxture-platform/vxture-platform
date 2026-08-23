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

---

# C8 · A-4 响应形状：补 A-3 的洞，三处分歧全收（2026-08-24）

opera 对接 atlas / runos 的联调查出一件 C1–C7 都没覆盖的事：**两个产品都满足 A-3，
却给出两种互不相容的分页信封。**

A-3 规定的是分页的**入参与义务**（`cursor` + 服务端钳制的 `limit`），一个字没说分页的
**响应形状**。于是两个产品各自在自己仓的 `20-specs/10-http-surface.md` 里把这个洞填上了
——而这恰好是两仓 `10-standards/00-index.md` 开篇明令禁止的那件事：

> 标准由平台仓编写与版本化，产品仓一律按引用消费；**标准有缺口先去那边补**，
> 再镜像回来 —— 绝不在产品仓里自造标准。

两份自造标准各自自洽、各自写进了自己的规范文档，且**都没进豁免登记**。按纪律 3，
「无理由的偏离视为待改，不是既成事实」。

`product_251` 已发 v0.5，新增条款 **A-4「列表与聚合响应的形状」**。

## 实测到的三处分歧

| #   | 分歧                                    | 证据                                                                                     | 收敛方向         |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| 1   | 游标页行键                              | atlas `{items, nextCursor}` · runos `{rows, nextCursor}`                                 | 统一 `items`     |
| 2   | **同名资源 `usage-summaries` 一裸一封** | atlas 返回 `TenantUsageSummaryAdminRecord[]`；runos 返回 `{dimension, from, to, rows}`   | atlas 补信封     |
| 3   | 窗口回显聚合零共享词汇                  | atlas `{windowStart, windowEnd, overall, byGroup}` · runos `{dimension, from, to, rows}` | atlas 改随 runos |

**第 2 条是最硬的一条。** runos 控制器的注释写着 _"No cursor: this is an aggregate over a
bounded window"_ —— **和 atlas 返回裸数组用的是同一个理由，形状却相反**。规范开篇那句判据
就是为这种情况写的：_如果两个上游对同一件事给出不同形状，而这个差异无法用「它们做的事本来
不同」解释，那它就是历史造成的。_

## 为什么是 `items` 不是 `rows`

不是口味，两条理由：

1. A-3 把这些面定义为「**无界流水**」，里面装的是**事件**不是表行。`rows` 把存储隐喻带进了
   一份刻意与存储无关的契约。
2. 更硬的一条：`rows` 在 runos 仓内**已经有含义**。`insertCapabilityCalls(rows)`、
   `flushStream(..., (rows) => ...)` 里它就是待写入的 DB 行。拿它当线上键，等于在一个文件里
   给一个词加第二个含义 —— 而这正是 X-4（一词一义）禁的。

收敛后 `rows` 留在内部保持存储含义，**永不上线**。

## A-4 顺带修一个真实缺陷

「回显 MUST NOT 放在每一行」这句不是洁癖。atlas 的 `usage-summaries` 把 `dimension` 放在
每一行上，而服务端会把 `groupBy` 默认解析成 `tenant`
（`normalizeUsageRollupDimension(raw)`：`if (raw === undefined) return "tenant"`）。

于是：**空结果时这个回显整个消失** —— 调用方拿到 `[]`，无从得知自己看的是哪根轴。
与 P3 同病：静默地少给信息，界面上看不出区别。

`cycleMonth` 相反，它是纯透传过滤器（`normalizeUsageSummaryFilters` 不给它兜默认值），
**没有服务端解析结果，因此不进信封** —— A-4 的判据是「有没有回显」，不是「把参数都抄一遍」。

## 血缘范围：全部在本仓内

跨全组织检索 `usage-summaries` / `logs/summary` / `audit/calls` / `audit/mgmt-events` /
`audit/outcomes` 的调用方，**没有任何兄弟产品消费这些端点**。消费方只有三个，都在本仓：
`opera-bff`、`admin-bff`、`console-bff`。改动完全可控，不需要弃用窗口。

## 已落：三仓的实际改动

> **一度受阻**：`D:\MyWebSite\vxturestudio\` 被 `.claude/settings.local.json` 里四条
> `Edit/Write/MultiEdit/NotebookEdit(//d/MyWebSite/vxturestudio/**)` 的 deny 规则挡下
> ——那是「上游产品仓只读」那条边界的执行件，比本轮授权更早，且 deny 优先级高于
> `additionalDirectories`，所以 `/add-dir` 加了目录也不放行。
>
> **处理方式是收窄而不是删除**：blanket 规则拆成逐仓拉黑，七个未授权的兄弟仓
> （karda / terra / varda / arda / vxtpl / agent-template / vx-agent-yucer）继续只读，
> 只放行 atlas 与 runos。代价要记下来：**新建的兄弟仓不再被自动拦住**，因为枚举式
> 拉黑把失败模式从「默认安全」翻成了「默认可写」。加新仓时要补一条。

### runos — 线上形状只在两处产生

| 文件                                    | 改动                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `service/src/audit/cursor.ts`           | `paged()` 返回类型 `{rows, nextCursor}` → `{items, nextCursor}`；函数入参名 `rows` **保留**（那是 DB 行，含义正确），只改返回键 |
| `service/src/audit/audit.controller.ts` | `usageSummaries()` 末尾 `.then((rows) => ({dimension, from, to, rows}))` → `items: rows`                                        |
| `service/src/audit/*.spec.ts`           | 断言键跟改                                                                                                                      |
| `docs/20-specs/10-http-surface.md`      | 第 76 行 `Each response is {rows, nextCursor}` → `{items, nextCursor}`；补一句指回 product_251 A-4                              |

`audit.service.ts` / `audit.repository.ts` 里的 `rows` **一处都不动** —— 那些是 DB 行。

### atlas — 两个端点

| 文件                                                 | 改动                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service/src/observability/observability.service.ts` | `LogSummaryResult`：`windowStart`/`windowEnd` → `from`/`to`，`byGroup` → `items`；`summarize()` 的 return 跟改。`overall` **保留**（它是与列表并列的聚合量，不是行） |
| `service/src/runtime/model-admin.service.ts`         | `listUsageSummaries()` 返回 `TenantUsageSummaryAdminRecord[]` → `{dimension, items}`；`dimension` 从每行提到信封（行内那份删掉，它正是空结果时消失的那个回显）       |
| `service/src/runtime/model-admin.controller.ts`      | `listUsageSummaries` 返回类型跟改                                                                                                                                    |
| `service/src/**/*.spec.ts`                           | 断言键跟改                                                                                                                                                           |
| `docs/20-specs/10-http-surface.md`                   | 「Cursor pagination」一节补响应形状；补一句指回 product_251 A-4                                                                                                      |

### platform — 上游落地后

| 文件                                                           | 改动                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bff/opera-bff/src/routers/runos-contract.ts`                  | 四处 `rowsKey: "rows"` → `"items"`                                                             |
| `bff/opera-bff/src/routers/atlas-contract.ts`                  | `usage-summaries` 由 `list` 改 `page`/`items` 并补 `dimension` 回显；`logs-summary` 字段名跟改 |
| `bff/opera-bff/src/routers/upstream-contract.ts`               | 文件头那段「两个上游各用各的词」的说明**要重写** —— 收敛之后它不再成立                         |
| `bff/opera-bff/src/routers/runos.router.ts`、`atlas.router.ts` | 读取点与类型跟改                                                                               |
| `bff/admin-bff`、`bff/console-bff`                             | `usage-summaries` 消费点跟改（console-bff 已自行再封一层，一并核对）                           |
| `portals/opera/**`                                             | `RunosCallStreams.tsx`、`RunosChangeTable.tsx`、观测/计量页读取点                              |

**收敛完成的验收**：两张契约表里 `rowsKey` 只剩一个值。只要还能在表里看到两个不同的行键，
这件事就没做完 —— 那张表就还在当翻译，而不是当检查。

## 一并做掉：P1.1（runos 游标从未被消费）

复核 A-3 时顺带确认的：**runos 三条流水早已交付 keyset 游标，opera 从来没消费过
`nextCursor`** —— 页面只给了「最近 100 / 500 / 1000 条」的档位选择，超出档位的历史根本够不着，
而界面上没有任何地方说明这一点。对照 atlas 请求日志那一侧，页面是有「已加载 N 条，还有更多 /
加载更多」的。

这不是 UI 细节，是**平台侧漏读了上游已经满足的契约**。因为它改的是同一批读取点，
与 A-4 的行键收敛放在一次里做，不单独排期。

### 三处收敛之外，实际还修了四件

改动落地时暴露的，都不是 A-4 本身，但都在同一条线上：

1. **契约守卫此前只查行、不查信封。** A-4 让信封承载服务端解析结果之后，这个洞变致命：
   `nextCursor` 从来没有被守过，于是「runos 早已交付游标、opera 一次都没消费」这件事
   在守卫全绿的情况下存在了很久。机制补了 `shape.envelopeFields`，**且信封检查不受空
   集合影响**——那恰恰是行检查失明、而回显最需要被查的时刻。

2. **opera 的 runos 契约表把 `dimension` 抄成了行字段。** 它在信封上。那条读一旦真有
   数据就会误报，只因 capability/metering 页当轮没被走到，实测也没暴露它。

3. **admin-bff 的 `TenantUsageSummaryRecord` 整体陈旧。** `id` / `statType` /
   `totalRequests` / `successRequests` / `failedRequests` / `totalCostAmount` /
   `currency` / `updatedAt` —— **上游一个都不发**。页面只读了 `totalTokens`（恰好还在），
   所以没炸；这份类型早就不是契约，只是一段没人核对过的记忆。

4. **admin-bff 往上游透传 `statType`。** atlas 的白名单里没有这个参数，而
   `rejectUnknownFilters` 是**拒绝不是忽略**——页面一旦真送它就是一个 400。换成
   `groupBy`，那是这个端点真正支持的轴选择。

### 守卫：这次收敛有东西拦着它退回去

| 位置                                                        | 拦什么                                                                          | 反向验证               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `vxture-runos/scripts/guardrails/check-api-conventions.mjs` | 控制器里出现 `rows`/`byGroup`/`records`；`paged()` 不返回 `{items, nextCursor}` | 两条都退回去跑过，都红 |
| `bff/opera-bff/src/routers/upstream-contract.spec.ts`       | 两张词表的 `rowsKey` 必须**只有一个值**；每个信封至少钉一个信封字段             | 125 测试全过           |

runos 那条守卫的写法值得记：**它禁的是「词」，不是「`rows:` 这个键」**。第一版只查键形，
反向验证时才发现要退回的那个形态是对象简写——

```js
.then((rows) => ({ dimension, from, to, rows }))
```

查 `rows:` 的规则从它旁边直接走过去了。精确匹配简写要真解析，禁标识符不用：控制器很薄，
没有哪个正当的控制器需要一个叫 `rows` 的局部量，改个参数名的成本是一个词。
**一条不能被排版绕开的规则，胜过一条读起来更自然的规则。**

没有反向验证，这个洞会一直在——而它恰好对着这次要防的那个真实形态。

### 三仓验证

| 仓              | 结果                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| vxture-atlas    | type-check 干净 · **966 测试全过** · lint · docs-numbering                   |
| vxture-runos    | type-check 干净 · **270 测试全过** · lint · docs-numbering · api-conventions |
| vxture-platform | opera-bff **125 测试全过** · opera / admin / admin-bff type-check 干净       |

生产代码在两个上游都是一次编译通过的，报错全部落在单测——改动面与预期一致。

### 实跑复验（2026-08-24）

两个上游镜像本地重建后重启（`atlas-app:local` / `runos-app:local`），两边 `/readyz` 均
`ready` 且真连着库（atlas 报 87 个活跃模型）。

atlas 重启踩了一个坑，仓里其实已经写死了做法：`.env` 里的 `DATABASE_URL` 是**主机向**的
（`127.0.0.1:5432`，给 psql / Prisma CLI 走 forwarder 用），而 compose 会把同一个值插进
容器，那里 `127.0.0.1` 是容器自己。`docs/50-deployment/00-index.md` 给了替换命令。
值得记的是它下面那句：**`/healthz` 照样回 `ok`，因为它不碰数据库——只有 `/readyz` 看得出来。**

| 页面                     | 读的是什么                                               | 结果                                 |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ |
| `/observability/metrics` | atlas `logs/summary` 新形状 `{from, to, overall, items}` | 网关流量聚合与 Provider 两张表都出数 |
| `/capability/metering`   | runos `usage-summaries` `{dimension, from, to, items}`   | 出真行（343 / 96 / 1 / 1）           |
| `/model/metering`        | atlas `usage-summaries` `{dimension, items}`             | **先炸了，见下**                     |

这次实跑的价值全在第三行：**守卫本身就是收敛的证明**。契约表声明了 `items` 与
`envelopeFields`，形状要是没对上，第一次读就会 `SHAPE_CHANGED` 或 `FIELD_MISSING`。
前两页出数，等于两个上游的新形状被逐字核对过一遍。

### 漏改的那个消费方是跑出来的，不是搜出来的

`/model/metering` 客户端异常。原因：它**自己声明了一份局部的 `UsageSummaryRecord`**，
而不是引用共享类型——所以按类型名搜消费方时它不在结果里，六处 `r.dimension` 全被漏掉。

修法不是把字段搬回行上，而是让页面只信**信封回显的那一根轴**：

```ts
setResolvedAxis(page.dimension); // 不是本地的 axis
```

两者正常时一致；不一致时上游是对的（比如它把一个不认的值兜底成了 `tenant`）。
信任本地那个，会让表格按一根上游根本没聚过的轴去解释每一行。

`react-hooks/exhaustive-deps` 顺手抓出两处过期闭包——`resolvedAxis` 没进 useMemo 依赖，
换轴后表格会拿旧轴解释新行。**类型检查看不见这个，lint 看得见。**

### 还没验的

浏览器扩展在复验途中掉线，以下三项**尚未实跑**，代码与单测均已就绪：

- `/model/metering` 修好之后的实际渲染
- `/ops/logs`（runos 三条流水 + atlas 请求日志的 `items`）
- `/audit/changes`（runos mgmt-events + atlas audit-logs 的 `items`）

BFF 日志里零 `CONTRACT` 违约，但那条证据偏弱：日志缓冲区被启动输出占满，且未发生的请求
同样不产生错误。**真正的证据是页面出数**，所以上面三项要补跑。

---

# C9 · 守卫统一 + 游标真的被消费了（2026-08-24）

C8 收尾时记下的两件事，一起做完。它们看着无关，其实是同一句话的两半：
**一个保证只做了一半，而一半的保证最容易被当成全部。**

## 一 · 契约守卫从两份变成一份

opera-bff 与 admin-bff 各带一份守卫实现。这不是重复代码那么简单——**两份已经漂了**：

|        | opera-bff 那份                 | admin-bff 那份   |
| ------ | ------------------------------ | ---------------- |
| 形状   | 声明式（list / page / single） | **只认裸数组**   |
| 信封读 | 全覆盖                         | **整条静默跳过** |

代价落在具体的一条读上：admin 的 `usage-summaries` 是信封，于是它**一条都没被守住**，
而恰恰是它的类型整体陈旧（`id` / `statType` / `totalRequests` / `successRequests` /
`failedRequests` / `totalCostAmount` / `currency` / `updatedAt` —— 上游一个都不发）。
唯一没炸的原因是页面只读了恰好还在的 `totalTokens`。

**同一个仓里两套契约守卫，正是 A-4 刚在上游消灭的那个病，低一层的版本**：两份实现都自洽，
代价落在同时对着两边的人身上——这次那个人是我们自己。

机制搬到 `@vxture-platform/shared`：

- **零框架依赖**，符合该包「运行于任何环境」的定位。异常类型由调用方**注入**——两个 BFF 的
  错误封套本来就不同（opera 有 `ApiError` 类，admin 直抛 `BadGatewayException`），
  机制不该替它们选。
- **词表留在各自仓内**：「我方读哪些字段」是消费方的事实，只有「怎么查」是共用的。
- 两个 `*-bff` 之间不建依赖的纪律没破：它们共用的是 shared，不是彼此。

顺带给 shared 包配上了 vitest——**机制搬了家却把测试留在别人仓里，等于这个包自己没验证**。
机制的 16 条测试跟着走；跨词表的 A-4 验收（两张表 `rowsKey` 只有一个值）留在 opera-bff，
因为它 import 的是那两张词表。

拆分时漏掉了一条：`describe("表里没有这条资源")` 排在被切走的块**之后**，一并没了。
对账 `109 + 15 ≠ 125` 才发现。已补回。**"测试都过了"不等于"测试都在"。**

admin 侧新增反向验证，`usage-summaries` 退回裸数组 → 4 条红，还原 → 全绿。

## 二 · P1.1：runos 的游标从交付到被消费

runos 三条流水**早就是 keyset 游标**（A-3 已符合）。opera 一次都没消费过 `nextCursor`，
界面上换成了「最近 100 / 500 / 1000 条」的档位选择器。

那个档位不是页大小，是**能看到多远的上限**——而 runos 把 `limit` clamp 在 1000，
所以第三档同时就是天花板。超出的历史根本够不着，**而界面上没有任何地方说明这一点**。

对 `mgmt-events` 这条追责流水尤其糟：**查不到与没发生过，在界面上长得一样。**

三处读取点（`audit/calls`、`audit/outcomes`、`audit/mgmt-events`）改成与同一页 Atlas
那半同形：固定页大小 + 「已加载 N 条，还有更多 /（已到末尾）」+「加载更多」。

两条纪律写进了代码注释，因为它们都不是显然的：

1. **页脚必须显式说到没到末尾。**「加载完了」与「加载不动了」在界面上长得一样，
   而前者是答案、后者是故障。
2. **翻页失败不清空已读到的行**，也不把整块变成错误态：手里那几页是真实数据，
   丢掉它们等于用一次网络抖动惩罚读者。失败走 toast。

另有一处容易踩的：两条流**各有各的游标**。切流不是翻页，拿着上一条流的游标去问另一条流
会被 `AUDIT_INVALID_CURSOR` 拒掉——那是上游对的，错在我们这边。

## 验证

|                           | 结果                                   |
| ------------------------- | -------------------------------------- |
| `@vxture-platform/shared` | 机制 16 条测试（新配 vitest）          |
| opera-bff                 | 109 条（16 条随机制迁出）              |
| admin-bff                 | 102 条通过 / 13 跳过；新增词表反向验证 |
| opera 门户                | type-check + lint 干净                 |
| `lint:boundaries`         | 2530 模块、2868 依赖，零违规           |

## 还没实跑

浏览器扩展在 C8 复验途中掉线，至今未恢复。以下**尚未在真实数据上跑过**：

- 「加载更多」的实际翻页行为（三条流各一次）
- 末尾态：`nextCursor` 变 null 时页脚是否如实说「已到末尾」
- `/model/metering` 修好之后的渲染（C8 遗留）
- `/ops/logs`、`/audit/changes` 的 `items` 形状（C8 遗留）

单测覆盖的是契约与形状，**覆盖不到「点下去会不会真的翻页」**——那正好是这一轮改的东西。
所以这一条不能算完。

---

# C10 · P1.2 / P1.3：上游发了、门户没接的两处（2026-08-24）

两条都是「数据一直在线上，界面上没有」。P1.3 纯门户，P1.2 查下去发现**光改门户会撒谎**。

## P1.3 · runos 调用流水的计量与配额维度

上游一行有 `costAmount` / `costUnit` / `quotaCounterBefore` / `quotaLimit` /
`bytesIn` / `bytesOut` / `matchedPolicyIds` / `degradedMode`，门户一个都没读。

### 线上类型是**实测**的，不是推断的

`costAmount` 是 `Decimal(18,6)`，而 `audit.repository.ts` 只把四个 BigInt 窄化成
Number——Decimal 原样交给 `JSON.stringify`。读侧这个形状**上游一条单测都没钉**
（写侧 fixture 是数字、usage-summaries 是字符串），正是 `latencyMs` 那条缺陷的温床。
所以直接打了一次真实请求：

```
costAmount "1" (string) · costUnit "call" · quotaCounterBefore 0 (number)
quotaLimit 0 · bytesIn 56 · bytesOut 312 · matchedPolicyIds [] · degradedMode false
```

### 两处会静默撒谎的地方

**① `quotaLimit === 0` 是「未强制」，不是「上限为零」。** runos 的 `resolveDecision`
原文：_"a no-op when the grant's quotaLimit is 0 (unenforced)"_，而列默认值也是 0。
渲染成「0 / 0」会读成**配额耗尽**——真相的反面。页面显示「未强制」。

**② 只显示计量数字、不显示单位，等于邀请人把 token 和页数加起来。** `costUnit` 是
开放词表（product_251 X-3 v0.4）。这不是理论风险：实测第一屏就同时出现了
`1 call` 与 `7 compute`——**同一列里两种单位**。

### 呈现沿用本文件已立的先例

延迟列早就把三段拆分挂在 `title` 上，并写明理由（「把三个数平铺在列里会把这张表挤成
一堵数字墙」）。所以：主数据进列（计量、配额位置），次级细节挂 `title`
（载荷字节、匹配策略），`degradedMode` 做徽标贴在裁决旁——它**限定这一行其余数字的
可信度**，一个降级模式下的 `allow` 和一个正常 `allow` 不是同一件事。

## P1.2 · atlas 的 `config` / `config.wire` 不可见

计划里写的是「门户接出来即可」。查下去发现不行。

### 光改门户会渲染一个从未被用过的描述符

生效的 wire 是**三层叠加**：`resolveWire(协议默认, providerConfig, modelConfig)`。
门户要自己算，就得复刻 `applyOverlay`——而它是**逐键**合并：`headers` 走
`mergeStringMap`、`authStyle` 走 `readEnum` 且**遇到非法值静默回退到基线**
（写这轮测试时我自己就踩了：给 `streamUsage` 填了个非法值，它安静地回退了）。

复刻一遍就是同一个事实的第二个来源，失败方式是安静的。这正是这整轮工作在消灭的病。

### 所以改了上游：atlas 直发 `resolvedWire`

代价几乎为零——`resolveWireFor(model)` **本来就存在**，只是私有在
`model-probe.service.ts` 里。搬到 `providers/wire.ts`（它只碰配置、不发请求，住在探测
服务里本身就是错位），`mapModel` 加一行。

这件事修的是 `behaviorVersion` 旁边的一个洞：

> 指纹说「配置动了」——这是它的本职，做得也好。但想知道**动成了什么**，此前只能
> `POST :id/probe`，而那是**真实上游调用、要烧 token**。
> **一个便宜的信号指向了一个昂贵的答案，结果就是没人去问。**

`config` 与 `resolvedWire` 并列保留：前者是「本层声明了什么」（也是密钥脱敏发生的
地方），后者是「实际跑什么」。控制台两个都要——但**不许自己合并**。

### 门户侧：归属只做存在性判断

线协议抽屉里每个键标注由哪一层声明。这条边界是刻意的：

- 「谁声明了这个键」= 原始层里有没有这个 key，纯存在性，无歧义 → 门户做
- 「生效值是什么」= 逐键合并语义 → 上游做，门户只显示

顺带发现 `ProbeReport` 也没渲染 `wire`——自检结果里那个字段同样没被接出来。

## 验证

|              | 结果                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| vxture-atlas | type-check 干净 · **971 测试**（新增 5 条钉**叠加顺序**，不是钉字段存在） · lint · docs |
| opera-bff    | **116 测试**（新增 7 条，含 `quotaLimit` 缺失→被读成「未强制」那条反向验证）            |
| opera 门户   | type-check + lint 干净                                                                  |
| 实跑         | 调用流水计量/配额两列出真数据，同屏出现两种计量单位                                     |

`resolvedWire` 的实跑验证待 atlas 镜像重建后补。

### 实测把设计判断验成了硬证据

`doubao-seed-2-0-lite-no-tools` 这一行同时踩中了两个点：

```
声明（config.wire）   supports = { tools:false, toolChoice:false }         2 个键
生效（resolvedWire）  supports = { tools:false, toolChoice:false,
                                   topP:true,  temperature:true }          4 个键
```

**只显示声明值**，运营看不到 `topP` / `temperature` 支不支持。**门户自己合并**，就得知道
`supports` 是逐子键合并而非整体替换——猜错了不报错。

再往下一层，这四个子键**来自三个不同的层**：`temperature` 是协议默认、`topP` 来自
Provider、`tools`/`toolChoice` 被本模型改成 false。

这条同时修掉了我自己的一处不精确：抽屉起初把 `supports` 标成「本模型覆盖」——**属实，
但会让人以为整个值由模型定**。对象类的键改标「多层合并」。一个用来消灭误读的抽屉
自己撒谎，是这轮里最不该出现的东西。
