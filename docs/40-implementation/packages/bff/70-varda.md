# @vxture/bff-varda

> ⚠️ 待大版本重构 | 迁移自 `bff/varda-bff/AGENTS.md`
> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)
> 产品规格：[`docs/20-specs/agents/varda/spec.md`](../../../20-specs/001-varda/10-spec.md)

---

## 包信息

| 项       | 值                                                   |
| -------- | ---------------------------------------------------- |
| 包名     | `@vxture/bff-varda`                                  |
| 路径     | `bff/varda-bff/`                                     |
| @layer   | `Application`                                        |
| 服务对象 | `agent-studio/varda`（admin + console 两个 surface） |

## 唯一职责

1. 验证 JWT（来自宿主 portal 的 Cookie）
2. 校验 `X-Varda-Surface` Header × JWT `userType` 合法性
3. 构造 `CallerContext`（surface / userId / tenantId / allowedTools / dataScope）
4. 将 `/varda/chat` 请求透传给 `agent-server/varda`，SSE 流式回传

**不做**：登录/登出、业务数据聚合、直接调用 LLM、操作数据库。

## Surface × userType 矩阵

| X-Varda-Surface | JWT userType  | 结果                     |
| --------------- | ------------- | ------------------------ |
| `admin`         | `operator`    | ✅ dataScope = global    |
| `admin`         | `tenant_user` | ❌ 403 SURFACE_FORBIDDEN |
| `console`       | `tenant_user` | ✅ dataScope = tenant    |
| `console`       | `operator`    | ❌ 403 SURFACE_FORBIDDEN |

## 目录结构

```
src/
├── middleware/
│   ├── auth.middleware.ts       # JWT 验证，挂载 req.user
│   └── surface.middleware.ts   # Surface 校验，构造 req.callerContext
├── routers/
│   ├── chat.router.ts          # POST /varda/chat（SSE 透传）
│   └── health.router.ts
├── tools/
│   └── tool-whitelist.const.ts # ADMIN_TOOLS / CONSOLE_TOOLS
├── types/
│   ├── caller-context.types.ts
│   └── chat.types.ts
└── index.ts
```

## 接口契约

**POST `/varda/chat`** — 发起对话（SSE 流式）

```typescript
// Request Header
// Cookie: vx_admin_access_token=... 或 vx_tenant_access_token=...（必须）
// X-Varda-Surface: 'admin' | 'console'（必须）

// Request Body
{
  sessionId?: string;   // 不传则创建新会话
  message: string;      // 用户消息内容
}

// Response：Content-Type: text/event-stream
// SSE 事件格式：
data: { type: 'text_delta'; delta: string }
data: { type: 'tool_use'; toolName: string; input: Record<string, unknown> }
data: { type: 'tool_result'; toolName: string; output: unknown }
data: { type: 'done'; sessionId: string; messageId: string }
data: { type: 'error'; code: string; message: string }

// HTTP Error（流开始前）
// 401: { code: 'UNAUTHORIZED' }
// 403: { code: 'SURFACE_FORBIDDEN'; message: '...' }
```

**GET `/health`** — 健康检查（无鉴权）

```typescript
// Response 200
{
  status: "ok";
  version: string;
}
```

## 核心约束（违反破坏安全隔离）

1. Surface 校验**只在 `surface.middleware.ts`** 做，router 不得重复校验
2. `tenantId` 只从 JWT payload 取，禁止从 request body / query 读取
3. `allowedTools` 只能来自常量，不接受前端传入
4. 中间件顺序：AuthMiddleware → SurfaceMiddleware → ChatRouter
5. `/health` 不经过中间件

## 依赖约束

**允许：**

- `@vxture/core-auth`（JWT 类型，不引入签发逻辑）
- `@vxture/core-config` / `@vxture/shared`
- NestJS / `@nestjs/jwt` / `cookie-parser`

**禁止：**

- `@vxture/model-runtime-client` / `@vxture/service-*` / `design-system` / `platform-*`
- 跨 BFF 导入 / JWT 签发逻辑
