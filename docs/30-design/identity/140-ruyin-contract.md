# Ruyin ⇄ Vxture OIDC 集成契约（接口标准）

> 📌 **对接方更名（2026-07-06，ADR-12 D7）→ 切换完成（2026-07-07）**：本契约的对接方为 **umbra（边界 VPN 产品）**——域名 **ruyin.ai 不变**；**client_id 已切换为 `umbra`**（一次切换，[`product_300_naming-migration.md`](../product_300_naming-migration.md) §2 v1.1 执行完成：活库 seed + worker-04 对端 env，authorize 正负探针验证过），scope 相应改 `umbra`/`umbra:subscription`，secret 沿用原 hash；其余契约条款**全部照旧有效**（umbra 保持现状租户级订阅模式，豁免 workspace×product 权益引擎与 SharingGrant）。"Ruyin"一名现指 client 端产品（desktop，产品定义待建），其 web RP 已注册在 `ruyin.vxture.com`，与本契约无关。

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md](../data_platform_100_architecture.md) + [data_platform_200_schema.md](../data_platform_200_schema.md)（本文不重述平台 DDL，只述本板块内容）。
> 📌 通用跨域接入（子域/跨域两模式、cookie/会话通则）已被 [`identity-platform-rp-integration.md`](./080-rp-integration.md) 取代；本文只留 **ruyin 专属** OIDC 接口契约（端点/PKCE/claim 名/back-channel logout）。token 内 claims（`active_org`/`roles`/`entitlement` 等）是 **OIDC 投影**，权威模型 = data_platform_200_schema.md（identity / iam 域，字段级权威）。

> 面向 **ruyin.ai（外部仓库 worker-04 / umbra 栈）团队** 的对接标准。本文是 vxture 平台作为 **OIDC IdP** 对外承诺的接口契约，ruyin 据此**并行开发** RP（Relying Party）。
> 与 [`identity-platform-implementation.md`](./120-implementation.md)（内部设计）配套；**本文以平台已落地实现（P0–P2）为准**，claim 名称/端点/校验规则均与生产代码一致，可直接编码。
> 版本：v2.1（2026-06-19）。状态：**接口冻结，可对接**。
> v2.1 裁定（ruyin 联调反馈三项偏离）：**D-BI** §5 授权"多子域 RP 用 Domain-scoped 不透明 cookie（去 `__Host-`，Secure/HttpOnly/SameSite=Lax、控全部子域）"——ruyin 现状即合规；**§2.3** 增登出吊销 refresh 硬化说明（全局 `end_session` 已吊销，仅本地登出需 `/oidc/revoke`）；**D-BJ** §13 删 `OIDC_RP_ENABLED`（桥退役、vxture 自身亦移除）。
> v2 修订：`access_token` 上下文模型对齐现行四层模型（`active_org`/`active_workspace`/`roles`，弃 legacy `active_tenant_*`/`tenants`）；人类身份声明（`name`/`preferred_username`/`account_status`/`email`/`phone`）已在 `access_token` 下发（§8）；`entitlement`当前不下发、暂缓（§8.1/§10）；推荐 scope =`openid profile email phone umbra umbra:subscription`（原 `... ruyin`，2026-07-07 随 client_id 切换）；头像 `picture`见`identity-platform-account.md`。
>
> 术语：**IdP** = vxture 平台（`accounts.vxture.com`）；**RP** = ruyin（`ruyin.ai`）。

---

## 0. 一句话总览

ruyin 从「console 生成一次性 token → 跨域桥」迁移为**标准 OIDC 授权码 + PKCE RP**：用户访问 ruyin 未登录时，**顶级跳转**到 IdP `/oidc/authorize`；若用户在 vxture 已登录（`vx_sid` 在 `accounts.vxture.com` 第一方生效），**静默发码**回 ruyin；ruyin 后端换 token、建**服务端会话**，浏览器只持有不透明的 `__Host-vx_rp_session`。登出靠 **back-channel logout**（IdP→ruyin 服务端，跨域唯一手段）。ruyin 每请求按 **entitlement** 硬门控（**目标态；当前未下发，暂缓——见 §8.1 / §10**）。

**浏览器零 OIDC token、零 `ry_*`**；token 只在 ruyin-BFF 服务端流转。

---

## 1. 平台提供（vxture 侧，已就绪）

| 项                        | 值                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Issuer                    | `https://accounts.vxture.com`（dev：`http://localhost:3081`）                      |
| Discovery                 | `GET {issuer}/.well-known/openid-configuration`                                    |
| JWKS                      | `GET {issuer}/oidc/jwks`（RS256 公钥；**支持轮换**，见 §6）                        |
| `client_id`               | `umbra`（2026-07-07 起；原 `ruyin`）                                               |
| `client_secret`           | 经 **secret manager** 派发（不入双方代码库；见 §13）                               |
| `redirect_uri`            | `https://ruyin.ai/auth/callback`（**精确白名单**，须提前登记）                     |
| `back_channel_logout_uri` | `https://ruyin.ai/auth/backchannel-logout`（**必填**）                             |
| `allowed_scopes`          | `openid profile email phone umbra umbra:subscription`（email/phone 已放行，见 §8） |
| `product_ref`             | `umbra`（驱动 entitlement；当前暂缓，见 §8.1 / §10）                               |
| realm                     | `tenant`                                                                           |
| access_token TTL          | 900s（15min，平台可调）                                                            |
| refresh_token TTL         | 2592000s（30d，平台可调）                                                          |

> ruyin **不直接访问平台 DB**；身份/租户/订阅一律经 token，必要时经服务间 API。

---

## 2. OIDC 端点参考（IdP）

所有路径相对 `{issuer}`。Discovery 是权威自描述来源，下表为冻结契约。

### 2.1 `GET /oidc/authorize`（授权端点）

Query 参数：

| 参数                    | 必填 | 说明                                                                                          |
| ----------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `response_type`         | ✓    | 恒 `code`                                                                                     |
| `client_id`             | ✓    | `umbra`                                                                                       |
| `redirect_uri`          | ✓    | 须**精确等于**登记的 `https://ruyin.ai/auth/callback`（否则 400，不重定向——防 open-redirect） |
| `scope`                 | ✓    | `openid profile email phone umbra umbra:subscription`（email/phone 取邮箱手机；见 §8）        |
| `code_challenge`        | ✓    | PKCE，BASE64URL(SHA256(verifier))                                                             |
| `code_challenge_method` | ✓    | 恒 `S256`（**不支持 plain**）                                                                 |
| `state`                 | 建议 | CSRF/状态绑定，回调原样回显                                                                   |
| `nonce`                 | 建议 | 重放防护，回显于 id_token                                                                     |
| `prompt`                | 可选 | `none` = 静默（无会话则回 `error=login_required`，不弹登录）                                  |
| `tenant_hint`           | 不用 | ruyin 恒个人租户，无切租户                                                                    |

行为：

- **有可用 IdP 会话**（`vx_sid` 命中、realm=tenant）→ `302 {redirect_uri}?code=...&state=...`。
- **无会话 + 交互**（无 `prompt=none`）→ `302 {WEBSITE_BASE_URL}/auth/oidc-login?login_challenge=...&realm=tenant`（IdP 托管登录页；ruyin 不实现登录 UI）。
- **无会话 + `prompt=none`** → `302 {redirect_uri}?error=login_required&state=...`。
- 其余 OIDC 错误（`unsupported_response_type` / `invalid_request` / `invalid_scope`）经 `redirect_uri` 回 `error=...`。

### 2.2 `POST /oidc/token`（令牌端点）

`Content-Type: application/x-www-form-urlencoded`。客户端认证二选一：

- **client_secret_basic**（推荐）：`Authorization: Basic base64(client_id:client_secret)`。
- **client_secret_post**：body 带 `client_id` + `client_secret`。

**授权码换 token**：

```
grant_type=authorization_code
code=<授权码>
redirect_uri=https://ruyin.ai/auth/callback   # 须与 authorize 时一致
code_verifier=<PKCE verifier>
```

**刷新**：

```
grant_type=refresh_token
refresh_token=<opaque>
```

成功响应（200）：

```json
{
  "access_token": "<RS256 JWT>",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "<opaque, 已轮换>",
  "id_token": "<RS256 JWT>",
  "scope": "openid profile email phone umbra umbra:subscription"
}
```

失败：`400 invalid_grant`（码失效/redirect 不符/PKCE 不符/refresh 重放）、`401 invalid_client`（client 认证失败）、`400 unsupported_grant_type`。

### 2.3 其它端点

| 端点                    | 用途                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /oidc/jwks`        | RS256 公钥集，验签用；按 `kid` 选取，**未命中刷新一次**                                                                                                   |
| `GET /oidc/userinfo`    | `Authorization: Bearer <access_token>` → `{sub,name,picture,phone_number,phone_number_verified,email,email_verified}`（可选；ruyin 若本地验签则无需调用） |
| `POST /oidc/revoke`     | RFC 7009；`token`(+`token_type_hint`)，恒 200                                                                                                             |
| `GET /oidc/end_session` | 全局登出；`post_logout_redirect_uri`(须登记)、`state`；销毁 IdP 中心会话、**吊销该 sid 的 refresh 链**并对所有 RP 发 back-channel logout                  |

> **登出吊销 refresh（硬化建议，非强制）**：**全局登出**走 `/oidc/end_session` 时 IdP **已**服务端吊销该 sid 的 refresh 链——主登出路径无需额外动作。仅当 RP 另有"**仅退本应用**"的本地登出（不经 end_session）时，建议顺手 `POST /oidc/revoke`（hint=`refresh_token`）吊销该 refresh，避免其残留至 TTL（30d）。

---

## 3. 跨域 SSO 流程（关键差异，务必照做）

```
浏览器                         ruyin-BFF                       IdP(accounts.vxture.com)
  │  GET ruyin.ai/...(未登录)     │                                  │
  │ ───── 顶级导航 ─────────────▶ │ /auth/login                       │
  │                              │  生成 PKCE+state+nonce，存 Redis    │
  │ ◀── 302 ── accounts.vxture.com/oidc/authorize?...（顶级跳转）──────────▶│
  │ ════════════ 浏览器对 accounts.vxture.com 是第一方，自动带 vx_sid(Lax) ═▶│
  │                              │                          有会话→静默发码 │
  │ ◀── 302 ── ruyin.ai/auth/callback?code=&state= ────────────────────│
  │ ───── GET callback ────────▶ │ /auth/callback                     │
  │                              │  POST /oidc/token（服务端，带 secret）─▶│
  │                              │ ◀── id_token+access_token+refresh ──│
  │                              │  验签/验 nonce → 建 RP 会话 → set cookie│
  │ ◀── 302 returnTo + Set-Cookie __Host-vx_rp_session ───────────────│
```

**硬性约束**：

- `/auth/login → /oidc/authorize` 必须是**顶级整页导航**（`302`/`window.location`），**绝不能用 iframe 或 XHR 做静默授权**——跨域第三方 cookie 限制会使 `vx_sid` 不携带，静默失败。
- SSO 不依赖任何跨域共享 cookie；它依赖「重定向落到 IdP 域时浏览器对 IdP 第一方」。

---

## 4. RP 须实现的端点（ruyin-BFF）

| 端点                            | 职责                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/login`               | 生成 `pkce(verifier,challenge)`+`state`+`nonce`，存服务端（如 Redis，键含 state，TTL ~600s），`302` 到 `/oidc/authorize`。支持 `returnTo`（白名单校验后回跳） |
| `GET /auth/callback`            | 取回并删 authreq（按 state）→ `POST /oidc/token` 换码 → **验 id_token**（aud+nonce+签名）→ 建 RP 会话 → set `__Host-vx_rp_session` → `302 returnTo`           |
| `GET /auth/session`             | 读 cookie → 解析/验签 access_token（近过期则静默刷新）→ 回前端 bootstrap 所需 claims                                                                          |
| `POST /auth/logout`             | 本地销毁 RP 会话 + 清 cookie；可选 `302 /oidc/end_session` 触发全局登出                                                                                       |
| `POST /auth/backchannel-logout` | **必须**实现，见 §9                                                                                                                                           |

> 鉴权中间件：每请求读 `__Host-vx_rp_session` → 载会话 → 验 access_token → 注入 user 上下文；失败转重登。

---

## 5. 会话与 Cookie 模型（强制）

- **token 只在 ruyin-BFF 服务端持有**（RP 会话存服务端，如 Redis），浏览器**绝不**见 access/id/refresh token。这是本节**真正的硬约束**（不透明、无 token、服务端验签）。
- 浏览器仅持一个**不透明** RP 会话 cookie（指向服务端会话），`HttpOnly; Secure; SameSite=Lax`。cookie 作用域二选一：

  | 形态                               | cookie                                                                          | 适用                                                                     | 约束                                                                                                                                                                     |
  | ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | **默认（推荐）**                   | `__Host-vx_rp_session`，host-only                                               | 单一 host 的 RP                                                          | `__Host-` 前缀强制无 `Domain` + `Secure` + `Path=/`                                                                                                                      |
  | **多子域变体（D-BI，已授权豁免）** | `vx_rp_session`（**去 `__Host-` 前缀**），`Domain=.<RP-apex>`（如 `.ruyin.ai`） | 一次登录需覆盖 apex + 自有 `*.<RP-apex>` 子应用（website/console/admin） | `__Host-` 与 `Domain` 物理互斥，故去前缀；**必须** `Secure`+`HttpOnly`+`SameSite=Lax`（**禁 `None`**）、保持不透明无 token；RP **须掌控全部子域**（防子域接管/悬空 DNS） |

  > 变体豁免依据：该 cookie 是 RP **自有域**的不透明会话句柄，**从不到达 IdP**，对 IdP/平台安全零影响；SSO 真正锚点是 `vx_sid`@accounts.vxture.com（IdP 侧 host-only，不受影响）。back-channel 登出按 `sid` 服务端索引销毁，**与 cookie 作用域无关**（§9 不受影响）。

- 退役所有 `ry_access_token` / `ry_refresh_token`（明文 token cookie）。

---

## 6. Token 校验规则（ruyin 必须强制执行）

对 **id_token / access_token / logout_token** 一律：

1. **`alg` 必须 `RS256`**；显式**拒绝 `none` / `HS*`**（防降级攻击）。
2. header 必须有 `kid`；按 `kid` 从 `GET /oidc/jwks` 取公钥（**缓存**，未命中**刷新一次** JWKS 再试——支持密钥轮换）。
3. `iss` 必须 `=== https://accounts.vxture.com`。
4. `aud` 必须 `=== "ruyin"`。
5. `exp` 校验允许 **60s 时钟偏移**（`exp + 60 >= now`）。
6. id_token：`nonce` 必须等于本次请求发出的 `nonce`。
7. **绝不信任**未验签 token 或浏览器侧传入的 claim。

---

## 7. id_token claims（契约）

```json
{
  "iss": "https://accounts.vxture.com",
  "aud": "ruyin",
  "sub": "usr_<account_uuid>",
  "iat": 1781000000,
  "exp": 1781000300, // 300s
  "jti": "tok_...",
  "sid": "<IdP 中心会话 id>", // 关联 back-channel logout
  "nonce": "<回显>", // 若请求带
  "auth_time": 1781000000,
  "userType": "tenant_user"
}
```

`sub` 命名空间：tenant 账号恒 `usr_` 前缀；业务库引用 `user_id` 时用**完整 `sub`**（或剥前缀后的 uuid，团队内统一一种，建议存完整 `sub`）。

---

## 8. access_token claims（契约）

> **v2 修订（2026-06-19，与现行 IdP 代码一致）**：上下文模型已由 legacy `active_tenant_*` / `tenants` 切换为四层模型的 **`active_org` / `active_workspace` / `roles`**（`bff/auth-bff` `access-claims.ts` / `oidc.service.buildTenantIdentityClaims`）。人类身份声明（`name`/`preferred_username`/`account_status`/`email`/`phone`）**已在 access_token 下发**（`profile` scope 给 `name`/`preferred_username`，`account_status`/`email`/`phone` 随 app 上下文恒发）。`entitlement` **当前不下发**（见下方 §8.1 / §10）。

```json
{
  "iss": "https://accounts.vxture.com",
  "aud": "ruyin",
  "sub": "usr_<account_uuid>",
  "iat": 1781000000,
  "exp": 1781000900, // 900s
  "jti": "tok_...",
  "scope": "openid profile email phone umbra umbra:subscription",
  "token_type": "Bearer",

  "userType": "tenant_user",
  "sid": "<IdP 中心会话 id>",

  // 人类身份（§5 关键修复）
  "name": "张三", // profile scope；无 name 回落账号 handle
  "preferred_username": "zhangsan", // profile scope；账号 handle
  "account_status": "active", // active | suspended | …
  "phone": "+86...", // 强锚点(B3)，可能缺省
  "phone_verified": true,
  "email": "user@...", // 可能缺省
  "email_verified": false, // 平台暂不断言已验证
  "picture": "https://accounts.vxture.com/avatar/usr_<id>?v=<hash>", // 待头像特性落地；profile scope，无自定义头像则缺省

  // 上下文（四层模型；ruyin 恒个人 org/workspace）
  "active_org": "<org_uuid>",
  "active_org_type": "personal", // personal | team —— 个人/团队判定唯一可靠信号
  "active_org_name": "张三的个人组织", // org 展示名；缺省时 RP 自行兜底
  "active_workspace": "<workspace_uuid>",
  "active_workspace_name": "默认工作区", // workspace 展示名；缺省时 RP 自行兜底
  "roles": ["org:owner", "workspace:owner"] // scope 前缀的治理角色码
}
```

> 取数注意：
>
> - `name`/`preferred_username`/`account_status` 随 `profile`（ruyin 已请求）即得；**`email`/`phone` 必须把 scope 扩为 `openid profile email phone ruyin`** 才下发（`allowed_scopes` 已放行）。
> - `picture` 属头像特性（`docs/30-design/identity-platform-account.md`），落地后随 `profile` 下发；无自定义头像则缺省，ruyin 前端兜底默认头像。
> - `active_org_type` / `active_org_name` / `active_workspace_name` 为展示上下文：`active_org_type`（`personal`|`team`）是个人/团队的唯一可靠判定信号（每账号都有个人 org，故 `active_org` 本身无法区分）；名称免去 RP 仅为渲染面板而回查 IdP。缺省时 RP 自行兜底（如 org_type→个人、org_name→"<用户名>的个人组织"、workspace_name→"默认工作区"）。
> - ⚠️ **不要**再读 legacy `active_tenant` / `active_tenant_role` / `tenants` —— 已不下发。

### 8.1 entitlement（订阅门控）—— 当前**不下发**（暂缓）

`entitlement` 属 commerce（订阅 P0.5）域，**现行 IdP access_token 不携带**（`access-claims.ts`：无 business entitlement）。在 commerce 落地前：

```json
// 现状：access_token 无 entitlement 字段
```

ruyin **暂不能**依赖 token 内 entitlement 做硬门控（§10 为目标态契约，待 commerce 接通后回填）。过渡期 ruyin 视为"无门控/全放行"或自行降级，**不得**因缺 `entitlement` 而拒绝已认证用户。

---

## 9. Back-channel Logout 契约（**跨域唯一登出手段，必须实现**）

**为什么必需**：全局登出销毁 `.vxture.com` 的 `vx_sid`，**无法**清掉 `ruyin.ai` host 的 RP 会话 cookie（跨域）。杀 ruyin 会话的唯一途径是 IdP 服务端 → ruyin 服务端的 back-channel logout。

**IdP 发送**：`POST https://ruyin.ai/auth/backchannel-logout`，`Content-Type: application/x-www-form-urlencoded`，body：

```
logout_token=<RS256 JWT>
```

`logout_token` claims：

```json
{
  "iss": "https://accounts.vxture.com",
  "aud": "ruyin",
  "sub": "usr_<account_uuid>",
  "iat": 1781000000,
  "exp": 1781000120, // 120s
  "jti": "...",
  "sid": "<中心会话 id>",
  "events": { "http://schemas.openid.net/event/backchannel-logout": {} }
}
```

**ruyin 须**：

1. 验 `logout_token`（§6 全套：RS256/JWKS、`iss`、`aud==ruyin`）。
2. 校验 `events` 含 `http://schemas.openid.net/event/backchannel-logout`，且含 `sid`（或 `sub`）。
3. 用 **`sid → rpsid` 索引**（建会话时维护，如 Redis `ruyin:sididx:{sid} -> {rpsid...}`）找到该 `sid` 的全部 RP 会话 → 销毁。
4. 回 `200`（best-effort；IdP 不重试阻塞，但应尽力成功）。

> 建议：RP 会话建立时把 access_token 的 `sid` 与本地 `rpsid` 建反向索引，供此处定位。

---

## 10. Entitlement 硬门控（per-app，ruyin 与 console/website 的关键区别）

> ⏸ **状态（2026-06-19）：目标态契约，当前未生效**。现行 IdP access_token **不下发** `entitlement`（见 §8.1）；待 commerce（订阅 P0.5）接通后回填。过渡期 ruyin **不得**因缺 `entitlement` 拒绝已认证用户。

ruyin 是 **business app**，**每请求**按 `access_token.entitlement` 门控（**目标态**）：

| `entitlement.status`   | 处理                                        |
| ---------------------- | ------------------------------------------- |
| `active` / `trial`     | 正常放行（须 `expires_at` 未过期或为 null） |
| `past_due`             | **宽限**：只读/限用（按 ruyin 产品策略）    |
| `expired` / `canceled` | 拒绝业务功能 → 跳订阅页                     |
| `entitlement` 缺失     | 视为无订阅 → 跳开通/订阅页                  |

- entitlement 来自平台 `(active_tenant, ruyin)` 订阅（P0.5），随 token 下发；ruyin **不查平台订阅 DB**。
- ruyin **业务角色**（任务负责人/审核员等）在 **ruyin 自有库**，用 `(active_tenant, sub)` 解析，**不进 token**。

---

## 11. 刷新与轮换

- `refresh_token` 是**不透明串**（非 JWT），服务端存储。
- **每次刷新轮换**：返回**新** `refresh_token`，旧的作废。
- **重放检测**：重复使用已消费的 refresh → IdP **吊销整个 family** 并回 `400 invalid_grant`。ruyin 收到后应销毁本地 RP 会话并转重登。
- **静默续期**：access 近过期（建议剩 ≤60s）时，ruyin-BFF 后台用 refresh 换新，`rpsid` cookie **不变**（轮换只在服务端）。
- refresh 失败（过期/被吊销）→ 销毁会话 → 重登。

---

## 12. 错误处理速查

| 场景                    | IdP 行为                           | ruyin 应对               |
| ----------------------- | ---------------------------------- | ------------------------ |
| 未登录 + 交互 authorize | 302 到 IdP 登录页                  | 正常（用户登录后回流）   |
| 未登录 + `prompt=none`  | `?error=login_required`            | 触发交互式 `/auth/login` |
| `redirect_uri` 不符     | 400（不重定向）                    | 配置错误，自查登记值     |
| PKCE/码失效             | `400 invalid_grant`                | 重新 `/auth/login`       |
| client 认证失败         | `401 invalid_client`               | 自查 secret              |
| refresh 重放            | `400 invalid_grant`（family 吊销） | 销毁会话，重登           |
| 全局登出                | back-channel POST                  | 销毁对应 sid 会话        |

---

## 13. 配置 / 环境变量（ruyin-bff）

| 变量                 | 值                                 |
| -------------------- | ---------------------------------- |
| `OIDC_ISSUER`        | `https://accounts.vxture.com`      |
| `OIDC_CLIENT_ID`     | `ruyin`                            |
| `OIDC_CLIENT_SECRET` | secret manager 派发                |
| `OIDC_REDIRECT_URI`  | `https://ruyin.ai/auth/callback`   |
| `OIDC_SCOPES`        | `openid profile email phone ruyin` |
| `RP_SESSION_TTL`     | RP 会话 TTL（建议 ≤ refresh TTL）  |

> ~~`OIDC_RP_ENABLED` 灰度开关~~ **已删（D-BJ）**：用于一次性桥并存期回退；桥已退役（§14 历史留档），开关无意义。**vxture 自身实现亦已移除**（Batch 16a D-BD）。RP 用"OIDC 配置（issuer+client_secret）存在与否"门控功能等价（缺则端点降级 503），无需此命名变量。

---

## 14. 迁移与退桥时序（金丝雀，可回滚）

> 🗄 **历史留档**：一次性桥已退役、ruyin 全量走 OIDC RP；本节仅作迁移背景，`OIDC_RP_ENABLED` 已删（见 §13 D-BJ）。

1. **并存上线**：ruyin OIDC RP 与现网一次性桥**并行**；ruyin-BFF 双读（新 `__Host-vx_rp_session` 优先，回落 `ry_*`）。
2. **灰度切换**：`OIDC_RP_ENABLED=on`（ruyin）→ 新登录走 OIDC；console 不再触发 `/auth/crossdomain/token`。
3. **验证全绿**（§15）：跨域 SSO、back-channel 登出、entitlement 门控、刷新降级。
4. **退桥**（验证后）：
   - **vxture 侧**删 `crossdomain.router`（`/auth/crossdomain/token`、`/auth/crossdomain/verify`）+ Redis `vx:crossdomain:*` + console `sso/start` 触发。
   - **ruyin 侧**删 `ry_access_token`/`ry_refresh_token` 逻辑 + 一次性 token 消费。
   - 退桥**不与上线同 PR**，留观察期；退役前保留回退开关。

> HS256 旧共享密钥链路与子域 RP 旧 cookie 仍等 **P5** 统一退役；P3 只退**桥**。

---

## 15. 验收清单（双方联调）

- [ ] 已在 vxture（console/website）登录 → 顶级访问 ruyin.ai **免再登录**（`prompt=none` 静默发码）。
- [ ] 全局登出 → ruyin 经 back-channel **会话被杀**，下次请求重登。
- [ ] ~~entitlement：`expired`→跳订阅页…~~ **暂缓**（§8.1：当前不下发；待 commerce 接通后验，过渡期不硬门控）。
- [ ] 篡改 id_token/access_token/logout_token → ruyin **拒**（验签/iss/aud/exp/nonce）。
- [ ] 浏览器**零 OIDC token、零 `ry_*`**，仅持**不透明** RP 会话 cookie（`__Host-vx_rp_session` host-only **或** 多子域变体 `vx_rp_session`+`Domain=.<apex>`，见 §5 D-BI）。
- [ ] refresh 轮换：旧 refresh 重放被拒（family 吊销）。
- [ ] 退桥后登录/续期/登出全链路正常。
- [ ] 非顶级（iframe）静默授权**不被依赖**。

---

## 16. 需双方对齐的协调项（OPEN）

1. **client_secret 派发**：经 secret manager，不入任一代码库；轮换机制约定。
2. **redirect_uri / back_channel_logout_uri / post_logout_redirect_uri 生产值**登记：当前 seed 取 `RUYIN_BASE_URL`（dev `http://localhost:3080`），**生产域名须确认**并更新 `identity.oidc_client(ruyin)`。
3. **JWKS 轮换**：ruyin 须实现「未知 kid → 刷新 JWKS」；平台轮换前会保留旧 kid 一段重叠期。
4. **联调环境**：平台提供 dev IdP（`http://localhost:3081`）+ dev client secret，供 ruyin 本地 e2e。
5. **provisioning（开通 webhook）** 在平台 **P4** 落地；P3 期 ruyin 个人租户可走「注册即激活」路径。
