# 安全规范

> 更新：2026-05-14

本文档定义平台的安全约束、Secrets 管理规则和各层安全边界。

---

## 1. Secrets 管理

### 1.1 命名规范

```
# 格式：SCREAMING_SNAKE_CASE
JWT_SECRET
JWT_REFRESH_SECRET
AUTH_INTERNAL_TOKEN
IDP_INTERNAL_TOKEN
DINGTALK_APP_SECRET
DATABASE_URL
```

### 1.2 禁止项

```
❌ 禁止提交任何 .env 文件到 git（.gitignore 已覆盖）
❌ 禁止在代码注释中写入真实密钥
❌ 禁止在日志中打印 token / secret / password
❌ 禁止在 URL query string 中传递 token（用 Cookie 或 Header）
```

### 1.3 Secrets 存放位置

| 环境     | Secrets 存放                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 本地开发 | `runtime/`（不提交，已 gitignore）                                                                         |
| CI/CD    | GitHub Actions Secrets（前端构建变量与镜像发布凭据）                                                       |
| 生产     | `/srv/vxture/runtime/secrets/platform.env`、`platform-mail.env` 与服务专属 `.env.<service>`（`chmod 600`） |

### 1.4 密钥强度要求

| Secret                | 最小长度     | 生成方式                                                                                                   |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`          | 64 字符      | `openssl rand -base64 48`                                                                                  |
| `JWT_REFRESH_SECRET`  | 64 字符      | 与 `JWT_SECRET` 不同值                                                                                     |
| `AUTH_INTERNAL_TOKEN` | 32 字符      | `openssl rand -hex 16`                                                                                     |
| `IDP_INTERNAL_TOKEN`  | 32 字符      | `openssl rand -hex 16`（`deploy/scripts/34-provision-idp-internal-secret.sh`），且 ≠ `AUTH_INTERNAL_TOKEN` |
| OAuth App Secret      | 由提供商决定 | 不自定义                                                                                                   |

---

## 2. JWT 安全约束

### 2.1 签发规则（仅 auth-bff）

```
✅ access token：由 `JWT_ACCESS_EXPIRES_IN` 配置，生产默认 8 小时
✅ refresh token：由 `JWT_REFRESH_EXPIRES_IN` 配置，生产默认 30 天
✅ jti：crypto.randomUUID()（每次签发唯一）
✅ 签发后 access token 存入 HttpOnly Cookie
❌ 禁止在 response body 中返回 token（防止 XSS 读取）
❌ 禁止使用 HS256 以外的算法（对称密钥，内网服务间足够）
```

### 2.2 Cookie 安全属性

```
HttpOnly: true          # JS 无法读取，防 XSS 窃取
Secure: true            # 仅 HTTPS 传输（生产）
SameSite: Lax           # 防 CSRF，允许顶层 GET 跳转
Domain: .vxture.com     # 跨子域共享（admin/console/api）
```

### 2.3 Token 吊销（fail-closed）

```typescript
// Redis 不可用时必须拒绝请求，禁止退化为"无状态验证"
if (!redis.isConnected()) {
  throw new ServiceUnavailableException("Auth service unavailable");
}
```

黑名单 key 格式：`blacklist:jti:{jti}`，TTL = access token 剩余有效期。

### 2.4 跨域 Token（crossdomain）

- TTL：30 秒（一次性使用）
- Redis `GETDEL` 原子操作：取即删，防止重放攻击
- 生成方：auth-bff；消费方：目标 BFF

---

## 3. 内部服务鉴权

> **2026-10-02：本节描述的共享口令是退役路径，新代码不许用它。**
> 下面保留它是因为还有在产调用方走这条路，按旧文做过事的人需要知道自己当时拄的是什么。
> 新的内部/产品间调用一律走**换票**（`POST /oidc/token`，token-exchange）——
> 令牌带 `workspace_id` 并在铸币时校验，见《产品接入通则》「C1 出站 · S2S 换票」。

### 3.1 换票（新代码用这个）

调用方用自己的 `client_id` / `client_secret` 换一张面向被调方的短时票。两种模式按
**有没有用户在场**选：OBO（上下文从用户票解出，调用方无从伪造）/ service（显式声明
`requested_context`，**平台铸币时校验覆盖**，不覆盖即 `invalid_target`）。

它比共享口令多给三件：**能分出是谁在调**（审计里 `act.sub` 就是调用方产品码）、
**能单独吊销一个调用方**、以及**请求体里自报的归属值会被令牌里的覆盖**。

### 3.2 共享口令（退役中，仅存量）

```
Header：x-vxture-internal-auth: {口令}
```

**同一个头后面有两把钥匙、各开一张面（2026-10-04 拆分）**，不互认、不回落：

| 钥匙                  | 开哪张面                                                                                    | 谁收 / 谁发                                                        | 住哪                                              |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `AUTH_INTERNAL_TOKEN` | **产品面**：platform-api 的 C2/C3 自助端点（`PlatformAuthGuard` 旧头路径）                  | 收：platform-api；发：console-bff 与各产品后台（值已发出，不轮换） | `secrets/platform.env`（七个容器）                |
| `IDP_INTERNAL_TOKEN`  | **内部面**：auth-bff `/internal/*`（运营账号 / 客户账号管理、step-up，`InternalAuthGuard`） | 收：auth-bff；发：admin-bff / arche-bff / opera-bff                | `secrets/platform-idp-internal.env`（只四个容器） |

拆开的意义：产品手里的值从此开不了运营管理面。谁读哪把由 `scripts/guardrails/check-internal-auth-key-usage.mjs` 精确钉住（auth-bff 出现 `AUTH_INTERNAL_TOKEN` 即红）。

接收方必须在入口中间件校验此 Header，拒绝不合法请求。比较只有一个实现：`@vxture/core-auth` 的 `sharedSecretMatches(presented, expected)`（2026-10-04 起；下面那段是它做的事，别在 BFF 里再抄一份）。`core-auth` 里曾有一份可复用的共享口令 guard（`!==` 比较、非生产硬编码回落值），已删——这一节禁止新增共享口令校验，留一个可复用的 guard 是在招人用它。

```typescript
// ✅ 正确：常量时间比较
import { timingSafeEqual } from "node:crypto";

const presented = Buffer.from(req.headers["x-vxture-internal-auth"] ?? "");
const expected = Buffer.from(process.env.AUTH_INTERNAL_TOKEN ?? "");
if (
  !process.env.AUTH_INTERNAL_TOKEN ||
  presented.length !== expected.length ||
  !timingSafeEqual(presented, expected)
) {
  throw new UnauthorizedException();
}

// ❌ 错误：`!==` 直接比字符串 —— 非常量时间，逐字节早退会漏出长度与前缀信息。
//    本节此前的示例就是这一行，而 auth-bff 自己那份早就是 timingSafeEqual。
// ❌ 错误：未配 AUTH_INTERNAL_TOKEN 时放行 —— 必须 fail-closed。
// ❌ 错误：相信调用方来自内网就不校验
```

**这条路的真实半径，写清楚免得下一个人低估它**：那个值**每个调用方同一个**，所以

- 审计日志里分不出是谁；吊销只能全体换；默认永不过期；
- **走这条路进来时，请求体里自报的归属值平台没有东西可以校验**。
  `bff/platform-api/src/authn/s2s-scope.ts` 的 `legacy === "trust-declared"` 那一支就是
  原样采用自报的 `workspace_id`，而那个值下一跳就进 SQL 的归属谓词。
  五个调用点的档位登记在 `scripts/guardrails/s2s-legacy-scope.snapshot.json`，
  `trustDeclared` 这个数只该减少。
- **同一函数 2026-10-04 起还有第二条信请求体的路（决策 3 PR C）**：代上报票（`delegated:true`，auth-bff 只为
  L1 上报者 atlas 铸，`aud=vxture · act.sub="atlas"`、无 workspace）在 `attribute-declared` 的两格——C2 读、C3
  token 上报——按自报产品归属、自报 `workspace_id` 照用；与旧口令那条路的差别只是**发送方身份可证**。快照里的
  `delegatedAttributing` 同样只该减少；一张被盗的代上报票的半径 = 这两格 × 300s，可按 `appoidc.oidc_clients`
  的那一行停用（共享口令做不到）。
- **内部面的例外（2026-10-04 PR C）**：auth-bff `/internal/operator/accounts/*`、`/internal/account/users/*`
  这 11 条路由自报的 `actorOperatorId` 现在有东西校验了——类级 `ActorBindingGuard` 要求
  `x-vxture-actor-token` 带该运营者自己的会话 access token（验签、`aud ∈ {admin, arche}`、sub 相符、
  不是 step-up / OBO / id_token、中央会话仍在），401 `actor_token_missing` / `actor_token_invalid` /
  `actor_token_mismatch`。`scripts/guardrails/internal-route-policy.snapshot.json` 的 `declaredUnbound` 8 → 0，
  守卫同时核「声明 token-bound 的 controller 真挂着这道 guard」。剩下的半径：攻破的 admin-bff / arche-bff
  只能冒充此刻在两者之一有活会话的运营者，而 IdP 分不出是谁在调（E2/E3）。产品面那条 trust-declared 不受影响。

**而这件事与本文下一节自相矛盾**：§4 的 BFF 层写着「❌ 禁止从 request body / query 读取
tenantId 覆盖 JWT 中的值」—— 共享口令那条路做的正是这件事。两句话不能同时成立，
以 §4 那句为准；§3.2 是待迁走的存量，不是可以照抄的做法。

---

## 4. 各层安全边界

### Portal 层（portals/_ / agent-studio/_）

```
✅ 所有 API 调用通过 gateway-bff 或直连专属 BFF
✅ 不存储任何凭证（JWT 在 Cookie 中，JS 不可读）
❌ 禁止从前端直接调用 service 层或 core 层 HTTP 接口
❌ 禁止在前端代码中硬编码 API key / secret
```

### BFF 层

```
✅ 每个请求必须验证 JWT 有效性（签名 + 过期 + 黑名单）
✅ console-bff 必须提取并校验 tenantId（只允许访问自己的租户）
✅ admin-bff 必须校验 userType === 'operator'
❌ 禁止从 request body / query 读取 tenantId 覆盖 JWT 中的值
❌ 禁止跳过 AuthGuard 的任何 endpoint（/health 除外）
```

### agent-server 层

```
✅ 入口必须有服务间鉴权（新代码走换票，见 §3.1；存量走 x-vxture-internal-auth，见 §3.2）
✅ CallerContext 必须二次校验 surface × userType 合法性
✅ console surface 工具必须以 ctx.tenantId 过滤数据
❌ 禁止接受前端传入的 allowedTools 覆盖白名单
```

### Service / Core 层

```
✅ 数据库查询使用 Prisma 参数化查询（不拼接 SQL 字符串）
✅ 敏感字段（password）使用 bcrypt 哈希存储（cost ≥ 12）
❌ 禁止在 service 层 log 中输出用户密码、token、完整手机号
```

---

## 5. CORS 策略

```
允许来源：
  - https://vxture.com
  - https://*.vxture.com
  - https://ruyin.ai
  - http://localhost:* （仅 NODE_ENV=development）

允许方法：GET, POST, PUT, DELETE, PATCH, OPTIONS
允许 Headers：Content-Type, Authorization, X-Varda-Surface
Credentials：true（Cookie 跨域传递）
```

---

## 6. 数据安全

### SQL 注入防护

全平台使用 Prisma，自动参数化查询。禁止使用 `$queryRawUnsafe`：

```typescript
// ✅ 安全
await prisma.user.findMany({ where: { email: userInput } });

// ❌ 危险
await prisma.$queryRawUnsafe(
  `SELECT * FROM "User" WHERE email = '${userInput}'`,
);
```

### 敏感数据日志过滤

```typescript
// logger 配置中屏蔽敏感字段
const REDACTED_KEYS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
];
```

### 个人信息处理

- 手机号存储：加密存储或仅存最后 4 位（按合规要求）
- 邮箱：明文存储，但日志中缩写显示（`u***@example.com`）

---

## 7. 安全检查清单（每次 PR）

```
□ 没有新的 .env 文件被提交
□ 没有 API key / secret 出现在代码中
□ 新增的 BFF endpoint 都经过了 AuthGuard
□ 新增的 service 方法没有拼接 SQL 字符串
□ 新增的日志没有打印敏感字段
□ 新增的内部接口走换票（§3.1），**不是**加一个 x-vxture-internal-auth 校验
□ 该接口的归属值来自令牌或会话，不是请求体自报（§4 那条禁令；共享口令那条路违反它）
```
