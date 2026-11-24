<!--
@package @vxture/repo
@layer Application
@category api-contract
@author AI-Generated
@date 2026-11-24
-->

# 身份事件同步接口与产品接入约定

> 版本：0.7 本地实现，2026-11-24。§2–§2.8 覆盖八个平台入口的持久会话、事件接收、SSE 与可协商轮询退役，全部未发布。§3–§8 保留完整跨产品目标协议；现行试点范围与差异以 §2.8 为准；§2.1–§2.7 保留早期子集沿革。
> 本任务经用户明确授权采用独立接口文档。本文负责新增身份事件协议；现有 OIDC、按需状态查询、C2 准入和 C3 商业开通仍以[产品接入通则](https://claude.ai/code/artifact/20e37039-ea59-4c5d-9fab-ba3ca3ad54f0)和[产品接入范本](https://claude.ai/code/artifact/f0bd83c7-6296-4200-a7d8-108b7755f584)为准。两份外部原件本轮未修改。发布前在原件增加本文的版本化引用，避免形成两份重复字段定义。

## 1. 生效范围与兼容

链路为：事实所属域提交状态与 outbox → 平台投递 → 产品后端持久应用失效 → 产品同源 BFF SSE → 浏览器重读自己的视图。接入方只能接收登记范围内的事实，不能凭通知获得席位、角色或工作空间访问权。

现有 `POST /oidc/session/status` 继续保持原请求 `{sid, active}`、原认证及 `{valid, next_check_at}` 语义，不向该端点塞事件字段。正常业务请求到达后按 `next_check_at` 检查；空闲页面不为它新建定时器。活动信号来自用户操作，刷新令牌、SSE 心跳和连接重建不得延长绝对寿命。

标准 OIDC Back-Channel Logout 保持既有登记 URL、form-urlencoded `logout_token` 和标准 events claim。可靠性改在发送队列和接收应用边界，不能把新事件 JWT 投给旧退出端点。旧客户端保持现有行为，不能仅因已有 `backchannel_logout_uri` 就标为具备恢复或 SSE 能力。

## 2. RP 结果分类（本批本地实现）

适用 Console、Website、Admin、Opera、Arche BFF 的会话解析及受保护路由。响应不包含令牌和上游错误正文。

| 情况                                                               | HTTP / code                                               | 调用方处理                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------- |
| 本地会话缺失、到期或已收到撤销                                     | 401，沿用各端现有未认证响应                               | 可以进入普通 OIDC 登录；这只证明当前 RP 无有效会话             |
| 存储 / JWKS / token 网络故障，或刷新正在别的实例进行               | 503 / `AUTH_UNAVAILABLE`，`retryable: true`               | 保留本地身份展示，拒绝本次受保护请求；允许退避重试             |
| 已过期令牌无法继续刷新，明确 `invalid_grant`，或新凭据身份绑定不符 | 503 / `AUTH_REAUTHORIZATION_REQUIRED`，`retryable: false` | 走一次受控 OIDC 重授权，不调用全局退出，不循环提交同一刷新令牌 |

两种 503 的响应形状均为 `{code, message, retryable, statusCode:503}`；会话查询 / 认证失败返回 `Cache-Control: no-store`，不清会话 Cookie。`invalid_grant` 单独不能证明用户已全局退出。当前前端已避免暂时故障清空身份，但完整的“重授权提示 + 单次跳转”用户流程仍归 C6 / C7。

RP token 更新必须带原会话作为条件，且不能创建已删除会话或延长原 Redis TTL。后台退出先建立 sid 撤销标记，再删除关联本地会话；回调创建也经过同一标记。详细 API、上线限制见 [RP 实现指南](../../40-implementation/packages/core/90-oidc-rp.md)。这解决已送达退出与本地并发竞争；可靠送达由 C3 / C4 完成。

### 2.1 客户中央会话与标准退出（本批本地实现）

客户登录先提交 `session.auth_sessions`，再建 Redis 交互会话；两者使用同一绝对到期时间。持久化失败不会成功登录。授权码发布前持久绑定 sid 与可信客户登记，code / refresh 换票补齐历史绑定。绑定与撤销锁同一会话行，撤销获胜后不能晚绑定；已终止 sid 禁止恢复 active。

`POST /oidc/session/status` 对客户增加持久有效性、realm 和 owner 校验；已撤销而 Redis 尚在返回 `{valid:false}`，数据库故障返回 503 `SESSION_STATUS_UNAVAILABLE`，接口请求及响应形状不变。workforce 仍使用自己的事实校验。

客户会话 active → revoked/expired 与待通知接收方在同一 PostgreSQL 事务保存，覆盖账号安全逻辑直接更新会话状态。后台通过 LISTEN/NOTIFY 唤醒并定期补扫，多个实例通过租约领取。发送现行标准 form `logout_token`，仅 200/204 记为送达；请求重定向不跟随；429/5xx/网络故障退避重试，永久拒绝、登记变化或超过窗口进入隔离。中央退出成功不等于所有产品已应用完成。

当前登记绑定为 `client_id + realm + release_channel + logout_uri`；release_channel 使用现行 stable/beta/canary，尚未增加下文 environment 或 capability 字段。上下文持久化为一致的组织/空间对及单调 `context_version`，上下文变化通过 §2.5 的独立 changes-v1 通道发送，不混入标准退出。存量严格生命周期通知保留，接收方需容忍重复标准退出。

部署、24 小时重试窗口、隔离恢复、旧实例排空与历史绑定覆盖限制见[运行手册](../../60-operations/50-run-identity-events.md)。退出恢复子集及 Console 退出 SSE 见下两节；变化投递、inbox 与多类型 SSE 已在 §2.5 本地接通，轮询退役的独立协商见 §2.6。

### 2.2 logout-v1 恢复子集（本地实现，默认关闭）

本节及 [OpenAPI 3.1 请求/响应定义](./150-logout-recovery.openapi.json) 是当前可测试的接口。§6 是完整目标协议，不能把其 `authorization_version` 或全类型恢复算法当作本次已实现字段。

| 接口                           | 请求                                                                          | 成功响应                                                      |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `POST /oidc/identity/snapshot` | `{sids:["sid-a"]}`，0–100 个不同 sid，仅字母、数字、下划线、连字符，长度 1–64 | `{binding,watermark,sessions}`；active / inactive / not_bound |
| `POST /oidc/identity/events`   | `{cursor:"opaque",limit:100}`，limit 可省略、范围 1–100                       | `{binding,events,next_cursor,has_more}`，仅 session.revoked   |

均为 JSON、`client_secret_basic`、`Cache-Control: no-store`，拒绝 query 参数及未定义请求字段。Basic 的 client_id 与 secret 先按 OAuth 表单规则编码，再拼接并 base64。浏览器 Cookie、Bearer 和公开客户端不能读取；workforce 须额外启用 §2.8 的中央开关。生产须使用 HTTPS 或受控的内部传输；恢复不签发 token，不修改 Cookie。

两种响应均携带 `binding={issuer,audience,realm:"customer"|"workforce",environment,profile:"logout-v1"}`，由持久登记确定。`session.identity_recovery_streams` 单独登记 issuer、client_id、environment（prod/beta/dev）、release_channel（stable/beta/canary）、精确 logout_uri；迁移不登记或启用任何客户端。读取时复核现行 OIDC 登记为 active、精确 realm、client_secret_basic、back_channel，通道与 URL 一致。环境不从通道、Host 或 client_id 后缀推算，作用域不可原地修改；变更作用域使用新 client。

active 示例：

```json
{
  "binding": {
    "issuer": "https://accounts.example.test",
    "audience": "console-dev",
    "realm": "customer",
    "environment": "dev",
    "profile": "logout-v1"
  },
  "watermark": "opaque-snapshot-watermark",
  "sessions": [
    {
      "sid": "sid-a",
      "state": "active",
      "sub": "usr_00000000-0000-4000-8000-000000000001",
      "session_version": "1",
      "context_version": "0",
      "absolute_expires_at": "2026-11-25T00:00:00Z",
      "context": null
    }
  ]
}
```

只有精确持久绑定的会话才返回 active / inactive；其余统一 `{sid,state:"not_bound"}`，不披露存在性。active 的 session_version=1，终态事件 version=2，表示本子集唯一的不可逆状态转移，并非已建立全量通用会话版本。context_version 来自持久事实，本批消费者不据此替换租户或宣称上下文同步；不返回尚未建立的 authorization_version。

快照的状态与水位来自同一个 PostgreSQL REPEATABLE READ 只读事务。退出任务插入触发器在原事务内更新并锁住客户端流头，再写连续事件；回滚不留空洞，后一个撤销不能先提交更高水位。恢复事件采用 §4 的 session.revoked 逻辑字段，传输是本接口 JSON，标准后台退出仍发送原 form logout_token；没有 application/jwt 新事件接收端。

cursor 是绑定流、作用域、位置与签发时间的 HMAC 不透明值，有效 7 天。响应刷新签发时间但不改变对应位置。篡改/跨 client 返回 403；超过期限或已提交事件缺失（含尾部缺失）返回 410，重新取得快照；不是“无变化”。当前不清理流事件，7 天是游标有效期，不代表已实现事件定期删除。

应用错误 `{code,message,retryable}`：400 INVALID_REQUEST、401 INVALID_CLIENT（附 WWW-Authenticate）、403 CAPABILITY_NOT_ENABLED / SCOPE_MISMATCH、410 CURSOR_EXPIRED、503 IDENTITY_UNAVAILABLE。无新增 429 限流器；HTTP JSON 解析器或代理产生的错误按其自身形状处理。RP HTTP 客户端禁止重定向，单请求 10 秒、响应 1 MiB 上限；非 200、错误作用域、缺项或未知事件一律失败，不能当成 inactive。

Console 试点启用后：

1. 标准 logout 验签成功，先提交 `session.rp_revocation_receipts`，再删除 Redis 会话，最后才 ACK。持久存储失败返回失败供中心重试；Redis 删除失败时持久屏障仍存在。标准 logout 不带稳定逻辑 event_id，因此按 `(issuer,client,customer,environment,sid)` 幂等，本次不是通用事件 inbox。
2. 每个进程/Redis 连接代次首次访问某 sid 时，读取其快照，再从水位补拉至流头，最多 20 页×100 条。不可验证时拒绝本次请求并返回 503，不清 Cookie；inactive 持久记撤销，not_bound/主体不符拒绝。恢复不延长原 TTL。
3. 同 sid 并发恢复合并。成功确认仅保存在进程内，Redis ready/close 清除确认；旧代次恢复结果不能写回。确认最多 10,000 个 sid，超出清空后按需重建；每个真实读取仍查询本地持久撤销，不缓存“未撤销”。RpAuthService 普通成功鉴权读取两次 store，因此通常增加两次本地 SQL。此为正确性优先的试点方案，容量和 P95 待测，不宣称零开销。
4. 新实例或断线恢复从新快照开始，不保存跨进程连续游标；因仅应用不可逆退出，重复补拉安全。连续补拉总耗时仍受页数和各请求超时约束，可能超过网关请求时限并重试，后续容量阶段需量化并调整。没有常驻中心轮询，没有新增定时器。

N6 扩展后的平台范围见 §2.8；独立产品及 worker 的离线 JWT 验证不自动获得此保证。中央提交与 RP 收到通知之间仍是异步窗口，标准投递及故障补偿负责收敛。页面退出推送见 §2.3，撤除轮询仍需上下文/授权事件及实际环境验收。

### 2.3 Console 退出 SSE（本地实现，默认关闭）

机读契约见 [Console SSE OpenAPI 3.1](./150-console-session-events.openapi.json)。本节是 logout-v1 的页面出口；§7 的通用事件版本、页面游标与十分钟重放窗口尚未实现，不能混用。

`GET /auth/events` 位于 Console 同源 BFF。使用现有 HttpOnly RP Cookie；默认 HTTPS 名为 `__Host-vx_rp_session_console`，本地 HTTP 为 `vx_rp_session_console`，实际后缀跟随受信 client_id。禁止 query 参数，不接受 URL token 或 sid。存在 Origin 时须等于配置的 Console origin；Sec-Fetch-Site 只允许缺省、same-origin 或 none。每次连接均重新鉴权，匿名不能建立流。

| HTTP      | 含义与客户端动作                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 200       | `text/event-stream; charset=utf-8`；`Cache-Control: no-store, no-transform`；`X-Accel-Buffering: no` |
| 204       | 功能未启用，停止本次页面的可选流；不代表会话失效                                                     |
| 400 / 403 | 参数不支持 / 非同源，停止可选流；不清身份                                                            |
| 401       | 当前流无法确认有效会话；重读当前 Cookie 的 `/auth/session`，只有确认匿名才退出                       |
| 429       | 每实例最多 5000 条连接、每 sid 最多 32 条；`Retry-After: 5`，有界退避                                |
| 503       | PG listener / Redis / 恢复不可用；保留身份展示，退避重连；业务请求仍独立鉴权                         |

流仅发送以下帧，不包含 token、sid、sub 或 RP 会话标识，不签发新的 Cookie：

```text
event: resync-required
data: {"reason":"connected"}

event: session-ended
data: {"reason":"revoked"}

event: resync-required
data: {"reason":"expired"}

: keepalive

```

连接成功先发 connected；持久复核确认本地会话无效后发 revoked 并关闭；达到连接建立时的 Redis 剩余寿命与中央绝对到期的较早者，发 expired 并关闭。三个事件都只要求页面重读当前 Cookie 的会话视图，旧连接不能直接清掉刚登录的新账号。每 25 秒注释心跳只写字节，不查中心/PG/Redis、不刷新 token 或 TTL、不作为用户活动。

`rp_revocation_receipts` 新增记录的原事务在提交时发 PG NOTIFY；回滚不通知。每个 Console BFF 持有一条 LISTEN 连接，广播给本实例相关 sid 的连接。提示须匹配 issuer/client/customer/environment，并再次查询持久撤销；伪造 NOTIFY 不能直接触发退出。订阅先于最终鉴权读取，通知与复核并发时合并并补读，最多八轮后断开重建，避免遗漏或无界追赶。

PG listener 丢失、Redis 连接代次改变会关闭现有流并清除进程恢复确认；重连重新鉴权、按 §2.2 核验中心，并重读页面视图。这里无持久页面游标：不发送 SSE `id`；Last-Event-ID 最长 512 字符且不参与恢复，超长返回 400。不可逆退出可安全从新快照恢复，此规则不适用于未来可反复变更的权限/上下文。

门户用 fetch 流区分 204/401/503；健康连接不定时查询身份，75 秒无字节才中止重连，退避含抖动总上限 30 秒。每标签页独立连接，卸载清理；半帧缓冲上限 64 Ki 字符。服务端写入背压即关闭慢连接，避免无界排队。当前没有跨标签页主连接选举。

启用须先完成 §2.2、应用 DDL26 对应迁移、配置同源代理，再设置 `RP_SESSION_EVENTS_ENABLED=true`。开关默认 false；缺少恢复能力而启用 SSE 会启动失败。完整步骤见[运行手册 §7](../../60-operations/50-run-identity-events.md#7-console-退出-sse-试点)。仅退出模式保留 Console 原 300 秒/focus/visibility 刷新；完整模式可按 §2.6 协商退役。退出流自身不产生周期身份查询，各客户端仍须独立验收。

### 2.4 changes-v1：客户上下文与授权变化恢复（本地实现，默认不登记）

机读契约见 [changes-v1 OpenAPI](./150-identity-changes.openapi.json)。本节定义事实生产与恢复读取；主动投递、RP inbox 和 Console 上下文/权限推送见 §2.5。现有 logout-v1 端点、响应和游标保持兼容；变化事件不混入旧退出流。

| 接口                                   | 请求                                             | 成功响应                                                                       |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `POST /oidc/identity/changes/snapshot` | 同 logout-v1 的 `{sids:[...]}`，0–100 个不同 sid | `{binding,watermark,sessions}`，active 新增 `authorization_version`            |
| `POST /oidc/identity/changes/events`   | `{cursor,limit?}`，limit 1–100                   | `{binding,events,next_cursor,has_more}`，只含 context_changed / access_changed |

认证、JSON 形状、禁止 query、错误码、no-store 与 7 天游标期限沿用 §2.2。额外要求 OIDC `client_kind=platform`，并在既有受信 recovery stream 下显式建立并启用 `identity_change_streams`；外部 product client 返回 403；workforce 仅在中央独立开关开启时可用。能力默认关闭，不因迁移或支持标准 logout 自动开启。绑定 profile 固定 `changes-v1`；HMAC 同时绑定 profile，不能把退出游标用作变化游标，也不能跨客户端使用。

快照中 `authorization_version` 是 customer 主体级十进制字符串，初始为 `"0"`；`context_version` 是该 sid 的上下文版本，两者独立。状态、两个版本与客户端已提交水位在同一个 REPEATABLE READ 事务读取。active 仅说明中央会话 active/未到期且精确绑定，不代表账号、组织、席位或业务准入允许；任何版本都不授予权限。真实请求仍经各事实源校验。

事件沿用 §4 的逻辑字段（通过本接口 JSON 返回，不是新 JWT webhook）：

| 事件                      | 主体/版本/范围                                                              | 接收要求                                                               |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `session.context_changed` | `{sid,sub}`，该 sid 的 context_version；不含 scope 和上下文值               | 标记该会话上下文失效，重新读取可信快照；验证合法成员关系后才能用于操作 |
| `identity.access_changed` | `{sub}`，主体授权版本；scope 包含 org_id/workspace_id/product_id，可为 null | 失效相关准入/权限缓存并向事实源重读；不直接增加或删除权限              |

事实表的写入与授权版本、`identity_change_outbox`、接收方连续水位和事件引用在同一事务提交；失败则整笔回滚。outbox 即使没有接收方也保存。授权版本通过主体行锁递增；客户端水位通过每流行锁递增，不使用可能提交乱序的独立 sequence。一个事实影响多个客户时，各主体独立版本；同一个逻辑事件在多个客户端保持 event_id/版本不变。级联或批量变更可能产生多个失效事件，应按版本合并处理，不以事件数量推断操作次数。

当前覆盖中央上下文，以及十类授权事实表：账号；租户/空间；租户/空间成员；角色、权限、角色权限映射；产品席位；订阅。触发器只比较影响状态/权限/默认上下文的字段，更新时间、HR 展示字段和同值重写不产生事件。角色/权限全局变动与捆绑订阅使用较宽 scope，null 表示该维度全部，不能解释为“没有影响”。完整写入口、范围及未覆盖项见[持续进展页](../../70-workplan/120-identity-sync-progress.md#事实入口覆盖与交付边界)。

新客户端绑定与授权变化共用主体锁，与上下文变化共用会话行锁，避免首次绑定时“快照读到旧版本、变化又没有接收方”的缺口。捕获按原持久会话绑定和受信流作用域路由；能力关闭或现行登记暂时不匹配时仍保留这些绑定的事件，读取继续拒绝。恢复登记后可补拉；作用域变更仍须新 client/stream，不允许修改原 stream 或把旧事件投到新环境。

恢复页只返回连续提交的事件；中间或尾部丢失返回 410，必须重新快照。授权版本出现缺口时应失效该主体全部缓存再重读；重新授权不能被旧撤权覆盖。退出仍是 sid 的不可逆终态，应先服从 logout-v1 结果，不因较新的授权/上下文版本恢复已退出会话。两个 profile 的快照分别一致，不构成跨接口的单个事务；消费者需按各自水位恢复并在应用前复核当前身份。

事实/恢复子集现已由 §2.5 接通主动投递、持久接收和页面失效。outbox 无自动清理；NOTIFY 始终只是唤醒提示，不能作为可靠事实或授权。workforce 及其平台门户已在 N6 接入（§2.8）；外部产品尚未接入。

### 2.5 changes-v1 签名投递与 Console 应用（本地实现，默认关闭）

机读契约：[签名接收 OpenAPI](./150-identity-receiver.openapi.json)、[页面 SSE OpenAPI](./150-console-session-events.openapi.json)。恢复继续使用 §2.4 的两条接口，不把新变化发送到标准 logout 端点。

| 环节     | 本地实现约定                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 登记     | `identity_change_receivers(stream_id,receiver_uri,enabled)`；地址与 stream 不可变，默认 false。依赖原 recovery/changes 流及 精确 customer/workforce realm 的 platform confidential 登记；新地址/环境使用新 client。                                                            |
| 生产     | 事件流引用插入时，同事务创建投递任务；已登记但禁用也保留任务。登记之前的历史事件不自动补建投递，客户端首次快照/补拉建立基线。                                                                                                                                                  |
| 发送     | `IDENTITY_CHANGE_DELIVERY_ENABLED=true`；LISTEN 唤醒和 30 秒持久任务补扫，每批 10 条、60 秒租约、每次最多 10 批。RS256、独立 typ、120 秒封套、每次新 jti，稳定 event_id/事实/首投 cursor；5 秒超时、不跟随重定向。                                                             |
| ACK/恢复 | 仅 204 成功；429/5xx/网络故障退避，上限 300 秒，最多自动重试 24 小时。其他状态隔离；401/403 同时暂停 receiver。租约过期的旧 worker 无法确认。超窗保留事件和任务，人工重放须另行审查。                                                                                          |
| 接收     | `POST /auth/identity-events`，application/jwt，最大 64 KiB；配置 issuer 的 JWKS、RS256/kid/typ、aud、customer/environment、iat/exp 和完整事件形状全部校验后，事务写 inbox 与单调版本，再 204。未知 kid 的 JWKS 拉取合并并限为每 5 秒至多一次、4 秒/64 KiB 上限；临时失败 503。 |
| 去重     | `(issuer,client_id,realm,environment,event_id)`。同 ID 不同事实 409；事实比较不含恢复接口可能重新生成的 opaque cursor。旧版本确认但不回退；授权变化始终失效主体所有范围，天然覆盖乱序和缺口。                                                                                  |
| 请求     | `RP_IDENTITY_CHANGES_ENABLED=true` 依赖退出恢复及 SSE 开关。首请求/进程重启/Redis 或 listener 断线/已收到更高版本时，有限快照+补拉，再读持久屏障。中心不可用为 503。快照只重建 org/workspace，不把旧 JWT 角色复制成新授权。退出 receipt 永远优先。                             |
| 缓存     | 每次权限读取检查本地持久授权版本；缓存包含版本，读取事实后再次核对，最多重试 3 次，防止旧请求回填。启用此能力时治理源失败为 503，不返回保底权限。                                                                                                                              |
| 页面     | 持久版本提交后 NOTIFY；每个实例按 sid/sub 唤醒连接，再读持久版本才发送 `context-changed` / `access-changed`。正文仅 `{reason}`，浏览器重读当前 Cookie；旧连接不能切换/清除新账号。心跳、期限、背压沿用 §2.3。                                                                  |

本批追加 `subscription_entitlement_overrides`、`product.products/plans/plan_versions/plan_components` 的相关事实捕获。组织/空间范围覆盖主组件和 bundled 权益；审计字段同值更新不产生失效。`identity_time_boundaries` 在原事务登记订阅 start/end/trial_end 与覆盖 expires_at，服务端 30 秒任务补扫到期边界，同事务发事件并标已处理；不修改订阅状态、不代替实时准入。数据库不可用或积压时通知可延迟，不能把 30 秒写成硬性到达 SLA。重复迁移仅补登记未来边界。

本地持久屏障只保证 **接收提交后的新读取** 使用新版本；中央提交到投递期间有异步窗口，已进入执行的业务事务不会被事件强制撤回。OBO access token 保持原签名与寿命，变化事件不重签 token，也不自动让独立产品接入。授权仍由事实源和业务服务校验。

现行实现使用请求级快照+有限补拉恢复，不持有全客户端永久消费游标；推送 cursor 不能当作已连续应用水位。两个 profile 的快照不是一笔跨 profile 事务。每轮最多 3 次重建，每次最多 20 页；持续变化/过大积压返回 503，后续请求重新恢复。Console 默认保留兼容刷新；完成条件后可按 §2.6 协商退役，断线自动恢复兼容。其他客户端仍须独立验收。

### 2.6 Console 轮询退役协商（N4，本地实现，默认关闭）

仅有退出 SSE 或 `RP_IDENTITY_CHANGES_ENABLED=true` 不足以停止轮询。新增独立开关 `RP_SESSION_POLLING_RETIREMENT_ENABLED=false`；显式启用时必须同时启用 OIDC RP、持久退出恢复、变化恢复和 SSE，否则启动失败。部署方还须完成事实迁移、中央签名投递/接收方登记和目标代理验收；本地开关不能自动证明中央投递健康。

| 阶段                                  | 服务端/页面行为                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| 开关关闭、旧服务或仅退出模式          | 不返回能力头；保留 300 秒、focus/visibility 兼容刷新                                       |
| 完整模式                              | `/auth/events` 的 200 响应附 `X-Vxture-Session-Sync: events-v1`                            |
| 页面收到 `connected`                  | 先按当前 Cookie 读取完整会话；仅成功且仍登录、连接有效时停止兼容定时器和焦点监听           |
| 健康静置或普通切标签                  | 仅 SSE 注释心跳，不请求身份；闲置安全时钟继续工作，不被心跳续命                            |
| 断线、75 秒无字节、非法帧或视图不可用 | 立即退出事件同步模式，恢复原兼容机制；SSE 按既有上限退避重连，成功协商后再次停止轮询       |
| 旧连接/晚到响应                       | 事件不直接改变身份；清理后的回调不能覆盖新连接模式；当前 Cookie 和请求版本屏障决定最终视图 |

整次 `restoreSession` 使用同一 15 秒截止信号。身份探测通过后，用户、租户、租户选项、权限四个读取必须全部成功；失败抛出不可用，不能用空对象/空列表伪装为匿名或撤权。页面保留最后确认的视图，业务请求仍由服务端鉴权。

新增 `96_identity_presentation.sql` / `2026-12-21-identity-presentation.sql`：账号句柄/邮箱/电话、用户资料展示名/头像哈希、组织名称/简称/可视码、空间名称/可视码和组织主 logo 变化复用 `identity.access_changed` 失效，不传资料正文或图片字节。与会话展示无关的 bio、更新时间等不触发；删除和同值更新分别有测试。迁移后的完整会话展示覆盖是退役前置条件。

本节只适用于已验收的 Console 客户端，不表示其他门户/外部产品已经无轮询。真实目标环境、跨产品和容量验收仍在发布前门槛中；本地浏览器/代理证据与范围见 [110 §12](../../70-workplan/110-identity-center-batches.md#12-n4-合并执行轮询退役与浏览器验收2026-11-24本地未发布)。

### 2.7 部署预检与接入范围（N5，不改变 v0.6 线协议）

`scripts/identity/inspect-sync.mjs` 提供独立运维 CLI：在只读事务中检查所选客户端的表、启用中的触发器、不可变登记和队列状态，输出 JSON 或 Prometheus 文本。`databaseReady=true` 只证明数据库检查通过，不能代替运行开关、签名/JWKS、代理、浏览器和跨产品验收。它不是浏览器接口，也不查询单个用户的登录状态。运行方法、指标语义和告警模板见[运行手册 §11](../../60-operations/50-run-identity-events.md#11-n5-部署预检监控与独立进程验收)。

当前能力覆盖显式登记的 customer/workforce platform BFF；Website、Admin、Opera、Arche 的接线与事实隔离已在 N6 完成，见 §2.8。vxtpl、Karda、Arda 须各自接入并提供证据，不能直接当作当前 platform-only 接口的合格接收方。Atlas、Runos 是 API 基础设施，产品授权镜像、用量或任务队列扫描不属于浏览器身份轮询。逐客户端实施与验收矩阵见运行手册 §11.4。

本地独立进程工具 `scripts/tests/identity-sync-acceptance.mjs` 串联实际中央事实/签名投递、两个 Console 接收进程、PG/Redis 和 SSE；覆盖容量观测、租约期间杀进程、重启快照恢复及标准退出。此证据与 N4 浏览器/nginx 验收相互补充；目标部署、互动登录/MFA、真实系统睡眠和外部产品仍须另验。通则/范本发布前仍需成对增加本文的版本化引用。

### 2.8 N6 平台全入口与运营域（v0.7，本地实现、默认关闭）

本节更新早期 Console-only / customer-only 的实施范围。恢复端点仍只服务显式登记的机密 **platform** 客户端；product 客户端不能绕过登记限制。所有恢复响应、签名事件、游标、撤销收据、inbox、授权版本与通知均绑定精确 realm。customer 使用 `usr_<uuid>`，workforce 使用 `opr_<uuid>`；相同 UUID 不共享任何身份事实。

| 入口                | 域与页面同步出口                                       | 完整视图 / 上下文边界                                                 |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Console             | customer，GET /auth/events                             | 原有当前 Cookie 完整快照及能力失效；保留已验证的 N4 行为              |
| Website             | customer，GET /auth/events                             | 当前会话与实时个人资料；可信中央上下文；暂时故障保留旧视图            |
| Admin、Opera、Arche | workforce，各自 GET /auth/events                       | 先确认当前会话，再读实时账号与权限；完整视图才启用轮询退役            |
| Accounts            | customer/workforce，GET /oidc/session-events?realm=... | 按 realm 选择中央 Cookie；分别读取个人、安全、设备/权限投影           |
| Workbench           | customer，GET /auth/events                             | 实时账号/成员与当前工作区；固定 org/workspace 不被中央上下文通知替换  |
| Customer Portal     | customer，GET /auth/events                             | 已发布 hostname、租户与工作区约束；独立 Cookie；服务端转发 SSE 不缓冲 |

**运营域事实与退出。** `WORKFORCE_IDENTITY_SYNC_ENABLED=true` 后，MFA 完成先创建持久会话，再创建 Redis 会话和授权码；签发前复核 authenticationVersion，失败清理。标准后台退出继续使用原 form logout_token。改密、MFA/Passkey 安全变更、账号安全字段和角色变更在同一事务内推进运营版本、撤销会话并产生退出任务。登录时间、失败次数、Passkey 使用计数不触发退出；展示姓名和权限目录/角色权限变化仅失效视图。强制退出覆盖 Redis 索引缺失的持久会话；在线列表在启用后同时核对持久 owner/状态，故障不回退到缓存在线结论。

workforce 的 changes-v1 仅含 identity.access_changed，scope 三字段均为 null；快照 context=null、context_version="0"。禁止 workforce session.context_changed；事件不能承载或授予权限。Schema 同时约束 realm 与 subject 前缀、快照上下文和事件 scope。

**Accounts 流。** 必填 realm，拒绝额外参数；customer 仅认 vx_sid，workforce 仅认 vx_sid_op，不能互相代用。要求 Sec-Fetch-Site=same-origin，存在 Origin 时必须匹配配置的 issuer/login UI。订阅前后验证域、owner 和持久寿命。开关关闭 204；缺失/终止会话 401；来源不符 403；连接超限 429；基础设施失败 503。成功返回 text/event-stream、X-Accel-Buffering:no、X-Vxture-Session-Sync:events-v1。只发送 resync-required，reason 为 connected/access-changed/expired；不暴露 sid/sub/token/权限。每 25 秒注释心跳不读身份，断线必须重读完整视图，流不续期。接口定义见同一份 [SSE OpenAPI](./150-console-session-events.openapi.json)。

**浏览器协商。** 共享 startSessionSync/startSessionEvents 先完成当前 Cookie 的整份视图读取；流明确返回 events-v1 且重新读取成功才拆除 300 秒/focus/pageshow/visibility 检查。传输故障恢复兼容检查，单次视图读取 15 秒截止；503 不清身份，401 清空。通知会等待较早的读取结束，再强制发起新读，隐藏标签页也处理。BroadcastChannel 只在同源页面首次获得有效会话时广播 recheck，用于 Cookie 切换后的旧标签页收敛，不传凭证或权限。匿名跨域页面仍需 OIDC 导航。

**独立 RP 与运行条件。** Workbench/Customer Portal 通过独立 RP_IDENTITY_DATABASE_URL 写入收据/inbox/版本，业务连接继续只读；svc_rp_identity 只授予相关 session 表权限。Customer Portal 使用已有 \_\_Host-vx_customer_portal_session，Workbench 使用其配置 RP Cookie。接收方登记以机密 client 为范围，业务访问仍逐请求检查 hostname/成员；中央事件不能把用户切到其他客户空间。

**实现定位。** Workbench 的服务端为 `bff/workbench-bff`（`@vxture/bff-workbench`）；Customer Portal 的服务端为 `bff/tenant-bff`（`@vxture/bff-tenant`）。后者部署配置使用 `TENANT_BFF_*`，登录客户端仍为已登记的 `customer-portal` 及环境变体；工程名称不改变接口、事件版本、Cookie 或身份域。完整对应关系见 [BFF 架构](../architecture/05-bff-layer.md#1-location--packages)。

所有 RP 默认关闭 RP_IDENTITY_RECOVERY_ENABLED / RP_IDENTITY_CHANGES_ENABLED / RP_SESSION_EVENTS_ENABLED / RP_SESSION_POLLING_RETIREMENT_ENABLED；启用必须提供 RP_IDENTITY_ENVIRONMENT。Accounts 单独使用 ACCOUNTS_SESSION_EVENTS_ENABLED。先执行迁移 2026-12-22-identity-workforce.sql（依赖前序迁移），再上线新程序；即使 workforce 关闭，新程序客户队列查询也依赖新增 realm 列。运营域开关开启前安排旧 Redis-only 会话重新登录；不静默把旧缓存补为可信持久会话。

验证为本地代码/接口/真实 PG、Redis 与独立进程证据，非八个入口全部浏览器验收；最终门槛和证据见 [进展页](../../70-workplan/120-identity-sync-progress.md)与[运行手册 §12](../../60-operations/50-run-identity-events.md#12-n6-平台全入口部署与回退)。

### 2.9 N7 发布准备与观测输出（本地工具，事件协议仍为 v0.7）

七个 RP 使用同一份非秘密作用域配置生成默认禁用的登记计划并执行批量只读预检；Accounts 直接观察中央会话，不注册为 RP。`prepare-registration.mjs` 只生成 SQL，不连接数据库；精确绑定不一致时生成事务拒绝覆盖。

预检公开输出的 scope 包含 clientId / environment / realm / releaseChannel。Prometheus 标签对应 client_id / environment / realm / release_channel，排除身份与令牌数据；realm/channel 进入队列筛选，缺少 realm 列显式不就绪。批量采集以 scope_expected/collection_success 区分缺失、故障与可读但未就绪，失败不伪造零积压。

这些是运维输出，不改变 OIDC、事件 JWT、SSE 或浏览器能力协商。批量退出码与原子写入语义、登记应用边界、八入口验收和灰度/回退步骤见[运行手册 §13](../../60-operations/50-run-identity-events.md#13-n7-本地发布准备包2026-11-25)。本地验证不能替代目标环境运行证据。

## 3. 客户端能力登记（候选）

由平台运营登记，不接受浏览器自行声明。沿用产品登记入口，C4 在既有模型增加 `identity_events` 配置：

| 字段               | 类型与约束                                                |
| ------------------ | --------------------------------------------------------- |
| `protocol_version` | 固定 `1`；不支持的主版本不启用                            |
| `enabled`          | boolean，默认 false；试投递和恢复验收后启用               |
| `receiver_uri`     | 受信 HTTPS URL；禁止重定向；本地测试只允许登记的 loopback |
| `event_types`      | §4 类型的子集；未知类型不能静默确认                       |
| `recovery_enabled` | boolean；开启后授予本客户端过滤后的恢复读取能力           |

issuer、realm、environment、OIDC client、product 和合法 channel 从平台现有登记关联解析。事件必须精确绑定该关联；不能根据请求 Host、前端参数或 URL 猜测环境。prod、beta、dev 使用独立绑定、接收地址及游标。跨 realm 的 customer / workforce 事件绝不合并。client_secret_basic 用于平台恢复端点，仅机密后端可用；公开客户端由 BFF 代办，不能获得客户端密钥。

## 4. 事件载荷与签名（候选）

逻辑事件模型见 [JSON Schema](./150-event-sync-event.schema.json)。字段不可携带令牌、手机号、邮箱、角色全量或计费数据。

| 字段                               | 含义                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `schema_version`                   | 数字 1                                                                                            |
| `event_id`                         | 平台生成的 UUID；一次事实变更稳定不变，重试 / 重签不变                                            |
| `type`                             | 下表枚举                                                                                          |
| `occurred_at`                      | UTC RFC3339 时间，仅诊断；不作排序依据                                                            |
| `issuer` / `realm` / `environment` | 必须与接收方受信登记精确匹配                                                                      |
| `audience`                         | 接收 OIDC client_id，长度 1–128                                                                   |
| `cursor`                           | 该接收方流的、不透明的恢复位置；长度 1–512，不解析、不跨客户端使用                                |
| `subject`                          | `{sid, sub}`，或仅 `{sub}`，见各类型                                                              |
| `version`                          | 十进制正整数字符串，最多 20 位；用 BigInt 比较，不能转 JS number                                  |
| `scope`                            | 仅授权失效事件使用；`org_id` / `workspace_id` / `product_id` 为字符串或 null，null 表示该维度全部 |

| `type`                    | 主体 / 版本空间                    | 接收动作                                                                   |
| ------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `session.revoked`         | `{sid,sub}`；每中央 sid 的会话版本 | 先持久撤销屏障，再删除该 sid 全部 RP 会话；新 sid 不受影响                 |
| `session.context_changed` | `{sid,sub}`；同一 sid 的上下文版本 | 标记上下文过期，受保护请求重读可信上下文后再放行；事件不直接替换租户       |
| `identity.access_changed` | `{sub}`；每主体的授权版本          | 失效 scope 对应准入 / 权限缓存，再向事实源重读；禁止自动补席位或管理员角色 |

不同类型版本空间独立。`session.revoked` 对同 sid 是不可逆的终态，不受其他类型较高版本覆盖。授权版本是主体级单调版本；若出现缺口必须使该主体的全部授权缓存失效并重读，不能只应用最后一个 scope。正常顺序按事件分别失效 scope；重复 / 旧版本幂等处理。

平台发送 `POST <receiver_uri>`，`Content-Type: application/jwt`，正文为 RS256 紧凑 JWS。protected header 为 `{alg:"RS256",kid,typ:"vxture-identity-event+jwt"}`。payload 为 `{iss,aud,iat,exp,jti,event}`；`event` 是上述模型，`iss == event.issuer`，`aud == event.audience`。有效期 120 秒，允许时钟偏差 60 秒，接收方还需检查 `iat` 非未来且 `exp-iat <= 120`。只接受登记 issuer 的 JWKS，不信任 JWT 自带 URL；未知 kid 最多触发一次有界 JWKS 更新，更新失败返回 503。旧公钥至少保留到所有已签封套过期；后续重试使用当前签名密钥。

每次重试重新生成 `jti / iat / exp`，稳定保留 event_id、版本、游标和事实内容。去重键为 `(issuer, realm, environment, audience, event_id)`，不能只按 jti。验签在去重之前；同 ID 不同内容视为完整性错误并告警。全请求最大 64 KiB。

示例逻辑事件（虚构标识）：

```json
{
  "schema_version": 1,
  "event_id": "f1dd3fe0-3dd9-4e16-9679-8a654081ebd8",
  "type": "session.context_changed",
  "occurred_at": "2026-11-24T06:00:00Z",
  "issuer": "https://accounts.example.test",
  "realm": "customer",
  "environment": "beta",
  "audience": "console-beta",
  "cursor": "opaque-position-example",
  "subject": { "sid": "example-sid", "sub": "example-user" },
  "version": "18"
}
```

## 5. 接收确认与可靠投递（候选）

接收顺序：校验封套和登记 → 同一持久事务记 inbox 去重与失效状态 → 204 空正文。重复的、已经持久应用的事件同样返回 204。不能仅放入进程内队列就确认。服务端保护已生效即可确认；页面是否在线、是否收到 SSE 不影响 ACK。

标准 logout 接收端维持标准成功响应，但也必须在响应前建立可恢复撤销屏障。短期 Redis 标记的 C2 实现尚不等于该持久确认：C4 必须补 inbox / 恢复路径，并在 Redis 丢失后重建撤销状态后才服务请求。

| 响应                             | 平台处理                                                |
| -------------------------------- | ------------------------------------------------------- |
| 204                              | 新事件接收完成；记录该接收方已应用                      |
| 400                              | 字段 / 类型不支持，停止热重试，隔离并告警               |
| 401 / 403                        | 签名或绑定拒绝，暂停接收方并告警；修复登记 / 密钥后重放 |
| 429 / 503、其他 5xx、断连 / 超时 | 有界重试；不标已交付                                    |
| 3xx、其他 2xx / 4xx              | 契约异常，隔离并告警，不跟随重定向                      |

单次请求超时 5 秒；指数退避基数 1 秒、上限 5 分钟、full jitter，合法 Retry-After 最大采纳 5 分钟。连续自动重试最多 24 小时；之后转未送达队列并告警，不删除逻辑事件。重放窗口至少 7 天；超出窗口按快照恢复。去重记录至少保留 8 天；撤销事实至少覆盖原会话绝对寿命与最长授权回调窗，不能因停止重试而消失。

事实、版本、事件必须同一 DB 事务提交。接收方绑定要持久保存，退出后不能靠已经删除的 Redis 索引重新寻找接收方。事件分发针对有权接收的客户端生成自己的连续流；同一客户端的序号须按提交顺序产生，不能把未提交 PostgreSQL sequence 最大值当水位。

## 6. 补读与快照端点（候选）

以下由 auth-bff 暴露，均为 `POST` JSON、`client_secret_basic`、`Cache-Control: no-store`。realm / environment / audience 由认证后的客户端登记确定；请求不能覆盖。只返回该客户端的持久绑定或授权范围内的数据。响应最大 1 MiB。

### `POST /oidc/identity/events`

请求 `{ "cursor": "opaque-position", "limit": 100 }`；cursor 必填，limit 默认 100、范围 1–100。返回 200：`{ "events": [Event], "next_cursor": "opaque-position", "has_more": false }`，按流顺序排列。空页保留有效 next_cursor。游标必须绑定签名与客户端 / realm / environment；客户端不能构造位置越权读流。

仅启动 / 重连 / 发现缺口 / 运维重放时调用，不能转为常驻后台轮询。收到 Webhook 时不把其中单个 cursor 当作“此前都已应用”；接收方维护持久的连续恢复位置。传输允许乱序，版本决定应用，游标决定补读范围。

### `POST /oidc/identity/snapshot`

首请求 `{ "sids": ["sid-a", "sid-b"] }`，最多 100 个本地在用 sid；一批 sid 在同一个数据库快照中生成结果和 `watermark`。返回 200：

```json
{
  "watermark": "opaque-snapshot-watermark",
  "sessions": [
    {
      "sid": "sid-a",
      "state": "active",
      "sub": "user-a",
      "session_version": "1",
      "context_version": "18",
      "authorization_version": "7",
      "absolute_expires_at": "2026-11-25T00:00:00Z",
      "context": { "org_id": "org-a", "workspace_id": "space-a" }
    },
    { "sid": "sid-b", "state": "inactive" }
  ]
}
```

`inactive` 仅用于本客户端历史绑定且现已无效的 sid；非本客户端绑定返回 `{sid,state:"not_bound"}`，不透露该 sid 是否存在。绑定记录必须保留到该 sid 最晚可能残留的本地会话过期，再加恢复窗口。`active` 快照是中央状态和版本，不是产品准入许可，授权仍经原 C2 和产品自身业务权限判断。

恢复算法：

1. 将待恢复本地会话标为“需确认”，暂停这些会话的受保护请求；建立持久接收缓冲。
2. 批量快照；失效 inactive / not_bound，会话主体不一致也拒绝；active 的上下文与授权缓存重建。恢复不能延长本地会话 TTL。
3. 从各批 watermark 补读至流头，按版本处理并保留已确认的撤销终态。多批之间不能用最后一批水位覆盖前批；为每批补齐或从最早水位整体补读。
4. 原子记录恢复位置和已应用版本后开放服务，消化恢复期间的缓冲。启动的新会话另受中央授权与本地撤销屏障保护。

快照必须来自一致的持久事实和已提交流水位。C3 / C4 实现需以事务锁或等价提交栅栏证明不会漏掉快照之后提交的低序号事件。不得用“先查状态，再查 max(id)”拼接。快照中不得通过旧 Redis 缓存复活已撤销会话。

共同错误形状 `{code,message,retryable}`：400 `INVALID_REQUEST`；401 `INVALID_CLIENT`；403 `CAPABILITY_NOT_ENABLED` / `SCOPE_MISMATCH`；410 `CURSOR_EXPIRED`（启动快照）；429 `RATE_LIMITED`（退避）；503 `IDENTITY_UNAVAILABLE`（保持待确认，不解读为 inactive）。错误不回显 secret / token。

## 7. 浏览器 SSE（候选，C6 / C7）

BFF 同源 `GET /auth/events`，现有 HttpOnly RP Cookie 认证，禁止 URL token、sid 或租户参数。服务端从会话解析作用域，每次发事件前确认连接仍属于当前会话。响应 `text/event-stream`、`Cache-Control: no-store`、`X-Accel-Buffering: no`。代理关闭缓存和缓冲。

事件只包含页面动作：`session-ended`、`session-changed`、`access-changed`、`resync-required`；data 为 `{version:"18"}` 或 `{reason:"cursor_expired"}`，不下发 token、中央 sid 或权限全集。SSE `id` 是 BFF 自己的有界恢复游标，不是平台流 cursor。Last-Event-ID 绑定当前本地会话；旧会话游标不能重放给新登录。无有效 Cookie 返回 401；连接中收到已确认退出先发 session-ended 再关闭。

每 25 秒注释心跳，仅维持连接；不触发业务快照或更新用户活动。BFF 保留页面通知至少 10 分钟，游标过期发 resync-required 后由页面重读一次快照。服务重启 / 丢消息时先恢复服务端事实，再要求页面重读。

页面按受控失效重读；401 可走登录，503 显示暂不可用并保留最后身份但不允许据旧视图继续敏感操作。同源多标签页用 BroadcastChannel 传播失效信号，消息不携带可信权限。连接复用可用 Web Locks，主标签页退出时接管；不支持时各标签页独立 SSE。标签恢复只重建断开的流或执行明确的恢复流程，健康流不触发普通 focus 轮询。

## 8. 产品接入步骤与验收

1. 平台登记能力、环境、接收地址；产品完成 inbox、持久撤销、版本及授权缓存失效。先用模拟 RP 验证，再启用试点。
2. 验证签名 / 过期 / 错环境 / 错受众拒绝；重复确认；同主体乱序、版本缺口、跨租户及跨 realm 隔离。
3. 故障注入覆盖：事实提交后进程退出、投递断网 24 小时、接收后 ACK 丢失、接收进程重启、Redis 清空后的恢复、7 天游标过期、快照与新撤销并发。均不得复活会话。
4. SSE 上线后完成退出、切换上下文和撤席的双向真实产品测试；健康页面观察至少两个原轮询周期。仅对应客户端、已验证事件类型的身份轮询可删除。
5. 商业开通定期对账、设备登录 claim、业务监控和真实用户空闲检测分别保留，不用“零轮询”删除其他用途的计时器。

本轮交付事件 schema 与候选示例；HTTP 全量 OpenAPI / DTO、签名封套、快照返回 schema 和端到端契约测试由 C3–C7 按实现同批补齐。C1 尚不能宣告发布就绪。版本 1 冻结前可修订候选；发布后新增类型走能力登记，破坏性字段变化升主版本并遵守通则兼容期。
