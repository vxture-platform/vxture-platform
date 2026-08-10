# 登录后跨产品通信 fabric 架构(Post-Auth Mesh Architecture)(product_230)

> 版本:**v1.0** · 日期:2026-07-12 · 状态:**已定稿**(评审 arda 回函 04 `arda-plat-230-mesh-optimization` v0.1 提案,owner 2026-07-12 裁定「立即做完整架构评审」;决策 D1–D5 已拍板,见 §8;**实施逐项授权**,切分见 §7)
> 文档族:产品架构族 `product_{NNN}`,本文 = **230**(细化标准位);族路由见 [`product_100_matrix.md`](./product_100_matrix.md) §0 头部
> 定位:**登录授权之后**的跨产品通信**传输面 / mesh 架构权威**——按"域关系 × 产品层"两轴分级,定义 S2S 通信走公网边缘还是内网 tailnet、边界如何收口、会话如何互验、控制面/数据面如何分离。补齐 product_200(三通道**结构**)与 product_210(产品↔产品**身份/授权/计量**)之外的**第三维:字节怎么走、走哪张网**。
> 上游:[`product_200_integration.md`](./product_200_integration.md) v1.0(三通道契约)、[`product_210_tool-protocol.md`](./product_210_tool-protocol.md) v1.0(token exchange = 本文 §5 收敛目标)、[`product_100_matrix.md`](./product_100_matrix.md) v1.0(产品矩阵)。
> 定位:平台传输面(S2S 内网 tailnet 寻址、边缘/内网双面边界、控制·数据面分离)的**架构定稿**。产品侧决策留痕见 [`arda_300`](../20-specs/210-arda/40-arda_300_integration-final.md) §2。
> 铁律承接:**平台只出规范与凭证,不出网关**(product_210 §0)——本文定传输面分级与边界,不新建中心代理/ESB;**S2S 永不公网、密钥与内部端点不出内网**。

---

## 0. 结论(一句话)

**登录后的一切 S2S 内部通信必须留在内网(tailnet/WireGuard),密钥与内部端点不出网。** 现状"所有产品一把尺、默认全走公网边缘"被本文取代为**两类分级**:同 apex(`*.vxture.com`)产品走**统一 tailnet fabric**(内网寻址 + 平台签发 scoped token),跨 apex(ruyin.ai 类)保持**轻集成**(公网 OIDC + 轻权益)。arda 回函 04 提案**整体采纳**,五项决策见 §8。

---

## 1. 分级判据:两类业务(决策 D5)

一切跨产品通信按两轴分级:**eTLD+1 域关系**(cookie 能否共享 / 是否同网)× **产品层**(业务耦合深度)。

|          | **类 1 · 跨 apex**(ruyin.ai 类)            | **类 2 · 同 apex**(`*.vxture.com`)                   |
| -------- | ------------------------------------------ | ---------------------------------------------------- |
| eTLD+1   | 不同 → **cookie 不共享**                   | 相同 → **登录态可互验**                              |
| 网络     | 可能异网段(境外/第三方托管)                | **同 tailscale 网段**                                |
| 登录     | 完整 OIDC(跨域 SSO)                        | OIDC 建态一次 + 之后**内网会话互验**(§4),免重复 OIDC |
| 权益     | 轻(claim / 单次 C2 读),不做深度计量        | 完整 C2/C3                                           |
| S2S 传输 | 只能公网 HTTPS(异网,TLS 必须)              | **只走 tailnet,绝不公网**(§2/§3)                     |
| 计量     | 无 / 轻                                    | 完整 C3 consume/gauge                                |
| 现役实例 | umbra(ruyin.ai,worker-04 境外不入 tailnet) | **arda(worker-02)及后续 karda/terra/agent 族**       |

- **类 1 故意做轻**:认证 + 简单订阅授权即可;异网天然只能公网 HTTPS,不吃内网红利也拖不垮类 2;umbra 现役契约(`identity-platform-ruyin-contract.md`)继续有效,不受本文影响;
- **类 2 吃满内网 fabric**:内网寻址(§2)、双面边界(§3)、会话互验(§4)、scoped token(§5)、控制/数据面分离(§6)全部适用;
- **判类精化(平台裁定,较回函 04 收紧)**:两轴各管各的——**S2S 传输走哪张网,判据 = 是否在平台 tailnet**(部署事实);**登录态/cookie 互验可不可行,判据 = eTLD+1**(域名事实)。二者通常一致,但 `runos.ai`/`anlan.ai`/`xuanzhen.ai` 等异 apex 域名产品若部署在平台 tailnet 内,**S2S 照走类 2 内网**,仅会话互验面按跨域处理。"类 1/类 2"标签按 tailnet 归属取值,域名仅是缺省信号;
- **归属登记**:判据与义务写入 product_200 §6 适用矩阵(逐产品归类),product_100 族路由登记本文。

---

## 2. 内网寻址约定(决策 D1)——回函 03 §3.1 直接答复

**同 apex 产品的 C2/C3/可见集 S2S 出站一律指向平台内网地址,不走公网。**

| 项            | 约定                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 传输网        | tailscale(WireGuard 加密 + 节点级双向身份);worker-01(平台)与 worker-02(arda)已同 tailnet                                                                                                                                                                               |
| 平台 S2S base | **`http://<worker-01-tailnet-ip>:3090`**(worker-01 tailscale 接口)——auth-bff 已绑此口("仅 Tailscale 对端可达",`deploy/compose.platform.yml` auth-bff ports),**内网端点本就存在,产品只需改指**                                                                          |
| 寻址形态      | **raw tailscale IP:port = 现行仓内约定**(先例 `MODEL_PLATFORM_URL=http://<worker-01-tailnet-ip>:3100`,`deploy/worker-02/.env.varda-server.example`;tailnet 私网地址无 tailnet 成员身份+凭证不可达,非 secret,仓内公开登记);MagicDNS 未启用,未来启用可平替(改名不改约定) |
| 端点路径      | **不变**——`GET /platform/entitlements`、`POST /usage/consume`、`PUT /usage/gauge`、`GET /platform/sharing/visible-set`(product_200/arda_200 契约字面),仅 base 由公网改内网                                                                                             |
| 鉴权          | 过渡 = `x-vxture-internal-auth: <AUTH_INTERNAL_TOKEN>`(仅内网发送,不出网);目标态 = §5 scoped S2S token                                                                                                                                                                 |
| 传输层信任    | tailnet 节点级已互认,**S2S 不再叠加 mTLS**(WireGuard 已提供加密 + 双向身份,省一层复杂度)                                                                                                                                                                               |

**先例佐证**:平台 LLM 网关(`<worker-01-tailnet-ip>:3100`)已由 worker-02 varda-server 经同一 tailscale 接口生产消费(`deploy/compose.platform.yml`、`docs/50-deployment/varda-worker-02-runbook.md` §3)——worker-01↔worker-02 内网 S2S 路径**已在生产验证**,arda C2/C3 复用同路径,**零新基建**。

> **回函 03 遗留安全项(B1)**:arda 把 `PLATFORM_API_URL` 从公网改指内网之前,其 C2/C3 出站处于"明文公网发 S2S 密钥"状态(实测 301 → Cloudflare → 404,未达真实端点,但密钥已出网)。**改指内网后轮换一次 `AUTH_INTERNAL_TOKEN`**(过渡凭证,轮换成本低;§5 token exchange 落地后整体退役)。轮换 = owner 运维动作,平台/产品两侧同窗换值。

---

## 3. 边缘 / tailnet 双面边界模型(回函 03 收口,推广到全产品)

流量分两面,端点按面归属,**边缘只放浏览器路由**:

| 面                           | 主体                     | 路径                                                                                                                          | 边界控制                                 |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **边缘面**(公网 TLS)         | 用户浏览器               | `/auth/*`、页面 `/`、浏览器 `/api/*`、**仅浏览器 well-known** `/.well-known/openid-configuration`                             | OIDC / session cookie;公网可达是**必须** |
| **tailnet 面**(S2S,绝不公网) | 产品 ↔ 平台、产品 ↔ 产品 | C2/C3/gauge/可见集出站、provisioning webhook(§3.1)、产品↔产品取数、产品内部触发端点、**工具发现 `/.well-known/vxture-tools`** | tailnet + S2S 鉴权;**任一字节不出内网**  |

> **`/.well-known/vxture-tools` 归 tailnet 面(owner 2026-07-20 裁定,收口 product_210 与本文的归面张力)**:工具发现是**产品↔产品 S2S**(供给方向调用方声明工具清单),按本节铁律"所有 S2S 只走 tailnet、绝不公网",此端点绑 tailscale 接口 + S2S 鉴权,**不出边缘**。边缘面的 `/.well-known/*` **仅**放浏览器相关(如 `openid-configuration`),不含 `vxture-tools`。product_210 §4.2 的工具清单端点据此明确为 tailnet 面。

**平台侧现状核验(2026-07-12)**:平台边缘 `accounts.vxture.com` nginx **无 `/platform/*` 与 `/usage/*` location**(仅 `/oidc`、`/.well-known/openid-configuration`、`/auth`、`/api/me`、`/avatar`、`/_next/static`、`/`)——**平台侧边界对称性已满足**(回函 03 §3.3 = 确认 ✅):C2/C3/gauge/可见集只经 auth-bff 的 tailscale 绑定暴露,公网边缘不路由。产品侧须对齐同款模型(边缘只放浏览器路由,内部端点 404;arda 实测偏差 B0/B2 的修复即此,= 线 B 自修项)。

### 3.1 provisioning webhook 方向特例(平台 → 产品入站)

webhook 与 C2/C3 反向(平台出站、产品入站)。**类 2 产品定为 tailnet 投递**(决策 D1 附带):

- **现状耦合(2026-07-12 核验)**:seed 的 `product_webhooks.webhook_url` = `${ARDA_BASE_URL}/provisioning/webhook`(`seed-catalog.mjs`),而 `ARDA_BASE_URL` **同时**是 OIDC client redirect URI 的 base——**直接改该 env 会破坏 OIDC 回调**;
- **解耦方案(P0 实施项)**:seed 引入 **`ARDA_WEBHOOK_BASE_URL`**(缺省回落 `ARDA_BASE_URL`,向后兼容),仅供 `product_webhooks.webhook_url` 投影;生产配为 arda 的 tailnet 地址(worker-02 tailscale IP:port,owner 转运)+ reseed → 投递全程内网;
- **HMAC 验签保留**(纵深防御,不因内网化撤除);arda 侧边缘对 `/provisioning/webhook` 可整体 404(公网不再需要此路径);
- **类 1(跨 apex)例外**:异网产品只能公网边缘投递,靠 HMAC + 平台源 IP 允许名单兜底(行业标准模式);
- **beta 栈**:现状仅 arda(stable)登记 webhook 行,beta plan 事件按 payload.plan 忽略(product_310 D4 备案),不受本节影响。

### 3.2 平台侧义务小结(回函 03 §3 逐项答复)

| 回函 03 §3                    | 答复                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. 内网 auth-bff base URL     | §2 已定:`http://<worker-01-tailnet-ip>:3090`(worker-01 tailscale)                                             |
| 2. webhook 投递源             | §3.1:tailnet 投递(源 = worker-01 tailscale IP `<worker-01-tailnet-ip>`;`ARDA_WEBHOOK_BASE_URL` 解耦 + reseed) |
| 3. 边界策略对称               | ✅ 确认:平台 `/platform/*`、`/usage/*` 仅内网(§3 核验)                                                        |
| 4. `AUTH_INTERNAL_TOKEN` 轮换 | ✅ 接受:arda 改指内网后同窗轮换(§2 注记)                                                                      |

---

## 4. 会话内省端点(决策 D2)——同 apex 免重复 OIDC(前向能力)

**问题**:类 2 产品互相验证"对方登录态"时重跑完整 OIDC 过重。**不共享 cookie**——现行 host-only cookie(无前导点)正确,`.vxture.com` 父域 cookie = 把会话泄给所有兄弟站,**禁止**(回函 04 §2.1 确认)。

**方案**:平台提供**内网会话内省端点**:

```
GET /internal/session/introspect          (tailnet 面,S2S 鉴权,绝不公网)
输入:平台中央会话引用(sid)
→ { active: bool, subject, active_org, active_workspace, roles, account_status }
```

- 产品间验对方登录态 = **一次 tailnet 调用、可缓存**(TTL 30s,对齐 C2 短 TTL 纪律),比重跑 OIDC 快且不牺牲隔离;
- 鉴权同 C2/C3(过渡 `AUTH_INTERNAL_TOKEN` → 目标态 S2S token,随 §5 一并迁移);
- **不改用户级 OIDC**(人用产品照旧建态一次);
- **arda v1 不依赖**——arda 自身是完整 OIDC RP,当前无产品↔产品会话互验场景;本端点是类 2 fabric 的**前向能力(P1)**,随首个真实互验需求落地,**不超前建**(起步最小化纪律)。

---

## 5. token exchange 收敛(决策 D3)——统一 fabric 替代共享 secret

现状 = `x-vxture-internal-auth` 一把长期共享 secret 供所有产品→平台 S2S(product_310 D1 过渡态)。**本文确认收敛方向 = product_210 §3 已定稿的 token exchange,不另设计**:

- **平台签发短时 scoped S2S token**(`aud` 单受众、`act.sub` 调用方、org/ws 上下文、`mode=obo|service`、TTL 300s、RS256 同 JWKS——形状/铸币授权/scope 粒度均为 product_210 §3/§9 权威)替代长期共享 secret → 泄露即失效、per-call 可审计、爆炸半径 = 单 caller(vs 共享 secret 全线沦陷);
- **一套 JWKS 验签纪律**:用户 token 与 S2S token 同验签八条(product_210 §3.3);加产品 = 注册 client + 上 tailnet 节点,**不新建 bespoke 通道**;
- **平台面迁移范围显式化**:product_210 §8 **T2**(平台面端点改收 `aud=vxture` S2S token、退役共享口令)的迁移面 = `/platform/*` + `/usage/*` + §4 会话内省端点(T2 原文"平台面端点"即含此义,此处显式登记);
- 收敛时序 = product_210 T1(IdP token exchange)→ T2(平台面迁移)。mesh 不改 token 语义,只钉死"平台面 S2S 全部收敛到此、共享 secret 退场"。

---

## 6. 控制面 / 数据面分离(决策 D4)——大宗取数不缠 broker(前向方向)

arda 是 broker(授权求值 + 策略 + 审计 + 配额),**不搬字节**。P2/agent 大宗只读若都走"agent → arda → 属主库 → arda → agent"两跳缓冲,既慢又让 arda 扛流量。定为**架构方向(P3,前向)**:

- **arda 留控制面**;**大宗只读走数据面**——arda 签发**短时定向签名凭据**(绑定 workspace/product/act/资源 ref),agent 凭它**直连**属主端点拉数,arda 不缠在字节路径上;
- **小结果 / 需脱敏的仍经 arda 代理**;大宗只读直连;
- arda 始终在授权/审计闭环内(凭据由它签发,归因天然——与 product_220 §4.3 归因同源),吞吐不受 broker 单点限制;
- **签名凭据形状 = 平台 + 属主产品共定**(涉及属主端点验签义务),随 P3 另立设计线;**不在 arda v1 关键路径**(v1 = 用户级面 + C2/C3,无 agent 大宗取数场景)。

---

## 7. 落地路线(阶段化,均逐项授权)

| 阶段                  | 动作                                                                                                                                                                                                                                                                                                   | 归属            | 授权点                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------- |
| **P0 边界收口**       | 平台侧:①内网 base = `http://<worker-01-tailnet-ip>:3090`(§2,已定);②seed `ARDA_WEBHOOK_BASE_URL` 解耦 + 生产 env(arda tailnet 地址)+ reseed(§3.1);③arda 切换后轮换 `AUTH_INTERNAL_TOKEN`。产品侧(线 B):`PLATFORM_API_URL` 改内网、边缘只放浏览器路由、flush 守卫/内置定时器、出站 host 断言(回函 03 §4) | 平台 + 线 B     | ②为代码/seed 项,单独授权;③ = owner 运维         |
| **P1 会话内省**       | `/internal/session/introspect`(§4)                                                                                                                                                                                                                                                                     | 平台            | 随首个同 apex 互验需求,逐项授权(arda v1 不阻塞) |
| **P2 token exchange** | product_210 T1(IdP token exchange)→ T2(平台面 + 内省端点迁移,退役共享 secret)                                                                                                                                                                                                                          | 平台            | product_210 §8 T1/T2(已定稿待授权)              |
| **P3 数据面分离**     | arda 签发定向签名凭据、大宗取数直连属主端点(§6)                                                                                                                                                                                                                                                        | 平台 + 属主产品 | 另立设计线                                      |

**arda v1 关键路径只含 P0**;P1/P2/P3 为 fabric 前向能力,不阻塞 arda v1 上线。

---

## 8. 决策记录(owner 2026-07-12 裁定「立即做完整架构评审」;对应回函 04 §6 五项)

| #   | 决策(回函 04 §6)                            | 结论                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 内网寻址约定                                | ✅ **采纳**:同 apex S2S 走 tailnet;平台 base = `http://<worker-01-tailnet-ip>:3090`(auth-bff 既有 tailscale 绑定,零新基建);webhook 同步内网化(`ARDA_WEBHOOK_BASE_URL` 解耦,§3.1);raw tailscale IP = 仓内既有约定(§2);端点路径不变。直接答复回函 03 §3.1/§3.2。 |
| D2  | 会话内省端点 `/internal/session/introspect` | ✅ **采纳为前向能力(P1)**:形状/鉴权/TTL 30s 见 §4;**arda v1 不依赖**,随首个同 apex 互验需求落地,不超前建。                                                                                                                                                     |
| D3  | token exchange 形状                         | ✅ **收敛到 product_210 §3**(已定稿,不重设计):scoped 短时 S2S token 替换共享 secret,一套 JWKS;平台面 + 内省端点一并纳入 product_210 T2 迁移面(§5)。                                                                                                            |
| D4  | 控制/数据面分离                             | ✅ **采纳为架构方向(P3,前向)**:arda 留控制面、大宗只读走短时定向签名凭据直连;凭据形状平台+属主产品共定,另立设计线;不在 v1 关键路径(§6)。                                                                                                                       |
| D5  | 两类分级                                    | ✅ **采纳并登记 product_200 §6 / product_100 族路由**:类 1 跨 apex 轻集成(umbra)、类 2 同 apex 内网 fabric(arda 等);判据与义务见 §1。                                                                                                                          |

## 9. 边界之外

不做中心代理/ESB(product_210 §0 铁律);不做跨 org 通信(org 绝对隔离,唯一跨 org = P 级资产经 entitlement);不改类 1 现役契约(umbra `identity-platform-ruyin-contract.md` 继续有效);token 形状/scope/生命周期归 product_210;产品间异步消息总线不做(webhook 归 C3)。

## 10. 对账与送达

arda v1 关键路径 = 内网 base 收口（已上产）；控制·数据面分离等前向项按本文 P1/P3 分期。
