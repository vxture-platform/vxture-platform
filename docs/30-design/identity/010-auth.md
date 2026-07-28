# Vxture 认证与账号体系概要设计

**版本**: 1.3.0
**日期**: 2026-05-08
**范围**: 账号隔离 · 跨域登录 · SSO · 统一登录体验 · Turnstile 人机验证 · 第三方授权登录 · PLG 租户模型 · 代码审查规范

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md](../data_platform_100_architecture.md) + [-schema.md](../data_platform_200_schema.md)（本文不重述平台 DDL，只述本板块内容）。
>
> 账号 / 租户 / OAuth 关联表数据模型见 a §3.4 + b §4–§15（字段级权威），本文不重述 DDL。

> 本文档只描述功能、流程与设计意图，不包含具体数据库 DDL。数据库表结构以实际已建表为准。

> **术语对齐（重建后模型）**：本文早期版本沿用的 `personal/enterprise` 租户类型、`tenant_id`、`tenant_user` 等词汇，在重建后的四层模型中对应为 org（组织）→ workspace（工作空间）→ membership（成员关系）→ user（用户）；租户类型统一为 `tenant.type = personal | organization`，realm 区分 `customer | workforce`，IAM `role.scope = org | workspace`。字段级定义以 b §4–§15 为准；本文正文保留原有流程叙述，术语以本注为权威映射。

---

## 1. 账号体系总览

Vxture 维护两套完全独立的账号体系，共用同一个 PostgreSQL 数据库，通过不同的表和 JWT 类型隔离。

| 维度         | 运营账号                | 租户账号                              |
| ------------ | ----------------------- | ------------------------------------- |
| 使用产品     | y.vxture.com            | console.vxture.com · ruyin.ai · agent |
| tenant_id    | 无（管理所有租户）      | 必填（只能访问自己租户）              |
| JWT userType | `operator`              | `tenant_user`                         |
| 角色         | `super_admin` · `admin` | `owner` · `admin` · `member`          |
| 登录方式     | 邮箱密码                | 邮箱密码 · 钉钉 · 飞书 · 企业微信     |

**隔离原则**：同一邮箱可同时存在于两套账号体系，互不冲突，两个身份完全独立。运营账号不能以租户身份登录任何租户产品，租户账号不能登录运营后台。运营后台可以在平台权限和审计约束下读取、管理租户与租户账号数据，这是“平台管理面”能力，不等同于把运营账号签发成 `tenant_user`。

---

## 2. 租户模型（PLG 增长路径）

### 租户类型

| 类型         | 说明                       | 典型来源                       |
| ------------ | -------------------------- | ------------------------------ |
| `personal`   | 个人租户，只有自己一个成员 | 第三方账号首次授权登录自动创建 |
| `enterprise` | 企业租户，可邀请多个成员   | 个人租户升级 或 企业直接购买   |

### 用户与租户的关系

一个用户可以同时属于多个租户（个人租户 + 若干企业租户），通过租户成员关系表维护多对多关系。每个成员在每个租户内有独立的角色。

### PLG 增长路径

```
第三方账号授权登录（钉钉 / 飞书等）
  ↓
系统自动创建个人租户（plan: trial）
  ↓
用户免费试用，数据归属个人租户
  ↓
          ┌──────────────────────────────┐
          ↓                              ↓
    继续个人使用                     升级企业订阅
    升级个人 Pro 计划                新建企业租户
    个人租户长期保留                  可选：将试用数据迁移到企业租户
                                     邀请同事加入
                                     绑定企业的钉钉 / 飞书 corp_id
```

### 多租户切换

用户登录后系统查询其所属的所有租户。若只属于一个租户直接进入；若属于多个租户，前端展示租户切换器，用户选择后签发携带对应 `tenantId` 的 JWT。

---

## 3. 第三方授权登录

### 支持平台与优先级

| 优先级 | 平台              | 状态      |
| ------ | ----------------- | --------- |
| P0     | 钉钉（DingTalk）  | ✅ 已接入 |
| P1     | 飞书（Lark）      | ✅ 已接入 |
| P2     | 企业微信（WeCom） | 待接入    |

### 前置工作（一次性，每个平台各做一次）

去各平台开放平台**注册开发者账号，创建自建应用**。自建应用无需平台审核，配置完成即可使用。

| 平台     | 注册地址               | 需要配置的内容                           |
| -------- | ---------------------- | ---------------------------------------- |
| 钉钉     | open.dingtalk.com      | 回调域名白名单 · 申请个人信息读取权限    |
| 飞书     | open.feishu.cn         | 重定向 URL 白名单 · 申请用户基本信息权限 |
| 企业微信 | work.weixin.qq.com/api | 可信域名 · OAuth 回调域                  |

回调地址统一设置为：

```
https://api.vxture.com/auth-api/auth/oauth/dingtalk/callback
https://api.vxture.com/auth-api/auth/oauth/feishu/callback
https://api.vxture.com/auth-api/auth/oauth/wecom/callback
```

> 路由由 gateway-bff（`api.vxture.com`）转发至 auth-bff，前缀 `/auth-api/` 由 Nginx 路由规则匹配。

用户用**个人账号**扫码或点击授权即可登录，无需企业管理员介入，体验与 GitHub 登录第三方网站完全一致。

### 授权登录完整流程（以钉钉为例）

```
① 用户点击"钉钉登录"
   前端跳转至钉钉授权页
   携带参数：app_id · redirect_uri · state（随机值，防 CSRF）

② 用户在钉钉授权页同意授权
   钉钉带着 code 跳回 auth.vxture.com/oauth/dingtalk/callback

③ auth-bff 服务端处理（用户不可见）
   用 code 换取钉钉 access token
   用 token 调用钉钉接口获取用户信息
   获得：open_id · union_id · 姓名 · 头像 · 手机号

④ auth-bff 查询 OAuth 关联表（provider=dingtalk, open_id=xxx）
   → 找到记录：取出关联的租户用户 ID，走正常登录流程
   → 未找到记录：自动注册（在同一事务内完成）
       创建租户用户记录（姓名、头像来自钉钉）
       创建个人租户记录（type: personal, plan: trial）
       创建租户成员关系（role: owner）
       创建 OAuth 关联记录（provider: dingtalk, open_id, union_id）

⑤ 查询该用户所属的所有租户
   → 只有一个租户：签发 JWT（含 tenantId），跳回原页面，登录完成
   → 多个租户：跳转租户选择页，选择后再签发 JWT
```

飞书、企业微信流程完全相同，只是调用接口和字段名称不同，可复用同一套 OAuth 处理框架。

### OAuth 关联表的作用

维护"第三方平台账号"与"Vxture 租户账号"的映射关系。核心字段：

- `provider`：平台标识（dingtalk / feishu / wecom）
- `open_id`：该平台下该用户的唯一 ID
- `union_id`：同企业跨应用的唯一 ID（为后续企业订阅阶段打通通讯录做准备）

一个 Vxture 账号可绑定多个平台，任意一个平台登录均可进入同一个账号。

### 钉钉配置参考

**使用范围**：钉钉三方授权只用于 `website + console` 的同一套租户用户账号体系。禁止用于 `admin`（不在 admin-bff 配置钉钉 OAuth，不允许钉钉账号签发平台管理员 token）。

**环境变量**（生产配置于 `/srv/vxture/runtime/.env.auth-bff`，本地真实值配置于 `runtime/.env.auth-bff`）：

```env
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_REDIRECT_URI=https://api.vxture.com/auth-api/auth/oauth/dingtalk/callback
```

当前接入只使用 OAuth 授权登录所需的 `DINGTALK_APP_KEY / DINGTALK_APP_SECRET`。钉钉事件回调的 `CALLBACK_TOKEN` 和 `CALLBACK_AES_KEY` 不属于当前登录链路，未启用事件订阅时不得放入 VXTURE_DEPLOY_HOST env。

**回调地址**：

```
生产：https://api.vxture.com/auth-api/auth/oauth/dingtalk/callback
本地：http://localhost:3090/auth/oauth/dingtalk/callback
```

钉钉开放平台配置的回调地址必须与 `DINGTALK_REDIRECT_URI` 完全一致。

**后端路由入口**（经 gateway 暴露）：

```
GET /auth-api/auth/oauth/dingtalk/start
GET /auth-api/auth/oauth/dingtalk/callback
```

callback 只允许签发 `userType = tenant_user`、`authScope = tenant_console` 的会话；`state.returnTo` 只接受 `website` / `console`，禁止 `admin`。

---

## 4. JWT 设计

### 运营人员 JWT Payload

```json
{
  "sub": "operator_user_id",
  "userType": "operator",
  "authScope": "platform-admin",
  "role": "admin",
  "tenantId": null,
  "jti": "随机 UUID，用于黑名单吊销",
  "iat": "签发时间",
  "exp": "过期时间"
}
```

### 租户用户 JWT Payload

```json
{
  "sub": "tenant_user_id",
  "userType": "tenant_user",
  "authScope": "tenant-console",
  "role": "member",
  "tenantId": "当前所选租户 ID",
  "jti": "随机 UUID，用于黑名单吊销",
  "iat": "签发时间",
  "exp": "过期时间"
}
```

> Token 策略（有效期 / 存储位置）、Redis Key 规范及 Cookie 命名详见 [`docs/30-design/session.md`](./020-session.md)。

---

## 5. 域名与产品映射

```
y.vxture.com    →  admin portal        →  admin-bff        运营账号专用
console.vxture.com  →  console portal      →  console-bff      租户账号专用
ruyin.ai            →  Ruyin 外部业务应用   →  外部业务 BFF     租户账号专用
auth.vxture.com     →  统一认证服务         →  auth-bff         两套账号统一入口
```

> Cookie Domain / Cookie Key 命名规范详见 [`docs/30-design/session.md`](./020-session.md) — §Cookie 命名规范。

---

## 6. 统一认证服务（auth-bff）

### 职责

auth-bff 是**唯一有权签发 JWT 的服务**，其他所有 BFF 只验证，不签发。

- 邮箱密码登录（运营账号 / 租户账号）
- 第三方 OAuth 授权登录（钉钉 · 飞书 · 企业微信）
- 登出与 token 吊销
- access token 续期（基于 refresh token）
- 跨域一次性 token 的生成与验证

### 核心接口概览

```
POST /auth/login
  租户账号密码登录入口，仅允许 website / console / ruyin source
  admin 登录必须先由 admin-bff 校验 platform_admin，再调用 /auth/internal/sign

POST /auth/logout
  根据 source 执行当前安全域登出，删除对应 refresh token，将 jti 写入黑名单，写入 revoked-before 水位，清除对应 Cookie
  source=website/console 处理 .vxture.com 租户端 Cookie
  source=admin 只处理运营端 Cookie
  source=ruyin 处理 ruyin.ai 本域 Cookie，并吊销同一租户逻辑会话

POST /auth/refresh
  验证 refresh token 签名、authScope 与 Redis 中保存的 refresh token 完全匹配后，签发新的 token 对
  Redis 缺失、异常或 token 不匹配必须 fail-closed，返回未授权或服务不可用

POST /auth/internal/sign
  内部签发接口，只允许可信 BFF 调用，必须携带 x-vxture-internal-auth
  source=admin 时签发 operator JWT，不以租户 account 作为登录身份来源

GET  /auth/oauth/{provider}/start
  生成授权跳转 URL，将随机 state 存入 Redis，重定向至第三方平台

GET  /auth/oauth/{provider}/callback
  验证 state（防 CSRF），用 code 换取用户信息
  查或建 OAuth 关联及租户数据，签发 JWT，跳回前端

GET  /auth/crossdomain/token
  验证当前登录态，按 targetDomain 白名单生成 30 秒有效一次性 token，返回供前端跳转使用

POST /auth/crossdomain/verify
  原子性取出并删除 Redis 中的一次性 token
  校验 userType / authScope / targetDomain，返回用户信息和 tenantId，由目标域 BFF 签发自己的 Cookie
```

Console 侧还需要提供浏览器可访问的 SSO start endpoint（`/{locale}/sso/start?ctx=...`）。该 endpoint 不签发 JWT，只负责解析跨 Portal `ctx`、按 `ctx.from` 校验 `returnTo` 白名单、在已登录态下调用 `auth-bff` 生成 crossdomain token，并将浏览器重定向回业务应用 callback。

> 登出边界（单域 / 跨域 / logout_all 边界规则）及跨域 SSO 完整流程详见 [`docs/30-design/session.md`](./020-session.md) — §登出与 Token 吊销 / §跨域 SSO。

---

## 8. 前端统一登录体验与会话同步

### 8.1 统一登录页面模板

website、console、admin、ruyin 以及后续新增业务前端，登录页都应基于 `@vxture/design-system` 的统一认证组件体系构建，不在各 Portal 内重复实现布局和视觉规则。

核心组件：

- `UnifiedAuthPage`：整页登录容器，负责页面背景、左右区域、Header、Footer。
- `AuthLoginLayout`：登录内容区布局，保证标题区、输入区、按钮区、三方登录区、页脚链接区高度关系一致。
- `AuthFlowForm`：登录流程结构，按输入区、主按钮区、三方登录区、页脚区组织。
- `AuthField`：统一输入框，支持图标、错误提示、自动填充属性。
- `AuthLoginOptions`：统一记住登录信息、忘记密码、忘记我、用户协议与隐私政策勾选区。
- `AuthPrimaryButton`：统一主按钮，支持 loading、disabled、disabledLabel。
- `AuthSocialButtons`：统一三方登录按钮区，支持官方 SVG 图标、禁用态和占位。
- `AuthChromeHeader` / `AuthChromeFooter`：统一登录页页眉页脚，支持语言切换、主题切换和法务链接。

布局原则：

- 登录框内容区分为五段：标题行、Tab 输入区、登录按钮区、三方登录区、页脚链接区。
- 标题行固定靠上且文字居中；Tab 切换不能引起标题位置上下跳动。
- 输入区占据中间弹性空间；按钮区、三方登录区、页脚链接区靠底部对齐。
- 三方登录区、页脚链接区在禁用或不渲染时仍保留合理高度，避免登录按钮过度下沉。
- 页面整体背景图、左侧背景图、左侧文案必须有默认值，并允许业务应用按品牌配置覆盖。

应用差异：

- tenant 端（website、console、ruyin）共享同一登录模板、同一 CSS 体系、同一图标体系、同一租户认证逻辑。
- admin 使用同一视觉模板，但认证、登录、登出、Cookie、JWT userType 与 tenant 端严格隔离。
- admin 默认不启用三方登录；如短期保留 UI，只能禁用或不渲染，并保留布局占位。
- 业务调用登录页时必须传入或保留返回地址，例如 `next=/workspace`，登录成功后返回原业务入口。

### 8.2 Cloudflare Turnstile 人机验证

登录、注册、短信验证码发送与短信验证码登录都接入 Cloudflare Turnstile Managed 模式。Turnstile 用于风险校验，不替代账号密码、短信验证码、OAuth state 或后端权限校验。

前端规则：

- 前端只持有 Cloudflare site key。tenant surface 通过 `NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY` 注入；admin surface 通过 `NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_ID` 注入，变量名使用 `SITE_ID` 是为了避免公开构建变量被误认为 secret。
- `AuthTurnstile` 默认使用无感/交互优先模式，必须保留独立布局槽位，不能浮动遮挡用户协议、隐私政策等勾选项或登录按钮。
- Turnstile token 必须随密码登录、注册、发送短信验证码、短信验证码登录请求提交。
- token 过期或登录失败后必须 reset，下一次请求使用新 token。
- pending 时主按钮禁用并显示 `安全验证中... Ns`，默认从 5 秒倒计时到 0 秒。
- 倒计时只提供可量化等待预期，不是强制等待；若 Turnstile 不到 5 秒完成，按钮必须立即恢复正常可点击状态；若超过 5 秒，显示保持 `0s` 直到验证完成或失败。
- 验证失败时按钮显示 `验证不可用`，并给出可操作错误提示。

后端规则：

- 服务端只持有 secret key，通过 `CF_TURNSTILE_TENANT_SECRET_KEY` 或 `CF_TURNSTILE_ADMIN_SECRET_KEY` 注入。
- `CF_TURNSTILE_ENABLED=true` 后，服务端必须强制校验相关认证请求，缺 token、token 无效、action 不匹配或 hostname 不在允许列表时拒绝请求。
- tenant 与 admin 使用不同 Turnstile surface 配置；tenant 端允许 website、console、ruyin 对应 hostname，admin 只允许 admin hostname。
- env 文件所有权：tenant Turnstile secret 只放 `/srv/vxture/runtime/.env.auth-bff`；admin Turnstile secret 只放 `/srv/vxture/runtime/.env.admin-bff`；本地真实值对应放在 `runtime/VXTURE_DEPLOY_HOST`；前端 site key 只通过 CI 构建变量注入。详见 [`docs/50-deployment/01-environments.md`](../../50-deployment/01-environments.md)。
- 服务端校验通过后才能继续执行密码校验、验证码发送或验证码登录，避免把人机验证放在业务逻辑之后。

### 8.3 Tenant 端会话同步

website、console、ruyin 属于同一租户逻辑登录态。由于浏览器不会在不同应用、不同端口或不同站点之间自动同步前端内存状态，前端必须以 BFF session 接口为真实来源，建立轻量 session observer。

统一机制：

- 应用启动时立即恢复 session。
- 路由变化、窗口 focus、页面 `visibilitychange=visible` 时静默恢复 session。
- 打开的 tenant 应用保持低频静默同步，当前实现为约 2 秒一次、约 1.5 秒节流，避免同一时间重复请求。
- 静默同步不得触发全局 loading，也不得因为一次网络抖动立刻清空当前用户；只有后端明确返回未登录时才同步为登出。
- 前端持久化只能缓存 UI 所需的用户快照，不得保存 JWT、refresh token 或任何可用凭证。

行为预期：

- 用户在 website 登录后，已打开的 console 登录页应自动探测到有效租户 session，并跳转到 `next` 或默认工作台。
- 用户在 console 登录后，website Header、appcenter CTA 等 UI 应自动收敛为已登录态。
- 用户在任一 tenant 应用登出后，其他已打开的 tenant 应用应自动收敛为未登录态；受保护页面跳回登录页，公开页面 Header 与 CTA 切换为访客态。
- appcenter Banner 主按钮作为登录态验证点：已登录显示 `进入工作台` 并跳转 console；未登录显示 `申请试用` 并跳转注册/试用入口。
- admin 的 session observer 只能观察 admin operator 会话，不参与 tenant 端同登录、同登出。

### 8.4 登录页 Header、Footer 与语言主题

- 登录页 Header 使用统一品牌、语言选择按钮和主题切换按钮。
- 语言选择面板应作为 design-system 通用面板维护，支持集中更新语言列表。
- 登录页 Footer 使用统一法务链接，推荐顺序为：服务条款、隐私政策、Cookie 使用政策。
- Header、Footer 的视觉样式必须来自同一 DS 模板，不允许 website、console、admin 分别维护相似但不一致的实现。

---

## 9. BFF 验证规则

### 所有 BFF 通用（auth middleware）

每个请求进入路由前必须经过认证中间件：

- 从 Cookie 提取 access token
- 验证 JWT 签名有效性
- 检查 `userType` 与 `authScope` 是否匹配当前 BFF 安全域
- 检查 jti 是否在 Redis 黑名单
- 检查 `revoked-before:{surface}:{userId}`，拒绝登出前签发的旧 access token
- 将用户信息（userId · userType · role · tenantId）挂载到请求上下文

认证 Redis 不可用时按 fail-closed 处理：不得因为 Redis 连接失败而放行受保护请求。任一步骤失败返回 401/403/503，不进入业务路由。

### 各 BFF 额外的 userType 守卫

```
admin-bff    →  userType 必须为 operator，否则返回 403
console-bff  →  userType 必须为 tenant_user，否则返回 403
外部业务 BFF（如 Ruyin）→  userType 必须为 tenant_user，否则返回 403
varda-bff     →  根据 x-varda-surface 分别要求 operator/platform-admin 或 tenant_user/tenant-console
```

### 租户数据隔离原则

console-bff 和外部业务 BFF 的所有业务路由，tenantId 只能从 JWT 上下文中获取，所有数据查询必须携带此 tenantId 作为过滤条件，禁止从请求参数接收 tenantId。

---

## 10. 容器清单

| 容器         | 类型    | 说明                                        |
| ------------ | ------- | ------------------------------------------- |
| auth-bff     | NestJS  | 统一认证服务，唯一签发 JWT 的服务           |
| website      | Next.js | 公营销站                                    |
| admin        | Next.js | 运营门户                                    |
| console      | Next.js | 租户工作台                                  |
| website-bff  | NestJS  | —                                           |
| admin-bff    | NestJS  | 仅接受 operator JWT                         |
| console-bff  | NestJS  | 仅接受 tenant_user JWT                      |
| 外部业务应用 | —       | 如 Ruyin，由外部业务仓库维护                |
| varda-server | NestJS  | Varda AI 助手后端（嵌入 admin / console）   |
| Nginx        | —       | 反向代理，路由分发                          |
| PostgreSQL   | —       | 主数据库，含 pgvector 扩展                  |
| Redis        | —       | Session · 黑名单 · 跨域 token · OAuth state |

**合计：14 个容器**

---

## 11. 代码审查规范

### 11.1 账号体系隔离

- [ ] 运营登录认证只能访问 operator 身份来源，禁止把租户 account 当作运营登录身份
- [ ] 运营后台管理功能可以在平台权限与审计约束下访问租户、账号和业务运营数据，但禁止绕过权限、禁止以租户身份签发会话
- [ ] 租户账号查询必须携带 tenantId 过滤条件，禁止全租户扫描
- [ ] 两套账号体系的数据禁止在代码中 JOIN 或混合处理
- [ ] 密码字段只存 hash（bcrypt rounds ≥ 12），禁止明文或可逆加密

### 11.2 JWT 签发

- [ ] 只有 auth-bff 可以调用 JWT sign，其他 BFF 禁止引入任何签发逻辑
- [ ] 签发时必须包含 `userType` · `authScope` · `sub` · `tenantId` · `jti` · `exp` 字段
- [ ] `jti` 必须是随机 UUID，不得使用可预测值
- [ ] access token 有效期不得超过 15 分钟
- [ ] JWT 密钥必须从环境变量读取，禁止硬编码

### 11.3 BFF 中间件

- [ ] 所有 BFF 的每个路由必须经过 auth middleware，禁止裸路由
- [ ] admin-bff 所有路由必须验证 `userType === "operator"`
- [ ] console-bff 和外部业务 BFF 所有路由必须验证 `userType === "tenant_user"`
- [ ] admin-bff 必须验证 `authScope === "platform-admin"`，租户端 BFF 必须验证 `authScope === "tenant-console"`
- [ ] 验证失败统一返回 401 / 403，错误信息不得包含内部实现细节
- [ ] jti 黑名单检查必须在签名验证之后、业务逻辑之前执行
- [ ] 认证 Redis 不可用或查询失败时必须 fail-closed，禁止跳过吊销检查

### 11.4 第三方 OAuth 登录

- [ ] 授权流程必须生成随机 state 存入 Redis，callback 时验证 state 防 CSRF
- [ ] 用 code 换取平台 token 的操作必须在服务端完成，禁止在前端处理
- [ ] 自动注册流程必须在数据库事务中完成，任一步骤失败全部回滚
- [ ] `provider + open_id` 的唯一约束必须在数据库层面保证，不仅依赖业务代码
- [ ] 从第三方平台获取的 access token 如需存储，必须加密，不得明文入库

### 11.5 跨域一次性 Token

- [ ] 跨域 token 必须是随机 UUID，TTL 不得超过 30 秒
- [ ] verify 接口必须使用 Redis 原子操作（GETDEL），禁止先 GET 再 DEL
- [ ] verify 接口必须校验 userType、authScope、targetDomain 和 tenantId 是否匹配目标产品
- [ ] 跨域 token 不得出现在任何应用日志中

### 11.6 Cookie 配置

- [ ] 所有认证 Cookie 必须设置 `HttpOnly: true`
- [ ] 生产环境必须设置 `Secure: true`
- [ ] vxture.com 系列 Cookie domain 必须为 `.vxture.com`
- [ ] ruyin.ai Cookie domain 必须为 `ruyin.ai`，禁止使用宽泛域名
- [ ] `SameSite` 设置为 `Lax`

### 11.7 租户数据隔离

- [ ] tenantId 只从 JWT 上下文获取，禁止从 query / body 接收
- [ ] 所有涉及租户数据的查询必须携带 tenantId 过滤条件
- [ ] 多租户切换必须重新签发 JWT（更新 tenantId），不得通过其他方式传递

### 11.8 依赖边界

- [ ] `@vxture/core-auth` 只包含 JWT 验证逻辑，禁止包含签发逻辑
- [ ] 前端代码禁止引入任何 JWT 库
- [ ] agent-server 不处理用户认证，认证由 BFF 完成后通过请求上下文传递
- [ ] OAuth provider 的调用逻辑只存在于 auth-bff 内部

### 11.9 安全规范

- [ ] 登录接口必须有频率限制（建议：同 IP 每分钟不超过 10 次）
- [ ] 密码登录失败不得区分"用户不存在"和"密码错误"
- [ ] 登出必须同时清除 refresh token（Redis）、写入 access token 黑名单和用户级 revoked-before 水位
- [ ] 禁止在响应体中返回 JWT 字符串，只通过 Cookie 传递
- [ ] 修改密码、解绑第三方账号等敏感操作必须要求重新验证身份

### 11.10 前端登录体验与会话同步

- [ ] 登录页面必须基于 design-system 统一认证组件，不得在 Portal 内复制一套近似实现
- [ ] 登录页 Header、Footer、语言选择、主题切换必须走统一 DS 模板
- [ ] tenant 端登录、注册、短信验证码发送、短信验证码登录必须提交 Turnstile token
- [ ] Turnstile pending 时主按钮必须禁用，并显示 5 秒倒计时等待预期；验证提前完成必须立即恢复按钮
- [ ] Turnstile 组件不得遮挡协议勾选、隐私政策、登录按钮等核心交互
- [ ] website、console、ruyin 必须通过 session observer 同步登录态和登出态
- [ ] 静默 session 同步不得因为网络抖动立刻清空用户状态，必须区分未登录与服务不可用
- [ ] admin session observer 必须与 tenant 端隔离，不得混用 tenant Cookie 或 tenant session endpoint

---

## 12. 环境变量规范

完整变量清单以 [`docs/50-deployment/01-environments.md`](../../50-deployment/01-environments.md) 为准。本设计文档只保留认证域相关归属规则：

- `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`AUTH_INTERNAL_TOKEN` 只放 `/srv/vxture/runtime/secrets/platform.env`；`SMTP_*` 只放 `/srv/vxture/runtime/secrets/platform-mail.env`。本地真实值使用 `runtime/secrets/`。
- `auth-bff` 持有租户端认证配置、OAuth 配置、SMTP 配置、tenant Turnstile secret，并负责签发 `vx_tenant_*` cookie。
- `admin-bff` 持有 admin Turnstile secret 和运营账号校验配置，校验通过后委托 auth-bff 内部签发 `vx_admin_*` cookie。
- `website-bff`、`console-bff` 不持有 Turnstile secret、OAuth provider secret、SMTP secret，只代理前端请求并校验自身安全域。
- `NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY` 与 `NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_ID` 是前端构建变量，只通过 GitHub Actions Secrets / Docker build args 注入镜像。

---

## 13. 阶段规划

### 阶段一（已完成基础闭环）

- 邮箱密码登录（运营账号 + 租户账号）
- 手机验证码登录（租户端 + admin）
- 统一登录 DS 模板（website / console / admin）
- Cloudflare Turnstile Managed 模式接入（tenant 端认证请求 + admin 独立 surface）
- website / console 租户端同登录、同登出 session observer
- 登录按钮安全验证倒计时体验
- **钉钉个人账号 OAuth 授权登录**
- **飞书个人账号 OAuth 授权登录**
- 首次登录自动创建个人租户（trial）
- 跨域无缝跳转基础设计（vxture.com ↔ ruyin.ai）

### 阶段二

- 企业微信个人账号登录
- 多租户切换器 UI
- Ruyin 前端完整登录页迁移到统一 DS 模板（由外部业务仓维护）
- logout_all：租户端所有业务应用、所有设备全局登出

### 阶段三

- 个人租户升级为企业租户
- 企业管理员安装应用，打通企业通讯录
- 钉钉 / 飞书应用市场上架审核

---

_本文档描述功能、流程与设计意图，不包含数据库 DDL。数据库表结构以实际已建表为准。_
