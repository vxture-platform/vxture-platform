# L0 工具协议规范:产品间直连的身份·授权·计量标准(Tool Protocol)(product_210)

> 版本:**v1.3** · 日期:2026-07-07(v1.0 定稿) / 2026-07-27 补 §11 / 2026-07-28 补 §4.1a(`endpoint` 字段,回应 `vxture-atlas` liaison platform#159) / **2026-08-16 v1.3**:§4.4 新增请求元数据(`task_id` 必备)、§7 错误封套并入 `product_251` X-1、头部声明与 runos `210-consumption-contract` 的关系 · 状态:**已定稿**(决策点 D1–D3 已于 2026-07-07 owner 拍板,见 §9;**实施逐项授权**,切分见 §8;**T1/T2 已实施(2026-07-12)**,T3 未实施;§11 治理检查单、§4.1a `endpoint` 字段均为新增,不改变已定稿的 §1–§10 核心决策)
> 文档族:产品架构族 `product_{NNN}`,本文 = **210**(细化标准位);族路由见 [`product_100_matrix.md`](./product_100_matrix.md) §0 头部
> 定位:**产品 ↔ 产品直连调用的平台技术标准**——工具形态(MCP 风格)、S2S 身份透传(token exchange)、grant ∧ entitlement 求值时点、审计与计量归属、错误与版本演进。补齐 [`product_200_integration.md`](./product_200_integration.md) 三通道之外的"第四面":C1/C2/C3 管"产品对平台",本文管"产品对产品"。
> 上游:[`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) §7(唯一直连通道,已固化)、product_200 §2.2/§5(登记项)、[`identity-platform-idp.md`](./identity/070-idp.md)(token 设施:RS256/JWKS/`/oidc/token`)、ADR-11/ADR-12、[`data_sharing_100_architecture.md`](./data_sharing_100_architecture.md)(可见集)。
> 铁律承接:**平台只出规范与凭证,不出网关**——不设中心代理节点,调用永远产品↔产品直连(product_110 §7.2 已否决 ESB 模式);产品不读平台库、不持 Provider Key。

> ### ⚠ 与 runos `210-consumption-contract.md` 的关系(2026-08-16 声明,`product_251` R-4)
>
> **有两份文件都叫「210」,而且都在讲消费面——它们不是同一份的两个副本,也不是上下游。**
>
> |      | 本文 `product_210`                                          | runos `210-consumption-contract`                    |
> | ---- | ----------------------------------------------------------- | --------------------------------------------------- |
> | 层   | **L0 平台标准**:产品↔产品直连的身份、授权求值时点、计量归属 | **runos 产品自己的消费面契约**:agent 怎么调它的能力 |
> | 管谁 | 所有产品(含 runos 自己作为 caller / provider 时)            | 只管 runos 的消费面                                 |
> | 谁改 | 平台仓                                                      | runos 仓                                            |
>
> runos 的那份 MUST 满足本文与 `product_251` 的 MUST 条款;本文不规定它的具体端点形状。
> **重号是跨仓巧合**——两个仓各有各的 `{NNN}` 序列,谁也没占用谁的号段。但巧合不构成辩护:
> 一个人同时读两个仓时,「210」这个词指两件事,而上下文并不总是在场。**改号需两仓同时定**,
> 已作为待办登记(`docs/70-workplan/30-l1-consistency-audit.md` R-4);在改成之前,引用时一律
> 带仓名前缀,不许单写「210」。

---

## 1. 目标与非目标

**目标**:让每一次跨产品调用(agent→L2 工具面、技能→L1/L2)具备四件平台职能——①**可信调用方身份**(谁、替哪个 org/WS、是否代表某用户);②**入口授权求值**(grant ∧ entitlement,被调方据身份判定);③**计量归属**(用量记到正确的 workspace × 执行点产品);④**审计**(凭证签发与调用留痕)。终态**取代 `AUTH_INTERNAL_TOKEN`**(一把共享口令)在产品间的任何使用。

**非目标**:不建网关/ESB;不做流量转发与中心限流(provider 自理);不改变 C1 用户级 OIDC(人用产品照旧);不含跨 org 调用(org 为绝对隔离边界,唯一跨 org 形态 = P 级资产经 entitlement);不做产品↔平台面的替换实施(仅登记迁移方向,§3.5)。

> **与 Runos 商业域网关的关系(2026-08-10 补注,`product_110` v1.1 §6.1)**:"不建网关"约束的是 **L0 协议层**——平台不设中心代理节点,联邦域调用恒为对等直连。Runos 的商业域网关是 **runos 产品自己的数据面**,只服务商业能力域(以订阅独立交付的业务场景 agent),它在本协议中既是 caller(代 agent 调提供方)也是 provider(对 agent 暴露能力面),**不是平台级中心网关**,也不改变本文任何条款。

## 2. 参与方与信任模型

```
调用方(caller)  = 发起调用的产品(L3 agent / Runos 技能执行位 / Runos 商业域网关 / L2 互调)
被调方(provider) = 暴露工具面的产品(L1/L2:Atlas/Ontos/Karda/Terra/Arda/Runos 分发面 + 商业域能力面)
L0(平台 IdP)    = 唯一凭证签发方(accounts.vxture.com,RS256 + JWKS,既有设施复用)
```

信任链:provider **只信 L0 签发的 S2S token**(验签 + claims),不信调用方自述的任何身份上下文;caller 的服务身份 = 其在 `appoidc` 目录中**既有的 confidential client**(client_id = product_code + client_secret),不新建第二套服务账号体系。

## 3. S2S 凭证:token exchange

### 3.1 凭证形态

S2S access token = **RS256 JWT**(header 带 `kid`,与用户级同一 JWKS/轮换机制),**短时效**(默认 300s,决策 D1)、**单受众**(`aud` = 被调方 product_code)、不可刷新(过期重换,无 refresh)。

| claim                     | 值                                              | 说明                                           |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `iss`                     | `https://accounts.vxture.com`                   | 既有 issuer                                    |
| `aud`                     | 被调方 `product_code`(单值)                     | A 的 token 到 B 必拒(对齐用户级 aud 纪律)      |
| `act.sub`                 | 调用方 `product_code`                           | **调用方身份**(RFC 8693 act 结构,验签后即可信) |
| `org_id` / `workspace_id` | 调用上下文                                      | 求值与计量归属的键                             |
| `sub`                     | 用户 id(OBO 模式)/ 缺省                         | 是否代表具体用户                               |
| `mode`                    | `obo` \| `service`                              | 两种铸币模式(§3.2)                             |
| `scope`                   | v1 = `tool:{provider_code}`(product 级,决策 D3) | 后续可细化到 tool 级                           |
| `exp`/`iat`/`jti`         | 标准                                            | `jti` 供审计与(预留)吊销                       |

### 3.2 获取:`POST /oidc/token`,grant_type = token-exchange

既有 token 端点新增 `urn:ietf:params:oauth:grant-type:token-exchange`(RFC 8693);client 认证 = 调用方产品既有 client credentials(`client_secret_basic`/`_post`,同 C1)。两种模式:

| 模式                    | 输入                                                             | 上下文来源                                                     | 典型场景                      |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| **OBO**(on-behalf-of)   | `subject_token` = 调用方持有的**用户 access_token**              | 从 subject_token 解出(org/ws/user,平台可信来源,调用方无从伪造) | 用户在 agent 里触发的实时调用 |
| **service**(服务上下文) | 无 subject_token,显式 `requested_context={org_id, workspace_id}` | 调用方声明,**平台铸币时校验**(下行)                            | 后台 Job/定时同步(无用户在场) |

**service 模式铸币授权规则(决策 D2,防任意 WS 冒用)**:调用方产品在所声明的 workspace 必须持有**有效覆盖**(该 (workspace, caller_product) 存在 active/trialing 订阅覆盖或 provisioned 开通态,平台侧直查 metering/provisioning)——即"你只能替真正开通了你的空间说话"。校验失败 → `invalid_target`。

被调方产品对调用方 WS 的 entitlement **不在铸币时校验**——那是 provider 入口求值的职责(§5),两层不合并:铸币管"调用方合法性",入口管"这次访问放不放行"。

### 3.3 被调方校验义务(硬性,对齐 RP 八条纪律)

1. `alg` 必须 RS256,显式拒 `none`/`HS*`;2. 按 `kid` 从 JWKS 取键(缓存,未命中刷新一次);3. `iss` 精确匹配;4. `aud` === 自身 product_code;5. `exp` 未过(容许 60s 偏移);6. `act.sub` 必须存在(无 act = 用户级 token 混用,拒);7. **绝不接受 `AUTH_INTERNAL_TOKEN`** 作为产品间凭证;8. 不信任 token 之外任何渠道传入的身份上下文(header/body 里的 org/ws 一律以 token 为准)。

### 3.4 调用方义务

不得伪造/降级/拼装身份上下文;不得转借 token(受众单值天然限制);不得缓存超过 `exp`;OBO 场景用户 token 失效则重走用户级刷新再换,不得降级为 service 模式续命(用户已离场的语义不同)。

**另须携带 `task_id`**——见 §4.4。身份回答"谁在调",`task_id` 回答"这次调用属于哪一件事";两者缺一,一个 agent 任务同时用了能力与模型时就拼不回一棵树。

### 3.5 与 `AUTH_INTERNAL_TOKEN` 的关系(过渡登记)

现行 `x-vxture-internal-auth` 仅限**产品 → 平台**的 C2/C3/可见集端点(`/platform/*`,product_310 D1 过渡态);**产品 ↔ 产品一律不得使用**。本协议落地后,平台面端点迁移到同款 S2S token(`aud=vxture`),届时退役共享口令——迁移为独立实施项,随 §8 T2 登记,不在 v1 强制。

> **同端点的 operator-OBO 模式(2026-07-28 登记,不属本协议)**:token 端点另承载管理面的操作者换票(subject=workforce 操作者 access token,铸 `mode="operator"`/`scope="mgmt:{aud}"`),治理归 `product_250_management-plane-contract.md` M-1——**不是 S2S 产品契约的一部分**,供给面守卫按 `scope` 前缀即可结构性拒收管理票。

## 4. 工具 schema 约定(MCP 风格)

### 4.1 工具描述符

```jsonc
{
  "name": "arda.query_dataset", // 命名空间 {product_code}.{tool_name},全局唯一
  "title": "查询数据集",
  "description": "按可见集内的 dataset ref 执行只读查询",
  "endpoint": { "method": "POST", "path": "/v1/query_dataset" }, // 实际调用路径,§4.1a
  "input_schema": {
    /* JSON Schema draft 2020-12 */
  },
  "output_schema": {
    /* 同上,可选 */
  },
  "version": "1.0.0", // semver;破坏性变更必须升 major
  "deprecated": false,
  "metering": { "metric": "arda.query", "mode": "per_call" }, // 计量声明(可选,§6)
  "authz": { "asset_types": ["dataset"] }, // 授权声明:涉及的资产类型(求值提示)
}
```

#### 4.1a `endpoint` 字段(2026-07-28 新增,回应 `vxture-atlas` liaison platform#159)

此前的描述符只说"这个工具存在、接受什么、怎么计量",不说"POST 到哪"——消费方能发现能力,却发现不了
可达性。`vxture-atlas`#61(TD-013)把 `model-platform/*` 整体改名到 `/v1/*`+`/capability/*` 时,轮询
`GET /.well-known/vxture-tools` 的消费方会看到**字节级不变**的响应,直到下一次真实调用才 404——描述符
全程"准确",但唯一变了的那件事(路径)恰好是这个 shape 表达不了的。

- **`path` 相对 provider 自己的 base URL**(消费方已从 config/registry 拿到),**不得成为第二处存放主机名
  的地方**——环境耦合仍然只经由 provider 的部署配置,不经由描述符。
- 与既有 `deprecated` 字段天然配对:provider 改路径时可以**新旧描述符并存**过渡(旧的
  `endpoint.path` 保留、标 `deprecated: true`;新的作为一个新条目并列),消费方按 §4.3 的版本纪律
  平滑迁移,不需要任何带外通知——这正是本字段存在的理由。
- 按 §7 的演进规则("新增字段向后兼容")是纯新增字段,老消费方忽略它不受影响,可向后兼容发布。

### 4.2 发现(无中心注册表)

provider 在自己的服务面暴露清单端点 `GET /.well-known/vxture-tools`(**tailnet 面,S2S 绝不公网**,#89 裁定;区别于边缘 `/.well-known/openid-configuration` 仅供浏览器)——S2S token 鉴权,返回工具描述符数组 + `protocol_version`。**平台不建中心工具注册表**——"平台知道哪里有数据"归 Arda 目录、"技能引用哪些工具"归 Runos 技能定义,各自以 `{product_code}.{tool_name}` 字符串松引用,调用时按 provider **在平台 tailnet 内网**直连(类 2 产品 S2S 一律 tailnet、绝不公网,权威 = product_230 §1;`arda.vxture.com` 等域名仅是缺省信号,判类以是否在 tailnet 为准)。

### 4.3 版本纪律

对齐 Runos 版本 pinning(product_110 §6.7):技能/agent 引用工具**锁定至 major**;provider 弃用工具先置 `deprecated: true` 并保留 ≥1 个发布周期;移除或破坏性变更必升 major 且旧 major 并存过渡。**路径迁移(改 `endpoint.path`,§4.1a)按同一纪律走**:旧描述符原地保留、置 `deprecated: true`,新路径作为新条目并列发布,双方并存至少一个周期——消费方靠轮询清单端点即可感知迁移,不需要额外的书信广播。

### 4.4 请求元数据:`task_id` 必备,其余永远可选(2026-08-16 新增,`product_251` G-1 / X-2)

每次调用 MUST 携带一条**身份链**:

| 项              | 必备性                    | 说明                                                                  |
| --------------- | ------------------------- | --------------------------------------------------------------------- |
| `task_id`       | **MUST**                  | 调用方给,**整个任务内稳定**;被调方 MUST 原样落库到自己的调用/请求记录 |
| 传输层身份(S2S) | **MUST**                  | 即 §3 的 token,不在元数据里重复                                       |
| 委托凭证        | 存在最终用户上下文时 MUST | OBO 模式(§3.2)                                                        |
| `session_id`    | SHOULD                    | 归因用                                                                |
| `agent_version` | SHOULD                    | 归因用                                                                |

形状取 Runos 已冻结的 `_meta.vxture`(理由完整,不另起一套):

```jsonc
{
  "_meta": {
    "vxture": {
      "task_id": "tsk_...",
      "session_id": "...",
      "agent_version": "...",
    },
  },
}
```

**「其余永远可选」是承诺,不是描述**:agent 运行时的升级成本很高,事后给元数据新增一个必填项,等于让所有在跑的 agent 一起失败。这条对 agent 侧的承诺一旦破坏就不可恢复,所以它写在规范里而不是留给各产品自己把握。

被调方 MUST NOT 只生成自己的 `request_id` 就算完成归因——那样每个产品各有一堆互不相关的请求号,谁也拼不出"这一个任务花了多少、碰过什么、在哪一步失败"。这也是计量能汇总的前提(`product_251` X-3)。

> **实测出处**:Runos 侧已有完整的任务→调用树(`task_id` 必填,另有 `trace_id`/`parent_call_id`);Atlas 侧全仓零 `task_id`,只有一堆 `requestId`。本条是把已经跑通的那一侧固化成规范,不是新发明。

## 5. 求值时点与义务分配(三方职责表)

| 方                   | 职责                                                                                                                                                                                                                                         | 禁止                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **L0(IdP)**          | 凭证签发(含 D2 铸币校验)、签发审计、JWKS 轮换、(预留)按 jti 吊销                                                                                                                                                                             | 不转发流量、不做业务授权判定                    |
| **provider(被调方)** | 入口强制求值:**grant ∧ entitlement**(公式 = product_110 §8.3,不得放宽)——entitlement 经 C2 `/platform/entitlements`、可见集经 C2 `/platform/sharing/visible-set`(均以 token 内 workspace 为键);**召回层过滤,不做生成后裁剪**;调用计量上报(§6) | 不信任调用方自报上下文;不为"内部产品"开豁免通道 |
| **caller(调用方)**   | 按 §3.4;工具引用版本 pinning                                                                                                                                                                                                                 | 不得预先"替 provider 求值"后绕过其入口          |

求值输入全部来自 token claims:`(org_id, workspace_id, act.sub=caller product, sub=user?)`——这正是 grant 命中谓词与 entitlement 查询需要的完整 caller 三元组,协议与共享模型在此闭合。

## 6. 审计与计量归属

- **签发审计**(L0):每次 token exchange 记录(调用方 client、模式、上下文、jti),入平台审计(实施随 T1 定表位,倾向复用 `support.audit_logs`);
- **调用审计**(provider):provider 本地记录(jti、工具、结果),属业务面数据,平台不集中收集;
- **计量归属**:消费型用量由**执行点产品**(provider)经 C3 `POST /usage/consume` 上报,`workspace_id` 取 token claim、`product` = provider 自身——"谁执行谁上报,记到调用方 WS 头上";AI 推理用量仍由 Atlas 统一上报,其他 provider 不重复计模型 token(product_200 §4.1 既有铁律);
- 工具描述符的 `metering` 声明是**对账口径**(该工具计什么、怎么计),不是上报机制本身。

## 7. 错误与版本演进约定

**错误封套并入 `product_251` X-1(2026-08-16 修订)**——本节此前自定义了一套 OAuth 风味的封套,与 atlas / runos 各自的那套并列,同一件事因此有三种拼法。三方共用的形状是:

```jsonc
{
  "code": "QUOTA_EXCEEDED", // SCREAMING_SNAKE,带模块前缀;拒绝类用统一词表
  "message": "...", // 给人读
  "retryable": false, // MUST 有
  "field": "workspaceId", // 可选,校验类错误指向具体入参
}
```

- **拒绝一律用这四个码**,不得各造各的:`NOT_ENTITLED`(没有授权)· `POLICY_DENIED`(策略拒绝)· `APPROVAL_REQUIRED`(需要人批准——**这是一条出路,不是一个错误**)· `QUOTA_EXCEEDED`(配额耗尽)。
- **承载位置随传输,字段名不随传输变**:HTTP 走响应体;MCP 走 tool result 的 `structuredContent`(协议规定,非偏好)。
- HTTP 状态码的语义区分不变:`401`(凭证无效/过期 → 重换 token)≠ `403`(求值拒绝 → 不要重试,提示用户/降级)≠ `409`(配额)。变的只是**体内的码**。

**被替换的旧形状**:`{ error, error_description, retryable }` 与小写码 `quota_exhausted` 已作废。同一件事此前有三种拼法——`quota_exceeded`(runos)/ `QUOTA_EXCEEDED`(atlas)/ `quota_exhausted`(本文),消费方要按错误分支处理时得写三套。此前一版建议"不统一拼写、只做映射表",那是错的:映射表是让每个消费方永远多背一层翻译,而当前零用户零债务,改拼写的成本几乎为零。

`protocol_version` 随清单端点声明;本规范演进遵循"新增字段向后兼容、语义变更升版并双版本过渡"。

## 8. 实施切分(逐项授权,本文仅规范不含实施)

| #   | 项                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 前置           |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| T1  | IdP token exchange | ✅ **已实施(2026-07-12)**:`/oidc/token` 新 `urn:ietf:params:oauth:grant-type:token-exchange` grant_type(`TokenExchangeService`,`bff/auth-bff/src/oidc/`);D2 铸币校验(active/trialing 订阅 OR provisioned 态,内联查询同 app-scope.resolver 惯例);OBO 模式经 `OidcKeyService.verify` 自校验 subject_token 派生 org/workspace/sub,service 模式显式声明 workspace_id;`sub` 缺省(service 模式,`OidcSignInput.subject` 收窄为可选);产品 client 复用零新建——`appoidc.oidc_clients.product_id` 反填(seed,匹配 -beta/-canary 释放通道后缀)使 `act.sub` 直接查表得出。**签发审计未实施**(§6 登记项,登记为 [TD-034](../60-operations/10-tech-debt.md#td-034--t1-token-exchange-签发无审计落库)——`support.audit_logs` 无产品级 actor 语义先例,不投机实现)。验证=单测 19 项(mock)+活库 itest 5 项(真实 D2 两腿覆盖+拒绝)全绿;boot-smoke DI 图核验过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 本文定稿       |
| T2  | 平台面迁移         | ✅ **已实施(2026-07-12,双接受过渡态,非破坏性切换;2026-07-12 code review 后修正守卫作用域,见下)**:`/platform/entitlements`、`/usage/consume`、`/usage/gauge`、`/platform/sharing/visible-set` 四端点改双接受——`Authorization: Bearer <token>`(T1 铸造、`aud=PLATFORM_S2S_AUDIENCE="vxture"`,自校验+`act.sub` 必存在,命中写 `req.s2sCaller`,`@S2sCaller()` 装饰器供 handler 读)**或**既有 `x-vxture-internal-auth` 共享密钥(行为不变,arda 现役调用未迁移仍全通)。`TokenExchangeService` 增 `vxture` 哨兵(L0 非 `product.products` 行,跳过产品表查询直接铸币,D2 覆盖校验照常生效)。<br><br>**⚠️ 严重缺口 + 已修(2026-07-12 code review 抓出)**:①**守卫作用域曾过宽**——初版把双接受直接改在共享的 `InternalAuthGuard` 上,而该类同时保护 `operator-admin-internal.router.ts`/`account-admin-internal.router.ts`(密码重置/MFA 重置/账号禁用/会话吊销),这些端点用请求体自报的 `actorOperatorId` 定权限、与调用方身份零绑定——任何持有合法 confidential client 的产品都能铸 S2S token 冒充任意 operator。**修复**:拆成两个守卫类——`InternalAuthGuard` 复原为纯共享密钥(仅供 operator/account admin-internal + step-up 三路由),新建 `PlatformAuthGuard`(`bff/auth-bff/src/authn/platform-auth.guard.ts`)承载双接受逻辑,只挂 3 个 platform-face router。②**OBO 未查 subject_token 的 `aud`**——`resolveOboContext` 只验签/issuer/exp,没查目标是不是自己,导致任何产品能拿**别的产品**的用户 token 冒领上下文,违反 §3.1 自己写的"A 的 token 到 B 必拒"。**修复**:加 `claims.aud === callerClientId` 校验(`token-exchange.service.ts`)。<br><br>**"退役"未做**(§3.5 的"届时"以真实调用方迁移为前提,当前 arda 仍只发共享密钥,断然切换会打断现役集成);**路由级 workspace/product 归属绑定亦未做**(`s2sCaller.productCode` 目前只挂在 request 上,三个 platform router 仍信任调用方自报的 `product`/`workspace_id` 参数,未与 token 身份比对——登记 [TD-035](../60-operations/10-tech-debt.md#td-035--s2s-token-身份未绑定到-platform-router-的-workspaceproduct-参数),此项**不含**已修的守卫作用域/OBO aud 两处,那两处是真实漏洞已堵,TD-035 专指仍待做的绑定颗粒度);会话内省端点(§4/product_230 §4)尚未建(P1,未阻塞),迁移面此段暂不适用。验证=`internal-auth.guard.spec.ts`(纯共享密钥,5 项,含"拒绝 Bearer 头"回归用例)+`platform-auth.guard.spec.ts`(双接受,12 项,从原 guard spec 迁移)+`token-exchange.service.spec.ts` 新增跨产品 OBO 重放拒绝用例全绿,auth-bff 全量 128 项无回归,tsc 干净,boot-smoke DI 图核验过(两守卫类均正确解析) | T1             |
| T3  | 首个消费场景       | agent → Arda 数据服务(线 B P4.4 联动:Arda 工具清单 + 入口求值 + consume)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | T1 + 线 B P3.2 |

## 9. 决策记录(2026-07-07 owner 全部拍板,按建议)

| #   | 决策                 | 结论                                                                                                                                            |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | S2S token TTL        | ✅ **300s,不可刷新**(短到转借无价值,长到不打爆 token 端点)                                                                                      |
| D2  | service 模式铸币授权 | ✅ **覆盖判定**(调用方产品在该 WS 有 active/trialing 订阅或 provisioned 态;复用既有查询,无新配置面)——否决"运营白名单"方案(多一套配置且必然腐化) |
| D3  | scope 粒度           | ✅ **v1 = product 级**(`tool:{provider}`);tool 级 scope 随真实需求再细化(起步最小化)                                                            |

## 10. 边界之外

不做产品间异步消息总线(webhook 通道归 C3);不做工具市场/评分等运营面(归各产品 Console);不管 Varda(内嵌复用宿主会话,非独立调用方);umbra/Ruyin(client 端)不进本协议(product_200 §6 适用矩阵为准)。

## 11. 供给面契约变更检查单(2026-07-27 新增,治理位)

> 背景:karda↔atlas 对接过程中暴露出"跨仓事实靠书信传递,无唯一权威落点"的问题(详见
> `docs/30-design/platform/41-atlas-integration-topology.md` §7)。本节把"谁能对新增/变更供给面
> 契约的正确性负责"过程化,防止单个 provider 各自为政、或单一消费方驱动出不通用的契约形状。

**适用范围**:任何 L1 provider(Atlas / Ontos / Runos 分发面)新增工具描述符(新的 `{product_code}.{tool_name}`)
或对既有工具描述符做破坏性变更(§4.3 定义的"必升 major"级别变更)时,**发布前**必须逐项确认:

| #   | 检查项             | 通过标准                                                                                                                                                                                                                                                                |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 鉴权路径           | 仍且只走本协议 S2S token exchange(§3);不为任何消费方开辟专属凭证形式或旁路鉴权                                                                                                                                                                                          |
| 2   | 错误语义           | 复用本协议 §7 统一错误封套与语义区分(`invalid_token`/`access_denied`/`quota_exhausted`);限流与配额耗尽必须在 `error` 码上可区分(消费方需要据此决定退避重试还是暂停待续订),不得自造一套 provider 专属错误码                                                              |
| 3   | 计量归属           | 仍由本 provider 作为执行点统一上报(§6"谁执行谁上报"),消费方不重复计量同一用量;AI 推理用量仍归 Atlas 单一入口                                                                                                                                                            |
| 4   | workspace 归属原则 | 批处理/资产加工类调用 = 归资产归属方;在线交互类调用 = 归触发请求方;新工具落在哪一类需在描述符/设计稿里明确写出,不留默认假设                                                                                                                                             |
| 5   | 已知消费方广播     | 设计定稿前已征询全部**已知**消费方(不止最先提需求的一家)——当前已知集合:karda、arda、terra(同构 L2)、raven/anlan/forge/xuanzhen(L3,尚未接入但按 `product_240` §3 天然享有权利);契约形状若明显只服务单一消费方场景,需在设计稿里说明为何其余消费方不适用,而不是未征询      |
| 6   | 能力发现           | 新工具已在 provider 自己的 `GET /.well-known/vxture-tools` 清单端点(§4.2)登记(`endpoint`/`version`/`deprecated`/`metering`/`authz` 齐全);路径变更(含改名/迁移)必须按 §4.3 双描述符并存,不得只改路径不改描述符;消费方应能通过查询该端点得知可用性与可达性,不依赖书信告知 |
| 7   | 跨仓事实回填       | 若本次变更改变了某个"稳态事实"(如端点已实现/已部署/地址变化),已同批回填对应登记表(如 `13-infra-allocation-registry.md`),不仅停留在设计稿或书信里                                                                                                                        |

本检查单由 **platform 维护**(因为要对"所有 L1 provider 一视同仁"负责,不能让某个 provider 自行决定
标准);**由 provider 在自己的设计评审中自查**(platform 不做门禁审批,不违背"平台只出规范与凭证,
不出网关"的铁律,§0);若某项确有理由不适用,provider 应在自己仓的设计文档里显式记录理由,而不是
静默跳过。
