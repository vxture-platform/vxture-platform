# @vxture/core-auth

> 架构层参考：[`docs/30-design/architecture/03-core-layer.md`](../../../30-design/architecture/03-core-layer.md)

---

## 包信息

| 项     | 值                    |
| ------ | --------------------- |
| 包名   | `@vxture/core-auth`   |
| 路径   | `packages/core/auth/` |
| @layer | `Infrastructure`      |

## 职责

平台级认证原语：JWT 签发与验证、访问 token 吊销（Redis）、NestJS Guard/Decorator、
OAuth provider 抽象接口、Cloudflare Turnstile 验证。
只提供平台基础设施，不包含任何业务级权限逻辑。

## 目录结构

```
src/
├── client/     # VxJwtClient（JWT 签发/验证）
├── decorators/ # @Public、@Roles、@CurrentUser
├── guards/     # JwtAuthGuard、RolesGuard（InternalAuthGuard 已于 2026-10-04 删除：零消费方、!== 比较）
├── session/    # AccessTokenRevocationService（Redis）
├── turnstile/  # TurnstileVerifier（Cloudflare 人机验证）
├── types/      # JwtAccessPayload、AuthUser、OAuthProvider 等
├── utils/      # token 解析、权限检查、provider 工具、sharedSecretMatches（共享口令常量时间比较，两个 BFF guard 共用）
└── index.ts
```

## 依赖约束

**允许：**

- `@vxture/shared`
- `@nestjs/common` / `@nestjs/core` / `@nestjs/jwt`
- `ioredis`（仅 `AccessTokenRevocationService` 使用）

**禁止：**

- Next.js / React / Prisma
- `@vxture/service-*` / `bff-*` / `ai-sdk` / `design-system`
- 业务级权限逻辑（如「是否有购买权限」属于 service-billing）

## 核心设计约束

- `JwtAuthGuard` 只验签、挂 `AuthUser`，不检查 revocation（revocation 由各 BFF 在需要时显式调用 `assertAccessTokenActive()`）
- `JwtAccessPayload.jti` 虽为 optional 类型（兼容旧 token），但启用 revocation 的 BFF 必须在签发时传入；通过 `generateJti()` 生成（`crypto.randomUUID()`，128 bit 熵）
- `OAuthProvider` 是抽象接口，具体实现（DingtalkProvider 等）放各 BFF / agent-server，core-auth 不依赖具体 SDK
- `userType` 字段从 JWT payload 透传到 `AuthUser`；surface guard 按 `userType ?? 'tenant_user'` 兜底推断

## 关键类型

| 类型               | 说明                                                      |
| ------------------ | --------------------------------------------------------- |
| `JwtUserType`      | `'operator' \| 'tenant_user'`，surface 路由隔离核心       |
| `JwtAuthScope`     | `'platform-admin' \| 'tenant-console'`                    |
| `PlatformRole`     | `'admin' \| 'tenant_admin' \| 'member'`                   |
| `AuthUser`         | `request.user` 的类型，Guard 验签后挂载                   |
| `JwtAccessPayload` | access token payload，含 `userType`、`jti`、`authScope`   |
| `OAuthProvider`    | OAuth provider 抽象接口（`exchangeCode` / `getUserInfo`） |
