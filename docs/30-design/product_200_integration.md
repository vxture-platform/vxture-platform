# Vxture × 产品对接标准(三通道)(Platform ⇄ Product Integration)(product_200)

> 版本:**v1.0** · 状态:已定稿并上产(三通道定型;C2 契约收缩见 §3.0）
> 文档族:产品架构族 `product_{NNN}`,本文 = **200**(细化标准位);族路由见 [`product_100_matrix.md`](./product_100_matrix.md) §0 头部
> 定位:vxture(L0)与各产品(L1/L2/L3/client/外部)之间的**对接契约权威**——所有产品接入平台走且仅走本文三通道。产品↔产品的直连(工具协议)不属本文范围,见 §5。
> 上游:[`product_100_matrix.md`](./product_100_matrix.md)(谁接入)、[`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md)(资产与授权语义)、ADR-11(权益引擎)。
> 权威实现指针:本文只定通道结构与义务,字段/端点细节一律指向既有权威文档,不重述。**传输面(S2S 内网 tailnet 寻址、边缘/内网双面边界)= [`product_230_mesh-architecture.md`](./product_230_mesh-architecture.md) 权威**(两类分级见其 §1,本文 §6 注记逐产品归类)。

---

## 1. 通道总览

平台与产品之间只有三条通道,方向与职责固定:

```
C1 身份认证      产品 ←→ L0     用户是谁、以谁的身份调用(OIDC + S2S 身份透传)
C2 权益获取      产品 →  L0     我(此 WS × 此产品)能干什么、能看什么(entitlement + grant 可见集,实时拉取)
C3 状态实时同步  产品 ←→ L0     上行:用量/事件上报(consume);下发:失效通知/开通指令(invalidate / provisioning webhook)
```

| 通道        | 权威文档                                                                                                                                                         | 核心铁律                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C1 身份认证 | [`identity-platform-rp-integration.md`](./identity/080-rp-integration.md)(RP 接入通则,含跨子域/跨域两模式;2026-07-01 已合并原 identity-app-integration-standard) | 产品不直连平台库;身份/组织上下文一律经 token;access token 只带治理角色,**不含业务 entitlement** |
| C2 权益获取 | ADR-11 §11.7(API 契约)、`data_commerce_200_metering.md`(entitlement_current)、共享模型 §8.5(可见集)                                                              | 权益实时派生、短 TTL 缓存、**永不入 token、永不落产品库**;查询维度 = product,永不暴露 plan      |
| C3 状态同步 | `data_platform_100` §2.2/§2.3(用量上行)、§10(provisioning webhook)、共享模型 §8.5/§8.6(grant invalidate)                                                         | **用量唯一写入方 = commerce consume 服务**;产品侧不做配额裁决;webhook HMAC 验签 + 幂等          |

三通道共同的边界(承双平面铁律):产品只持 `org_id / workspace_id / user_id` 引用,不复制平台主数据;不持 Provider Key;不读平台库。

---

## 2. C1 身份认证

### 2.1 用户级(OIDC,已就绪)

- 产品作为 **OIDC RP** 接入平台 IdP(`accounts.vxture.com`):授权码 + PKCE,子域/跨域两模式,back-channel logout,浏览器零 token(服务端会话);接入步骤、cookie/会话通则、claim 结构见权威指针(上表);
- **client 注册要素**:client_id(= product_code)、**prod/beta = 两个独立 client**(`{code}` / `{code}-beta`,各自单一 redirect_uri + back_channel_logout_uri——back-channel logout 硬约束单 URI;跨域产品单 URI)、`allowed_scopes = openid profile email phone`(D12 后产品 token 无商业承载,`{product_code}` 商业 scope 退役=四 scope)、realm=customer;
- token 内上下文 = 四层模型投影(`active_org` / `active_workspace` / 治理 `roles`);**entitlement 不入 token**(C2 实时回查)。

### 2.2 服务级 / 工具级(S2S 身份透传)

共享模型要求"技能/agent 对 L1/L2 的每次调用以**调用方 agent 身份**直连"(工具引用、跨产品消费)。这超出用户级 OIDC 的覆盖:

- **默认态(新产品)**:S2S 走 **token exchange / on-behalf-of**——产品 A 以"产品 A × caller(org, ws, user?)"复合身份获取面向产品 B 的短时凭证;被调方(L2 入口)据此做 grant ∧ entitlement 求值与计量归属。规范 = L0 工具协议(`product_210` v1.0 定稿,见 §5),新产品默认生在其上;
- **legacy 过渡**:`AUTH_INTERNAL_TOKEN` 式共享服务口令仅在显式 env 开关下保留兼容,**新产品不登记该凭证**(产品间本就禁共享口令,不生在退役凭证上);
- **义务分配**:凭证签发与审计在 L0(IdP);求值在被调方入口;调用方不得伪造/降级身份上下文。

## 3. C2 权益获取

### 3.0 契约收缩原则(D12,2026-07-13 定,全产品适用)

**信封只承载商业事实(买了什么),不承载功能解释(意味着什么)**。三条边界规则,新需求按此确定性路由,杜绝一次性字段谈判:

1. **决策位/资格位禁入信封**:能不能试用、该买什么、什么价、给不给资格——一律不下发。商业决策 UI 归 **vxture-console**,产品端渲染通用入口 + 深链(地址与词表见 §3.2),零商业推断;
2. **描述性事实按判据准入**:产品无需理解任何平台策略即可逐字渲染的字段(状态/日期/剩余量/上限数字)可正常加入信封,属演进非补丁;
3. **功能语义不过界**:档位→功能 = 产品仓内版本化能力矩阵(平台不配置功能键);档位→配额数值 = 平台配置;产品不展示"升到 X 档得 Y"(console 的事)。

**演进容错通则(双方义务)**:产品必须容忍信封新增字段与 `status` 新枚举值(未知即降级隐藏/保守渲染)。

### 3.1 entitlement 解析(信封 v3 权威 = product_220 §3)

```
GET /platform/entitlements?workspace_id={W}&product={P}          # 单 product,运行时门控主用
GET /platform/entitlements?workspace_id={W}&products=a,b,c      # 批量,首屏
→ { status/trial_ends_at/current_period_end/cancel_at_period_end/data_retention_until,  # 订阅事实(单代表订阅投影)
    tier, bundled, limits: {"member.max":…, …},                  # 销售轴(活跃覆盖合并;上限数字产品动作点本地执行)
    quota_pools:  [{metric, limit, remaining, priority}, ...] }  # 消耗型多池视图(机制零变更)
```

- 产品端**只读消费**:短 TTL 缓存 + C3 invalidate 秒级失效;门控公式 = `tier != null`(UI)/ `tier != null || bundled`(数据面),展示 quota_pools 合计;**`capabilities`/`features` 已退役**(功能键归产品能力矩阵);
- **无 `?plan=` 入口**:plan 是购买时的商业打包概念,运行时产品只认自己的 product;
- P 级资产 SKU 同走此通道(资产型权益表现为独立 SKU 的销售轴/池)。

### 3.2 转化深链(产品→console 唯一转化出口)

**落地地址(已上产)**:

```
GET {CONSOLE_BASE}/subscribe?product={P}&intent={subscribe|upgrade|renew|addon}[&target_tier=][&metric=]
   CONSOLE_BASE = https://console.vxture.com（产品侧 env 可配,如 NEXT_PUBLIC_CONSOLE_URL）
```

- `product` / `intent` 必带;`target_tier`（升级目标档,console 预选）/ `metric`（addon 场景,哪个额度用尽）选带;`workspace_id` 由 console 会话的活跃租户解析,**产品不必也不应带**;
- **仅显式用户点击触发**,产品端永不自动跳转。

词表 v1:`intent = subscribe | upgrade | renew | addon`(`subscribe` = 从无直购订阅的首购,对应信封 `status: null` 的"订阅"CTA;`renew`/`upgrade` 对应已有订阅的续订/升档;预留 `seat` = 席位增购——**按产品独立无 workspace 打通**,co-term 与该产品主订阅共终)。console 容错承诺:未知 intent → 降级订阅管理首页(保留 product 上下文定位该产品订阅卡片);已知 intent 未知参数 → 忽略参数进流程;落地页按订阅事实状态感知(临期突续费/trialing 突转正/null 突开通);未知值记结构化日志作词表演进信号;intent 只废弃不删除(废弃值按未知处理)。新增 intent 仅 console 实现,产品端零改动。

### 3.3 共享可见集解析(v1.0 新增,承共享模型 §8.5)

- 平台(`sharing` 域)对资产面产品(Arda/Karda/Terra/Runos)提供**可见集解析**:给定 caller(org, ws, product),返回其可见资产集(自有 ∪ 被授权 ∪ org 级 ∪ 已订阅 P 级)及各自 scope;
- 形态 = 按 grantee 预展开的**物化可见集**(对齐 entitlement_current 模式:短 TTL + invalidate);
- **求值执行点在产品入口**(召回层强制,不做生成后裁剪);联合求值公式与谓词按共享模型 §8.3,产品侧不得自定义放宽;
- 仅资产面产品需要接入本节;L3 agent 作为调用方不直接查 grant(它经 L2 的入口被求值)。

## 4. C3 状态实时同步

### 4.1 上行:用量上报(consume)

```
POST /usage/consume  { workspace_id, product, metric, amount, idempotency_key }
→ 200 { consumed, remaining_total, per_pool_breakdown, event_id? }                 # 配额覆盖住了
→ 200 { gated: true, reason: "quota_exhausted", consumed, remaining_total, … }    # 没覆盖住(仍是 200)
```

- **本端点记账,不裁决(owner 裁定 2026-08-10;取代原 409 门控)**:它回答"用了多少"和"配额覆盖了多少",
  **不回答"你该怎么办"**——没余量时是禁用按钮、继续服务、还是引导升级,由**调用方**决定。`gated` 留在
  body 里作**信息**,不再是 HTTP 错误。原来的 409 把平台的意见包装成调用方必须服从的错误,而不认同的
  调用方本来就 fail-open 照常服务——**status code 只买到了歧义**。
- **`consumed` = 调用方实际用掉的量**,不是配额覆盖住的量。两者只在"配额不够"时才不同,而那恰恰是最需要
  被量到的一次。**配额为零(尚未发布计划)也照常记录**——用量已经发生,不写下来不会让它没发生,只会让账消失。

- **`event_id`(2026-08-10 增,`@vxture/shared` 1.6.0,回应 liaison platform#220)**:本次写入的
  `metering.usage_events.id`,回显给调用方存在自己的请求记录旁,两边账可以直接对上,不必绕
  `request_id`/`idempotency_key` 间接关联(那只在两侧都不掉队时才成立)。**可选字段、纯增量**,老调用方
  忽略即可。**409 上也给**:可分割 metric 的部分成功是 409 且 `consumed>0`、确实写了事件——这批行恰恰
  是最难人工对账的,把关联键只给 200 等于把最需要的那批漏掉。原子拒绝没写事件,字段整个不出现。

- **唯一写入方 = commerce consume 服务**(单事务:校验配额 → 记事件 → 更新池),产品侧与 Model Platform 均禁止直写用量表;
- 产品侧模式:本地 `local_usage.usage_raw` 缓冲 → 异步 Job 上报;`idempotency_key` 强制(防重放/重复计量);超额语义按 metric 声明(可分割=部分成功 / 原子=全有全无);
- 产品侧**不做配额裁决**(只呈现与拦截 UI);AI 推理用量由 Atlas 统一进此通道,产品不重复上报模型 token。

### 4.2 下发:失效通知(invalidate)

```
PUSH invalidate { workspace_id, products: [...] }               # entitlement 变更
PUSH invalidate { grant_id | resource_ref, affected: [...] }    # grant 变更/到期(v1.0 新增)
```

- entitlement 失效:订阅/升级/过期 → 秒级推送,产品清缓存重拉(C2);
- **grant 失效**(新增):grant 撤销/到期、DataSource 解绑 → 推送相关资产面产品;Karda/Arda 按派生边执行 re-scope(级联撤销,共享模型 §8.6);
- 与 seed/wipe 共用平台→产品鉴权通道。

### 4.3 下发:开通生命周期(provisioning webhook)

- 平台维护开通状态机 `(workspace, product): pending → provisioned → deprovisioned`(字段级见 `data_platform_100` §10);
- outbound webhook:HMAC 签名(平台自签密钥,非 Provider Key;**平台侧 env 命名惯例 = `{PRODUCT}_PROVISION_WEBHOOK_SECRET`**,每产品独立、经 secret manager,产品侧对端键名自定)、幂等 key、重试/lease/死信;产品端义务:验签、幂等消费、按指令建/拆业务空间(agent-db 内该 WS 的 schema/数据域);
- Beta→Prod 转换指令同经此通道(业务数据迁移可选,平台侧订阅状态切换)。

## 5. 产品间直连(不属三通道)与待建规范

产品 ↔ 产品(agent → L2 工具面、技能 → L1/L2)不经平台转发,走 **L0 工具协议**直连——L0 只出**规范与凭证**(C1 §2.2),不出网关。待建规范文档(登记项):

> **L0 工具协议规范**([`product_210_tool-protocol.md`](./product_210_tool-protocol.md),v1.0 已定稿 2026-07-07,D1–D3 已拍板,实施逐项授权):工具 schema 与调用约定(MCP 风格)、S2S 鉴权与调用方身份透传(token exchange)、grant ∧ entitlement 求值时点、审计与计量归属、错误与版本演进约定。

## 6. 产品 × 通道适用矩阵

| 产品                             | C1 用户级            | C1 S2S(目标态)               | C2 entitlement               | C2 可见集       | C3 consume 上行         | C3 invalidate | C3 provisioning | 备注                                           |
| -------------------------------- | -------------------- | ---------------------------- | ---------------------------- | --------------- | ----------------------- | ------------- | --------------- | ---------------------------------------------- |
| Atlas                            | ✔                    | ✔(被调方+调用方)             | ✔                            | —               | **✔(唯一推理计量入口)** | ✔             | ✔               | Model Platform 只读配额 gate 特权照旧          |
| Ontos                            | ✔                    | ✔                            | ✔                            | 待产品定义      | ✔                       | ✔             | ✔               |                                                |
| Runos                            | ✔                    | ✔(分发面 + **商业域网关**)   | ✔                            | ✔(技能资产)     | **按域二分,见下注**     | ✔             | ✔               | **零计量仅限联邦域**;商业域上报归属未收口      |
| Arda / Karda / Terra             | ✔                    | ✔(被调方,入口求值)           | ✔                            | **✔(资产面)**   | ✔                       | ✔(含 grant)   | ✔               |                                                |
| Raven / Anlan / Forge / Xuanzhen | ✔                    | ✔(调用方)                    | ✔                            | —(经 L2 被求值) | ✔                       | ✔             | ✔               | agent-db 业务面模板                            |
| Ruyin(client 端)                 | 待产品定义           | 待产品定义(Atlas/Runos 互通) | ✘(不进新引擎)                | ✘               | 待定                    | ✘             | ✘               |                                                |
| umbra                            | ✔(现 RP 契约照旧)    | ✘                            | ✘(现状租户级订阅 claim 豁免) | ✘               | ✘                       | ✘             | ✘               | `identity-platform-ruyin-contract.md` 继续有效 |
| Hermes                           | ✘                    | 内部凭证                     | ✘                            | ✘               | ✘                       | ✘             | ✘               | internal                                       |
| Varda                            | —(内嵌,复用宿主会话) | —                            | —                            | —               | 经 Atlas                | —             | —               | 非独立产品                                     |

> **Runos C3 计量按域二分(2026-08-13 补齐 v1.2 漏改)**:本行原写 `—(零计量路径)`,那是 runos v1.0「纯控制面 / 无运行时 / 零计量 / 不在调用链路」的旧口径。[`product_100_matrix`](./product_100_matrix.md) v1.2(2026-08-10,runos `ADR-003`)已把 runos 改写为**商业能力面**,并在修订依据里**点名**该说法与新定义冲突;但 v1.2 的下游同步清单只列了 `product_240`,**漏了本文**——本次按已裁定内容机械补齐,不引入新判断。
>
> 正确读法(权威 = [`product_110`](./product_110_sharing-isolation.md) §6 两域模型):
>
> - **联邦域**:确为**零计量路径**——技能"使用数"仅作目录统计,不作计费;Runos 分发不转发,不在调用链路上。原表述在这个域内成立。
> - **商业域**:Runos 网关**在调用链路上**,承担配额执行(最终一致软执行)、每调用成本、计费维度;账务对账 SoR = Runos 审计事件流。**这个域有计量路径**。
>
> **但上报归属尚未收口**:`product_110` §6.8 #1 登记——商业域一次调用会同时被网关(能力包口径,计费维度)与提供方 L2(供给侧 consume 口径)记录,两条记录是**同一次调用的两个商业口径**,不自动构成重复计费;**consume 的上报归属、去重键与账单呈现规则待 runos × 提供方 L2 × billing 三方裁定**,收口时点 = **商业域首个可售能力包上线前**。在此之前本行不填 ✔ 或 ✘——填任何一个都是替三方预判。同步项另见 `product_100_matrix` v1.2 下游清单 #4(状态:待定)。
>
> **配额计数的 SoR 不受此未决影响**:`governance.quota_counter` 在 `vx_runos_db`(`product_100_matrix` §2 列语义注明文,runos `ADR-007`),按网关节点分片、调用路径上原子递增。未决的是**上报给平台 C3 的归属与去重**,不是计数器归谁。
>
> **传输面分级(mesh 类别,权威 = [`product_230`](./product_230_mesh-architecture.md) §1,2026-07-12 增)**:上表产品按"域关系 × 产品层"归入两类——**类 2 · 同 apex 内网 fabric**(S2S 一律 tailnet,绝不公网;C2/C3/gauge/可见集出站指平台内网 base,webhook tailnet 投递):Atlas/Ontos/Runos/Arda/Karda/Terra/Raven/Anlan/Forge/Xuanzhen(其中 anlan.ai/xuanzhen.ai 虽异 apex 域名,只要部署在平台 tailnet 内即按类 2 走内网 S2S;cookie 互验面另论;runos 已于 2026-08-09 迁回 `runos.vxture.com`,不再是异 apex 例子);**类 1 · 跨 apex 轻集成**(异网,仅公网 HTTPS + HMAC/允许名单兜底):umbra(worker-04 境外不入 tailnet)。Ruyin(client 端)/Hermes(internal)不适用。判类以**是否在平台 tailnet**为准,域名仅是缺省信号。

## 7. 新产品接入 checklist

1. **目录**:product 目录登记(code/layer/类型/checklist 项)+ plan 结构(运营);
2. **C1**:OIDC client 登记(redirect_uris、scopes、back-channel logout)+ RP 实现(按接入标准);
3. **C3**:webhook 端点(验签/幂等)+ provisioning 消费;`local_usage` 缓冲 + consume 上报 Job;
4. **C2**:entitlement 拉取与缓存失效;门控渲染;资产面产品另接可见集解析;
5. **数据面**:按业务面模板建 agent-db(`vxturebiz_{product}_{env}`,workspace_id 隔离键,`vx_provision`/`local_authz`/`local_usage` 三契约 schema + N 领域 schema,见 product_240 §2.4);
6. **验收**:登录→开通→门控→consume→invalidate 全链 e2e;上架 launch checklist 过检。
