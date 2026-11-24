# Vxture BFF Layer Architecture

**Version**: 1.5.0
**Last Updated**: 2026-11-25
**TypeScript**: 5.9.3

## Overview

The **BFF (Backend For Frontend) Layer** is the **sole communication gateway** between
frontend applications and backend services.

Every portal and every agent has exactly one dedicated BFF. The frontend never communicates
with services, core packages, or agent backends directly — all traffic goes through its BFF.

The BFF is responsible for:

- Authentication and session validation
- Tenant context resolution and propagation
- Data aggregation from multiple backend sources
- Response shaping tailored to its frontend consumer
- Domain routing via internal router modules

The BFF contains **no business logic**. Business logic belongs in `services/` or `agent-server/`.

---

# 1. Location & Packages

```
bff/
├── auth-bff/          # @vxture/bff-auth       → portals/accounts and central identity
├── website-bff/       # @vxture/bff-website    → portals/website
├── admin-bff/         # @vxture/bff-admin      → portals/admin
├── console-bff/       # @vxture/bff-console    → portals/console
├── opera-bff/         # @vxture/bff-opera      → portals/opera
├── arche-bff/         # @vxture/bff-arche      → portals/arche
├── workbench-bff/     # @vxture/bff-workbench  → portals/workbench
├── tenant-bff/        # @vxture/bff-tenant     → portals/customer-portal
├── gateway-bff/       # @vxture/bff-gateway    → shared ingress
└── platform-api/      # @vxture/bff-platform-api → platform API
```

命名规范：`@vxture/bff-{consumer-name}`

目录使用 `{consumer-name}-bff`；`platform-api` 是平台 API 的独立入口。
上述前八项是身份同步的八组前端/BFF，gateway 与 platform-api 不计入该八组。
Agent/Varda 已迁出平台仓；下文 Agent 模式仅作外部架构参考，不代表本仓包清单。

**Workbench 与 Tenant 的职责和工程名称：**

| 消费者                                     | BFF 目录 / 包名                               | 镜像仓库                 | 运行配置                                                                    |
| ------------------------------------------ | --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| 个人工作台 `portals/workbench`             | `bff/workbench-bff` / `@vxture/bff-workbench` | `platform_bff-workbench` | `WORKBENCH_BFF_PORT`                                                        |
| 租户组织专属门户 `portals/customer-portal` | `bff/tenant-bff` / `@vxture/bff-tenant`       | `platform_bff-tenant`    | `TENANT_BFF_PORT`、`TENANT_BFF_TOKEN`、`TENANT_BFF_URL`、`TENANT_BFF_IMAGE` |

`tenant-bff` 表达租户组织专属访问入口，按发布的 hostname 绑定组织并验证成员。
Console 面向租户管理，Tenant 面向该组织的门户使用者，两者各有独立 BFF。
唯一调用链为 `portals/customer-portal` → HTTP → `bff/tenant-bff` → `@vxture/service-customer-portal`。
`customer-portal` 是前端产品、领域服务及已登记登录契约的名称；它不作为 BFF 工程名称。
OIDC client、Cookie、Redis 命名空间、HTTP 头、数据库角色/表仍按该业务契约使用，不能随目录改名。
新增构建、部署、排障或回退引用一律使用表中名称，不设目录、包名或环境变量兼容别名。

**一对一原则**：每个 BFF 精确服务一个前端消费者。
前端永远不知道数据来自 `agent-server/` 还是 `services/` — BFF 是统一的数据出口。

### auth-bff — 唯一 JWT 签发者

`@vxture/bff-auth` 是**平台唯一有权签发 JWT 的服务**。

其他所有 BFF 不持有 JWT 签名密钥，登录成功后通过内部调用委托 auth-bff 签发：

```
POST /auth/internal/sign   →   auth-bff 验证凭据并返回 signed JWT
```

**设计意图**：

- 集中化密钥管理，私钥只存在于 auth-bff 的环境变量中
- 其他 BFF 仅验证（verify）JWT，不签发（sign）
- 第三方 OAuth（DingTalk、Feishu）回调统一在 auth-bff 中处理

**约束**：

- admin-bff 禁止配置第三方 OAuth — 运营后台仅支持邮箱密码登录
- website-bff 支持第三方 OAuth（DingTalk）通过 auth-bff 处理回调

---

# 2. Two Types of BFF

BFF 实例分为两类，职责有所差异：

## Portal BFF（`website-bff`, `admin-bff`, `console-bff`）

服务平台门户应用。数据主要来自 `services/*` 和 `core-*`。

```
portals/{name}  →  bff/{name}-bff  →  @vxture/service-*
                                   →  @vxture/core-*
```

典型职责：用户认证、租户管理、计费查询、订阅状态。

## Agent BFF（`agent{N}-bff`）

同时桥接 Agent 前端与 Agent 后端，是两者唯一的通信通道。

```
agent-studio/{N}  →  bff/agent{N}-bff  →  agent-server/{N}    (Agent 私有逻辑)
                                        →  @vxture/service-*   (平台共享逻辑)
                                        →  @vxture/core-*      (基础设施)
```

典型职责：将 Agent 的私有 API 与平台能力聚合后，以统一响应返回给前端。

## Embedded Agent BFF（`varda-bff`）

服务嵌入式 Agent 前端，当前用于 `admin` 与 `console` 两个宿主门户内的 Varda 智能体。

```
portals/admin
portals/console
      ↓ embeds
agent-studio/varda  →  bff/varda-bff  →  agent-server/varda
```

`varda-bff` 是 Varda 前端唯一可见的服务端入口，负责：

- 验证宿主门户传入的 JWT 或 session 凭据
- 构造并透传 `CallerContext`（userId、tenantId、surface、roles）
- 代理 `/varda/chat` SSE 流，保持 token 实时输出
- 隔离浏览器端与 `agent-server/varda` 的内部 API

宿主门户只嵌入 `@vxture/agent-studio-varda` 的 UI，不复用旧的 portal 内 assistant router。

---

# 3. Internal Structure

```
bff/{name}-bff/
├── package.json
├── tsconfig.json
└── src/
    ├── routers/          # 域路由模块，每域一个文件
    │   ├── user.router.ts
    │   ├── billing.router.ts
    │   └── {domain}.router.ts
    ├── aggregators/      # 跨域数据聚合逻辑
    │   └── {name}.aggregator.ts
    ├── middleware/       # 中间件
    │   ├── auth.middleware.ts
    │   └── tenant.middleware.ts
    ├── types/            # 面向前端的 DTO 类型定义
    │   └── {domain}.types.ts
    └── index.ts          # 应用入口，注册路由与中间件
```

---

# 4. Middleware

## auth.middleware.ts

**职责**：验证请求携带的认证凭据，拒绝未认证请求。

- 从请求头提取 token（JWT 或 session cookie）
- 调用 `@vxture/core-auth` 验证 token 有效性
- 将解析后的用户信息（userId、roles）挂载到请求上下文
- token 无效时返回 401，不进入路由处理

## tenant.middleware.ts

**职责**：解析并传播租户上下文，确保所有下游调用携带正确的租户标识。

- 从请求（路径参数、子域名、Header）中解析 tenantId
- 调用 `@vxture/core-tenant` 验证租户合法性
- 将 tenantId 注入请求上下文
- 所有路由处理器通过上下文获取 tenantId，无需重复解析

**中间件执行顺序**：auth → tenant → router

---

# 5. Router Modules

每个 router 模块负责**一个业务域**的路由处理。

**设计原则**：

- 每个 router 是独立的模块文件（`{domain}.router.ts`）
- 每个 router **自行处理内部错误** — 一个 router 的异常不得影响其他 router
- Router 调用 `services/*` 或 `agent-server` 获取数据，不包含业务逻辑本身
- Router 负责**响应塑形**：从后端数据中挑选、重命名、组合前端所需字段

```ts
// 示例：billing.router.ts 职责
// 1. 接收前端请求
// 2. 调用 @vxture/service-billing 获取原始数据
// 3. 将数据转换为前端需要的 DTO 格式
// 4. 返回响应
// 5. 捕获所有内部错误，返回标准化错误响应
```

**BFF 域扩展规则**：需要新增业务域时，在 `routers/` 下新增 router 文件。
不得创建新的 BFF 包来承载额外的域。

---

# 6. Transactional Email in Portal BFFs

Portal BFFs (`admin-bff`, `console-bff`) use `@vxture/core-mail` to send transactional
email notifications after state-changing operations.

**Pattern**:

```ts
// AppModule: 导入一次，全局可用
@Module({
  imports: [MailModule, ...],
})
export class AppModule {}

// Router: 注入 MailService，操作成功后 fire-and-forget 发信
constructor(@Inject(MailService) private readonly mailService: MailService) {}

await performAction(); // 主业务操作

void this.mailService.send({
  to: tenantContactEmail,
  subject: '[Vxture] 操作已完成',
  html: buildEmailHtml(result),
}).catch(() => {}); // 发信失败不阻断 HTTP 响应
```

**设计约束**:

- `MailModule` 用 `@Global()` 装饰 — `AppModule` 导入一次即在所有 controller 中可注入
- `MailService.send()` 在未配置 SMTP 时自动进入 no-op 模式，不抛异常
- 邮件发送使用 `void ... .catch(() => {})` — 失败静默处理，不影响主流程返回
- 邮件 HTML 由 BFF 内部函数构建，不依赖前端模板
- 收件人取自数据库字段（如 `tenant_organization.contact_email`）；为 `null` 时跳过发信

**当前 BFF 使用情况**:

| BFF           | 触发场景                      | 收件人                              |
| ------------- | ----------------------------- | ----------------------------------- |
| `admin-bff`   | 离线付款核销 / 驳回           | 租户联系邮箱（`org.contact_email`） |
| `console-bff` | 订阅升级 / 暂停 / 恢复 / 取消 | 操作者邮箱（`req.user.email`）      |

---

# 7. Aggregators

Aggregator 负责**跨域数据聚合**，组合来自多个 router 或服务的数据。

**使用场景**：

- 前端某个页面需要同时展示来自 billing、subscription、user 三个域的数据
- 单次 HTTP 请求需要并发调用多个下游服务并合并结果

**约束**：

- Aggregator 只做数据组合，不包含业务决策逻辑
- 跨域的业务编排属于业务逻辑，应在 `services/` 中处理

---

# 8. Response Shaping

BFF 对响应格式负全责。

- **字段投影**：只返回前端实际需要的字段，不透传后端完整数据结构
- **字段重命名**：后端字段名与前端约定不一致时，在 BFF 转换
- **数据组合**：将多个来源的数据合并为单一响应结构
- **类型安全**：响应结构在 `types/` 中定义 DTO 类型，前端依赖这些类型

---

# 9. Error Handling

- 每个 router 模块独立捕获并处理错误
- 错误统一转化为标准化 HTTP 错误响应（状态码 + 错误码 + 消息）
- Router 内部错误不冒泡到全局，不影响其他 router 的正常工作
- 认证和租户解析的错误在 middleware 层统一处理，不进入 router

---

# 10. Dependency Rules

Allowed:

```
agent-server/{N}          (Agent BFF 专用，通过内部 HTTP/tRPC 调用)
@vxture/service-*
@vxture/core-*
@vxture/shared
```

Forbidden:

```
other bff-*               (BFF 之间不互相调用)
@vxture/design-system
@vxture/platform-*
@vxture/model-runtime-client            (AI 能力属于 agent-server，不直接进 BFF)
React / 任何浏览器 API
```

**Critical constraint**: BFF 严格服务端。前端代码不得以包的形式导入 BFF。
所有前端 ↔ BFF 通信通过 **HTTP（REST 或 tRPC）** 进行。

---

# 11. Expansion Rules

| 场景                                   | 正确做法                                       |
| -------------------------------------- | ---------------------------------------------- |
| 现有 BFF 需要新业务域                  | 在 `routers/` 下新增 `{domain}.router.ts`      |
| 现有 router 变得非常大                 | 将 router 拆分为多个子 router，仍在同一 BFF 内 |
| 两个 portal 需要共享逻辑               | 提取到 `@vxture/service-*`，两个 BFF 分别导入  |
| 需要新的消费者（新 portal 或新 agent） | 创建新的 BFF 包 `bff/{name}-bff/`              |
| 现有 BFF 路由规模超大，需要独立部署    | 将部分 router 提取为独立 BFF 微服务            |

---

# 12. AI Coding Rules

AI 在操作 `bff/*` 时必须：

1. 禁止在 BFF 中导入 `@vxture/design-system`、`@vxture/platform-*`、`@vxture/model-runtime-client`
2. 禁止在 BFF 中写业务逻辑 — 业务逻辑属于 `services/` 或 `agent-server/`
3. 每个 router 模块必须独立处理自己的错误
4. 新增业务域通过新增 router 文件实现 — 不创建新 BFF 包
5. 响应类型在 `types/` 中定义 DTO — 不将后端数据结构直接透传给前端
6. auth 和 tenant 逻辑只在 middleware 中处理 — 不在 router 中重复解析
7. BFF 之间不互相调用
8. 不使用 `any` 类型
9. 区分 Portal BFF 与 Agent BFF 的职责差异：Agent BFF 需对接 `agent-server/`

---

End of document.
