# Opera ↔ Atlas / Runos 契约逐条复核（2026-08-23）

对着 `vxture-atlas` 与 `vxture-runos` 两个仓的**生产源码**（只读，`main` = `origin/main`，
均为 2026-08-21 迁仓后的 squash 初始提交）把 opera 的对接面从头核了一遍：
opera-bff 的两个代理路由 → 门户九个真实页面 → 每个字段名与每条写路径的前置条件。

## 验证状态

**§一 是源码比对得出的，§四 是把它们全部跑了一遍。** 两段是同一天的两轮：上午没有可连的
上游（Docker 未起），只能逐字段对源码；下午 owner 把 atlas / runos / karda 起在本机，补齐
opera 全栈、真实登录后逐条实测。

结论：**§一 的每一条都成立**，且实测又挖出四条只有跑起来才现形的（§4.3）。§一 里说错的一处
在 §4.2 纠正。

仍未覆盖的一条：atlas 处于 `blocked` 时服务状态页的表现（要停 owner 正在用的数据库，没做），
改为把翻译函数钉进单测。

---

## 一、已修（本仓；§4.3 又追加四条）

### 1. Atlas 路径改名，旧名 2026-09-16 停服 · `atlas.router.ts`

`product_251` X-4（atlas#206）把三个含糊的资源名改了：

| 旧名             | 新名                      |
| ---------------- | ------------------------- |
| `endpoints`      | `model-routes`            |
| `product-grants` | `product-endpoint-grants` |
| `grants`         | `tenant-model-grants`     |

旧名仍在服务，但带 `Deprecation: true` + `Sunset: 2026-09-16`，并计入
`capability_legacy_path_requests_total{path,operator}`——**那个计数器是删除旧名的闸门**
（日期是地板，归零才是触发条件）。继续打旧名等于我们自己把上游的清理挡住，且到期变 404。

已把出站路径全部改到新名（12 处），**对外路径一行不动**。审计不受影响：atlas 的
`canonicalCapabilitySegment()` 本来就把旧名折回新名再落库。

> **未办、需要另一位跟进**：`admin-bff` 还在打 `/capability/grants`（tenant 轴，属 admin
> 的商业面）。同一个 sunset 日期，同一个计数器。本次聚焦 opera，没有越界改它。

### 2. 编辑 Provider 必然 400 · `model/services/page.tsx`

编辑对话框里 `providerCode` / `providerType` 两个输入框**已经是 disabled 的**，但值照旧
躺在 draft 里，跟着整包 PATCH 发出去。Atlas 的判据是**出现即拒**，不比对值：

```ts
if (body.providerCode !== undefined) throw MODEL_ADMIN_VALIDATION_FAILED;
```

所以"编辑 Provider → 保存"必然失败，且报的是一条看起来像"你想改 code"的错——而用户根本
没改。**禁用一个输入框不等于把它从载荷里去掉。**

修法：拆出 `mutable`，创建时才拼上身份字段。

### 3. 编辑模型必然 400 · 同上

同一个形状，两个字段：

- `modelCode` —— 身份列，`98_column_locks.sql` 只给 INSERT。出现即 400。
- `provider` —— **根本不是列**，读的时候从所属 provider 联出来的。同样出现即 400，
  Atlas 的错误信息里明说换归属要用 `providerId`。

### 4. 网关 API Key 页整页渲染不出来 · `model/keys/page.tsx` + `lib/status.ts`

Atlas 现在回的是 `state`，不是 `status`；中间那档由 `disabled` 改叫 `inactive`
（M-B3 最小词表）。页面读 `r.status` → `undefined` → `KEY_STATUS_META[undefined].tone`
→ **TypeError，表格炸掉**。

顺带三处一起对齐：

- 新增 `effectiveState`（`active|expired|inactive|revoked`）——把到期折进去之后**现在实际
  是什么**。页面改读它，删掉本地那份 `isExpired()`：同一个判断有两个实现迟早分叉，而它决定
  的是"这把钥匙现在还开不开门"。
- `expiresAt` 真的有了。此前注释写着"Atlas 还没有这一列"，恒为 undefined；现在 create 与
  rotate 都收这个入参。签发对话框补了「到期」输入（留空 = 不限期）。
- `DELETE /capability/api-keys/:id` **已交付**（软删除，要求先停用或撤销）。门户侧比上游更
  严，只允许删已撤销的——停用是可逆的暂停，和终态一起开放删除等于让一次误点跨过可逆性。
  404 兜底文案保留，那是给还没升级的部署看的。

### 5. Runos 授权改条款：撤销+重发 → 一次 PATCH · `capability/grants/page.tsx` + `runos.router.ts`

原实现是「撤销 → 重发」，当时是对的（runos 对已存在的 direct 授权重写是彻底空操作）。
**两条前提都变了**：

1. 有了 `PATCH /commerce/capability-grants/:grantId`（`updateTerms`）——偏序更新，同一个调用
   里连带重编派生闭包，并发 `mgmt.capability_grant.update` 事件。
2. 重发换条款不再是空操作，而是 **409 `GRANT_EXISTS`**，message 直接指向那条路由。
   旧路径现在连"能跑通"都不成立。

换掉它还去掉两个真实代价：撤销与重发之间那一刻**产品是没有授权的**（两次写、两个失败点）；
以及新行是新 grantId，**已消费计数从零开始**——每改一次配额就等于送一次免费额度。

新增 BFF 路由 `PATCH /api/runos/grants/:grantId`。

### 6. 重置配额后，用量列开始说谎 · `capability/grants/page.tsx`

`quota/reset` 的响应是 `{grantId, used, updatedAt}`——**没有** `quotaLimit` / `enforced` /
`remaining`（那三个是 `consumption()` 拿着授权行现算的）。此前直接把它当 `QuotaConsumption`
存进缓存，于是 `q.enforced` 变 undefined，用量列把一条**有配额上限**的授权渲染成「未强制」。
改成重置完重新读一次消费量。

### 7. 注册 Skill 类型能力必然失败 · `capability/registry/page.tsx`

opera 给 skill 强制拼死的那条 `fetch` 操作缺 `inputSchema` / `outputSchema` / `idempotent`。
runos 只有**一个**操作校验循环，它对每一条 operation 都要求这三样，skill 那条并不例外
（skill 专属检查是在循环**之后**追加的，不是替换它）。提交一个 skill 会一次性收到三条错误。

已补上，用**空 schema `{}`** 编码——空 schema 在 JSON Schema 里的含义正是「不作任何约束」。

### 8. 提交 certified 审核必然失败 · 同上

runos `certify()` 对每一项都判 `note.trim() === ""` 并整批 400。opera 此前把空备注**整个键
省掉**，界面上还写着"备注（可选）"——默认状态提交必然失败，而错误信息读起来像是某一项填错了。

改成：`note` 始终发送、界面标必填、四项写全才能提交、说明为什么（"一句『通过』没有复核价值"）。

### 9. Atlas 就绪探测把「坏了」显示成「就绪」 · `product-health.router.ts`

025 标准的 readiness 词表是 `ready` / `degraded` / **`blocked`**，不是 `fail`。此前这里只认
`ready|degraded|fail`，`blocked` 落到 HTTP 状态码的兜底分支：

| 产品  | blocked 时的 HTTP             | 兜底判成        |
| ----- | ----------------------------- | --------------- |
| runos | 503（显式置的）               | `fail` 凑巧对了 |
| atlas | **200**（handler 不改状态码） | **`ready`**     |

也就是说 **atlas 数据库不可用时，服务状态页显示它「就绪」**。已抽出 `readinessFromBody()`
并认全词表。同时纠正文件头那句"全仓零产品真正接上 readiness"——atlas 与 runos 都接上了。

### 10. Runos 调用流水的延迟列恒为空 · `ops/logs/RunosCallStreams.tsx` + `runos.router.ts`

上游把延迟拆成 `latencyTotalMs` / `latencyGatewayMs` / `latencyCapabilityMs`，**没有
`latencyMs`**——而本页读的正是那个不存在的名字，于是延迟列一直是「—」，不报错。
已改读 total，另两段挂在 title 上（"慢在哪一段"是排障的第一个分叉）。

同一处：行标识由 `callId` 改为 `eventId`。`call_id` 在上游只有**非唯一**索引，配
`sequence_no` / `retry_of`——一次调用可以落多条事件行，重试时 React key 会撞。

### 11. 附带：`taskId` 跨产品串联 · `ops/logs/page.tsx` + `atlas.router.ts`

atlas 的请求日志现在带 `taskId`（X-2，读形状与过滤器都有），runos 的 `capability_call` 一直
有——**同一个键**。这是两条流之间唯一的接缝：一次 agent 任务在模型面烧了多少 token、在能力面
调了什么、哪一段失败的。已把过滤器接上（BFF 透传 + 页面输入框），并把 `taskId` 加进复制行。

顺带把 BFF 里几个**类型早就漂了但没人报错**的地方对齐：`AtlasChangeRecord`（X-3 的五个字段
改名，页面读的一直是新名，只有类型没跟上）、`AtlasRequestLogRecord`（缺 `taskId` /
`productCode` / `endpointCode` / `costUnit`）。

---

## 二、要回给上游的四条

**都没有发出去**——跨仓联络走 GitHub issue，是对外动作，等 owner 点头。内容准备好了，
后两条是联调实测出来的：

### → runos：文档与校验器在 skill 的 fetch 上自相矛盾

`docs/30-design/120-capability-model.md` §4.3 写着：

> No input/output schemas: the single `fetch` operation returns the content.

而 `service/src/registry/validation.ts` 的操作校验循环对**每一条** operation 都强制
`inputSchema` / `outputSchema` 必须是 JSON Schema 对象、`idempotent` 必须是 boolean，
skill 的那条 fetch 不例外。照文档写的注册请求会被自己的校验器拒掉。

要么校验器给 skill 的 fetch 放行，要么文档改口。我们这边按校验器走（那才是会拒绝请求的
一方），用空 schema `{}` 编码——但这是绕，不是解。

### → runos：能力详情把 embedding 向量整包发出来

`findCapabilityWithRelations()` 用 `include: { versions: ... }` 取全量列，而
`CapabilityVersion.embedding` 是 `Float[]`（发现向量）。于是 `GET /capability/capabilities/:id`
每个版本都带着一整条向量返回。opera 详情抽屉一次可能拉十几个版本。

**没有在 BFF 里裁掉**：裁了就等于我们替 runos 决定哪些字段不重要，而那个判断会漂。

### → runos：`GRANT_EXISTS` 的报错把人指向一个 404

**2026-08-23 实测坐实。** 条款不同的重复授权回：

> `acme-smoke-agent12312312 already holds github.repo-reader on different terms - PATCH /commerce/grants/01a0…d917 to change them`

而 `PATCH /commerce/grants/{id}` 实测是 **404**，真实路由是 `/commerce/capability-grants/{id}`。
这条错误信息的全部价值就是告诉你下一步打哪儿，而它指的地方不存在。

### → runos：对 `official` 能力跑认证清单会把它降级

`certify()` 判过四项之后**无条件** `admission_tier = "certified"`，而准入档是有序的
（`experimental < certified < official`）。实测：first-party 注册进来是 `official`，跑完
"全部通过"的清单之后变成 `certified` —— 一次通过的审核让它掉了一档。门户侧已经把入口对
`official` 禁掉了，但服务端也该拒（或至少不下调）。

---

## 三、有意没做的

- **`DELETE /capability/provider-keys/:id`** 上游有，opera 不代理。provider key 挂着
  `key_rotation_logs`（FK ON DELETE CASCADE），删一把连轮换史一起没。给 vault 加一个没人要过
  的硬删除入口不是"补齐对接"。要加，先讨论。
- **`POST /capability/endpoint-instances/:id/activate|deactivate`** 上游有，opera 走通用的
  `PATCH .../state`。端点是三态（active/draining/disabled），二元开关表达不了 `draining`——
  这正是 B-3 的判据本身。原样保留。
- **`isActive` → `state` 的语义迁移**（`atlas-compat.ts` 的删除条件）。这不是改名：要逐处判断
  `deprecated` 该算「在服务」还是「已停用」，机械替换成 `state === "active"` 会让**已弃用但仍
  在服务的模型显示成「停用」**。三十多处，是独立一批。

---

## 四、联调实测（2026-08-23 下午，本机 docker）

owner 把 atlas / runos / karda 起在本机，栈补齐为
auth-bff(3081) + accounts(3080) + opera-bff(3041) + opera(3040)，以 `superadmin` 真实登录后
逐条打。**§一 的每一条都从"读源码推断"升级成了"跑出来看见"。**

### 4.0 地基：跑着的镜像 == 我审的源码

| 容器               | 运行中 gitSha | 本地 HEAD                                                        |
| ------------------ | ------------- | ---------------------------------------------------------------- |
| `vx-atlas-app-dev` | `26795d18`    | `26795d1` —— 一致                                                |
| `vx-runos-app-dev` | `4996d56d`    | `465f289`，中间两个 commit 只动 docs/CLAUDE.md —— 服务源码零差异 |

### 4.1 逐条结果

| #                | 结论     | 实测证据                                                                                                                                                                                                                                                                              |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 路径改名       | ✅       | `capability/model-routes`、`product-endpoint-grants` 均 401（存在），对照 `capability/nonexistent-xyz` 404。改用新名后写一次 endpoint，atlas 审计记的是 `objectType: "model-routes"` —— **审计没有分叉**。`capability_legacy_path_requests_total` 在 opera 跑了整轮之后仍**零序列**。 |
| 2 Provider 编辑  | ✅       | 旧载荷（带 `providerCode`/`providerType`）→ **400 `providerCode cannot be changed after creation`**；新载荷（同样的值、只留可改字段）→ **200**。                                                                                                                                      |
| 3 模型编辑       | ✅       | 旧载荷 → **400 `modelCode cannot be changed after creation - it is the version identifier consumers pin against…`**；新载荷 → **200**。                                                                                                                                               |
| 4 API Key 页     | ✅       | 119 行响应里 **`anyRowHasStatus: false`**，字段是 `state` + `effectiveState` + `expiresAt`。旧代码读的 `r.status` 根本不存在，`KEY_STATUS_META[undefined].tone` 必抛。修后整页正常，且 **6 把 `state:active` 但 `effectiveState:expired`** 的 key 正确显示「已过期」。                |
| 5 授权改条款     | ✅       | 用旧路径重发换条款 → **409 `GRANT_EXISTS`**（前提已变，确认）。新 `PATCH` → 200，`grantId` 与 `createdAt` 不变、`compiledAt` 前进、`riskScope` read→write、`quotaLimit` 100→500，runos 侧发出 `mgmt.capability_grant.update`。                                                        |
| 6 重置配额       | ✅       | `GET .../quota` 回 6 个字段；`POST .../quota/reset` 只回 `{grantId,used,updatedAt}` **3 个**。塞进同一格缓存 `enforced` 就是 undefined。                                                                                                                                              |
| 7 注册 Skill     | ✅       | 旧 `SKILL_OPERATION` → 400，**恰好三条**：`inputSchema`/`outputSchema` 不是 JSON Schema 对象 + `idempotent is required`。补齐后 → 201。                                                                                                                                               |
| 8 certified 审核 | ✅       | 空备注 → **400 `item "prompt_injection_surface" requires a boolean pass and a non-empty note`**；写了依据 → 201 `outcome: certified`。                                                                                                                                                |
| 9 就绪探测       | ⚠️ 见下  | atlas/runos 都探得到（`/readyz`，`status:"ready"`）。**没能制造 `blocked`**——那要停 atlas 的数据库，是对 owner 正在用的环境动手，没做。改为把翻译函数单测钉死。                                                                                                                       |
| 10 调用流水延迟  | ✅       | 响应里 **`'latencyMs' in row === false`**，真值在 `latencyTotalMs/GatewayMs/CapabilityMs`（7252 / 86 / 7166ms）。修后页面 74 行延迟列全部有数，此前全是「—」。                                                                                                                        |
| 11 taskId 串联   | ✅（半） | 过滤器不被 `rejectUnknownFilters` 拒（200）；atlas 200 行里 9 行带 `taskId`；按 `smoke-46676-1787017805957` 过滤命中 8 行，页面输入框可用。**但这套 dev 数据里两边的 taskId 没有交集**，跨产品拼接这件事本身没有数据可演示。                                                          |

### 4.2 §一 里说错的一处，纠正

原文在第 7 条实测清单里担心「探针够不着 atlas，因为 atlas 没有前端门户」。**不成立**：
`/api/product-health` 实测 atlas 的 origin 是 `http://localhost:3100`、命中 `/readyz`、
`live: healthy`、`ready: ready`。runos 同理。karda 存活正常、readiness 未实现。

### 4.3 只有跑起来才看得见的四条（已一并修掉）

这四条读源码时都没抓到——它们不是"形状对不上"，是**两边各自合法、拼在一起才失效**。

**（12）`droppedAlias` 是复数 `droppedAliases`，警告一次都没触发过**
撤一个版本，runos 回 `{"droppedAliases":["latest"]}`（数组，且覆盖**所有**指向该版本的
别名，不只 stable）。opera 读的是单数 string，恒为 undefined —— 于是"这个能力现在没有
stable 可解析"那条 warning **从来没有亮过**，撤掉一个正是 stable 的版本只会得到一个平静的
绿色 toast。已改为按实际掉的别名报，并只在 `stable` 在其中时才说"没有 stable 可解析"。

**（13）对 `official` 能力跑认证清单是降级，而按钮写着"提交 certified 审核"**
准入档有序（`experimental < certified < official`），`certify()` 判过之后**无条件**置成
`certified`。实测：first-party 注册进来是 `official`，四项全过跑完变成 `certified`。
菜单项此前只在 `certified` 时禁用，`official` 时是**可点的**。已一并禁用。

**（14）兼容层把 39 把已撤销的 key 标成"生效中"**
`atlas-compat.ts` 由 `state` 补 `isActive` 的判据是「不等于 `inactive` 就算开着」。这对
两值资源无损，但网关 API Key 是三值 —— 活库 119 把 key 里 **39 把 `revoked` 全被补成
`isActive: true`**。今天没有页面读它（那页读 `state`/`effectiveState`），是个还没爆的雷；
但一个"已撤销 = 生效中"的字段摆在那儿，下一个顺手读它的人不会怀疑。已修 + 单测。

**（15）服务状态页的「checks」栏对每个真正实现了 readiness 的产品都是空的**
025 标准里 `checks` 的值是对象（`{status,latencyMs}`），而 `readChecks()` 只收字符串，
于是全部丢掉、返回 null。修后 atlas 的六项依赖检查显示出来了，其中
**`registryDrift: warn 76ms`** —— 一个此前完全看不到的告警。

### 4.4 记一笔，没修

- **opera-bff 把上游的 200/201 抹平成自己的默认 201。** runos 用状态码区分"新建"与"已存在"
  （product_251 B-2），而 BFF 的 Nest 控制器对 POST 默认回 201，上游那个区分**过不了代理层**。
  今天没有页面读它，所以是记录不是修复 —— 真要修，得让每个 POST 代理显式透传上游状态码，
  那是一次涉及两个 router 全部写路由的改动，值不值得由 owner 定。
- **`rejectUnknownFilters` 目前打不到我们**：BFF 只转发自己 `@Query` 声明过的键，送一个野参数
  根本到不了 atlas（实测 `?notAFilter=1` 回 200）。所以那条纪律约束的是**我们往 params 里加键**
  的时候，不是透传风险。

## 五、跑过的验证

| 项                                           | 结果                      |
| -------------------------------------------- | ------------------------- |
| `pnpm --filter @vxture/bff-opera type-check` | 通过                      |
| `pnpm --filter @vxture/bff-opera lint`       | 通过                      |
| `pnpm --filter @vxture/bff-opera test`       | 67 passed（新增 10 条）   |
| `pnpm --filter @vxture/opera type-check`     | 通过                      |
| `pnpm --filter @vxture/opera lint`           | 通过                      |
| `pnpm --filter @vxture/opera build`          | 通过                      |
| `pnpm lint:design`                           | 通过（DS 债基线 3，未增） |
| 真实登录 + 九个页面逐条点                    | 见 §四                    |

**类型检查一条都没拦住上面任何一个缺陷**——它们全都是"我方类型自己声明的形状"与"上游真实
返回的形状"之间的漂移，而 `request<T>()` 只做断言不做校验。§4.3 那四条更进一步：连逐字段
读源码都没抓到，因为两边各自看都是对的。**这类缺陷只有真的跑一遍才会现形。**

## 六、联调环境残留（收尾用）

- 本次为联调启动、**仍在跑**：dev-panel(:8090) + auth-bff(3081) + accounts(3080) +
  opera-bff(3041) + opera(3040)。停：`POST http://localhost:8090/api/bulk/stop`，或直接关掉
  dev-panel 进程。**改了 BFF 代码要重启 opera-bff**（`POST /api/service/opera-bff/restart`），
  它是 build 产物不热重载。
- 写进 runos dev 库、已收尾：测试授权 `acme-smoke-agent12312312 → github.repo-reader`（已撤销，
  产品剩 0 条）；测试能力 `runos.opera-smoke-skill`（版本 1.0.0 已 `withdrawn`，从快照掉出；
  能力行本身**删不掉**，runos 的目录保留历史）。
- 写进 atlas dev 库：三次原值回写的 PATCH（provider / model / endpoint 各一次，字段值没变），
  外加两次故意失败的 PATCH —— 五条都在 `audit.change_records` 里，`actorConsole: "opera"`。
- **`vx-platform-pg` 在无限重启**（secret 路径被 Git Bash 的 MSYS 翻译搞坏：
  `D:/Program Files/Git/run/secrets/...`）。真正在用的是 `vx-platform-postgres-db-dev`(5433)，
  不影响联调，建议清掉这个僵尸容器。

---

## 七、2026-08-23 第二批（owner 定调之后）

owner 口径：**按上游完整契约建，不裁字段；生产标准；允许出错但错要精准；剩下的列计划，
不建妥协的过程产品。** 按这条把上一批里几处"防御性降级"全部清掉——它们正是妥协的过程产品。

| 做了什么                                                                   | 之前是什么                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 删 `atlas-compat.ts` + 门户 30+ 处 `isActive` 全量迁到 `state`             | 垫片由 `state` 反推布尔，页面读布尔；三值资源在它手里必然失真                                |
| 新增 `features/atlas/state.ts`：`isEnabled` / `isServing`                  | 迁移不是换表达式，是换成**说清在问什么**的名字；`deprecated` 归哪边逐处判断过                |
| 新增 `atlas-contract.ts`：列表读出口断言必有字段，缺则 502 点名            | 三处「这台 Atlas 还没有删除前置条件」降级文案 + 一个恒为「—」的依赖计数 + 一个从不触发的告警 |
| 模型注册补 `modelType` + 四个容量字段，列表补类型/上下文/`behaviorVersion` | 只能建 chat 模型（服务端默认值），五个字段不可见不可编                                       |
| 两条 POST 透传上游状态码                                                   | Nest 默认 201 把 B-2 的「新建 vs 已存在」抹平                                                |
| `admin-bff` 迁到 `tenant-model-grants`                                     | 仍在打 2026-09-16 停服的旧名                                                                 |
| `next.config.js` `OPERA_BFF_DEV_URL` → :3041；删僵尸容器 `vx-platform-pg`  | 退役端口默认值；MSYS 路径搞坏的孤儿容器空转 4 天                                             |

**第二批的实测**（opera-bff 重启后，同一套真实登录）：

- 契约断言四个资源全过；四个资源的响应里 **`isActive` 已彻底消失**
- 模型新字段流通：`modelType:"chat"` / `contextWindow:200000` / `sort:523` /
  `behaviorVersion:"b1-8b2d8cf78621"`
- **状态码透传生效**：同一条授权首次 POST → **201**，条款相同重复 POST → **200**（此前恒 201）
- 页面渲染确认：模型子表新增「类型 / 协议」「上下文 / 输出」两列，未声明的显示「未声明」/「—」而不是 0
- 全量校验：opera-bff 69 tests（新增 `atlas-contract.spec.ts` 10 条，含反向验证）· 两个包
  type-check/lint · admin-bff type-check/lint/85 tests · portal build · boot-smoke · prettier · lint:design 全绿

**四条上游 issue 已发**（owner 逐条授权）：runos
[#6](https://github.com/vxture-foundation/vxture-runos/issues/6) ·
[#7](https://github.com/vxture-foundation/vxture-runos/issues/7) ·
[#8](https://github.com/vxture-foundation/vxture-runos/issues/8) ·
[#9](https://github.com/vxture-foundation/vxture-runos/issues/9)

**剩余缺口的计划**见 [`2026-08-23-atlas-runos-remaining-plan.md`](./2026-08-23-atlas-runos-remaining-plan.md)
——其中 **P0 是 admin 的 atlas 页面**：本轮在 opera 修掉的那个"读一个上游已经不发的字段"，
在 admin 里还原封不动地活着，且已两步实证。

---

## 八、admin 批（同日，owner 批准后）

计划里的 P0 做掉了。**实际范围比"把 `isActive` 换成 `state`"大得多** —— 逐字段对完
atlas 的 `*AdminRecord` 之后发现三类问题，第三类是硬断的：

### 8.1 六个记录全都在读一个上游不发的字段

`isActive` → `state`。admin-bff **没有任何归一层**（opera-bff 那个垫片是它自己的），
所以每一处 `x.isActive` 都是 `undefined`。表现：授权状态徽标全渲染成「停用」、启停开关
按 `!undefined` 取反**永远发 activate**、仪表盘两个计数恒为 0。

### 8.2 两个记录**整个形状**是上游不再返回的旧版

| 记录                | admin 声明的                                                                                                                                                         | atlas 实际返回的                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ModelPolicyRecord` | `policyCode` `policyName` `policyType` `dailyTokenLimit` `monthlyTokenLimit` `dailyRequestLimit` `monthlyRequestLimit` `allowFallback` `fallbackModelCodes` `config` | `name` `priority` `maxConcurrent` `rateLimitRpm` `rateLimitTpm` `rateLimitTpd` `maxContextTokens` `state` `effectiveAt` `expiresAt` |
| `TenantQuotaRecord` | `periodStart` `periodEnd` `maxAgents` `maxKnowledgeBases` `maxStorageGb` `usedTokens` `allowedModelIds` `isActive` `createdAt` `updatedAt`                           | `maxApiKeys` `maxWorkflows` `maxConcurrent` `rateLimitPerMinute` `allowedModels` `effectiveAt` `expiresAt`                          |

**几乎没有一个字段对得上。** 而且 atlas 的配额**根本没有 state / isActive** —— 它生不生效
完全由 `effectiveAt`/`expiresAt` 的窗口决定，读时判定。所以统计卡上那句「生效中的配额」
此前读的是一个上游从来没有过的布尔，恒为 0；现在改成算窗口（`isInForce()`）。

### 8.3 三条更新路由发 PUT，而 atlas 只有 PATCH —— **实测 404**

直连 atlas 逐方法探（401=路由在、404=没有，另用不存在的路径做对照组）：

```
PATCH /capability/tenant-model-grants/abc -> 401     PUT -> 404
PATCH /capability/price-rules/abc         -> 401     PUT -> 404
PATCH /capability/policies/abc            -> 401     PUT -> 404
```

也就是说 **admin 上「编辑一条授权 / 价格规则 / 策略」全线是 404**。出站方法改 PATCH，
**对外仍是 `@Put`**（门户那侧语义没变，把上游差异吸收在适配层，与路径改名同一条纪律）。

### 8.4 写入侧的静默忽略

atlas 的 create body 收 `state` 不收 `isActive`；update body **根本没有状态字段**——
启停只走具名 activate/deactivate，理由是审计：`AuditMiddleware` 从路径推导 action，
用 update 改状态会被记成 `action='update'`，于是按 `?action=deactivate` 检索的审计员一条
都查不到。此前两处都在发 `isActive`，被上游静默丢掉。

修法：create 映射到 `state`；**编辑对话框里那个"启用"勾去掉**，换成一句说明指向行操作
——它在编辑态本来就什么都不做，勾了保存、值被丢掉、界面还显示成功。

### 8.5 语汇上收到共享包

`isEnabled` / `isServing` / `isInForce` 从 opera 的 `features/atlas/state.ts` 迁到
`@vxture-platform/shared`（`constants/atlas-state.constants.ts`），opera 侧改为薄转出。

理由：**两个门户读同一批记录，这个判断只能有一份**。`catalog-domains.constants.ts` 立的
「纯值集、零业务逻辑」在这里不适用，差别写在文件头：那条规矩管的是**平台自己的商业政策**
（哪个订阅状态算有覆盖），而「`deprecated` 算不算还在服务」是**上游契约的事实**——
atlas 自己定的优先级 `deleted_at > is_active > deprecated_at`。两个门户对同一个字段得出
不同结论，其中必有一个是错的。

admin-bff 也加了自己的 `atlas-contract.ts`（与 opera-bff 同型、物理独立——两个 \*-bff
之间不建依赖是明确纪律；清单不同因为代理的资源子集不同）。

### 8.6 这一批跑过的验证

admin 门户 type-check / lint / build（46 页）· admin-bff type-check / lint / 85 tests /
boot-smoke · opera 侧全部复跑 · `lint:boundaries`（2444 模块无违规）· format · lint:design。

**尚未做**：admin 的真实登录点检。admin 有自己的 RP 会话，需要 owner 再登一次
（`http://localhost:3030/auth/login`）。8.1–8.4 的判据里，**8.3 是直连 atlas 实测的**，
8.1/8.2 是逐字段对 atlas 源码（gitSha 已证实 == 在跑的镜像）。

### 8.7 真实登录点检（admin），又逼出两条

owner 登录后逐页点检。**§8.1–8.4 全部确认**，同时又暴露两条只有跑起来才会现形的：

**（16）模型平台页整页打不开 —— 一个 501 拖垮六个读**

atlas 的 `GET /capability/quotas` 是一个**故意的 501 桩**：

> `MODEL_ADMIN_NOT_IMPLEMENTED` — "Bulk quota listing across tenants is not available
>
> - the platform exposes only a single-workspace entitlement read"

而 `ModelPlatformPage` 把它和另外五个读放进同一个 `Promise.all`。实测：**5×200 + 1×501
→ 整页空白**，还打出「模型数据读取失败，请确认 Model Platform 是否已启动」——把人指向一个
根本没坏的服务（atlas 好好的，5/6 都成功）。**既有缺陷，与本批改动无关。**

改成 `Promise.allSettled`：成功的照常渲染，失败的那一格自己降级。配额那一格显示 **「—」**
而不是编一个 0 —— 上游不提供就说不提供。修后整页恢复：模型注册 131（在线 105/自建 26）、
启用 106/停用 25、Provider 19（启用 15）、策略 130/价格 213、配额「—」/汇总 303。

**（17）编辑授权：404 → 400 → 200**

同一条路径上三个真实缺陷，逐个removed，全在一次网络追踪里：

| 阶段       | 状态码  | 原因                                                                                                                                                          |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 修之前     | **404** | admin-bff 发 PUT，atlas 只注册了 PATCH（§8.3）                                                                                                                |
| 改完方法   | **400** | 载荷带 `agentId` —— atlas 对 `agentId`/`applicationId`/`applicationType` 是**出现即拒**：租户授权的应用范围创建后固定，`atlas_svc` 在这三列上没有 UPDATE 权限 |
| 载荷也改完 | **200** | 只送 `priority`/`reason`/`expiresAt`；`agentId` 只在创建时送，编辑态下拉锁死                                                                                  |

第二条与 opera 那边 Provider / 模型编辑**是同一个坑**：禁用一个输入框不等于把它从载荷里去掉。

**其余点检结果**：188 条租户覆盖授权全部显示「启用」（修之前会全是「停用」）；行菜单显示
「停用覆盖」（说明正确读出了状态）；编辑对话框里那个死勾已换成指向行操作的说明横幅；
模型筛选的「已弃用」第三档已接上，但这库里 131 = 106 启用 + 25 停用，**没有 deprecated
模型可证**，属于"接上了但无数据"。

### 8.8 补上 runos 侧的契约守卫（同日）

`atlas-contract.ts` 先建、runos 空了一轮，而 runos 恰恰贡献了两条漂移
（`latencyMs` 不存在、`droppedAlias` 是复数），**两条都是手工逐字段对源码才发现的**。
只守一半等于把「漂移会响一声」这个保证做成了一半，而一半的保证最容易被当成全部。

新增 `runos-contract.ts` + `runos-contract.spec.ts`（11 条），挂在十处读上：
capabilities（列表 / 详情）· credentials · 三条审计流 · 用量汇总 · grants（两种取法）·
配额消费量。

**与 atlas 侧的一处真实差异：runos 的读是信封。** atlas 回裸数组，runos 的审计流回
`{rows, nextCursor}`、用量汇总回 `{dimension, from, to, rows}`。照抄 atlas 那个「是数组就
查第一行」的实现会把信封当成单个对象去查——要么每次都报错，要么变成一个**恒真的守卫**，
而恒真的守卫比没有守卫更糟：它让人以为这一侧被守着。`firstRow()` 存在的全部理由就是这个，
spec 里「信封」那一组把两种错法都钉住了。

**实测**（opera-bff 重启后、真实登录逐页走）：能力注册 / 凭证托管 / 调用日志 / 用量计量 /
变更审计全部正常渲染，opera-bff 336 行日志里 **契约违约 0、ERROR 0** —— 清单没有误伤。

未被真实数据覆盖的两处，如实记下：`grants` 当前库里是空集合（守卫对空集合直接放行）；
`grant-quota` 的字段清单来自本轮早些时候那次真实读
（`{grantId, used, quotaLimit, enforced, remaining, updatedAt}`），不是这一轮重新观测的。
