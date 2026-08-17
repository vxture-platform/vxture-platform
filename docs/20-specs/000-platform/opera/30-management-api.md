# 平台自身管理面 API 口径（opera-bff 对 `product_251` 的符合性自陈）

> 状态：v1.0 · 2026-08-16 · 范围：`bff/opera-bff` 对外的 `/api/*`
> 上游规范：[`product_251`](../../../30-design/product_251_management-api-conventions.md)（正文 artifact 见该文头部）
> 实测背景：[`30-l1-consistency-audit.md`](../../../70-workplan/30-l1-consistency-audit.md) §C6

`product_251` D-3 要求「各条的符合性由该产品 owner **自陈**」。本文就是 platform 那一份。
它同时是仓内口径——写新端点时照这里，不必每次回去翻 artifact。

**范围只含 platform 自己拥有的对象**：产品目录、OIDC 客户端、维护窗口、租户目录。
`atlas.router.ts` / `runos.router.ts` 是**代理层**，动词与形状镜像上游，不受本文约束——
改它们等于让代理与被代理者对不上（上游的收敛进度见 `docs/80-liaison/00-index.md`）。

---

## 1. 动词语义（B-1）

**`PUT` = 全量替换**：请求体未出现的可写字段被清空/复位。
**`PATCH` = 部分更新**：未出现即不改。
**`POST :id/{verb}` = 动作**：状态迁移与二元开关走这里，不把目标值 PATCH 进去。

无论哪种，**「把一个字段清空」都有明确表达**（显式 `null` 或空串），不只能靠省略键。

| 端点                                                   | 动词    | 语义                                                                          |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `/api/products`                                        | `POST`  | 创建                                                                          |
| `/api/products/:id`                                    | `PUT`   | **全量替换**——每个可写列都在 `SET` 里，省略键落回默认值                       |
| `/api/products/:id/state`                              | `PATCH` | 单字段；四态状态机，非二元，故不用动作端点                                    |
| `/api/products/:id/webhook`                            | `PUT`   | **全量替换**三个字段（`homeUrl`/`webhookUrl`/`webhookSecretRef`），省略即清空 |
| `/api/products/:id/checklist/:itemCode`                | `PATCH` | **部分更新**：`remark` 键不在则不动                                           |
| `/api/oidc-clients`                                    | `POST`  | 创建                                                                          |
| `/api/oidc-clients/:clientId/rotate-secret`            | `POST`  | 动作                                                                          |
| `/api/oidc-clients/:clientId/activate\|deactivate`     | `POST`  | **二元开关走动作端点**（B-3）                                                 |
| `/api/maintenance-windows`                             | `POST`  | 创建                                                                          |
| `/api/maintenance-windows/:id`                         | `PUT`   | `scheduled`：全量替换；`in_progress`：见 §1.2                                 |
| `/api/maintenance-windows/:id/start\|complete\|cancel` | `POST`  | 状态迁移动作                                                                  |

**没有 `DELETE`。** 退役是状态迁移不是删行（B-4 ✅）——「谁曾经接入过、什么时候退的」必须答得出。

### 1.1 这条查出来的一个真实缺陷

`PATCH :id/checklist/:itemCode` 此前**无条件**写 `remark = EXCLUDED.remark`。而控制台的
`toggleChecklistItem` 只送 `{ isSatisfied }`——于是：

1. 跑一次自动接入检查 → 每项写进 `remark: "自动检查：…"`；
2. 运营者手动勾一下任意一项 → **那一项的 remark 被抹掉**，返回 200，界面上看不出区别。

不进错误日志，几个月后表现为「我明明写过说明」。B 组整组要防的就是这类。
**已修**：键不在 = 不改；显式 `null`/空串 = 清空；有值 = 覆盖。

### 1.2 同一个 URL 在两个状态下语义不同 —— 有意，但必须说得出来

`PUT /api/maintenance-windows/:id` 在 `scheduled` 下是全量替换，在 `in_progress` 下只接受
「顺延 `endAt` + 追记描述」。**这个差异是业务规则**：一个正在跑的维护窗口，改标题、改开始
时间没有意义。

但语义不同不等于可以静默。原来 `in_progress` 分支把 `title`/`severity`/`startAt`/
`affectedServices` **直接丢弃**并返回 200。现在的规则：

- **送来的锁定字段与库里不同 → 409 `MAINTENANCE_WINDOW_LIVE_FIELDS_LOCKED`，并点名是哪几个**；
- 送来的值与库里相同 → 视为无操作放行。

后半条不能少：控制台在 live 模式下把那几个输入框设为 `disabled`，**但仍然提交原值**。
只拦「提到了」会让人在界面上根本存不下描述。**判据是「你要不要改」，不是「你提没提」。**

**「相同」怎么算，联调改过一次（2026-08-16）**：`affectedServices` 一开始按**顺序**比，
实测送 `['beta','alpha']` 而库里是 `['alpha','beta']` 会被 409 拒——运营者一个服务都没改。
已改为**按集合比**（去重 + 排序）：这个字段回答的是「哪些服务受影响」，先后不承载语义。

**误拒比漏拒更伤。** 漏拒是少挡一次；误拒是让人对着一个自己没做过的改动找半天，还找不到。
凡是这种「比对旧值决定拒不拒」的判断，都要先问一句：**这个字段的相等，业务上到底怎么定义。**

---

## 2. 错误封套（X-1）

权威实现：`bff/opera-bff/src/errors/api-error.ts`（构造）+ `filters/all-exceptions.filter.ts`（出口）。

```jsonc
{
  "code": "VALIDATION_REQUIRED",
  "message": "…",
  "retryable": false,
  "field": "productCode",
}
```

- **拒绝类用统一词表**，不带模块前缀：`NOT_ENTITLED` / `POLICY_DENIED` / `APPROVAL_REQUIRED` / `QUOTA_EXCEEDED`。
  能力门缺失一律 `NOT_ENTITLED`，不另造码。
- **其余带模块前缀**：`CATALOG_*` / `MAINTENANCE_WINDOW_*` / `OIDC_CLIENT_*` / `AUTH_*` / `VALIDATION_*`。
- **`retryable` 必有**。默认判法在 `defaultRetryable()`：429 与 502/503/504 为 `true`，其余 4xx 为
  `false`，**500 也是 `false`**——未知故障下让调用方自动重试，只会把一个故障放大成一片。
- **`field` 在校验类错误上要给**：控制台据此高亮那一格，而不是弹一句话。

三条纪律：

1. **形状的保证在出口，语义的来源在抛出点。** 过滤器兜住框架自造的错误（路由不存在的 404、
   请求体不是合法 JSON 的 400）——那些点代码碰不到，而「封套齐全」如果只在自己写的分支上
   成立，消费方仍要写两套解析。
2. **上游透传不覆盖上游的码。** atlas / runos 的错误体本来就带 `code`，且 `blockedBy` /
   `retryAfterMs` 这类明细正是控制台把「你不能删」变成「先去清掉这三个」的依据。过滤器只在
   缺 `retryable` 时补一个。
3. **兜底码是漏改的信号。** `UNCLASSIFIED_*` 出现在日志里，意味着某处还在抛裸 Nest 异常，
   或者是框架抛的。可以 grep。

---

## 3. `state`（B-3）

「算不算数」统一叫 `state`，最小词表 `active` / `inactive`，可扩枚举表达真实中间态
（产品目录是 `draft`/`active`/`inactive`/`deprecated`，维护窗口是四态流程）。

**改名只发生在接口层**——`product.products.status`、`admin.maintenance_windows.status`
这些列不动：规范管边界形状，DDL 是另一层，两边各有自己的稳定性要求。

唯一连库一起改的是 `appoidc.oidc_clients` 的 `disabled` → `inactive`：那不是列名，是**值**，
而值就在词表里。留一层 `inactive ⇄ disabled` 的接口翻译，等于让每个读库的人都要记两套词。

二元开关必须给 `activate` / `deactivate`（OIDC 客户端已给）。**判据是「这个对象是不是只有
开/关两种状态」**，不是「统一都改成动作端点」——产品目录的四态状态机保留 `PATCH :id/state`。

---

## 4. 审计记录（X-3）

```
eventId · occurredAt · actorId · actorConsole · objectType · objectId · action · outcome
```

- 落 `support.audit_logs`，**opera 与 admin 写同一张表**——审计是平台级事实，不因发自哪个门户而分家。
- `actor_console` 是 2026-08-16 新增列，由各 BFF 填**常量**（`opera` / `admin`）：一个进程只服务
  一个控制台，让调用方传迟早有人传错。auth-bff 的后台通道换票不属于任何控制台，那种行是
  `NULL`，不硬编一个。
- 写操作的审计行**必须在业务写事务内**，同生共死。

### 4.1 `outcome` 补齐：被拒的写操作也留痕（2026-08-16 联调发现 → 当日修复）

`outcome` 这一列**存在**，`support.audit_logs` 的 CHECK 也允许 `success` / `failure` / `denied`。
但 opera-bff 的审计行**写在事务内、成功路径上**——被能力门拦掉、被状态机拒掉、被校验挡掉的
那些请求，一条记录都不产生。实测：三次被拒的写操作（409 ×2、400 ×1）对应 **0 行审计**；
全库 25575 行 `success`、1 行 `failure`，`denied` 为零。

**这条必须写下来，因为我们刚拿同一件事去要求别人。** `runos#119` 的标题就是「管理事件缺
`outcome`——『谁试图做但被拒了』当前答不出来」。Runos 是没有那个字段，platform 是有字段
但从不写——**对消费方而言是同一个盲区**。「有列」不等于「有记录」，符合性看的是后者。

**已修（owner 当日拍板口径）**：`audit/denied-audit.ts` + 出口过滤器。

| 状态      | 记不记 | 为什么                                                                   |
| --------- | ------ | ------------------------------------------------------------------------ |
| 403       | **记** | 没有授权、step-up 未过——这是安全事实，正是审计存在的理由                 |
| 409       | **记** | 状态机拒绝（终态只读、非法迁移、锁定字段）——「有人想改一个不该改的东西」 |
| 400       | 不记   | 参数写错。每个手滑都留一行会把审计表淹掉，而它不回答任何安全问题         |
| 401       | 不记   | **写不了**：`actor_id` 是 NOT NULL，没有会话就没有主体。这类进访问日志   |
| 404 / 5xx | 不记   | 「对象不存在」不是拒绝；本方故障进错误日志与栈                           |

三条实现上的取舍，都写在 `denied-audit.ts` 文件头：

1. **在响应之后写**。留痕慢一点无所谓，让调用方多等一个数据库往返才不行。
2. **绝不抛**。业务事务早已回滚，留痕失败不能把一个已发出的 4xx 变成 5xx——那是拿观测性
   换可用性。但**必须留日志**：静默丢审计比不记审计更糟，因为你会以为记着。
3. **保真度低于成功路径，且明说**。过滤器看得见 HTTP、看不见领域动词：成功行是
   `governance.maintenance.start`，拒绝行只能从路径推 `maintenance_window.start`。
   它回答的是「谁、对哪类对象、想做什么、被什么码拒了」——`error_code` 那一格往往比
   `action` 更有用。

**池子不走构造器 DI**：由 `main.ts` 在 app 建好后 `app.get()` 传入。全局 provider 注入
useFactory provider 会让 bootstrap 静默死锁（`step-up.guard.ts` 头部记录过同一个坑）。

实测（2026-08-16 联调，真会话）：403 `AUTH_STEP_UP_REQUIRED` 与 409
`CATALOG_INVALID_STATE_TRANSITION` 各落一行 `denied`；同批的 400／404／GET 一行都没多。
全库 `denied` 由 **0 → 2**。

---

## 5. 弃用纪律（D-1）与本轮变更的处置

D-1 要求：破坏性变更 MUST 先标弃用、MUST 与新形状并存至少一个版本周期、MUST NOT 单方面下线；
**「同一个 URL 换语义」按破坏性变更处理**——比删掉更危险，因为调用方不会收到 404。

### 5.1 消费方边界：这里只有一个消费方，而且同批部署

`/api/*` 的消费方是且仅是 `portals/opera`——**同一个仓、同一次部署**。没有外部调用方、没有
脚本、没有第二个前端。

因此本面**登记一条有范围的豁免**：_在消费方与提供方同批部署的前提下，破坏性变更不设并存期。_
理由是并存期的作用是保护「来不及一起改的调用方」，而这里不存在那样的调用方；为一个不存在
的调用方维护两套路由，代价是真的，收益是零。

**豁免的边界写死在这里**：一旦出现第二个消费方——另一个前端、一个运维脚本、另一个产品直接
调 `/api/*`——**这条豁免立即失效**，D-1 全文适用。加消费方的那个人有义务回来改这一节。

### 5.2 本轮（2026-08-16）的破坏性变更清单

| 变更                                                                         | 类型                  | 处置                                 |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------------------ |
| `PATCH /api/products/:id/status` → `/state`（体字段同改）                    | 改路由 + 改字段       | 同批切换，portal 同时改              |
| `PATCH /api/oidc-clients/:clientId/status` → `POST :id/activate\|deactivate` | 删路由 + 换形状       | 同批切换                             |
| `GET /api/maintenance-windows?status=` → `?state=`                           | 改参数名              | 同批切换                             |
| 审计 DTO `id/time/actor/result/resourceType/resourceId` → X-3 字段名         | 改字段                | 同批切换（Dashboard + 审计页）       |
| `oidc_clients.status` 值 `disabled` → `inactive`                             | **改数据 + 改 CHECK** | 需一次协同部署，见 §5.3              |
| `PATCH …/checklist/:itemCode` 的 `remark` 由「省略即清空」改为「省略即不改」 | **换语义**            | 同批切换；这是修缺陷，旧行为无人依赖 |
| `PUT /api/maintenance-windows/:id` 在 `in_progress` 下由静默丢弃改为 409     | **换语义**            | 同批切换；旧行为是静默数据丢失       |

**并存期为零不是「不算破坏性变更」**——它们全都是，只是在 §5.1 的边界内不需要并存期。
列在这里是为了它们被数过，而不是被忽略过。

### 5.3 需要协同部署的两处（顺序反了会出事）

| 改动                                    | 不先 apply DDL 的后果                                     |
| --------------------------------------- | --------------------------------------------------------- |
| `support.audit_logs` 加 `actor_console` | 审计 insert 失败 → 审计在写事务内，**所有写操作跟着回滚** |
| `oidc_clients` CHECK 改 `inactive`      | 「停用客户端」写入被 CHECK 拒                             |

活库数据订正（本仓不代跑）：

```sql
update appoidc.oidc_clients set status = 'inactive' where status = 'disabled';
```

**顺序：apply DDL → 跑订正 → 重建 opera-bff / admin-bff。** 这就是没有并存期要付的价——
它没有消失，只是从「两套路由」变成了「一次有顺序的部署」。

---

## 6. platform 列的符合性

| 条款                      | 状态                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| X-1 错误封套与拒绝词表    | ✅ 2026-08-16                                                                                   |
| X-2 `task_id` 归因        | ✅ `product_210` §4.4（platform 自身管理面不产生 agent 调用，本条对本面 ➖）                    |
| X-3 审计与计量记录        | ✅ 2026-08-16——字段名 + `actorConsole` + **被拒留痕（§4.1）** 均已实测落库。本面无计量，那半 ➖ |
| X-4 一词一义 / 版本弃用   | ➖ 不拥有 `grants` / `endpoints` 两个撞名词；改名后适配层跟着改                                 |
| M-A-2 列表反查走参数      | ✅ 既有                                                                                         |
| M-A-3 分页与批量上限      | ➖ 本面无无界流水（审计读端点走钳制 `limit`，基数受留存策略约束）                               |
| M-B-1 动词语义            | ✅ §1                                                                                           |
| M-B-2 写入结果可分辨      | ➖ 未见「创建命中已存在对象」的模式                                                             |
| M-B-3 `state`             | ✅ §3                                                                                           |
| M-B-4 `DELETE` 只表示移除 | ✅ 本面无 `DELETE`                                                                              |
| G 组（消费面）            | ➖ 本面不面向 agent                                                                             |
| D-1 破坏性变更与弃用      | ✅ §5（含一条有范围的豁免）                                                                     |
| D-2 新产品准入            | 面向未来                                                                                        |
| D-3 符合性矩阵维护        | 本文即自陈；**新增写端点时回来改 §1 的表**                                                      |

**没有自动守卫。** D-3 建议用脚本校验可自动判定的部分（错误码大小写、审计字段名）。当前靠
评审，登记为待办——`UNCLASSIFIED_*` 兜底码已经是一个可 grep 的信号，但字段名与动词语义
还没有。
