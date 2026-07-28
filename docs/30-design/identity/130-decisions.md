> 🗄 **已归档 · 历史决策台账（2026-07-01）** — 本文是 SSO 重建 B1–B5 / D-1~D-10 决策与 P0–P5 路线的原始出处，其**顶层身份模型已被四层重建取代**。现行权威：数据架构与字段级数据模型见 [`data_platform_100_architecture.md`](../data_platform_100_architecture.md)（架构）+ [`data_platform_200_schema.md`](../data_platform_200_schema.md)（字段级）+ [`data_platform_300_migration.md`](../data_platform_300_migration.md)（落地）。机制层细节仍由各 P0–P4 子文承接；本文仅作历史/决策档，**勿据顶层模型部分实施**。

# Identity 决策台账 / ADR（identity 板块 · 归档）

> 🧭 本文 = identity 板块的**决策/ADR 横切归档**（B1–B5 / D-1~D10 / P0–P5 的原始决策与 rationale）。架构层见 [`identity-platform-architecture.md`](./040-architecture.md)（§8 为本台账的决策索引摘要）。

> 范围：vxture-platform（IdP）+ console / website / admin / ruyin / xuanzhen / hermes / …（RP，开放集合）
> 版本：v2.1（2026-06-10）
> 状态：目标态设计（target-state），尚未实施。本轮只做分析与设计，不含编码。
> origin：由 `docs/tmp-vxture-identity-design.md`（v1.0 草案）系统化重写而来，并与已上线体系对齐。
> v2.1：确认四项决策(B1–B4) + 计费单元 B5（按应用订阅，多租户×多业务×多类订阅）；补 Google 上游、hermes/开放应用集合、平台账号中心表述。
> v2.2：D-2~D-8 全部拍板（past_due+frozen / opaque refresh / RS256 / provisioning 落 commerce / capability 回查 / operator cookie 仅 admin / 文档随 P1–P5 迁移）；开放决策清零。

---

## 0. 本文与既有文档的关系

本文是**全平台 OIDC 身份体系的单一权威目标态**。它不是凭空新建，而是把已上线的认证体系（auth-bff 单签发、PLG 自动建租户、手机强锚点、跨域桥）演进为标准 OIDC IdP。各既有文档的定位：

| 文档                                                               | 关系                                                                                                 | 处理                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `docs/30-design/auth.md`                                           | **被本文取代其机制部分**（自定义 JWT、HS256、跨域桥）；账号/PLG/双账号体系等不变                     | 实施期逐节迁移引用，最终标注 superseded-by 本文 |
| `docs/30-design/session.md`                                        | **被取代**（cookie 桥 → OIDC 会话与 back-channel logout）                                            | 同上                                            |
| `docs/30-design/tenant.md`                                         | **对齐**（active_tenant 由全局改为按应用，见 §7）                                                    | 增补 per-app 语义                               |
| `docs/30-design/identity-platform-authorization.md`                | **对齐**（token 内只放治理角色，细粒度回查不变，见 §8）                                              | 增补 token/回查边界                             |
| `docs/30-design/data_platform_100_architecture.md` / `commerce.md` | **对齐 + 增量**（新增 oidc_client / auth_session / provisioning + commerce 改 per-app 订阅，见 §13） | 按 §13 落详细设计                               |
| `docs/30-design/decisions/001-auth-bff-sole-jwt-issuer.md`         | **延续**（auth-bff 仍是唯一签发者，只是改为 OIDC IdP + 非对称签名）                                  | 新增 ADR 记录算法迁移                           |
| `docs/30-design/db/schemas/*.sql`                                  | ⚠️ **过期**（仍是迁移前 `account.*`/`tenancy.*` DDL，而生产已是 `identity.*`/`tenant.*`/`iam.*`）    | 文档卫生：本轮一并校正或标注废弃                |
| `docs/tmp-vxture-identity-design.md`                               | **被本文吸收**                                                                                       | 留作 origin，实施落地后退役                     |

---

## 1. 决策基线

### 1.1 已拍板（本轮确认，不再回退）

| #      | 决策                        | 选择                                                                                                                                                                                                   |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B1** | 平台-as-IdP 改造范围        | **全平台 OIDC 化**：console / website / admin / ruyin / xuanzhen 全部成为 RP；auth-bff 演进为统一 OIDC IdP                                                                                             |
| **B2** | ruyin 跨域桥                | **切换到 OIDC**（授权码 + PKCE），验证通过后退役一次性 token bridge                                                                                                                                    |
| **B3** | 身份锚点                    | **保留"已验证手机"为强制全局锚点**；登录即注册、OAuth 无手机→绑手机流程不变。token 仍同时携带 phone+email，email 可未验证                                                                              |
| **B4** | active_tenant 作用域        | **按应用独立**：每个 app 在 IdP 会话内有各自的 active_tenant；同应用内单租户、跨应用并行                                                                                                               |
| **B5** | 订阅/开通计费单元（原 D-1） | **按应用订阅（单元 = 租户 × 应用）**：明确的多租户 × 多业务 × 多类订阅模式；每个 app 自带计划与定价，租户对用到的每个 app 各持一份订阅（可表达 ruyin Pro + xuanzhen Free）。商业层决策，token 与之解耦 |

> **业务应用是开放集合**：ruyin / xuanzhen / hermes / …（持续增加）。新增一个 app = 注册一条 `oidc_client` 配置 + 定义其商业产品/计划，**IdP 零改代码**。上游三方登录（飞书/钉钉/Google/…）始终保留，并以"绑定到平台账号"的方式接入（见 §4.2）——业务应用只认平台 token，从不直接对接第三方。

### 1.2 仍开放（需产品/你拍板，见 §16 汇总）

**全部决策已拍板（D-1~D-8 清零，2026-06-10）**，详见 §16 决议台账。无遗留开放项；后续进入详细设计 / 实施。

---

## 2. 顶层架构

**一句话**：身份统一在 vxture-platform 的 OIDC IdP；所有应用（含平台自有 console/admin）都是 RP，靠授权码+PKCE 拿 token；IdP 持双 realm（租户/运营）严格隔离；token 按 client_id 单值 aud 裁剪；active_tenant 按应用独立；订阅按 (租户×应用) 计费；业务自治、业务数据挂租户。

```
                        ┌───────────────────────────────────────────┐
   上游 IdP（broker）    │      accounts.vxture.com  —  OIDC IdP            │
   ┌──────────────┐     │  （auth-bff 演进；唯一 token 签发者）        │
   │ 飞书/钉钉/    │◀────│  realm=tenant   → identity.account          │
   │ Google/…     │broker│  realm=operator → ops.admin                 │
   │（社交登录）   │     │  端点：/authorize /token /jwks /userinfo     │
   └──────────────┘     │       /revoke /end_session /backchannel      │
                        └───────────────────────────────────────────┘
                            ▲ 授权码+PKCE（每个 RP 一个 client_id）
        ┌──────────┬──────────┬───────────────┬───────────┬──────────┬─── …（开放集合）
        │ (子域)    │ (子域)   │ (子域,operator)│ (跨域)     │ (子域)    │ (子域)
   ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ website │ │ console  │ │  admin   │ │ ruyin.ai │ │ xuanzhen │ │ hermes…  │
   │  (RP)   │ │  (RP)    │ │  (RP)    │ │  (RP)    │ │  (RP)    │ │  (RP)    │
   └─────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
   realm=tenant realm=tenant realm=operator realm=tenant realm=tenant realm=tenant

   中心会话（按 realm 隔离）：
     tenant-realm   sid_t  → cookie 作用域 .vxture.com（子域静默 SSO；ruyin 跨域靠回跳 IdP）
     operator-realm sid_o  → cookie 仅 y.vxture.com（绝不外溢到租户应用）

   每个 sid 下，按 client_id 维护各自的 active_tenant：
     sid_t ─┬─ (console)  → active_tenant = tn_org_456（可切换）
            ├─ (ruyin)    → active_tenant = tn_self_123（恒个人租户）
            └─ (xuanzhen) → active_tenant = tn_org_456（独立切换，不影响 ruyin）
```

四条支柱（沿用草案，已与现实对齐）：

1. **中心化身份，业务自治。** vxture-platform 是全局唯一身份与计费真相源。ruyin/xuanzhen 不建账号库表，只存业务数据，靠 `user_id`(=`sub`) / `tenant_id` 外键引用。
2. **全员租户化。** 所有用户必关联租户；个人是 `type=individual` 单人租户（注册即建），组织是 `type=organization`。业务数据挂 `tenant_id`，`user_id` 仅标识操作者。
3. **OIDC SSO，按 client_id 裁剪。** 平台是 IdP，应用是 RP，授权码+PKCE。一个 token 只服务一个应用（`aud` 单值），entitlements 只签该应用相关部分。
4. **active_tenant 作用域 = 单个应用。** 跨应用不约束（ruyin 个人租户长开 + xuanzhen 组织租户干活并存），同应用内强制单租户。

> **目标态服务定位与包组织（2026-06-12 决，见 §16 D-9/D-10）** —— 按主流身份体系三面解耦：
>
> 1. **登录 / 账号 UI** = 独立前端 `portals/accounts`（accounts.vxture.com，**已落地**）；认证后端不渲染页面。
> 2. **认证服务（IdP）** = 专职 AuthN / SSO / 跨域跨子域签发，即 auth-bff 的演进体。**目标态更名 `identity-server`、归位 `services/identity/server`**（**可运行平台服务**，与库 `services/identity/iam` 同域；**不是 BFF**——它服务全体 RP 而非某一前端；先例：`services/model/platform` 即 `services/` 下的可运行中心服务），随 **P5** 退 legacy 时一并搬迁。
> 3. **权益 / 授权（entitlement）** = 独立、按请求**实时回查**，**不进 token**（见 §8 + §16 D-10）。
>
> `accounts.vxture.com` 是唯一公开门面，反代 `/oidc/*` 到内部 identity-server；详见 [`identity-platform-idp.md`](./070-idp.md)。

---

## 3. OIDC Client（应用）注册模型

每个 RP 都是**机密客户端（confidential client）**——它有自己的 BFF（server-side），由 BFF 持 client_secret 完成换码。浏览器永不接触 OIDC token（见 §6.4 BFF token 持有模式）。

注册表 `identity.oidc_client`（新增，见 §13），每个 client 配置：

| 字段                                     | 说明                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `client_id`                              | `website` / `console` / `admin` / `ruyin` / `xuanzhen` / `hermes` / …（开放集合，新增即注册） |
| `client_secret_hash`                     | 机密客户端密钥（哈希存储；明文进 secret manager，不落库）                                     |
| `realm`                                  | `tenant`（默认）/ `operator`（仅 admin）                                                      |
| `redirect_uris[]`                        | 回调白名单（精确匹配）                                                                        |
| `post_logout_redirect_uris[]`            | 登出后跳转白名单                                                                              |
| `back_channel_logout_uri`                | back-channel logout 接收端（ruyin **必填**，见 §10）                                          |
| `allowed_scopes[]`                       | `openid profile <app>`（如 `openid profile xuanzhen`）                                        |
| `product_ref`                            | client_id → 商业产品（app）的映射键；用于直读 (租户×应用) 订阅、签 entitlement（见 §9）       |
| `access_token_ttl` / `refresh_token_ttl` | 短期 access（5–15min）+ 长期 refresh                                                          |
| `pkce_required`                          | 恒 `true`（S256）                                                                             |
| `is_enabled`                             | 启停                                                                                          |

> **与 `identity.oauth_provider` 区分**：`oauth_provider` 是平台作为 RP 去对接**上游** IdP（飞书/钉钉/Google）的入站配置（方向：平台→第三方）。`oidc_client` 是平台作为 IdP 给**下游**自有应用发 token 的出站配置（方向：应用→平台）。**两者方向相反，不可复用同一张表。**

---

## 4. 身份域（realm）与登录

### 4.1 双 realm 隔离（全平台 OIDC 化的关键约束）

现状已有且承重的不变量：**operator（运营，y.vxture.com）与 tenant_user（租户用户，其余应用）是两套完全隔离的账号**——不同库（`ops.admin` vs `identity.account`）、不同 RBAC（`ops.*` vs `iam.*`）、同一邮箱可在两边各存一份互不相干。ADR 规定 operator 的凭据**绝不能**访问租户数据。

OIDC 化后用 **realm** 承载这个隔离：

- **realm 由 client 决定**：`admin` client → `operator` realm（认证 `ops.admin`）；其余 client → `tenant` realm（认证 `identity.account`）。
- **sub 命名空间分离**：operator 的 `sub` 与 tenant_user 的 `sub` 不同前缀/不同空间，物理不可混。
- **`userType` claim 持久化**：token 携带 `userType: operator|tenant_user`，RP 守卫继续校验；叠加 `aud` 单值 + JWKS，operator 的 token（`aud=admin`）在 console（期望 `aud=console`）结构性被拒。
- **中心会话按 realm 隔离**：`sid_t`（tenant）cookie 作用域 `.vxture.com`；`sid_o`（operator）cookie 仅 `y.vxture.com`，**绝不外溢**，运营登录不会静默带入任何租户应用。
- 同一人若既是运营又是租户用户：在两 realm 各自独立登录、各自 sid、各自 sub（与现状"两个身份"一致）。

### 4.2 登录方式（IdP 自身的认证手段，在 /authorize 登录页内完成）

> **门面拓扑（v2 收敛，权威见 [`identity-platform-idp.md`](./070-idp.md)）**：唯一公开身份域 **`accounts.vxture.com`** 同时承载登录/账号 UI（`/login`，realm 驱动）与（反代到内部 auth-bff 的）OIDC 协议端点（`/oidc/*`·`/.well-known/*`）；**`OIDC_ISSUER = https://accounts.vxture.com`**，auth-bff 无公开主机名。登录页与登录端点同源 → 免 CORS。本文及各阶段文档内 `accounts.vxture.com` 即此公开 IdP 域。

OIDC 化后，应用不再各自实现登录；登录只发生在 IdP 的 `/authorize` 页面。**核心模型：以平台账号为中心**——第三方身份只是绑定到平台账号的上游登录方式，业务应用只认平台 token、从不直接对接第三方。IdP 支持的认证手段沿用现有实现：

1. **手机验证码（强锚点，B3）**：手机是全局唯一锚点；验证手机即可登录，账号不存在则自动创建（登录即注册）。
2. **密码**：identifier（手机/邮箱/用户名）+ 密码（bcrypt，cost≥10）。
3. **社交登录（brokered）**：飞书/钉钉/Google（及后续 wechat/github…）作为**上游 IdP**，IdP 代理（broker）其授权；回调拿到稳定外部 ID 后映射到 `identity.sso_connection`（**绑定到平台账号**）。**若上游未返回手机且账号无已验证手机 → 进入绑手机流程**（沿用现有 `needs_phone_binding`），绑定成功才发 token。**手机强锚点在 OIDC 化后依然成立。**
4. **（运营 realm）**：admin 仅密码 + 运营面 Turnstile，无自助注册（沿用现状）。

> 用 Google 登录 ruyin 的真实链路：`ruyin → 平台IdP →(平台 broker) Google → 平台发 ruyin token`，ruyin 全程不碰 Google，租户/订阅由平台注入。
> 登录页人机校验（Turnstile）分两个 surface：租户面 vs 运营面，沿用现状，不变。

### 4.3 PLG 自动建租户

tenant realm 首次登录（任意方式）→ 在事务内创建 `identity.account` + 个人租户（`tenant.type=individual`，trial）+ `tenant_member`（owner, is_primary_owner）。沿用 ADR-005，不变。区别仅在：建租户后不再"重签 JWT"，而是 IdP 会话就绪后按 OIDC 流程发 token。

---

## 5. 签名与密钥（HS256 → 非对称）

### 5.1 为什么必须改

现状 access/refresh 都用 **HS256 对称密钥**（`JWT_SECRET` 在多个 BFF 间共享验签）。全平台 OIDC 化后，RP 通过 **JWKS 公钥**验签——**绝不能**把签名密钥发给每个 RP（尤其 ruyin 这种跨域/外部仓库）。因此 access_token / id_token 必须改为**非对称签名**。

### 5.2 目标

- **算法**：**RS256**（已定 D-4，RP 库通用兼容性最好；ES256 备选已弃）。
- **JWKS**：IdP 暴露 `/jwks`，发布公钥 + `kid`；私钥仅在 IdP 进程 + secret manager，不出 IdP。
- **轮换**：双密钥重叠窗口——发布新公钥并用新私钥签发，旧公钥保留至旧 token 全部过期再下线；`kid` 区分。
- **alg 白名单**：RP 端固定 `alg=RS256`，拒绝 `none`、拒绝 HS（防降级攻击）。

### 5.3 refresh token 形态

**已定 D-3：opaque（不透明句柄）+ 服务端存储（Redis）**，绑定 `sid + client_id`，**用后轮换（rotation）+ 重放检测（reuse → 吊销整个 family）**。延续现状"refresh 存 Redis、fail-closed 校验"，比 JWT refresh 更易主动吊销。

---

## 6. Token 模型

### 6.1 三种 token 各司其职

| token             | 用途                                           | 签名          | 受众                 |
| ----------------- | ---------------------------------------------- | ------------- | -------------------- |
| **id_token**      | RP 建立登录态的身份断言（**不**用于 API 鉴权） | 非对称        | `aud=client_id`      |
| **access_token**  | API 调用凭据（携带租户/开通上下文，下表）      | 非对称        | `aud=client_id` 单值 |
| **refresh_token** | 刷新 access（绑 sid+client）                   | opaque/服务端 | —                    |

### 6.2 access_token 完整 claims（签给 xuanzhen 示例）

在草案基础上**对齐真实字段来源**（见附录映射表）。关键改名：草案的 `tenantId` → `active_tenant`（强调"按应用当前租户"语义）。

```json
{
  // ── 标准 OIDC ──
  "iss": "https://accounts.vxture.com",
  "aud": "xuanzhen", // ★单值；ruyin 的 token 拿不到 xuanzhen
  "sub": "usr_<account.id>", // = identity.account.id；业务库 user_id 引用此值
  "iat": 1718000000,
  "exp": 1718000900, // ★短期 5–15min，切租户/改订阅靠 refresh 对齐
  "jti": "tok_a1b2c3", // 唯一 ID，支持吊销/防重放（沿用现有黑名单）
  "scope": "openid profile xuanzhen",
  "token_type": "Bearer",

  // ── 身份 ──
  "userType": "tenant_user", // ★realm 标记：tenant_user | operator
  "phone": "+8613800138000",
  "phone_verified": true, // ★强锚点：恒 true（B3）
  "email": "user@example.com",
  "email_verified": false, // email 可未验证
  "account_status": "active", // active|suspended|deleted（identity.account.status）

  // ── 会话 ──
  "sid": "sess_xyz789", // 中心会话；back-channel logout 按此吊销

  // ── 租户上下文（应用级 active_tenant，B4）──
  "active_tenant": "tn_org_456", // ★本应用当前唯一租户
  "active_tenant_type": "organization", // individual|organization
  "active_tenant_role": "admin", // ★平台治理级角色 owner|admin|member（tenant_member.role），非业务角色
  "active_tenant_status": "active", // active|frozen（tenant.status=suspended → frozen 只读降级）
  "active_tenant_env": "both", // ★新增对齐：beta|prod|both（tenant_member.environment_access）

  "tenants": [
    // 切换菜单用的只读快照
    { "tenant_id": "tn_self_123", "type": "individual", "role": "owner" },
    { "tenant_id": "tn_org_456", "type": "organization", "role": "admin" }
  ],

  // ── 开通状态（★按 client_id 裁剪：仅本应用 + 仅 active_tenant；直读 (租户×应用) 订阅，见 §9）──
  "entitlement": {
    "app": "xuanzhen",
    "plan": "paid", // 来自 (active_tenant, app) 的 tenant_subscription→plan（直读）
    "status": "active", // active|trial|past_due|canceled|expired（★见 D-2）
    "expires_at": 1720000000 // 来自该订阅 endAt/trialEndAt；null=永久
  }
}
```

签给 ruyin 时：`aud="ruyin"`，`active_tenant=tn_self_123`，`entitlement.app="ruyin"`，结构相同。

### 6.3 防缺陷关键点（沿用草案，已校验可行）

| 项                        | 正确做法                      | 防的坑                                        |
| ------------------------- | ----------------------------- | --------------------------------------------- |
| `aud`                     | 单值，一个 token 一个应用     | xuanzhen token 被 ruyin 接受；跨应用越权      |
| `entitlement`             | 单数对象，仅本应用 + 当前租户 | token 膨胀；ruyin 看见 xuanzhen 订阅          |
| `active_tenant`           | 进 token，按应用独立          | 全局单值会让 ruyin 长开被 xuanzhen 切租户带跑 |
| `exp`                     | 短（分钟级）+ refresh         | 切租户/改订阅后旧状态残留过久                 |
| 角色分层                  | token 只放**平台治理级** role | 业务角色污染身份层                            |
| `account_status`/`status` | 进 token                      | 状态变更后每请求回查平台                      |
| `userType`+realm          | token 标记 + aud 隔离         | operator/tenant_user 越界                     |

> **业务角色（阵法师/审核员等）绝不进 token**，由应用用 `(active_tenant, sub)` 查自己的库裁定（见 §8）。

### 6.4 BFF token 持有模式（安全要点，对齐现状"token 不出 body"）

每个 RP 是机密客户端 + 有 BFF：

1. 浏览器发起登录 → RP-BFF 重定向到 IdP `/authorize`（带 PKCE）。
2. 回调 code 到 **RP-BFF**（不是浏览器 JS）→ RP-BFF 用 code+secret+verifier 换 token。
3. **OIDC token（id/access/refresh）只存在 RP-BFF 服务端**（内存/Redis），浏览器只拿 RP 自己的 **HttpOnly 会话 cookie**。
4. 富 access_token（含 entitlement 等）仅用于 **BFF → 后端 API**，**绝不下发浏览器**。

这保留了现状"token 永远 HttpOnly、不进 response body"的安全姿态，且 RP 前端无需处理 OIDC。

---

## 7. 中心会话 `sid` 与按应用 `active_tenant`

### 7.1 会话模型

- IdP 为每次"realm 内登录"建一个中心会话 `sid`（tenant realm 的 sid_t / operator realm 的 sid_o），承载"你是谁"（sub、realm、auth_method、device/ua/ip、创建/活跃时间）。
- **sid 只管身份，不管租户。** 租户上下文挂在 `(sid, client_id)` 维度。
- 存储：**Redis 为主**（`sess:{sid}` 哈希，含每个 client 的 active_tenant 字段）；**可选持久表** `identity.auth_session`（多设备管理 UI / 审计用，见 §13）。operator sid 的 cookie **仅作用域 `y.vxture.com`、绝不外溢**（已定 D-7）。

### 7.2 按应用 active_tenant（B4 落地）

```
sess:{sid_t} = {
  sub: usr_123, realm: tenant, auth_method: phone, ...,
  clients: {
    "console":  { active_tenant: "tn_org_456" },
    "ruyin":    { active_tenant: "tn_self_123" },   // 恒个人租户，不切
    "xuanzhen": { active_tenant: "tn_org_456" }     // 独立切换
  }
}
```

- **首次进某 app**：IdP 解析 `(sid, client)` 的 active_tenant——只有 1 个租户则直接定；多个则取上次/默认（个人租户）或弹切换。
- **切换租户（仅 console/xuanzhen 等需要）**：app 调 IdP 更新 `(sid, client)→tenant` → 通过 refresh 或静默重授权（`prompt=none`）发新 token。**作用域仅限该 client，不波及 ruyin。**
- **多设备 = 多 sid**：active_tenant 按会话独立、不跨设备同步——保住"两台电脑各操作不同租户"的诉求。

---

## 8. 授权分层：什么进 token、什么回查

| 数据                                                                                                                  | 位置                                     | 来源 / 裁定方                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 账号状态、active_tenant + 类型 + **治理角色**(owner/admin/member) + 状态、env、entitlement（per-app 直读）、tenants[] | **进 access_token**                      | IdP 签发时填充                                                                                      |
| 租户**细粒度** console 权限（菜单/按钮/API）                                                                          | **回查**（不进 token，防膨胀）           | console-BFF 用 `(active_tenant, sub)` 查 `iam.tenant_role/permission/member_role_binding`（可缓存） |
| **能力门控** capability（如 platform.model.manage）                                                                   | **回查**（已定 D-6，不进 token；可缓存） | `iam.capability` ← `iam.subscription_capability` ← 订阅计划                                         |
| **业务角色**（阵法师/审核员…）                                                                                        | **回查应用自身库**                       | ruyin/xuanzhen 用 `(active_tenant, sub)` 查自己的库                                                 |
| 运营权限                                                                                                              | 回查 `ops.*`                             | admin-BFF（operator realm）                                                                         |

**每请求校验链**（应用侧，前 5 步零回查）：

1. **验签**：JWKS 验签 + `iss`；校验 `aud==自己`、`exp` 未过、`alg=RS256`、`jti` 未吊销。
2. **realm/类型**：`userType` 符合本应用期望。
3. **账号**：`account_status==active`。
4. **租户**：`active_tenant_status==active`（`frozen`→只读降级）；如需环境隔离看 `active_tenant_env`。
5. **开通**：`entitlement.status∈{active, past_due(宽限内)}` 且 `expires_at` 未过；否则跳订阅页。
6. **业务权限**：用 `(active_tenant, sub)` 查应用库裁定业务角色 / 必要时回查 iam 细粒度权限。

> **目标态：entitlement 从 token 移出（2026-06-12，§16 D-10，建议待终拍）。** 当前 `entitlement` 作快照进 access_token（上表/步骤 5，**过渡实现**）——这让认证服务伸进商业层，且对计费级硬门控有"最长一个 access TTL（900s）"的时效滞后（订阅中途欠费/降级，要到刷新重查才被拦）。主流做法是 **AuthN（身份）与 AuthZ/权益分离**：identity-server 只签身份（至多带个**非权威提示**，RP 不据此做最终拦截），"能用哪些产品/档位"由**独立权益服务按请求实时回查**——这正是 **#9 配额 enforcement**（请求→哪份订阅配额）卡住的同一接缝，拆出来一并解决。**代价**：`entitlement` claim 已写入 P3/P4 对外契约，改为"实时回查端点"是契约变更，宜在外部 RP 真正对接前拍板。

---

## 9. 开通（provisioning）与 webhook

### 9.1 两个概念必须分开（关键澄清）

- **Entitlement（商业开通）**：租户对某 app 的商业资格（plan/status/expires）。**计费单元 = (租户 × 应用)**（B5，明确的多租户 × 多业务 × 多类订阅模式）：每个 app 自带计划，租户对每个用到的 app 各持一份 `commerce.tenant_subscription`（按 `product_ref` 区分）。IdP 签 xuanzhen 的 token 时**直读 `(active_tenant, xuanzhen)` 的订阅行**填 entitlement——是直查，不再是单一租户订阅的投影。
- **Provisioning（业务开通）**：app 是否已为该租户**初始化业务空间 + 默认业务角色**。这是 app 自治的生命周期，平台不拥有。

> **商业层结构需求（B5 落地，详细设计见 `commerce.md`）**：
> ① `commerce.tenant_subscription` 增 `product_ref`，去掉"租户唯一"约束（改 `(tenant_id, product_ref)` 唯一活跃订阅）；
> ② `commerce.tenant_subscription_quota` 不再租户 1:1，改按订阅 /(`tenant_id`, `product_ref`) 快照；
> ③ `product.plan` 归属到具体 app/product（计划按 app 划分档位）；
> ④ 把"app/product"确立为 `product` schema 的一等实体，供 `oidc_client.product_ref` 映射、plan 归属、subscription 引用。
> **已有的 `tenant_subscription_override`（按 租户,agent,feature）与 `tenant_usage_event`（按 applicationId）本就是 per-app 粒度，无需改。**
> ⚠️ **product/app/agent taxonomy 对齐**是 commerce/product 详细设计的前置项（"ruyin 是 product 还是 agent？varda 与 ruyin 的关系？"）；身份层只依赖 `oidc_client → product_ref` 这一映射，不内嵌该 taxonomy。

### 9.2 开通时序

```
用户在某租户上下文进 app
  → app 校验 entitlement=none（或本地无业务空间）
  → 跳平台订阅页（带 tenant_id + app）
  → 平台记账（commerce 该 app 订阅/计划变更）
  → entitlement 对 (tenant, app) 首次 active
  → 平台发 webhook：tenant.provisioned { tenant_id, app, plan }
  → app 初始化业务空间 + 默认业务角色，并记录自身 provisioned 状态（幂等）
```

- 个人租户开通 ruyin 可设为"注册即自动激活"（匹配认证即用）。
- **去开通**：entitlement 失效 → webhook `tenant.deprovisioned` → app 降级只读/归档（不硬删）。
- **投递**：签名 webhook（HMAC），at-least-once + 重试，app 侧按 `tenant_id+app` 幂等。平台留 provisioning 状态 + 投递日志于 **`commerce`**（已定 D-5，与订阅同源便于对账）。
- ruyin/xuanzhen 是外部仓库（vx-worker-02+），故用 webhook（非进程内事件）。

---

## 10. 登出

- **`/end_session`（全局登出，默认，安全优先）**：销毁 `sid`（按 realm）→ 对该 sid 下所有有活跃会话的 RP 发 **OIDC back-channel logout**（`logout_token` JWT，含 sid/sub）。
- **子域 RP**（console/website/admin/xuanzhen.vxture.com）：`.vxture.com` 会话 cookie 失效 + back-channel 杀服务端会话，双保险。
- **ruyin.ai（跨域）**：cookie 是 `.ruyin.ai`，父域登出**清不掉它**，因此 **back-channel logout 必填**（§3 client 注册的 `back_channel_logout_uri`）。这是草案 #3 的正确落地。
- **局部登出**：只杀该 RP 会话（RP 本地）+ 通知 IdP 丢弃 `(sid, client)`，不动其他应用。

---

## 11. IdP 对外端点（OIDC 契约）

| 端点                                | 方法        | 作用                                                               |
| ----------------------------------- | ----------- | ------------------------------------------------------------------ |
| `/.well-known/openid-configuration` | GET         | 发现文档                                                           |
| `/authorize`                        | GET         | 授权 + 登录页（PKCE S256 强制；realm 由 client 定）                |
| `/token`                            | POST        | code/refresh 换 token（机密客户端：client_secret + PKCE verifier） |
| `/userinfo`                         | GET(Bearer) | 取非 token 字段（昵称/头像等，RP 可短 TTL 缓存）                   |
| `/jwks`                             | GET         | 公钥集（含 kid）                                                   |
| `/revoke`                           | POST        | 吊销 token                                                         |
| `/end_session`                      | GET/POST    | 单点登出 + back-channel 通知各 RP                                  |

**`/token` 内部裁剪逻辑（核心）**：

```
1. 校验 client_id + client_secret + PKCE；按 client 定 realm 与 aud
2. 读中心会话 sid → 得 sub、realm、phone/email、account_status
3. 解析 (sid, client_id) 的 active_tenant（可被切换请求更新）
4. 查 tenant_member → active_tenant_role/status/env + tenants[]
5. 直读 entitlement：按 client→product_ref 查 (active_tenant, product_ref) 的 tenant_subscription，填 plan/status/expires（★仅此一个应用）
6. 按 client_id 设 aud（单值）→ 非对称签发短期 JWT
```

> **约束**：签发时只装填本 client 对应应用的 entitlement。应用间确需互读开通（一般不应）走服务间 API（如 `GET /internal/tenants/{id}/entitlements`），**绝不塞回 token**。

---

## 12. 跨域 vs 跨子域（只在会话层，不在 token 内容）

| 应用                                    | 类型                            | SSO 静默续期                                                                                                       | 登出联动                        |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| console/website/admin/xuanzhen/hermes/… | `*.vxture.com` 子域（开放集合） | IdP 会话 cookie 在 `.vxture.com`，`prompt=none` 静默授权                                                           | 父域 cookie 失效 + back-channel |
| ruyin.ai                                | 跨域                            | 浏览器不带 vxture.com cookie，但 OIDC 跳转**落在 IdP 域**（accounts.vxture.com，此处 cookie 在），故静默回授仍成立 | **必须 back-channel logout**    |

> 纠正草案的一处含糊：ruyin 的 SSO 并非靠浏览器共享 cookie，而是靠"重定向到 IdP 域时 IdP 自己的会话 cookie 生效"——这正是 OIDC 优于一次性 token 桥之处。

---

## 13. 数据底座增量

现有 `identity / tenant / iam / commerce` 已足够支撑大部分字段（见附录映射）。需**新增**：

| 新增                       | 位置                     | 内容                                                      | 备注                                   |
| -------------------------- | ------------------------ | --------------------------------------------------------- | -------------------------------------- |
| `oidc_client`              | `identity`               | §3 的 client 注册表                                       | 与 `oauth_provider` 方向相反，**新表** |
| `auth_session`（可选持久） | `identity`               | sid、sub、realm、device、状态、按 client 的 active_tenant | Redis 为主，表用于多设备 UI/审计       |
| 签名密钥元数据（可选）     | `identity` `signing_key` | kid、公钥、状态、轮换时间（**私钥不落库**）               | 或纯 secret manager + 配置             |
| provisioning 状态/投递日志 | `commerce`（已定 D-5）   | (tenant, app)→provisioned 状态 + webhook 投递记录         | 与订阅同源                             |

**复用/调整**：

- `identity.account_session`（现 jti 黑名单）**保持**作 token 吊销用；新会话语义用 `auth_session`，二者不混。
- `identity.oauth_state` 已有 PKCE/nonce 字段——服务**入站** broker（平台→飞书）；**出站**（应用→平台）的授权码用 **Redis 短 TTL**，不复用此表。
- entitlement 状态机（已定 D-2）：`tenant_subscription.status` 新增 **`past_due`**（账单宽限，可只读/限用）；并区分 `tenant.status=suspended → active_tenant_status=frozen`（账号级冻结，只读）。两概念分层。
- **commerce 改为 per-app 订阅（B5，重点改动）**：`tenant_subscription` 增 `product_ref` 并放弃"租户唯一"；`tenant_subscription_quota` 改按 (租户, product_ref)/订阅 快照；`product.plan` 归属到 app/product，并把"app/product"立为 `product` schema 一等实体。详细设计见 `commerce.md`/`data_platform_100_architecture.md`；身份层仅依赖 `oidc_client.product_ref` 映射。

---

## 14. 安全与防缺陷

- **PKCE 强制**（S256），即便机密客户端；`state`(CSRF) + `nonce`(防重放 id_token)。
- **机密客户端**：所有 RP 经 BFF 持 secret 换码；浏览器零 token（§6.4）。
- **短 access**（5–15min）+ **refresh 轮换 + 重放检测**（reuse → 吊销整个 refresh family）。
- **aud 单值**强制；`iss` 校验；JWKS 公钥固定；**alg 白名单**（拒 none / 拒降级到 HS）。
- **jti + 吊销**：沿用黑名单 + revoked-before 水位；登出叠 back-channel。
- **realm 隔离**：operator 与 tenant_user 物理不可越界（sub 空间 + aud + userType 三重）。
- token 永不进 response body / localStorage；HttpOnly cookie 仅承载 RP 自身会话。
- 沿用 `auth.md §10/§11` 的账号隔离与代码评审清单，新增"OIDC 签发裁剪 / aud 单值 / 非对称验签 / back-channel"检查项。

---

## 15. 迁移路径（金丝雀，逐项一 PR）

> 原则：IdP 新链路与现有 HS256+桥**并行**搭建，按 RP 逐个切换、验证、回填，最后退役旧链路。符合"先文档→按文档实施→实测回填"。

| 阶段                       | 内容                                                                                                                                                                              | 验证标志                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **P0 IdP 地基**            | 非对称密钥 + JWKS + 发现文档；`/authorize`(PKCE)/`/token`/`/userinfo`/`/revoke`/`/end_session`；`oidc_client` 表 + 各 client 注册；Redis 授权码/会话；access_token 富 claims 直读 | 拿 test client 跑通授权码全链路，JWKS 验签通过               |
| **P0.5 commerce per-app**  | commerce 改 per-app 订阅（B5）+ product app/product 实体 + entitlement 直读 API                                                                                                   | 同租户多 app 不同档位可并存且各自正确                        |
| **P1 平台子域先行**        | console + website 切为 RP（子域，风险最低）；保留旧链路灰度回退                                                                                                                   | 登录/续期/登出/切租户全绿；旧链路可秒回退                    |
| **P2 运营 realm**          | admin 切为 RP（operator realm，sid_o 隔离）                                                                                                                                       | operator/tenant_user 隔离验证：交叉 aud/realm 全部被拒       |
| **P3 ruyin（B2）**         | ruyin 切为 OIDC RP；back-channel logout 接通；验证后**退役一次性 token 桥**                                                                                                       | 跨域静默 SSO + back-channel 登出闭环；桥下线                 |
| **P4 xuanzhen / hermes …** | 新 app 作为全新 OIDC RP 接入（绿地）+ provisioning webhook 闭环                                                                                                                   | per-app active_tenant 并存（ruyin 个人 + xuanzhen 组织不串） |
| **P5 收尾**                | 退役 HS256 共享密钥路径；校正 `docs/30-design/db/schemas/*.sql`；auth.md/session.md 标 superseded                                                                                 | 全平台仅 OIDC；旧密钥下线                                    |

---

## 16. 开放决策点汇总（待拍板）

| #          | 决策点                   | 决议（全部已定 2026-06-10）                                                                                                                                                                                                                                         | 影响                                    |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **D-1** ✅ | per-app 开通商业模型     | **按应用订阅（单元=租户×应用）**，多租户×多业务×多类订阅；commerce 改表见 §9.1/§13                                                                                                                                                                                  | —                                       |
| **D-2** ✅ | 订阅状态机 / 冻结        | 新增 **`past_due`**（账单宽限，可只读）；`tenant suspended → active_tenant_status=frozen`（账号级冻结只读）；两概念分层                                                                                                                                             | entitlement 语义完整                    |
| **D-3** ✅ | refresh token 形态       | **opaque + 服务端存储(Redis) + 用后轮换 + 重放检测**                                                                                                                                                                                                                | 可吊销、延续现状                        |
| **D-4** ✅ | 签名算法                 | **RS256**（兼容优先；ES256 已弃）                                                                                                                                                                                                                                   | RP 库兼容                               |
| **D-5** ✅ | provisioning 落表        | **`commerce`**（状态 + webhook 投递日志，与订阅同源）                                                                                                                                                                                                               | 对账一致                                |
| **D-6** ✅ | capability 进 token?     | **回查为主**（token 只放 entitlement；capability 由 BFF 按 plan 查、可缓存）                                                                                                                                                                                        | token 不膨胀                            |
| **D-7** ✅ | operator cookie 作用域   | **仅 `y.vxture.com`**、绝不外溢（强隔离）                                                                                                                                                                                                                           | 运营/租户隔离                           |
| **D-8** ✅ | 文档重构节奏             | **随 P1–P5 逐节迁移**，P5 收尾统一标 superseded                                                                                                                                                                                                                     | 文档与实现同步                          |
| **D-9** 🎯 | 认证服务命名 / 归位      | 目标态（2026-06-12 决）：auth-bff 演进体**更名 `identity-server`、归位 `services/identity/server`**（可运行平台服务，非 `bff/`；服务全体 RP 不是某前端，故非 BFF；先例 `services/model/platform`）。**随 P5 退 legacy 时搬迁**（一次性正名归位，不留中间态）。见 §2 | 包组织正名、分层归位                    |
| **D-10** ◐ | AuthN ⟂ entitlement 分离 | 目标态（2026-06-12，**建议待终拍**）：**entitlement 移出 access_token**，改**独立权益服务实时回查**（§8）；认证服务只管身份/SSO/签发，至多带非权威提示。**影响 P3/P4 对外契约**（entitlement claim），宜外部对接前定                                                | 计费级硬门控更实时；并解 #9 enforcement |

---

## 附录：access_token claims ↔ DB 来源 速查（可验证）

| claim                                | 来源表.字段                                                                                       | 备注                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| `sub`                                | `identity.account.id`                                                                             | 业务库 user_id 引用此值          |
| `userType`                           | （realm 推导）`identity.account` / `ops.admin`                                                    | tenant_user / operator           |
| `phone` / `phone_verified`           | `identity.account.phone` / `phoneVerifiedAt`                                                      | 强锚点恒 true                    |
| `email` / `email_verified`           | `identity.account.email` / `emailVerifiedAt`                                                      | email 可未验证                   |
| `account_status`                     | `identity.account.status`                                                                         | active\|suspended\|deleted       |
| `sid`                                | 中心会话（Redis `sess:{sid}` / `identity.auth_session`）                                          | 新增                             |
| `active_tenant`                      | `(sid, client_id)` 会话态 → `tenant.tenant.id`                                                    | 按应用独立                       |
| `active_tenant_type`                 | `tenant.tenant.tenantType`                                                                        | individual\|organization         |
| `active_tenant_role`                 | `tenant.tenant_member.role`                                                                       | owner\|admin\|member（治理角色） |
| `active_tenant_status`               | `tenant.tenant.status`                                                                            | suspended→frozen                 |
| `active_tenant_env`                  | `tenant.tenant_member.environmentAccess`                                                          | beta\|prod\|both（新增对齐）     |
| `tenants[]`                          | `tenant.tenant_member`（按 account 聚合）                                                         | 只读快照                         |
| `entitlement.plan/status/expires_at` | `(active_tenant, client→product_ref)` 的 `commerce.tenant_subscription`(+`product.plan`) **直读** | 按应用订阅(B5)；状态见 D-2       |
| `jti`                                | 签发生成；吊销查 `identity.account_session` 黑名单                                                | 沿用                             |

> `user_id` / `tenant_id` 在业务库（ruyin/xuanzhen）中仅为外键引用（指针），不是数据副本。业务库无 users/tenants/密码/订阅表；如需昵称头像可建**只读缓存表**（明确"缓存非拥有"，不得长出密码/状态/权限字段）。
