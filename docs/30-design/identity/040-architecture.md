# Identity 平台架构（identity 板块 · 架构层）

> 🧭 **本文 = identity 板块的架构层**（C4 Context / Container 级）：只讲 **what / why / how-it-fits + 边界 + 指路**，**不含字段级 DDL / 列清单 / 端点报文**。字段级看数据权威，机制看详细层，落地看实施衔接层。
> 与 [`data_platform_100_architecture.md`](../data_platform_100_architecture.md)（数据板块）的 **a/b/c 三层同构**对齐：架构层（本文）/ 详细层（机制文档）/ 实施衔接层（迁移·rollout）。
> 版本：v1.0（2026-07-01）。状态：架构基线（statement-of-record），统摄既有已上线体系。

## 三层路由（先定位再深入）

| 层             | 定位                                     | 归属文档        |
| -------------- | ---------------------------------------- | --------------- |
| **架构层**     | 板块定位 / 身份模型 / 拓扑 / 边界 / 指路 | **本文**        |
| **详细层**     | 机制字段级：端点 / 报文 / 状态机 / claim | §9 机制文档清单 |
| **实施衔接层** | 迁移差量 / Batch 进度 / 部署 runbook     | §9 实施清单     |

- **上级（概念父文档）**：[`control-plane.md`](../platform/10-control-plane.md) —— identity 是「平台控制面 = 全平台唯一真相源」中的**身份与访问**子域。
- **数据权威（本文只引用、绝不重述字段）**：
  - **a** = [`data_platform_100_architecture.md`](../data_platform_100_architecture.md)：架构级 —— §3.4 各域概览、**§4 identity**、**§5 iam**、§6 成长子域、§14 operator/admin 概览。
  - **b** = [`data_platform_200_schema.md`](../data_platform_200_schema.md)：字段级 —— **§4 identity 全表 DDL**、**§4.18 双 realm 隔离边界**、**§5 iam（role/permission/oidc_client/signing_key）**、**§14 admin.operator\_\***。
  - **c**（落地/迁移）= [`data_platform_300_migration.md`](../data_platform_300_migration.md)。
- **铁律**：任何"表长啥样 / 列叫什么 / claim 报文结构"一律回指 a/b 或对应机制文档，本文**不复制**。

---

## 1. 板块定位与边界

**一句话**：identity 板块是全平台**唯一身份真相源 + 唯一 OIDC IdP**——以 `accounts.vxture.com` 居中，用授权码 + PKCE(S256) + RS256 给**所有应用**（含平台自有 console/admin/website 与外部业务 ruyin 等）发 token；持**双 realm 严格隔离**；身份与业务解耦（token 只带治理上下文，业务权益/配额下沉 commerce）。

### 1.1 统摄双 realm（owner 决策）

本板块**同时统摄两套身份 realm**，二者**共享同一套 IdP / RBAC 机制 / SSO·SLO 拓扑**，但账号体系**物理硬隔离**（详见 §2.2）：

| realm                          | 归属主体            | 数据域（权威）                    | 入口                          | 说明                                 |
| ------------------------------ | ------------------- | --------------------------------- | ----------------------------- | ------------------------------------ |
| **customer**（原 `tenant`）    | 终端客户 / 租户用户 | `identity.*`（a§4 / b§4）         | website / console / ruyin / … | PLG 自助注册、全员租户化、手机强锚点 |
| **workforce**（原 `operator`） | 平台运营 / 管理员   | `admin.operator_*`（a§14 / b§14） | y.vxture.com                  | 无自助注册、MFA 强制、控制面身份     |

> 术语对齐（分类）：**仅 realm 取值改名** `tenant→customer` / `operator→workforce`（数据权威 a/b 已收敛，本文以新名为主、括注旧名）；**cookie 名** `vx_sid`/`vx_sid_op` 与 **`sub` 前缀** `usr_`/`opr_` **未改名、仍是现行权威标识**（topology §1、b§4.18/§14）；**claim `active_tenant*`** 属**过渡态、正随契约 v2 退役**。

### 1.2 范围（IN）

身份认证（AuthN）、单点登录/登出（SSO/SLO）、身份模型（org/租户/空间/成员/用户）、两级治理 RBAC、OIDC IdP 契约与密钥、RP 接入标准、上游社交联邦 broker、workforce/operator 身份安全（MFA）。

### 1.3 明确 OUT（交由邻域，本文只引边界）

- **业务权益 / 订阅 / 配额 / 计费**（entitlement/quota）→ **commerce**（b§8/§9），**不进 token**，按请求实时回查。
- **产品目录 / plan / product_ref 语义** → **product**（b§7）；身份层只消费 `oidc_client.product_id` 这一映射键。
- **业务对象授权**（阵法师/审核员等业务角色）→ 各业务应用**自有库**，平台 IdP 不拥有。
- **provisioning 开通编排 / webhook 投递** → commerce（b§10），起步期 parked（见 §6.3）。
- **成长面**（等级/积分/KYC）→ identity 成长子域（a§6/b§6），仅 customer realm，与身份认证解耦。

---

## 2. 身份模型（Container 级）

### 2.1 四层稳定模型

```
User ──┬── Tenant Membership ─────► Tenant (type=personal | organization, owner_user_id)
       │                                  │ 1:N
       └── Workspace Membership ────► Workspace (tenant_id, is_default)
```

- **全员租户化**：任何用户必关联租户；个人 = `type=personal`（注册即建 1 default workspace + 1 条 `role=owner` membership），组织 = `type=organization`。
- **两级成员**：Tenant Membership（`role.scope=org`）+ Workspace Membership（`role.scope=workspace`），角色 code 引用 iam 全局目录、**不建跨 schema FK**。
- **强锚点**：`phone` 全局 UNIQUE 且已验证（登录即注册以手机为并号锚点，**不按 email 自动并号**）；`email` 可空/可未验证。
- **业务库只持指针**：ruyin/xuanzhen 等业务库仅存 `user_id`(=`sub`) / `tenant_id` 外键引用，不复制平台主数据、无账号表。
- **字段级不在此重述** —— 表清单/列/约束/不变量见 **a§3.4·§4** + **b§4**（`users`/`user_profile`/`tenant`/`tenant_membership`/`workspaces`/`workspace_memberships`/`invitation` 等）。

### 2.2 双 realm 硬隔离（架构红线）

customer（`identity.*`）与 workforce（`admin.operator_*`）是两套**完全独立**账号：不同 schema、不同 RBAC（iam vs admin operator\_\*）、无外键、无交叉、无 SSO 串味；同一邮箱可两边各存互不相干。三重结构性拦截：

1. **realm**：由 `oidc_client.realm` 决定认证哪套账号库。
2. **`sub` 命名空间**：`usr_` vs `opr_`，物理不可混。
3. **`aud` 单值 + `userType`**：operator token（`aud=admin`/`userType=operator`）拿到任何 customer RP 校验**结构性被拒**，反之亦然。

> 隔离不变量（零 FK、会话/刷新/验证码不得跨 schema 泄漏）字段级见 **b§4.18**（identity 侧）+ **b§14**（operator 侧）；红线概述见 [`identity-platform-operator.md`](./090-operator.md) §1。

---

## 3. 访问与会话拓扑

**北极星**：身份 / SSO / SLO 全部经 IdP（`accounts.vxture.com`）居中；**SSO = 顶级重定向到 IdP**（`SameSite=Lax` 中央会话 cookie 随顶级导航携带），**SLO = IdP 服务端 back-channel logout**；RP 会话 cookie 永远只留各自域内，从不跨注册域共享。

```
                    上游社交 IdP（入站 broker）
                     飞书 / 钉钉 / Google
                            │ OIDC / OAuth（平台作 RP）
                            ▼
   ┌─────────────────────────────────────────────────────┐
   │        accounts.vxture.com  ——  唯一 OIDC IdP          │
   │  /login(realm 驱动) · /oidc/* · /jwks · back-channel   │
   │        RS256 · PKCE(S256) · 双 realm 中央会话           │
   └───────┬───────────────────────────────────┬───────────┘
    vx_sid │ (.vxture.com, customer)   vx_sid_op │ (host-only, workforce)
           ▼                                     ▼
   ┌───────────────────────────────┐     ┌───────────────┐
   │ website   console    ruyin.ai │     │ admin.vxture  │
   │ (子域RP) (子域RP)  (跨域RP,模式B)│     │ (operator RP) │
   └───────────────────────────────┘     └───────────────┘
   每 RP：vx_rp_session（host-only · opaque · token 留 BFF 服务端）
   ── customer realm ──────────────┘     └── workforce realm ──
```

（C4 Context/Container：IdP 居中，上游 broker 入站，下游 RP 按 realm 两列；会话作用域标注见上。）

- **三类 cookie**：`vx_sid`（customer 中央会话，`.vxture.com`）/ `vx_sid_op`（workforce 中央会话，**host-only 于 accounts，绝不外溢**）/ `vx_rp_session`（各 RP 域内 host-only，opaque，token 留服务端）。
- **两种部署模式，同一机制**：模式 A 跨子域（`*.vxture.com`，靠父域 cookie 天然 SSO）；模式 B 跨域（如 `ruyin.ai`，靠"重定向落到 IdP 域时 IdP 第一方 cookie 生效"，**back-channel logout 必填**）。
- **禁用**：iframe 静默 SSO（check_session）与 front-channel logout —— Safari ITP / 第三方 cookie 弃用会使其失效。
- **每接一个新业务** = 注册一个 `oidc_client` + 该业务 BFF 做 RP（含 back-channel 接收）+ 域内 portal↔BFF 同源反代，**IdP 侧零改动**。

> cookie/SSO/SLO/同源反代/operator 登录接线的**权威细节** = [`identity-platform-access-topology.md`](./110-access-topology.md)（含决策 D-AT 逐子域反代 / D-AU 统一 post-logout 品牌页 / D-AW 跨域 SLO 可配置）。

---

## 4. 认证与联邦（IdP / OIDC 概览）

- **IdP 定位**：`accounts.vxture.com` 是**唯一公开身份域**，同时承载登录/账号 UI（`/login`，realm 驱动）与反代到内部认证服务的 OIDC 协议端点（`/oidc/*`·`/.well-known/*`）；`OIDC_ISSUER = https://accounts.vxture.com`，认证服务无公开主机名 → 登录页与端点同源、免 CORS。
- **协议基线**：授权码 + **PKCE S256 强制**；**RS256** 签名 + JWKS 公钥发布 + `kid` 轮换（私钥绝不出 IdP、绝不落库）；`aud` 单值裁剪（一个 token 只服务一个应用）；refresh = **opaque + 服务端存储 + 用后轮换 + 重放检测（reuse → 吊销 family）**。
- **端点面**：`/authorize`·`/token`·`/userinfo`·`/jwks`·`/revoke`·`/end_session`·`/.well-known/openid-configuration`（+ back-channel logout 广告）。
- **登录手段（在 IdP 登录页内完成，应用不实现登录）**：手机验证码（强锚点，登录即注册）/ 密码（Argon2id）/ 社交登录（brokered）；**验证码优先、密码次之**。运营面仅密码 + MFA + Turnstile，无自助注册。
- **社交联邦 = 入站 broker**：平台作为 RP 去对接**上游** IdP（飞书/钉钉/Google），绑定到平台账号；业务应用只认平台 token、从不直接对接第三方。上游 broker 配置（`identity.oauth_provider`，入站）与 `iam.oidc_client`（出站发 token）**方向相反、不可复用同一张表**。上游未返回手机 → 进绑手机流程。
- **BFF token 持有**：token（id/access/refresh）只在 RP-BFF 服务端，浏览器仅持 opaque RP 会话 cookie，富 access_token 只用于 BFF→后端 API、绝不下发浏览器。

> 机制权威：IdP 机制（门面拓扑 + issuer 收敛 + 端点/密钥/会话/refresh）= [`identity-platform-idp.md`](./070-idp.md)；账号与认证（三层标识/验证码登录/社交 broker/账号合并/邮箱两态/头像）= [`identity-platform-account.md`](./050-account.md)。token claims/DB 来源速查见 a/b + `identity-platform-idp.md` §6。

---

## 5. 授权：两级 RBAC + 治理

- **两级治理 RBAC**：`iam.role.scope = org | workspace`（全局角色目录，非 per-tenant）+ `permission` + `role_permission`；成员表按 `role.code` 内联引用。**只表达"谁能管组织/空间/计费"**，不含业务授权。
- **什么进 token / 什么回查**：token 只放**粗粒度治理角色** + 账号/租户上下文；**细粒度权限**（菜单/按钮/API code）由 BFF 用 `(tenant, sub)` 回查 iam、可缓存；**业务角色**回查应用自有库；**运营权限**回查 `admin.operator_*`。
- **执行层**：每个 BFF 两级守卫 —— ① 身份类型守卫（`userType` 校验）；② 路由级 `@RequirePermission` 装饰器；console/业务 BFF 强制 `tenantId` 只从 token 取、查询必带租户过滤。
- **entitlement/capability 已退役出 iam**：SoT 归 commerce(b§8)/product(b§7)，access token **不含业务权益**（AuthN ⟂ AuthZ 分离）。

> RBAC 跨包协作/执行规范 = [`identity-platform-authorization.md`](./060-authorization.md)；iam 表（role/permission/role_permission/oidc_client/signing_key）字段级 = **b§5**；operator 侧 `admin.operator_role*` 与 iam **零交叉** = b§14。

---

## 6. Provisioning 与外部接入

### 6.1 一种机制，两种模式

所有应用都是 IdP 的 **OIDC 授权码 + PKCE RP**，接口完全一致；跨域（模式 B）只多两条硬约束：**必须实现 back-channel logout** + **绝不尝试 cookie/iframe 静默授权**。RP 须实现 5 端点：`/auth/login`·`/auth/callback`·会话 bootstrap·`/auth/logout`·`/auth/backchannel-logout`；须强制 token 校验（RS256/iss/aud/exp/nonce，拒 none/HS）。可复用 `@vxture/core-oidc-rp`。

### 6.2 客户端注册

接入 = 平台登记一行 `iam.oidc_client`（回调白名单、realm、SLO 参与、品牌等接入语义）。**完整字段级列定义 = b§5.3**；接入方只需关心语义子集（见接入标准）。

### 6.3 边界（起步期）

- **provisioning（开通 webhook）= OUT**：属 commerce，当前 parked；需业务空间开通编排时再落地。
- **entitlement 起步期不依赖**：commerce 未上线，App 不置 `product_id`、业务授权走自有库；商业化后再启用 token 硬门控（或改实时回查端点）。

> RP 接入（标准 + 集成模板 + business-app 契约 + provisioning）= [`identity-platform-rp-integration.md`](./080-rp-integration.md)；首个跨域应用契约（独立）= [`identity-platform-ruyin-contract.md`](./140-ruyin-contract.md)；per-app 订阅/EntitlementProvider〔邻域 commerce〕= [`commerce-app-subscription.md`](../commerce/20-app-subscription.md)。

---

## 7. Workforce realm（operator 身份安全）

- **独立控制面身份域**：schema / 表 / 账号 / 生命周期 / RBAC 五维隔离；不反转 OIDC 架构（admin-bff 作 OIDC RP、`vx_sid_op` host-only、`admin.operator_*` 两级 RBAC 全保留）。
- **安全增量**：MFA 策略引擎（Disabled/Optional/Required，取最严）+ 默认 **TOTP** + 高权限强制 **WebAuthn/Passkey** + 恢复码兜底；两步登录状态机（首因子 → MFA verify）；短会话 + 高危 step-up 重认证；`amr`/`acr` 记录；独立 operator 审计 + 异常检测。
- **刻意取舍**：不采用 mTLS/Cf-Access 作登录层、不用短信作唯一 MFA、不联邦第三方 IdP（operator 身份只留 vxture）；补偿控制见 §2.4 of 专项。
- **凭据**：密码 Argon2id、TOTP secret 加密落库、恢复码单次哈希。

> 权威设计 = [`identity-platform-operator.md`](./090-operator.md)；operator 身份域全表（account/credential/mfa/webauthn/recovery/verification/login_attempt/refresh/role\*/session）字段级 = **b§14**。

---

## 8. 关键决策摘要（ADR 索引）

> 以下为**已定**决策的架构级摘要，原文（含选型理由/取舍）见来源文档，本文不复述细节。

| #        | 决策                                                               | 结论                                                                                                          | 来源                                       |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| B1–B4    | 全平台 OIDC 化 / ruyin 切 OIDC / 手机强锚点 / active_tenant 按应用 | 全平台 RP 化；授权码+PKCE；phone 强制全局锚点；每 app 独立 active_tenant                                      | identity-platform-decisions.md §1.1        |
| B5 / D-1 | 计费单元〔邻域 commerce〕                                          | 按应用订阅（租户×应用），多租户×多业务×多类订阅；token 与之解耦（仅因影响历史 claim 而索引，SoT 归 commerce） | identity-platform-decisions.md §1.1/§9     |
| D-2      | 订阅状态机 / 冻结〔邻域 commerce〕                                 | 新增 `past_due`；tenant suspended→`frozen` 只读；两概念分层（SoT 归 commerce）                                | identity-platform-decisions.md §16         |
| D-3      | refresh 形态                                                       | opaque + 服务端存储 + 用后轮换 + 重放检测                                                                     | identity-platform-decisions.md §16         |
| D-4      | 签名算法                                                           | **RS256**（兼容优先；ES256 弃）                                                                               | identity-platform-decisions.md §16         |
| D-6      | capability 进 token?                                               | **回查为主**，token 不放 capability（不膨胀）                                                                 | identity-platform-decisions.md §16         |
| D-7      | operator cookie 作用域                                             | `vx_sid_op` 仅 host-only、绝不外溢                                                                            | identity-platform-decisions.md §16         |
| D-10     | AuthN ⟂ entitlement 分离                                           | entitlement 移出 token、实时回查（SoT 归 commerce）——**已落地为 b§5.5 退役**                                  | identity-platform-decisions.md §16 + b§5.5 |
| D-AT     | RP 域内同源                                                        | 逐子域 nginx 反代 `/auth`+`/api` → 各自 BFF（标准 RP 拓扑）                                                   | identity-platform-access-topology.md §10   |
| D-AU     | RP 登出回跳                                                        | 统一中性 post-logout 页，携带发起 RP 品牌                                                                     | identity-platform-access-topology.md §10   |
| D-AW     | 跨域 SLO                                                           | 每业务可配是否参与全域 back-channel logout（ruyin 默认参与）                                                  | identity-platform-access-topology.md §10   |
| OP-V2    | operator MFA / 无 mTLS / 无第三方联邦                              | TOTP 默认 + 高权限强制 WebAuthn + 恢复码；不引 mTLS/Cf-Access                                                 | identity-platform-operator.md §2           |

> 完整历史决策台账（B1–B5 / D-1~D-10 全表 + 演进）见已归档的 [`identity-platform-decisions.md`](./130-decisions.md)（顶层身份模型已被四层重建取代，仅作决策档）。

---

## 9. 三层文档地图

### 9.1 架构层

| 文档                                          | 覆盖                                     |
| --------------------------------------------- | ---------------------------------------- |
| **identity-platform-architecture.md**（本文） | identity 板块架构层：模型/拓扑/边界/指路 |

### 9.2 详细层（机制字段级）

| 文档                                                               | 覆盖 realm    | 机制                                                                                            |
| ------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------- |
| [`identity-platform-access-topology.md`](./110-access-topology.md) | 双 realm      | SSO/SLO/三 cookie/同源/跨域/operator 登录                                                       |
| [`identity-platform-idp.md`](./070-idp.md)                         | 双 realm      | IdP 机制：门面拓扑/issuer + 端点/RS256/JWKS/会话/refresh（合并 p0-idp + login-surface）         |
| [`identity-platform-account.md`](./050-account.md)                 | customer      | 账号与认证：三层标识/验证码登录/社交 broker/账号合并/邮箱两态/头像（合并 4 篇）                 |
| [`identity-platform-authorization.md`](./060-authorization.md)     | 双 realm      | 两级 RBAC 执行（跨包）                                                                          |
| [`identity-platform-rp-integration.md`](./080-rp-integration.md)   | customer      | RP 接入：标准（子域+跨域）/集成模板/business-app 契约/provisioning（合并 4 篇；ruyin 契约独立） |
| [`identity-platform-ruyin-contract.md`](./140-ruyin-contract.md)   | customer      | ruyin 跨域对接契约（仍生效）                                                                    |
| [`identity-platform-operator.md`](./090-operator.md)               | **workforce** | operator 身份安全权威（MFA/隔离/审计）                                                          |

### 9.3 实施衔接层（迁移 / rollout）

| 文档                                                                       | 覆盖                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`data_platform_300_migration.md`](../data_platform_300_migration.md)（c） | 数据现状→最终态差量 + 落地步骤 + 代码锁步                                                       |
| [`identity-platform-decisions.md`](./130-decisions.md)（归档）             | 历史决策台账（B1–B5 / D-1~D-10）                                                                |
| [`identity-platform-implementation.md`](./120-implementation.md)           | 现状→新版迁移 / rollout Batch 进度 / 部署 runbook+踩坑 / operator 实施 / 收尾+退桥（合并 6 篇） |

---

## 附. 数据权威回指速查

| 主题                                                                        | 架构概览（a）    | 字段级（b）                           |
| --------------------------------------------------------------------------- | ---------------- | ------------------------------------- |
| identity 域（用户/租户/空间/成员/auth 支撑）                                | a §3.4·§4        | b §4                                  |
| 双 realm 隔离不变量                                                         | a §4（关键约束） | b §4.18（customer）/ §14（workforce） |
| iam：两级 RBAC / oidc_client / signing_key                                  | a §5             | b §5                                  |
| 成长子域（等级/积分/KYC）                                                   | a §6             | b §6                                  |
| operator/admin 运营身份                                                     | a §3.4·§14       | b §14                                 |
| entitlement/配额（OUT，回查）                                               | a §8             | b §8                                  |
| product / plan（OUT；product 域语义键，oidc_client 侧以 `product_id` 引用） | a §7             | b §7                                  |
