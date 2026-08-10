# Identity RP 接入（identity 板块 · 详细层）

> 🧭 架构层见 [`identity-platform-architecture.md`](./040-architecture.md)（板块定位 / 边界 / 拓扑总览 / 双 realm）。本文 = **RP 接入标准 / 集成模板 / business-app 契约 / provisioning 的详细层 reference**。
> 平台数据模型权威 = [`data_platform_100_architecture.md`](../data_platform_100_architecture.md)（a）+ [`data_platform_200_schema.md`](../data_platform_200_schema.md)（b）：`iam.oidc_client` 完整字段级见 **b §5.3**，本文只列接入方关心的语义子集、不重述 DDL。
> 合并自 `identity-app-integration-standard` + `identity-sso-p1-rp` + `identity-sso-p4-app-integration-contract` + `identity-sso-p4-provisioning`，2026-07-01。状态：机制基线（statement-of-record）。

---

## 1. 接入总则：一种机制，两种部署模式

所有应用都是 IdP（issuer `https://accounts.vxture.com`，dev `http://localhost:3081`）的 **OIDC 授权码 + PKCE(S256) RP**，RS256 验签，**token 只在 app 后端（app-bff）服务端流转，浏览器只持不透明的 RP 会话 cookie**。登录对两种模式**机制相同**——顶级整页跳转到 IdP `/oidc/authorize`，**禁 iframe / XHR 静默授权**；差异只在**域、cookie 作用域、登出依赖**：

| 维度              | 模式 A：跨子域（`*.vxture.com`）                           | 模式 B：跨域（独立注册域）                                |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| 例子              | `console.vxture.com` / `admin*` / `xuanzhen.vxture.com`    | **`ruyin.ai`（当前首个）**                                |
| `redirect_uri`    | `https://{app}.vxture.com/auth/callback`                   | `https://{app-domain}/auth/callback`                      |
| 中央会话 `vx_sid` | `.vxture.com` cookie，浏览器对所有子域 + accounts 都带     | 仅对 `accounts.vxture.com` 第一方；**绝不发往 app 域**    |
| 静默 SSO          | 顶级跳 accounts `/oidc/authorize` → 带 `vx_sid` → 静默发码 | **同左**（顶级跳转后浏览器对 accounts 第一方带 `vx_sid`） |
| RP 会话 cookie    | host-only 于 `{app}.vxture.com`                            | host-only 于 app 域                                       |
| 跨域 cookie 共享  | 理论可（`.vxture.com`），**但本标准不依赖**                | **不可能**（不同注册域）                                  |
| 全局登出（SLO）   | back-channel logout（**强烈建议**）                        | back-channel logout（**唯一手段，必须**）                 |

> 结论：两模式**接口完全一致**，app 按同一套实现；跨域只是多了两条硬约束——"必须实现 back-channel logout + 绝不尝试 cookie/iframe 静默"。SSO 依赖"重定向落到 IdP 域时浏览器对 IdP 第一方携带 `vx_sid`"，不依赖任何跨域共享 cookie。

- **适用范围**：`realm=tenant` 的业务应用接入。operator（运营后台 admin）走 `workforce` realm、host-only `vx_sid_op`（不下发子域、与客户面硬隔离），复用同一模板但不适用本文的社交/注册/切租户面，另案。
- **平台提供（已就绪）**：discovery（`GET {issuer}/.well-known/openid-configuration`，权威自描述）、JWKS（`GET {issuer}/oidc/jwks`，RS256 公钥、支持轮换）、`client_id`/`client_secret`（平台登记派发，secret 经 secret manager、库里仅存 hash）。app **不直接访问平台 DB**；身份/组织上下文一律经 token，必要时经服务间 API。
- IdP 端机制（`/oidc/authorize` 决策、`/oidc/token` 签发、realm/`sub`/会话 cookie、密钥轮换、back-channel 投递）见对侧 [`identity-platform-idp.md`](./070-idp.md)；本文只述 **RP 侧**运行时装配与契约。

---

## 2. RP 集成模板（app-bff）

子域 tenant-realm RP 的 canonical 集成模板，console / website 首批采用，admin / ruyin / xuanzhen·hermes 复用（差异见各自阶段）。既有实现可复用 `@vxture/core-oidc-rp`（`HttpOidcRpClient` / `RpAuthService` / `RpSessionStore`）——website / console / admin 即基于它；外部仓库 app 按本契约自行实现等价逻辑亦可。

### 2.1 OIDC 客户端模块

- **库**：Node 端用 `openid-client`（标准、维护好），封装为 `@vxture/core-oidc-rp`（各 BFF 复用）。
- **启动加载**：拉 `OIDC_ISSUER` 的 discovery + JWKS，缓存（定时/按需刷新、按 `kid` 选键）。
- **client 配置**（每 BFF 一份，来自 env / secret manager）：`client_id`、`client_secret`、`redirect_uri`、`scopes`、`OIDC_RP_ENABLED`（灰度开关）。
- **机密客户端**：换码用 `client_secret_basic`（荐）或 `client_secret_post`；PKCE 仍强制（防授权码注入）。

### 2.2 app-bff 须实现的端点（5 个）

| 端点                       | 方法 | 职责                                                                                                                                                                                 |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/auth/login`              | GET  | 生成 `pkce(verifier,challenge=S256)` + `state` + `nonce`，存服务端（键含 `state`，TTL ~600s），`302` → IdP `/oidc/authorize`；支持 `returnTo`（白名单校验后回跳）                    |
| `/auth/callback`           | GET  | 按 `state` 取回并删 authreq → `POST /oidc/token`（服务端带 secret）换码 → **验 id_token（§2.5）** → 建 RP 会话 + 维护 `sid→rpsid` 索引 → set `__Host-vx_rp_session` → `302 returnTo` |
| `/auth/session`            | GET  | 读 cookie → 验/解 access_token（近过期静默刷新）→ 回前端 bootstrap 所需 claims                                                                                                       |
| `/auth/logout`             | POST | 本地销毁 RP 会话 + 清 cookie；`302 {issuer}/oidc/end_session?post_logout_redirect_uri=&state=` 触发全局登出                                                                          |
| `/auth/backchannel-logout` | POST | **IdP→RP 服务端**回调（不依赖浏览器 cookie，靠 `logout_token` 验真），按 `sid` 杀会话（§2.7）                                                                                        |

> 前 4 个是浏览器可达；`/auth/backchannel-logout` 仅供 IdP 服务端调用。console 另有 `/auth/switch-tenant`（POST，切租户，§2.8）——非通用端点，仅需要切组织租户的 app 实现。

### 2.3 登录时序

```
浏览器 ─GET /auth/login──────────────▶ app-bff
  app-bff: 生成 verifier/challenge(S256)、state、nonce
           存 vx:rp:{client_id}:authstate:{state} = {verifier, nonce, returnTo}  (TTL ~10min)
           302 → IdP /oidc/authorize?client_id&redirect_uri&scope&state&nonce
                                     &code_challenge&code_challenge_method=S256
  IdP: (有 vx_sid 则静默；否则 302 accounts /login) → 302 redirect_uri?code&state
浏览器 ─GET /auth/callback?code&state─▶ app-bff
  app-bff: getdel vx:rp:{client_id}:authstate:{state} → {verifier, nonce, returnTo}
           POST IdP /oidc/token (client_secret_basic, code, redirect_uri, code_verifier)
           验 id_token(§2.5) → 建 RP 会话(§2.4) → set __Host-vx_rp_session
           302 → returnTo(白名单校验)
```

**硬约束**：`/auth/login → /oidc/authorize` 必须**顶级整页导航**（`302` / `window.location`）；**绝不用 iframe / XHR 静默授权**（跨站 cookie 限制会使 `vx_sid` 不携带）。`POST /oidc/token` 服务端发起、带 client secret；成功返回 `{access_token(RS256 JWT), token_type:"Bearer", expires_in, refresh_token(已轮换), id_token(RS256 JWT), scope}`。

### 2.4 RP 会话运行时（BFF 持 token）

**浏览器只拿 RP 会话 cookie，绝不接触 OIDC token。**

- **RP 会话 cookie**：`__Host-vx_rp_session`（prod）/ `vx_rp_session`（dev http）。`__Host-` 前缀 → host-only + `Secure` + `Path=/`（天然按 app 隔离、无 `Domain`）；`HttpOnly` + `SameSite=Lax`（Lax 允许 RP↔IdP 顶级跳转携带）。值 = 随机 `rpsid`，opaque 会话指针。
- **Redis 会话**：`vx:rp:{client_id}:sess:{rpsid}` → JSON `{idToken, accessToken, refreshToken, accessExpiresAt, sid, sub, activeTenant}`，TTL 对齐 refresh 寿命（滑动续期）。
- **`sid` 反查索引**：`vx:rp:{client_id}:sididx:{sid}` → set(`rpsid`)，供 back-channel logout 按 IdP `sid` 找到并杀 RP 会话。
- **富 access_token 仅 BFF→后端 API 用**（`Authorization: Bearer`），不下发浏览器。
- **RP 会话 cookie 永不跨注册域共享**；跨域 app 不得期望读到 `vx_sid` 或任何 `.vxture.com` cookie。

### 2.5 回调与 token 校验（RP 必须强制）

对 **id_token / access_token / logout_token** 一律：

1. `alg` 必须 `RS256`；**显式拒 `none` / `HS*`**（防降级）。
2. header 须有 `kid` → 按 `kid` 从 `/oidc/jwks` 取公钥（**缓存**，未命中刷新一次再试）。
3. `iss === https://accounts.vxture.com`（`OIDC_ISSUER`）。
4. `aud === <自己的 client_id>`（平台逐 token 强制；RP 须再校验，防串味）。
5. `exp` 未过，容许 **60s 时钟偏移**。
6. id_token：`nonce` 必须等于本次请求发出并存储的值；`state` 命中 Redis（getdel 单用）否则拒（CSRF/重放）。
7. `returnTo` 必须过 origin/path 白名单（默认本 app 域，防开放重定向）。
8. **绝不信任**未验签 token 或浏览器侧传入的 claim。

### 2.6 每请求鉴权 → AuthUser

```
读 __Host-vx_rp_session → rpsid → 载 vx:rp:{client_id}:sess:{rpsid}
  无会话 → 401（XHR）/ 302 /auth/login（页面导航）
  accessExpiresAt 临近/过期 → 刷新（§2.9）
  验 access_token（JWKS 验签 + aud + exp，JWKS 已缓存，开销小）
  组装 AuthUser{ sub, userType, active_org, active_org_type, active_workspace, roles[], account_status }
  跑门控链：account_status==active（租户/组织 frozen→只读 的 claim 源见下 ⚠️）
注入 request 上下文（复用/扩展 @vxture/core-auth 的 AuthUser；OrgContext/WorkspaceContext 由 active_org / active_workspace 派生）
```

> **AuthUser claims 字段权威 = b（列/类型），语义与门控链 = a §8。** 本文只描述 RP 侧运行时装配。细粒度 console 权限仍回查 `iam.*`（不进 token）——`iam.*` 表结构字段权威 = b（iam schema），语义 = a §8；业务角色回查应用库。

**Token claims（权威 = 现网 IdP 代码 `bff/auth-bff/src/token/access-claims.ts`；本节以代码为终裁）**：

- **id_token**（exp ~300s，仅供 RP 建会话，不用于 API 鉴权）：`{iss, aud=<client_id>, sub:"usr_<uuid>", iat, exp, jti, sid, nonce?, auth_time, userType:"tenant_user"}`。
- **access_token**（tenant realm，exp = client TTL）：携带 `iss` / `aud` / `sub:"usr_<uuid>"` / `iat` / `exp` / `jti` / `scope` / `sid` / `userType` + `account_status` + 组织/空间上下文（`active_org` / `active_org_type`〔`personal`\|`organization`〕/ `active_org_name` / `active_workspace` / `active_workspace_name`）+ 治理角色 `roles[]`（见下）。

> ⚠️ **命名 cutover 已完成（`access-claims.ts` + `oidc.service.ts` 租户实发路径）**：租户上下文 claim 已从 `active_tenant*` 系列**迁为** `active_org` / `active_workspace`;`active_tenant*` 与 `tenants[]` **不再下发**(唯一实发路径 `oidc.service.ts` §tenant realm 只发上列 claim + 人类身份 claim)。新接入 app 一律按 `active_org` / `active_workspace` 编码,不得再读 `active_tenant*`。业务授权由 app 自有库按 `(active_org, sub)` 解析。`sub` 恒 `usr_` 前缀,业务库引用存完整 `sub`。
> ⚠️ **entitlement 不进标准 claim 集(D12)**:token **不带**权益/订阅事实;仅遗留的 scope 门控机制(`appScope.resolveClaims`)在 client 显式请求订阅 scope 时才释放订阅 claim——**post-D12 新产品不请求该 scope、必须改走 C2 `GET /platform/entitlements`**,不得依赖 token 里的 entitlement(access-claims.ts 头注“NO business entitlement”)。
> ⚠️ **cutover 连带的三个缺口(待平台线收口)**:① 旧 `active_tenant_status`(frozen→只读)门控失去 token 源——current claim 不带组织/空间冻结态,frozen 只读如何强制须确认(补 `active_org_status` claim 或服务端回查);② §2.8 切租户预检 `tenantId ∈ tenants[]` 失去 token 源(tenants[] 已不发)——须改由 app-bff 服务端回查成员关系;③ 平台自有 RP 客户端 `@vxture/core-oidc-rp`(`packages/core/oidc-rp/src/claims.ts`)仍按 `active_tenant` 翻译,消费侧滞后,须随此 cutover 同步。

**`roles[]` claim 格式（权威;新接入 app 必须按此解析,防越权门控失效）**：

- 形态 = **scope 前缀字符串数组**,例 `["org:owner","workspace:owner"]`（access-claims.ts:`roles: string[]`,scope-prefixed）。**不是**裸角色码、**不是**标量。
- 值域 = 每 scope 五个治理角色码 `owner` / `manager` / `member` / `readonly` / `guest`（`data_identity_200_schema.md` §6.4 seed,`seed-catalog.mjs`;**无 `admin` 码**——平台从不签发 `admin`）。
- 消费方**必须**剥 scope 前缀再判定,**禁止**拿裸 `owner`/`admin` 直接比对（会把 `org:owner`/`workspace:owner` 判为不匹配、把 `manager` 判为非管理员,导致管理面越权门控失效——`vxture-arda` `entitlement/roles.ts` 现存此 bug）。
- "可管理本组织/空间"的判定 = role ∈ `{org:owner, workspace:owner, workspace:manager}`（owner 全授、manager 管成员/角色/设置不含账单,§6.4 能力姿态）。`member`/`readonly`/`guest` 无治理权限。
- 三轴分离铁律:治理角色（本 claim,不入产品库）⊥ 产品功能角色（产品自库按 `(active_workspace, sub)` 解析）⊥ 订阅 tier（C2 拉取）。
- **`workspace:owner` = 全订阅产品的 owner 基线**:持 `workspace:owner` 者在该 workspace 订阅的**每个产品**里天然有 owner/超管基线(产品鉴权 = `isWorkspaceOwner(token) || 产品自库授权`),**首登即超管**,解产品初始化"谁是第一个管理员"的 bootstrap 问题(scope 对齐:订阅是 workspace 级)。`workspace:manager` 是否给产品 admin 基线由产品自定,标准不强制。此桥不破上条三轴正交(仅 owner 短路满权)。

### 2.7 back-channel logout 接收

全局登出销毁 `.vxture.com` 的 `vx_sid`，**无法**清掉 app 域 host-only 的 RP 会话 cookie——唯一途径是 IdP 服务端 → app 服务端的 back-channel logout（跨域**唯一**手段；子域另有父域 cookie 失效兜底但**仍建议实现**）。

IdP 发 `POST {back_channel_logout_uri}`，`application/x-www-form-urlencoded`，body `logout_token=<RS256 JWT>`，claims：`{iss, aud=<client_id>, sub, iat, exp(~120s), jti, sid, events:{"http://schemas.openid.net/event/backchannel-logout":{}}}`。app 须：① 验 `logout_token`（§2.5 全套 + 校验 `events` 含 backchannel-logout 且含 `sid`，**禁含 `nonce`**）；② 用建会话时维护的 `vx:rp:{client_id}:sididx:{sid}` 找到该 `sid` 全部 RP 会话 → 逐一销毁；③ 回 `200`（best-effort）。

### 2.8 切租户（仅 console / 需切组织租户的 app）

```
前端 ─POST /auth/switch-tenant {tenantId}──▶ app-bff
  预检：app-bff 服务端回查该 user 的成员关系（tenantId 须在其可访问 org 内,否则 403;tenants[] 已不进 token,见 §2.11 ⚠️）
  302 IdP /oidc/authorize?prompt=none&tenant_hint={tenantId}
  IdP 更新 (sid, client_id)→tenantId → 静默发码 → /auth/callback → 新会话(新 active_org)
  前端 reload
```

- **作用域按应用**：IdP 只改 `(sid, client_id)` 的 active_org，不波及其它 app（如 console 切租户不影响 ruyin / website）。
- website 无切租户（恒个人或单一上下文）；xuanzhen 有（组织租户）；ruyin 恒个人无切。

### 2.9 静默续期与降级

- **access 近过期**（剩 ≤60s）→ app-bff 后台调 IdP `/oidc/token` `grant_type=refresh_token`（存储的 refresh）→ 成功则更新存储（**轮换**：新 refresh 落库、旧失效），`rpsid` cookie 不变。
- **refresh 失败**（`invalid_grant`：过期/被吊销/重放）→ RP 会话失效。页面导航场景 `302 IdP /oidc/authorize?prompt=none`（IdP 有 `vx_sid` → 静默发码 → callback → 新会话；返回 `login_required` → 全量登录）；XHR 场景**不**静默跳转，返回 401，前端据此触发 `/auth/login`（页面级）。
- **重放检测**：重复用已消费 refresh → IdP 吊销整个 family 回 `400 invalid_grant`；app 应销毁本地会话并转重登。
- **降级**：Redis 不可用 → RP 会话读 fail-closed（与 ADR-001 refresh fail-closed 一致）。

### 2.10 跨子域静默 SSO（模式 A）

- app-1 登录 → IdP 设 `vx_sid`（`.vxture.com`）。
- 访问 app-2 → app-2-bff `/auth/login` → IdP `/oidc/authorize`（顶级跳转、浏览器对 accounts 带 `vx_sid`）→ **静默发码** → app-2 建**自己的** RP 会话 + **自己的** token。无需再登录。
- 每个 RP 各自 RP 会话 + 各自 token（`aud` 各异）；**唯一共享的是 IdP `vx_sid`**——这就是 SSO 的来源，不靠共享 app cookie。

### 2.11 配置 / 环境变量（app-bff）

| 变量                                    | 说明                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `OIDC_ISSUER`                           | `https://accounts.vxture.com`（dev `http://localhost:3081`）                   |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | 平台登记派发（secret 经 secret manager，不入库不入前端）                       |
| `OIDC_REDIRECT_URI`                     | app 的 `/auth/callback`（须 = 登记白名单）                                     |
| `OIDC_SCOPES`                           | 如 `openid profile ruyin`                                                      |
| `OIDC_POST_LOGOUT_REDIRECT_URI`         | end_session 回跳（dev 跨端口须显式设；prod issuer==accounts 默认即 `/logout`） |
| `OIDC_RP_ENABLED`                       | 灰度开关（`on`→OIDC RP 路径；`off`→旧路径回退，过渡期双读，退役旧路径放 P5）   |
| `RP_SESSION_TTL`                        | RP 会话 / Redis TTL（建议 ≤ refresh TTL）                                      |

> 生产 `redirect_uris` 等由对应 `*_BASE_URL` env 派生，须与平台登记值一致。现网 console/website 存量迁移期以 `OIDC_RP_ENABLED` 双读并存（新 `__Host-vx_rp_session` 优先、回落旧 `vx_tenant_*`），可秒回退。

---

## 3. 客户端注册（`iam.oidc_client` 接入方语义子集）

app 接入须由平台登记一行 `iam.oidc_client`。**完整字段级定义（列 / 类型 / 索引 / 约束）= b §5.3，为唯一权威**；下表仅为**接入方需关心的语义子集**，不重述平台建表 DDL：

| 列（接入方视角）              | 语义                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `client_id`                   | 唯一标识（= token `aud`、authorize `client_id`）                                 |
| `client_secret_hash`          | 明文 secret 经 secret manager 派发给 app，**不入库 / 不入代码库**；平台仅存 hash |
| `realm`                       | `tenant`（业务应用；`admin` → `workforce`，平台 realm 口径见 b §5.3）            |
| `redirect_uris[]`             | 精确白名单，如 `https://ruyin.ai/auth/callback`                                  |
| `post_logout_redirect_uris[]` | `end_session` 回跳白名单                                                         |
| `back_channel_logout_uri`     | app 的 back-channel 接收端点（跨域**必填**；子域建议填）                         |
| `allowed_scopes[]`            | 如 `["openid","profile","<app>"]`                                                |
| `product_ref`                 | 可空；置则驱动 `entitlement` claim〔邻域 commerce〕（起步期可不置，见 §5）       |
| `display_name` / `logo_url`   | 登录页 / 统一登出页品牌展示                                                      |

> 登记方式：平台在 seed catalog 的 oidc_client 列表加该 client（现有 website / console / admin），secret hash 经部署期 `27-provision-client-secrets` 注入；生产 `redirect_uris` 等由对应 `*_BASE_URL` env 派生，须与登记值一致。字段级 DDL / 列 / 索引 / `@@map` / `@@schema` / 初始 seed → **b §5.3** / 落地增量迁移见 [`identity-platform-implementation.md`](./120-implementation.md)。

---

## 4. business-app 接收契约（幂等 + 有序）

面向 xuanzhen（玄阵）/ hermes 等绿地 business app（外部仓库）团队：它们除标准 OIDC RP 接入（§2，子域、共享 `vx_sid` 静默 SSO）外，额外接收平台 **provisioning webhook**（`tenant.provisioned` / `tenant.deprovisioned`）以初始化/停用业务空间。

> **两概念正交**：**entitlement**（能不能用，token 携带、每请求门控，实时）≠ **provisioning**（业务空间建没建好，webhook，最终一致）。app 即便已 `provisioned`，每请求**仍按 `access_token.entitlement.status` 门控**（`active`/`trial`→放行；`past_due`→宽限只读；`expired`/`canceled`/缺失→跳订阅页）；webhook 只管业务空间生命周期，不作实时门控。两者互不替代。〔entitlement / provisioning 均属**邻域 commerce**，identity 板块不拥有——见 §5。〕

**app 侧接收端点** `POST /provisioning/webhook`，处理顺序（**app 必须实现幂等 + 有序**）：

1. **验签**（先于一切）：取原始 body 字节 + `X-Vxture-Signature` 的 `t`、`v1`；用 app secret 重算 `v1' = hex(HMAC_SHA256(secret, "{t}.{raw_body}"))`，**常量时间**比对 `v1' == v1`；校验 `t` 在容忍窗 **±5min** 内（防重放）；任一不符 → **401**。轮换期平台可能用新/旧两 secret 之一签名，app 应**对两 secret 各验一次**，任一通过即接受（见 §5）。
2. **幂等**：按 `id`（= `X-Vxture-Delivery`）查本地已处理表，命中 → **直接 200**（at-least-once 下重复投递必然发生，副作用不可重复执行）。
3. **有序**：维护 per `(tenant_id, application)` 已处理最大 `seq`；`payload.seq <= 已处理max` → **忽略但回 200**（陈旧/乱序）。
4. **执行**：`tenant.provisioned` → 初始化业务空间 + 默认业务角色（**可重入**，已初始化则跳过副作用）；`tenant.deprovisioned` → 降级只读 / 归档（**不硬删**，保留数据以便复订）；记录 `delivery_id` 已处理 + 更新 max `seq`（建议与执行同事务）。
5. **响应**：成功 **2xx**（平台据此标 `delivered`）；任何 5xx/超时 → 平台重试。

> **责任红线**：平台只保证 at-least-once 送达；**重复投递、乱序到达必然发生**，app 不实现步骤 2/3 会导致重复初始化 / 数据错乱；业务空间初始化必须可重入。app 侧另一 provisioning 环境变量：`PROVISION_WEBHOOK_SECRET`（+ 轮换时 `_NEXT`），经 secret manager，与平台登记的 `webhook_secret_ref` 同值。

---

## 5. provisioning 投递器〔邻域 commerce，2026-07-07 已上生产〕

> **provisioning（开通 webhook）/ 开通编排 / entitlement 均属邻域 commerce，identity 板块不拥有商业逻辑**（entitlement SoT + 投递器实现归 commerce）。原"起步期 OUT（parked，#264）"已销——**2026-07-07 全链上生产**（[`product_310_arda-integration.md`](../product_310_arda-integration.md) P2.3/P2.3b，Arda 首个消费方）。字段级权威 = [`data_commerce_220_provisioning.md`](../data_commerce_220_provisioning.md)；本节保留 **wire 契约**供产品团队实现消费端。
> **粒度演进（2026-07-07 本次修正）**：本节早期按 `(tenant, app)` 记录；实现粒度 = **`(workspace, product)`**（与 ADR-11 entitlement 粒度对齐），旧表名 `commerce.tenant_app_provisioning`/`app_webhook_delivery` 已随 commerce 域拆分改名 `provisioning.provisionings`/`webhook_deliveries`，payload 增带 `workspace_id`。

**触发**（订阅生命周期 → 事件，`SubscriptionService` 域层接线，按 plan_component **逐产品扇出**）：

| commerce 事件                                                                                            | provisioning 动作                                                 |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 订阅生效（`active`/`trialing`）                                                                          | `provisionings` upsert、`version++`；enqueue `tenant.provisioned` |
| 订阅失效（`cancelled`/`expired`）且该 `(workspace, product)` 无其他有效订阅覆盖（ADR-11 §11.4 逐笔退出） | `version++`；enqueue `tenant.deprovisioned`                       |
| 重新订阅                                                                                                 | `version++`；再 `tenant.provisioned`（复用同一状态行）            |
| `paused`                                                                                                 | **不投递**——业务空间保留，但不计入订阅覆盖                        |

**状态机**（`provisioning.provisionings`，`status ∈ {pending, provisioned, deprovisioned}`；`version` 每次变更自增 → payload `seq`）：

```
        tenant.provisioned                 tenant.deprovisioned
pending ──────────────────▶ provisioned ──────────────────▶ deprovisioned
   ▲                             │                                 │
   └─────────────────────────────┴───────── 重新订阅(version++) ───┘
```

**投递器**（现实现 = admin-bff `ProvisioningDispatchJob`，`PROVISION_DISPATCH_INTERVAL_MS` 默认 10s tick）：领取 `webhook_deliveries` 中 `status IN ('pending','failed') AND next_retry_at<=now()`，按 `created_at` 升序；**租约防重复**（多实例）`UPDATE ... SET status='delivering', leased_by/leased_until ... FOR UPDATE SKIP LOCKED`，仅抢到的实例投递；投递 2xx → `delivered`，否则 `attempts++`、指数退避 `next_retry_at`、回 `failed`（可重试态）；`attempts>=max_attempts`（默认 8）→ `status='dead'`（死信，告警/人工补投）；`leased_until` 过期未完成的 `delivering` 行可被其他实例接管（防实例崩溃卡单）。

**投递契约（平台 → app）**：

```
POST {product.product_webhooks.webhook_url}   # 如 https://arda.vxture.com/provisioning/webhook
Content-Type: application/json
X-Vxture-Event: tenant.provisioned        # | tenant.deprovisioned
X-Vxture-Delivery: <delivery_id>          # 幂等键，= payload.id
X-Vxture-Signature: t=<unix_ts>,v1=<hex>  # v1 = hex(HMAC_SHA256(secret, "{t}.{raw_body}"))
```

```json
{
  "id": "<delivery_id>", // 幂等键（= X-Vxture-Delivery）
  "type": "tenant.provisioned", // | tenant.deprovisioned
  "occurred_at": 1718000000, // epoch 秒
  "seq": 7, // = provisionings.version，per (workspace, product) 单调
  "workspace_id": "<workspace_uuid>", // 开通主体（真实主体，2026-07 粒度修正）
  "tenant_id": "<tenant_uuid>", // rollup 反查
  "application": "arda", // = product.products.product_code
  "plan": "arda-free", // plan_code；provisioned 带，deprovisioned 可空
  "data": {} // 扩展位（当前空，向后兼容预留）
}
```

- **签名**（Stripe 风格，防重放）：`signed_payload = "{t}.{raw_request_body}"`（`raw_request_body` = **原始字节**，不可重序列化）；`secret` = `product.product_webhooks.webhook_secret_ref` 指向的 secret 值（现实现 = 宿主 env 名，如 arda 的 `ARDA_PROVISION_WEBHOOK_SECRET`；每产品独立）。双 secret 重叠轮换为目标态约定（现实现单 secret），产品端验签实现宜 day-one 支持对多 secret 各验一次。
- **平台投递行为（产品端可预期）**：重试指数退避，`attempts>=max_attempts`（默认 8）→ 死信 `dead` + 告警/人工补投；多实例经 DB 租约防重复投递（网络层重复仍可能，**产品端必须幂等**）；按 `created_at` 升序投递但重试/网络会致乱序，产品端靠 `seq` 单调忽略陈旧、**不得依赖到达顺序**。

> 涉及的平台 schema 字段（`product.product_webhooks.webhook_url` / `webhook_secret_ref`、`provisioning.provisionings.version`、`provisioning.webhook_deliveries.leased_until` 等）均属**平台数据模型 provisioning/product 域**——字段级权威 = [`data_commerce_220_provisioning.md`](../data_commerce_220_provisioning.md)，本节旧引用（`product.application.*`/`commerce.tenant_app_*`）为迁移前名。产品登记：把 `webhook_url` 与 `webhook_secret_ref`（env 名，secret 值经 owner 手动派发）经 seed 提交平台（arda 已于 P2.3 登记）。

---

## 6. ruyin 跨域（仅指针）

ruyin.ai 是**首个跨域应用**（模式 B）：`client_id=ruyin`、`realm=tenant`、`redirect_uri=https://ruyin.ai/auth/callback`、`back_channel_logout_uri=https://ruyin.ai/auth/backchannel-logout`（跨域**必填**，父域清不掉 ruyin host-only cookie）、`allowed_scopes=openid profile ruyin`、`product_ref` 起步期不置（不发 entitlement，ruyin 自有业务授权）。RP 机制严格照本文 §2（PKCE S256 / RS256-only 验签 / id·access claim / refresh 轮换 / `__Host-vx_rp_session` / back-channel）。

> ⚠️ **ruyin 契约保持独立、不并入本文**（外部依赖，`ruyin.ai` 在 umbra / worker-04，跨仓）——详见独立契约 [`identity-platform-ruyin-contract.md`](./140-ruyin-contract.md)。跨域接入拓扑（SSO / SLO / 跨域）另见 [`identity-platform-access-topology.md`](./110-access-topology.md)。本文仅作指针。

---

## 7. 验收与边界

**验收（RP 接入通用）**：

- [ ] 已在 vxture 登录 → 顶级访问 app **免再登录**（模式 A 共享 `vx_sid` 静默 / 模式 B 顶级跳转静默发码）。
- [ ] 篡改 id/access/logout_token → app **拒**（RS256 / `iss` / `aud` / `exp` / `nonce`）；`state` 重放被拒；非白名单 `returnTo` / `redirect_uri` → 400 不重定向。
- [ ] 浏览器**零 OIDC token**，仅 `__Host-vx_rp_session`（DevTools 核验）。
- [ ] access 过期 → 静默 refresh；refresh 过期 → `prompt=none` 重授权；IdP 无会话 → 全量登录。
- [ ] refresh 轮换：旧 refresh 重放被拒（family 吊销）。
- [ ] 切租户（console/xuanzhen）：`prompt=none` + `tenant_hint` 静默换发新 `active_org`，**不影响**其它 app。
- [ ] 全局登出 → app 经 **back-channel** 会话被杀，下次请求重登；非顶级（iframe）静默授权**不被依赖**。

**验收（business-app provisioning，起步期按需）**：

- [ ] 开通 app → 收 `tenant.provisioned`（验签通过）→ 初始化业务空间 + 默认角色；同一 `delivery_id` 重复投递只初始化一次；乱序旧 `seq` 被忽略。
- [ ] entitlement 失效 → 收 `tenant.deprovisioned` → 降级只读（不硬删）；`past_due` **不**触发停用。
- [ ] 门控正交：已 `provisioned` 但 entitlement `expired` → 每请求仍拒（跳订阅）。
- [ ] 签名安全：错误签名 / 超 ±5min 时间窗 → app 拒（401）；app 暂时 5xx → 平台重投最终 delivered，持续失败 → `failed` + 告警。

**边界（起步期，避免过度）**：

- **Provisioning / entitlement / 开通编排 = 邻域 commerce**（§5）：业务授权走 app 自有库（按 `(active_org, sub)`）;entitlement 门控走 **C2 `GET /platform/entitlements`**（D12 后不进 token,见 §2.11 ⚠️）;provisioning 走 webhook 投递闭环。
- **ruyin 契约独立**（§6，外部依赖，不并入）。
- **跨域 SLO 可配置**：是否参与全域 back-channel logout 可逐 app 配置；ruyin 默认参与。
- 不在本文内：operator 接入（运营后台 admin，`workforce` realm，另案）、社交联邦（IdP 内部，见 [`identity-platform-idp.md`](./070-idp.md) §7 + [`identity-platform-account.md`](./050-account.md)）、MFA（高权限入口，另案）。
