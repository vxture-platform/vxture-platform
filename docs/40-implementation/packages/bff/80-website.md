# @vxture/bff-website

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项       | 值                    |
| -------- | --------------------- |
| 包名     | `@vxture/bff-website` |
| 路径     | `bff/website-bff/`    |
| @layer   | `Application`         |
| 框架     | NestJS                |
| 端口     | 3011                  |
| 服务对象 | `portals/website`     |

---

## 核心定位

website-bff 是 Vxture 官网（`portals/website`）的专属 BFF，负责：

- **认证代理**：所有认证操作（login / signup / logout / refresh / forgot-password / reset-password / tenant/init）通过 HTTP 透传至 auth-bff，转发 Cookie 和 Set-Cookie 头。**本 BFF 不签发 JWT，只 verify。**
- **用户信息**：读写当前登录用户的基础信息和 Profile
- **邮箱验证码**：注册/验证流程中的验证码发送与校验

### 认证代理设计意图

website-bff 在认证路由上只做"管道"：原样转发请求体至 auth-bff，原样转发 Set-Cookie 至浏览器。
这样的好处是：当 auth-bff 更新 Cookie 策略（cookie name、domain、TTL）时，website-bff 无需修改。

---

## 接口契约

> 所有 `/api/auth/*` 以外的接口均需携带 Cookie `vx_tenant_access_token`。
> 统一错误响应格式：`{ message: string; statusCode: number }`

### `/api/auth` — 认证（代理至 auth-bff）

中间件公开路径（无需认证）：`/api/auth/login`、`/api/auth/signup`、`/api/auth/forgot-password`、`/api/auth/reset-password`、`/api/auth/refresh`、`/api/auth/send-phone-code`、`/api/auth/login-with-phone`、`/api/auth/oauth/*`、`/api/send-code`、`/api/verify-code`

---

**POST `/api/auth/login`** — 密码登录

```typescript
// Request body（website-bff 注入 source='website'）
{ identifier: string; password: string; turnstileToken?: string }

// Response 200（auth-bff 返回，Set-Cookie 原样透传给浏览器）
// 写入：vx_tenant_access_token / vx_tenant_refresh_token
// 同 auth-bff /auth/login Response 格式（AuthUserDto）
```

**POST `/api/auth/signup`** — 邮箱注册

```typescript
// Request body
{ email: string; name: string; password: string; turnstileToken?: string }

// Response 201（Set-Cookie 透传，tenantId 为空，需后续 tenant/init）
```

**POST `/api/auth/logout`** — 登出

```typescript
// Request body: 无
// Response 200（auth-bff 清除 Cookie）
{
  status: "logged_out";
}
```

**POST `/api/auth/refresh`** — 续期 access token

```typescript
// Request body: 无（从 Cookie 读取）
// Response 200（更新 Cookie）
{
  status: "refreshed";
}
```

**POST `/api/auth/forgot-password`** — 发送密码重置邮件

```typescript
// Request body
{
  email: string;
}
// BFF 固定注入 source='website'，重置链接指向 WEBSITE_BASE_URL/reset-password

// Response 200 — 始终成功（防枚举）
{
  status: "ok";
}
```

**POST `/api/auth/reset-password`** — 重置密码

```typescript
// Request body
{
  token: string;
  newPassword: string;
}

// Response 200
{
  status: "ok";
}
// Response 400 — token 无效或已过期
```

**POST `/api/auth/tenant/init`** — 初始化租户

```typescript
// 需要有效的 vx_tenant_access_token Cookie
// Request body
{
  type: "individual" | "organization";
}

// Response 200（更新 Cookie 中的 tenantId）
{
  tenantId: string;
}
// Response 401 — 未登录或 token 已过期
```

---

**POST `/api/auth/send-phone-code`** — 发送手机验证码

```typescript
// Request body
{ phone: string; turnstileToken?: string }
// Response 200（透传 auth-bff 响应）
```

**POST `/api/auth/login-with-phone`** — 手机验证码登录

```typescript
// Request body
{ phone: string; code: string; turnstileToken?: string }
// Response 200（同 login，Set-Cookie 透传）
```

**GET `/api/auth/oauth/dingtalk/start`** — 发起钉钉 OAuth

```
// 302 跳转至钉钉授权页（经 gateway 代理到 auth-bff）
```

---

### `/api/me` — 当前登录用户

全部接口需 auth middleware 挂载 `req.user`（已认证）。

**GET `/api/me`** — 基础用户信息

```typescript
// Response 200：AuthUserDto
{
  id: string;
  name: string;
  displayName: string | null;
  username: string;
  email: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  personalVerified: boolean;
  organizationVerified: boolean;
}
// Response 401 / 404
```

**GET `/api/me/profile`** — 完整用户 Profile

```typescript
// Response 200：AccountProfileDto
{
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  language: string | null;
  profileUpdatedAt: string | null;
}
```

**PUT `/api/me/profile`** — 更新 Profile

```typescript
// Request body：UpdateProfileDto（所有字段可选）
// Response 200：AccountProfileDto（更新后）
```

**PUT `/api/me/password`** — 修改密码

```typescript
// Request body
{
  currentPassword: string;
  nextPassword: string;
}
// Response 200
{
  status: "ok";
}
// Response 401 — 当前密码错误
```

---

### `/api/send-code` / `/api/verify-code` — 邮箱验证码

**POST `/api/send-code`** — 发送邮箱验证码

```typescript
// Request body
{
  email: string;
} // 须为合法邮箱
// Response 200
{
  message: "验证码已发送，请注意查收";
}
// Response 429 — 限流触发
```

**POST `/api/verify-code`** — 校验验证码

```typescript
// Request body
{
  email: string;
  code: string;
} // code 为 6 位数字
// Response 200
{
  valid: boolean;
} // true = 验证通过并消耗，false = 错误或已过期
```

---

### `/health` — 健康检查

```
GET /health  →  { status: 'ok' }   无鉴权
```

---

## 目录结构

```
bff/website-bff/src/
├── routers/
│   ├── auth.router.ts           ← 认证代理（login / signup / logout / refresh /
│   │                               forgot-password / reset-password / tenant/init /
│   │                               phone / oauth 等）
│   ├── me.router.ts             ← 当前用户信息读写
│   ├── verifycode.router.ts     ← 邮箱验证码发送与校验
│   ├── phone-auth.router.ts     ← 手机验证码代理
│   └── health.router.ts
├── aggregators/
│   └── session.aggregator.ts   ← 聚合 IAM + Profile 数据
├── auth/
│   └── auth.service.ts         ← JWT verify（仅验证）+ 当前用户查询 + 密码修改
├── middleware/
│   ├── auth.middleware.ts      ← 公开路径白名单 + Cookie token 解析
│   └── tenant.middleware.ts
├── types/
│   └── auth.types.ts           ← AuthUserDto / AccountProfileDto / RequestContext 等
├── app.module.ts
└── main.ts
```

---

## 环境变量

```bash
# From /srv/vxture/runtime/secrets/platform.env
DATABASE_URL=
REDIS_URL=
JWT_SECRET=                     # shared JWT verification secret
AUTH_INTERNAL_TOKEN=            # internal BFF calls, if needed

# From /srv/vxture/runtime/.env.website-bff
NODE_ENV=production
WEBSITE_BFF_PORT=3011

# 上游服务
AUTH_BFF_URL=http://vx-auth-bff:3090   # auth-bff 内部地址

# CORS
ALLOWED_ORIGIN=https://vxture.com

# From /srv/vxture/runtime/secrets/platform-mail.env
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<mail-host>
SMTP_PASS=
SMTP_FROM="Vxture Studio <no-reply@<mail-host>>"
```

---

## 依赖约束

```
✅ @vxture/core-auth        — JWT verify
✅ @vxture/core-config
✅ @vxture/service-iam      — 账号 / Profile 查询
✅ @vxture/service-mail     — 验证码发送
✅ auth-bff（HTTP 代理）    — 认证操作委托
❌ JWT 签发                 — 严禁
❌ @vxture/model-runtime-client / agent-server/*
❌ @vxture/design-system / platform-*
```
