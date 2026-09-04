# Identity 账号与认证（identity 板块 · 详细层）

> 🧭 架构层见 [`identity-platform-architecture.md`](./040-architecture.md)（板块定位 / 边界 / 拓扑总览 / 双 realm）。本文 = **账号标识 / 登录手段 / 社交联邦 / 账号合并 / 头像 的详细层 reference**。IdP 端点 / 密钥 / 会话机制见 [`identity-platform-idp.md`](./070-idp.md)；RP 接入见 [`identity-platform-rp-integration.md`](./080-rp-integration.md)。
> 平台数据模型权威 = [`data_platform_100_architecture.md`](../data_platform_100_architecture.md)（a）+ [`data_platform_200_schema.md`](../data_platform_200_schema.md)（b）：`users` / `identities` / `user_credential` / `user_avatar` 等字段级见 **b §4 identity**，本文**不重述 DDL**。
> 合并自 `identity-account-consolidation` + `identity-auth-consolidation` + `identity-sso-google-provider` + `identity-avatar`，2026-07-01。状态：机制基线（statement-of-record）。

---

## 1. 账号标识模型

一个平台用户三层标识，职责互不重叠：

| 标识                  | 形态                          | 可变性              | 用途                                           | 备注           |
| --------------------- | ----------------------------- | ------------------- | ---------------------------------------------- | -------------- |
| `id`（内部 PK）       | `usr_<uuid>`                  | 永不变              | 系统内部引用（如 `/avatar/usr_...`、外键）     | 已有           |
| `user_no`             | 纯 10 位数字，如 `1000010000` | 永不变              | 对外**稳定可读 ID**：客服 / 工单 / 展示 / 追溯 | 新增列         |
| `account`（username） | 字符串                        | 可改（查重 + 限频） | 账号密码登录标识、`preferred_username`         | 已有，规则收紧 |

**关系**：`id` 是机器主键（不可读）；`user_no` 是它的人类可读对偶（即便 `account`/`email`/`phone` 全改了，也能用 `user_no` 唯一锁定追溯）；`account` 是用户自选的登录名。

### 1.1 `user_no` 规格

- **形态**：纯数字，展示为 10 位；起点 = 10 亿 + 1 万（首号 `1000010000`）。
- **生成**：建号时取序列 `nextval` 写入主档；不复用（用户注销也不回收号段）。
- **唯一 + 并发安全**：全局唯一；序列天然并发安全，无需应用层加锁。

> 字段级 DDL（`bigint` 列、`identity.user_no_seq` 序列、唯一约束）为平台数据模型，见 b §4 identity / a §3.4，落地见 migration 0006。

### 1.2 `account`（username）规格

- **默认值**：建号时 `account = "_" + user_no`，例如 `_1000010000`（**下划线开头**）。
- **修改规则**：首字符必须 ASCII 字母 `[A-Za-z]`；字符集 `[A-Za-z0-9_]`，长度 3–24；全局唯一（沿用 `users.account` 唯一约束 + 注册 / 改名时查重）；限频（例如 90 天一次，阈值实现时定）。
- **互斥不撞（关键不变式）**：系统默认一律 `_` 开头，用户自选一律字母开头 → 两类前缀互斥，用户自选名**永远不可能**等于某个系统默认名，无需 `^u\d+$` 之类禁用规则。同理用户名首字符必须字母 ⇒ 不可能纯数字 ⇒ 永不与"纯数字的 `user_no`"在展示上混淆。
- **废弃旧逻辑**：`deriveAccount` 当前"无 `email` 时塞手机号"分支**移除**（曾生成 `u_{手机后11位}_{随机}`，把完整手机号嵌入 `account` 并经 `preferred_username` 流入 token → 隐私泄露），改为 `_{user_no}`。

### 1.3 手机 = 账号归属锚点

**手机始终是账号归属的唯一强锚点**（D-5）：`email` 从不参与"找人 / 并号"，只在账号已确定后用于填充展示字段与（已验证态）邮箱验证码登录。此不变式贯穿社交联邦（§3）与账号合并（§4）。

---

## 2. 登录手段与验证码

`/authorize` 登录页复用既有能力，**只把「签 JWT + 设 cookie」的尾部换成「建中心会话 + 继续 authorize」**（IdP 机制见 [`identity-platform-idp.md`](./070-idp.md) §7）。tenant realm 登录面**验证码优先**；operator realm 永远密码-only、无 tab、无验证码 / 社交 / 注册。

### 2.1 登录 tab 与智能输入框

- **验证码优先（D-CA）**：验证码登录为第一登录模式（默认选中 + 左侧 tab），账号 + 密码为第二（右侧）。tab 文案顺序固定 `验证码登录 | 密码登录`。仅 tenant realm 有 tab。
- **单一智能输入框（D-CC）**：验证码 tab 一个标识输入框，前端自动识别手机号（`/^1[3-9]\d{9}$/`）vs 邮箱（含 `@`），发对应渠道验证码、提交走对应登录端点，不做手机 / 邮箱子切换；无法判定则前端提示。占位符如「手机号 / 邮箱」。
- **密码 tab 三标识**：邮箱 / 用户名 / 手机号 + 密码。后端 `AccountService.verifyCredential` 已解析三种，零改。

### 2.2 手机验证码（强锚点 · 登录即注册）

- 端点 `POST /auth/send-phone-code` + `POST /oidc/authorize/login/phone`；服务 `AuthnService.loginWithPhoneCode`，用 `@vxture/service-sms` `PhoneCodeService`（scope `tenant-auth`）。
- **新手机自动建号**（登录即注册）——手机码是平台**唯一注册锚点**，不变。

### 2.3 邮箱验证码（仅登录 · 不注册）

- **仅对已绑定且已验证邮箱的现有账号开放（D-CB）**：邮箱无对应账号 → 报错、不建号。新用户路径 = 手机码注册 → 账号中心绑邮箱 → 之后可邮箱码登录。
- 后端（auth-bff）：`AuthnService.sendEmailCode(email)` → `VerifyCodeService.sendCode`（限流命中抛 429）；`AuthnService.loginWithEmailCode(email, code)` → `verifyCode.verifyCode` 失败抛 401；通过后按邮箱解析账号，**无账号 → 404 `email_not_registered`**，命中则签发会话（沿用手机码的会话 / active-context 装配，去掉自动建号分支）。
- 端点：`POST /auth/send-email-code`（`{ email, turnstile_token? }`，Turnstile 门控比照 `send-phone-code`）+ `POST /oidc/authorize/login/email`（`{ login_challenge, email, code }` → `{ redirectTo }`，tenant-only realm 守卫）。
- **登录态查询收紧**：`findUserByIdentifier` 的邮箱匹配须加 `email_verified_at is not null` 条件（当前实现 `lower(coalesce(email,''))=lower($1)` 不区分验证态 → 接管风险，见 §4.3）。

### 2.4 验证码服务与 Redis 键（D-CE）

两条验证码链路各用既有 service，均 6 位码、TTL 600s、一次性销毁、三级限流（1m / 1h / 1d），无需新建：

| 渠道 | service                                        | Redis 键前缀                   | scope         | 归属包                 |
| ---- | ---------------------------------------------- | ------------------------------ | ------------- | ---------------------- |
| 邮箱 | `VerifyCodeService`（`sendCode`/`verifyCode`） | `vc:*`（如 `vc:code:{email}`） | —             | `@vxture/service-mail` |
| 手机 | `PhoneCodeService`                             | `svc:*`                        | `tenant-auth` | `@vxture/service-sms`  |

- 邮箱码底层：`VerifyCodeService.sendCode(email)` / `verifyCode(email, code)` + `MailService.sendVerifyCode`（`services/notification/mail/src/service/verifycode.service.ts`）。auth-bff 的 `AuthnModule` 已 import `MailModule`（导出 `VerifyCodeService`），DI 零额外接线。
- Turnstile 门控沿用 tenant site key。

### 2.5 认证中心边界

accounts.vxture.com 是全平台**唯一**认证中心，承载登录 / 注册（手机码即注册）/ 找回密码 / 绑定手机 / 绑定邮箱 / 登出。其它 portal（website / console / admin）**零认证表单**——只跳 accounts 的 OIDC RP redirect（`buildRpLoginUrl` / `buildLogoutUrl`）。找回密码走 accounts 中央面 `/forgot-password` + `/reset-password?token=`（IdP `POST /auth/forgot-password` 恒 200 防枚举 + `POST /auth/reset-password`，邮箱链接）；社交补绑走 `/bind-phone?binding_token=` + `POST /auth/oauth/bind-phone`；登出走 `/logout` 统一 post-logout（SLO / back-channel 已闭合）。legacy `console` 本地 reset 表单及 `/api/auth/reset-password` 已退役。

---

## 3. 社交联邦 broker（入站）

平台作为**入站 broker** 消费上游社交 IdP（"用 X 登录"），接 `identity.oauth_provider`（入站表）——**不是** `oidc_client`（出站发 token）。两者方向相反。已接 Dingtalk / Feishu / Google。

**表驱动基座（#166，零架构改动）**：`oauth.router` 的 `createProvider` 工厂、`OAuthProvider` 接口、`PgOAuthProviderRepository`、`sso_connection` 绑定、`vx:oauth:state` / `vx:oauth:bind`、手机强锚点绑定流程共用。新增一个上游 = 加一个 provider 类 + 扩 `OAuthProviderType` 一个枚举值 + `identity.oauth_provider` 一行配置。

### 3.1 provider 标准化 profile

各 provider 构造 `(clientId, clientSecret)`，实现 `buildAuthorizationUrl` / `exchangeCode` / `getUserInfo`，输出标准化 profile：

```ts
{
  (providerId, email, emailVerified, name, avatar, phone);
}
```

- **`OAuthUserProfileResponse` 增 `emailVerified?: boolean`**（provider 验证信号透传）：Google 透传 `email_verified` 真值；Feishu / Dingtalk 恒 `false`（只给字符串、未经平台验证）。
- provider 抓的头像字段：Feishu `avatar_big`、Dingtalk `avatarUrl`、Google `picture`（见 §5.4 首创导入）。

### 3.2 Google provider（入站 OIDC broker）

| 项          | 值                                                          |
| ----------- | ----------------------------------------------------------- |
| 授权端点    | `https://accounts.google.com/o/oauth2/v2/auth`              |
| token 端点  | `https://oauth2.googleapis.com/token`                       |
| userinfo    | `https://openidconnect.googleapis.com/v1/userinfo`          |
| JWKS        | `https://www.googleapis.com/oauth2/v3/certs`                |
| scope       | `openid email profile`                                      |
| 稳定用户 ID | `sub`（Google OIDC subject，作 `providerAccountId`）        |
| 返回字段    | `email`、`email_verified`、`name`、`picture`；**★无 phone** |
| PKCE        | 支持，强制 S256                                             |

- 配置为 `identity.oauth_provider` 一行（`code=google`、端点 URL、`client_id`/`client_secret` 经 secret manager、`redirect_uri = https://accounts.vxture.com/auth/oauth/google/callback`、`is_enabled=true`）。启用 / 停用仅靠 `is_enabled`，无需改 env / 重部署（#166）。
- Google 控制台须把 `redirect_uri` 加入 OAuth client "已授权重定向 URI"白名单（登录闭环前置）。
- **可选优化**：Google 是 OIDC，`id_token`（验签 JWKS + `aud`==clientId + `nonce`）已含 `sub`/`email`/`email_verified`，可直接解析省掉 userinfo 调用；默认与其它 provider 一致走 `exchangeCode → getUserInfo`，id_token 直解记为推荐增强（须正确缓存 Google JWKS + 校验 `aud`/`nonce`/`iss`）。
- **网络现实**：Google 端点境内可达性属基础设施（代理 / 网络策略），非本设计（当前 Google 出海口暂缓）。

### 3.3 state / bind / 绑手机流程（B3）

`state`（CSRF，`vx:oauth:state` 10min GETDEL）+ `nonce`（id_token 防重放）+ PKCE（S256）；`redirect_uri` 精确白名单（平台侧 + 上游控制台双白名单）。以 Google 为例（Google 无手机 → 每次新登录必走绑手机；Feishu / Dingtalk 若返手机可能直接返）：

```
用户点"用 Google 登录"
  → /auth/oauth/google/start → 302 Google（state 存 vx:oauth:state 10min）
  → Google 授权 → callback?code&state
  → 校验 state；exchangeCode；getUserInfo → { sub, email, emailVerified, name, phone:null }
  → 查 sso_connection(google, sub)：
       命中 → 直接登录该账号（已绑过手机）
       未命中 → 无已验证手机 → status="needs_phone_binding"
                 存 vx:oauth:bind:{token} = {provider:google, sub, email, name}（10min）
                 → 前端跳绑手机页
  → POST /auth/oauth/bind-phone（取 pending、验手机验证码）
       → 按 phone 解析/创建账号（登录即注册）
       → 链 sso_connection(google, sub) + 存 providerAccountData 快照
       → 签发/建会话
```

- **身份解析与链接**：命中 `sso_connection(provider, provider_account_id=sub)` → 登录其 `account`；未命中经手机绑定 → 按已验证 `phone` 在主档解析 / 创建 → 建 `sso_connection` + `providerAccountData` = provider profile 快照。
- **诊断日志只记是否拿到 email / phone，不记值**；`client_secret` 仅 secret manager。

### 3.4 与 IdP 登录页的关系（正交 · 复用）

同一 provider 类**双链路复用**：现网 `oauth.router` 旧流程 callback 直接解析 / 建会话；未来 IdP `/authorize` 登录页把 callback 落点改为"建 IdP 中心会话"（而非直接签租户 token），绑手机 / 解析 / 链接不变。迁移时 provider 不动。

---

## 4. 账号合并与邮箱两态

多 provider 先后登录（如先钉钉后飞书）时如何整合到一个平台用户。核心：**账号归属永远由手机锚点决定，`email` 从不参与找人 / 并号，只在账号已确定后填充展示字段。**

### 4.1 手机锚点合并 · 空则回填

每次社交登录，账号由手机强锚解析 / 创建后，对主档执行"为空才补"：

| 字段     | 回填条件                                                          | 验证标记                                                      |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `email`  | `user.email` 为空 且 provider 给了 email 且**该邮箱未被他人占用** | provider 已验证 → 写 `email_verified_at=now()`；否则留 `null` |
| `name`   | `user.name` 为空 且 provider 给了 name                            | —                                                             |
| `avatar` | 沿用现状（仅建号时导入一次，见 §5.4）                             | —                                                             |

- **去重跳过**：若回填的 `email` 已被别的账号占用 → 跳过、不报错、记日志（绝不并号）。
- **provider 快照仍写**：`identity.identities.metadata` 继续保存每个 provider 的原始 `email` / `name` / `avatar` 快照（非权威，便于审计 / 溯源）。
- **A 禁止 / B 放开**：A（不同 provider `email` 相同就自动并号）风险高（撞邮箱 → 越权并号）→ **永久禁止**；B（账号已由手机唯一确定，只填空白字段）风险低 → **放开**（本设计）。

### 4.2 邮箱两态模型

provider 给的邮箱默认不可信。落库 `users.email` + `users.email_verified_at`（`null` = 未验证）：

| 状态       | 来源                                                 | 可作登录锚？ | 用途                      |
| ---------- | ---------------------------------------------------- | ------------ | ------------------------- |
| **未验证** | Feishu / Dingtalk userinfo 的 email 字段             | ❌ 否        | 展示、找回提示            |
| **已验证** | Google `email_verified=true`，或用户在平台亲自验证过 | ✅ 是        | 展示 + **邮箱验证码登录** |

### 4.3 接管风险与门控

> 若把未验证回填邮箱当登录锚：A 用手机注册、飞书回填邮箱 `X@y.com`（平台没验过，可能输错 / 共享邮箱）；B 才是 `X@y.com` 真主人 → B 走邮箱验证码登录收到码 → **登进 A 的账号**。接管。

因此：邮箱验证码登录**只匹配 `email_verified_at IS NOT NULL` 的账号**（`findUserByIdentifier` 收紧，见 §2.3）；首次验证入口 = 登录态用户在 accounts 页主动验证邮箱（发码 / 链接）→ 置 `email_verified_at` → 此后可用于验证码登录。推论：Google 用户（provider 已验证）天然即可邮箱码登录；Feishu / Dingtalk 用户需亲验一次。**邮箱码登录绝不因邮箱相同而自动合并身份**（沿用 §4.1 原则）。

> 部署纪律：**先跑迁移**（加列 + 回填存量 `user_no`）→ **再晋升代码**（建号取 `nextval`、回填逻辑、username 校验），与头像列上线节奏一致。

---

## 5. 头像

**北极星**：头像永远是平台自有资源，经 IdP 的 `picture` claim（一个版本化 URL）下发给 RP；RP 不查库、不代理图片，图片字节缓存交给浏览器 HTTP 缓存。三方头像只在账号**首次创建**时导入一次，之后三方仅用于登录。

### 5.1 存储底座（D-1）

**头像字节存 Postgres bytea + 平台缓存端点服务**（单机、无对象存储；头像 10–50KB 小图，零新基建、事务一致）。表 `identity.user_avatar`（字段级见 b §4 identity）用途 / 语义：

- `users.avatar_url`（既有列）：**弃用其"存外部 URL"原意**，URL 改由端点派生、不再持久化整 URL；保留列以便未来迁对象存储时存 CDN 直链（§5.8）。
- 版本来源 = `user_avatar.hash`；**无行 = 无自定义头像 → 不写 `picture` claim**（前端兜底默认）。平台不为默认头像建行 / 生成。
- `hash` 冗余到 `users.avatar_hash varchar(64) null`，让 claim 构建只读 `users`（避免 join `user_avatar` 大字段）；`avatar_hash` 为 null 即"无自定义头像"。`user_avatar` 仅在服务端点读字节。

### 5.2 默认头像（D-2）

**默认头像是各应用的前端资产——内联通用剪影 SVG（`fill: currentColor`），按登录态 / 未登录态用 CSS 配色；平台不服务默认头像。**

- 资产 `avatar-default.svg`（通用人物剪影，`fill: currentColor` + `1em`），已升入 `@vxture/design-system` 供 console / website / admin 共享，ruyin 跨仓自带一份。
- **关键约束**：`<img src=…>` 加载的外部 SVG 无法继承 host 页面 `currentColor`，故"按登录态配色"只能内联 `<svg>`（或 `<use>`）——这正是默认头像必须落前端、非平台端点服务的原因。
- 渲染规则（所有应用）：`picture ? <img src=picture> : <DefaultAvatar/>`，外层 CSS `color` 按状态切换。

### 5.3 服务端点与缓存（D-4）

```
GET {ACCOUNTS_BASE}/avatar/usr_<id>?v=<hash>[&s=64]
```

- 由 auth-bff（accounts 同源）提供，nginx 将 `/avatar/*` 路由至此。
- **只服务自定义头像**：有 `user_avatar` 行 → 返字节（`Content-Type: image/webp`）；无行 → `404`。
- 响应头：带 `?v=<hash>` → `Cache-Control: public, max-age=31536000, immutable` + `ETag: <hash>`；恒带 `X-Content-Type-Options: nosniff`。
- **公开读**：头像低敏、免鉴权（`<img>` 跨域加载不带凭据）；URL 含 UUID（不可枚举）。`s` 尺寸变体服务端按需缩放（可进程内 LRU）。

### 5.4 三方首创导入（D-3）

- 触发点：社交登录走到"新建用户"分支（非"匹配既有 subject"）。provider 已返回 `avatar`。
- 流程：`fetch(avatar)` → 校验 content-type / 大小 → 归一化为 webp（≤256px）→ 写 `user_avatar` + `users.avatar_hash`，`source=<provider>`。
- **网络现实**：境内大概率拉不到 Google 头像（与 Google 登录受阻同因），Feishu / Dingtalk 一般可达。下载失败 → 不建 `user_avatar` 行（`picture` 缺省 → 前端兜底），账号正常创建、不阻断。
- 幂等：以 `user_avatar` 是否已有行为准；既有用户再三方登录**不**覆盖用户自定义。

### 5.5 上传 / 修改端点（D-5）

- `PUT /api/me/avatar`（登录态）：仅 `image/png|jpeg|webp`，大小上限（≤5MB），重编码为 webp（≤256px，剥 EXIF）。
- **拒绝 SVG 上传**（可内嵌脚本，存储型 XSS 风险）；默认头像 SVG 是平台生成、可信，二者区别对待。
- 写入后更新 `user_avatar.data`/`hash`/`updatedAt` + `users.avatar_hash` → 版本段变 → 下次 token `picture` 自动指新图。

### 5.6 经 IdP 传递 `picture` claim（D-6）

- `buildTenantIdentityClaims`（`oidc.service.ts`）`profile` 分支补：**有自定义头像才发**
  ```
  if (user.avatarHash) picture = `${ACCOUNTS_BASE}/avatar/usr_${id}?v=${user.avatarHash}`
  ```
  无 `avatarHash` → 不写 `picture`（前端兜底）。与 `name` / `preferred_username` 同位、同门控。
- `UserView` + `getUserById` 增 `avatarHash`（不含字节）；`/oidc/userinfo` tenant 分支补 `picture`；discovery `claims_supported` 增 `picture`。

### 5.7 RP / ruyin 消费与缓存（D-7）

- 工具包 `@vxture/core-oidc-rp`：`RpUser` 增 `picture: string | null`，`mapAccessClaims` 容错映射。
- 渲染契约：`picture ? <img src={picture}> : <默认剪影>`，默认必须前端内联（剪影 SVG，`fill:currentColor` 按登录态配色），**禁空 `src`**。`picture` 为 null（无自定义头像）属常态。触发 scope = `profile`（ruyin 已请求，无需改 scope）。
- 缓存分层：picture URL 存 rpsess（来自 token，refresh 自动更新）；图片字节走浏览器 HTTP 缓存（版本化 + immutable，首登拉一次、后续命中）；**RP 服务端不代理、不缓存图片**。
- 同仓组件 `@vxture/design-system` 的 `<UserAvatar src={user.picture} alt={user.name}/>`；ruyin（umbra，跨仓 OUT）自带等价实现 + 可选 localStorage 防闪烁。

### 5.8 版本化 / 失效与迁移（D-8）

- **URL 即版本**（`?v=<hash>`）："改头像 = 换 URL" → 即时失效 + 永久缓存并存；旧 URL 内容不变可长期缓存，新版本是新 URL 必拉新。RP 滞后上限 = 一个 access_token TTL（≤900s）后 `picture` 即更新，展示场景可接受，无需推送 / 事件。
- **迁移路径**：规模 / 多机上来后迁 OSS / S3，`avatar_url` 列复用为 CDN 直链、`picture` 改指 CDN；端点与 claim 语义不变，RP 侧零改动。

### 5.9 console 上传接入（批次 H）

在 console 个人信息页（`ProfilePage.tsx`）用真正的文件上传替换旧"粘贴 URL"交互。

- **架构事实**：console-bff 是同集群第一方 BFF，`SessionAggregator` 已直接 import `@vxture/service-account` 的 `AccountService`。故头像上传沿用同一模式：console-bff `PUT /api/me/avatar` → `AccountService.setAvatar` **直连库**（不代理 auth-bff）。"RP 不查库"只约束**跨域** RP（ruyin 改头像须走 IdP Bearer API，本设计 OUT）。鉴权用 `req.user`（RP 会话中间件注入），不碰 `vx_sid`。
- **数据契约**：`getCurrentUser` / `getCurrentUserProfile` 响应新增 `picture: string | null`（有 `avatarHash` → `${OIDC_ISSUER}/avatar/usr_<id>?v=<hash>`，否则 null）；`PUT /api/me/avatar` → `{ picture }`（新版本 URL，供即时刷新，免等 token 刷新）；`DELETE /api/me/avatar` → `{ status: "ok" }`（移除 → 回落前端默认剪影）。
- **后端**：`service-account` 增 `deleteAvatar(userId)`（事务：`delete from user_avatar` + `update users set avatar_hash = null`）；`sniffImageType` / `AVATAR_MAX_BYTES` 从 auth-bff 上移入 service-account 导出（auth-bff 改 import、console-bff 复用、避免漂移）。console-bff `MeRouter` 加 `@Put("avatar")` / `@Delete("avatar")`，`main.ts` 注册 `express.raw({ limit: "5mb" })` 于 `/api/me/avatar`，注入 `OIDC_ISSUER`，nginx `client_max_body_size ≥5M`。
- **前端**：显示改用 `<UserAvatar src={profile.picture}>`；编辑弹窗 URL 文本框换为 `<input type=file accept="image/png,image/jpeg,image/webp,image/gif">` → 客户端校验 / 预览（objectURL）→ PUT 字节 → 成功 `refetch profile + refreshSession`；`clearAvatar` 改为 DELETE。MVP 不做客户端裁剪。
- **安全**：服务端始终校验（嗅探拒 SVG + 大小上限），不信客户端；serve 端 `nosniff`。console 显示读 profile / session（已刷新），不依赖 token claim。

> 实测简化（A–G 已合 develop）：未引入 `sharp`（避原生 / alpine 依赖，对齐仓库 WASM 取向）→ 用 magic-byte 嗅探（`avatar-image.ts`）+ content-type 白名单 + 大小上限 + nosniff + 拒 SVG；服务端缩放 `?s=` 与 re-encode / EXIF strip 列为后续硬化。

---

## 6. 关键决策与边界

**账号标识 / 合并**

- **D-1**：用户标识三层 `id` / `user_no` / `account`；`user_no` 新增、纯 10 位数字、序列起 `1000010000`、永不变。
- **D-2**：username 默认 `_{user_no}`，修改必字母开头、查重、限频；前缀互斥免撞（符号选 `_` 而非 `$`，避 JS 模板 `${}` / shell / 正则解析风险）。
- **D-3**：采用 B（空则回填，带去重），A（按 `email` 并号）永久禁止。
- **D-4**：邮箱两态；验证码登录仅认已验证邮箱（防接管）。
- **D-5**：手机始终是账号归属锚点，`email` 不参与找人 / 并号。

**认证面 / 验证码**

- **D-CA**：验证码优先（默认 + 左 tab），`验证码登录 | 密码登录`；仅 tenant realm 有 tab，operator 密码-only 无 tab。
- **D-CB**：邮箱码仅登录、不自动注册（仅对已绑定邮箱账号开放，无账号报错不建号）；手机码维持"登录即注册"唯一注册锚点。
- **D-CC**：验证码 tab 单一智能输入框，自动识别手机 / 邮箱分流，不做子切换。
- **D-CE**：邮箱码用 `VerifyCodeService`（`vc:*`）、手机码用 `PhoneCodeService`（`svc:*`，scope `tenant-auth`）；均 6 位、TTL 600s、一次性、三级限流，Turnstile 沿用 tenant site key。

**头像**：D-1 bytea 存储 / D-2 前端内联默认剪影 / D-3 三方首创导入一次 / D-4 版本化服务端点 / D-5 上传拒 SVG / D-6 `picture` 经 profile scope / D-7 RP 从 token 取 URL 浏览器缓存字节 / D-8 URL 即版本（详见 §5）。

**边界**

- **operator 隔离不变**：所有验证码 / 社交 / 注册 / 找回密码能力仅 tenant realm；operator 永远密码-only（预建、无自助注册）。
- **不自动并号**：无论社交联邦还是邮箱码登录，绝不因 `email` 相同而自动合并身份；并号只经 `sso_connection(sub)` 或已验证手机锚点。
- **跨域 RP 不查库**：ruyin（umbra，跨仓）消费 `picture` 走 token；其头像上传须走 IdP Bearer API（未来单列，本文 OUT）。

## 7. 删除账号（自助，30 天保留期）

> 2026-09-04 owner 裁定，console 批 5b 实施。入口在 console「账号信息」页底的危险操作区；后端 `AccountService.requestDeletion / cancelDeletion / purgeUser`，跨域资格判定在 console-bff `AccountDeletionAggregator`，清扫在 platform-api `account-deletion-purge` 作业。

**状态机**：`active` →（申请）→ `deleting`（`deletion_requested_at = now()`）→（30 天后清扫）→ `deleted_at` 置位、标识脱敏。保留期内重新登录可撤销（`deleting` → `active`，清 `deletion_requested_at`）。

**判定范围** = 本人是所有者的租户（个人租户 + 组织租户）。

| 类别                   | 项                                                                                                                      | 判据                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 阻断（任一命中不能删） | 组织租户所有者                                                                                                          | `tenancy.tenants.owner_user_id = 本人 and type='organization'`；先转让或注销                                   |
|                        | 未清账单                                                                                                                | `billing.invoices.bill_status in (unpaid, paying, partial, overdue)`                                           |
|                        | 付费余额 > 0                                                                                                            | 付费余额 = min(`credits.balance`, Σrecharge − Σrefund)——库里一池不分，从 `transactions` 流水推，**先消耗赠送** |
|                        | 进行中退款                                                                                                              | `refunds.audit_status='pending'` 或 approved 且 `refund_status in (pending, processing)`                       |
|                        | 进行中开票                                                                                                              | `invoice_receipts.invoice_status in (applying, approved)`                                                      |
|                        | 有钱在途的待付订单                                                                                                      | `pending_verify`，或账单已有实收，或存在待核实付款腿（与订单取消的 409 条件同源）                              |
| 确认（能删，须知悉）   | 订阅未到期                                                                                                              | `metering.subscriptions` 未过期且非 cancelled，剩余周期作废                                                    |
|                        | 赠送余额                                                                                                                | balance − 付费余额，作废                                                                                       |
| 自动（删除时连带）     | 一分钱没收到的待付订单取消；非所有者的组织成员关系解除；会话 / 刷新令牌全部吊销；三方绑定解除；本人发出的待接受邀请撤销 | 申请时即做，连带动作任一失败不动账号                                                                           |
|                        | 个人租户软删                                                                                                            | **清扫时**做（保留期内撤销无需恢复）                                                                           |

**保留期内的登录**：读路径（`getUserById / findUserByIdentifier / findCredentialById`）放行 `deleting`，登录照常完成；console-bff 对该用户除会话恢复读（`GET /api/me`、tenant-context、capabilities）与 `/api/me/deletion*` 之外一律 `403 ACCOUNT_DELETING`，console 外壳据此只画「账号在删除保留期：撤销删除并重新启用 / 保持删除并退出」。

**清扫**（`AccountService.purgeUser`，事务）：`account = deleted_<user_no>`、`email = null`、`phone = deleted:<id 前 24 位>`、`account_login_disabled = true`、`deleted_at = now()`；`user_profiles` 展示字段清空；`user_avatars / user_credentials / identities` 整行删除；会话与刷新令牌吊销。`user_no` 永不回收（§1），订单 / 账单 / 支付 / 审计里的裸 `user_id` 仍能解引用到「一个已删除的用户」。

**DDL / 迁移**：`account.users.deletion_requested_at`、`chk_users_status` 加 `deleting`、部分索引 `idx_users_deletion_requested_at`、98 列锁白名单加新列；迁移 `2026-09-11-account-deletion-retention.sql`。
