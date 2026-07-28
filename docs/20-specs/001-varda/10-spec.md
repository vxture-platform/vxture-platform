# 瓦尔妲 Varda · 平台智能助手实现方案

**版本**: 1.0.0  
**日期**: 2026-04-30  
**适用**: Vxture Monorepo · AI Coding（Cursor / Claude Code）

---

## 文档说明

本文档是瓦尔妲 Varda 的完整实现方案，面向 AI coding 工具直接输出代码使用。

**阅读约定**

- 代码块 → 文件路径或关键代码，可直接参考实现
- `> ⚠️` → 重要约束，AI coding 必须遵守
- `★` 一期实现 · `☆` 二期迭代 · `—` 暂不实现

---

## 目录

1. [产品定位与架构概览](#1-产品定位与架构概览)
2. [Portal 层变更：tenant → console](#2-portal-层变更tenant--console)
3. [目录结构详解](#3-目录结构详解)
4. [CallerContext — 上下文隔离核心](#4-callercontext--上下文隔离核心)
5. [工具调用系统](#5-工具调用系统)
6. [对话编排与 LLM 集成](#6-对话编排与-llm-集成)
7. [接口协议](#7-接口协议)
8. [前端 Embedded 集成](#8-前端-embedded-集成)
9. [数据存储设计](#9-数据存储设计)
10. [演进阶段规划](#10-演进阶段规划)
11. [依赖边界与 AI Coding 规则](#11-依赖边界与-ai-coding-规则)
12. [容器与部署](#12-容器与部署)

---

## 1. 产品定位与架构概览

### 1.1 定位

瓦尔妲 Varda 是 Vxture 平台的内嵌智能助手，以 **Embedded micro-frontend** 模式运行于 admin 和 console 门户中。

Varda 不是通用聊天机器人，而是一个**具备平台权限感知能力的操作副驾驶**：

- 感知当前用户身份（operator / tenant_user）
- 感知当前业务上下文（所在门户、租户 ID、用户角色）
- 调用平台工具查询数据、分析状态、引导操作
- 阶段二起支持直接执行有限操作（暂停租户、调整订阅等）

### 1.2 消费者与部署模式

| 消费者门户      | URL                | 用户类型    | Varda Surface | 数据范围   |
| --------------- | ------------------ | ----------- | ------------- | ---------- |
| portals/admin   | y.vxture.com       | operator    | `admin`       | 全平台数据 |
| portals/console | console.vxture.com | tenant_user | `console`     | 本租户数据 |

### 1.3 架构位置

```
portals/admin            portals/console
  │  renders               │  renders
  ▼                        ▼
agent-studio/varda  ←──── 同一份前端代码
  │
  │  X-Varda-Surface: admin | console
  │  HTTP + JWT Cookie
  ▼
bff/varda-bff                           (@vxture/bff-varda)
  │  验证 JWT · 校验 surface · 构造 CallerContext
  ▼
agent-server/varda
  │
  ├──► @vxture/model-runtime-client         (llm · workflow)
  ├──► @vxture/service-billing
  ├──► @vxture/service-subscription
  ├──► @vxture/service-ticket
  └──► @vxture/core-*         (auth · tenant · config)
```

### 1.4 命名规范

| 层   | 目录                  | 包名 / 说明                            |
| ---- | --------------------- | -------------------------------------- |
| 前端 | `agent-studio/varda/` | micro-frontend，embedded 入宿主 portal |
| BFF  | `bff/varda-bff/`      | `@vxture/bff-varda`                    |
| 后端 | `agent-server/varda/` | 独立 NestJS 应用，无 @vxture 包名      |

> ⚠️ **架构约束（AI coding 必须遵守）**
>
> 1. varda 前端直连 varda-bff，不经过 admin-bff 或 console-bff
> 2. varda-bff 自行验证 JWT，不依赖宿主 portal 的 BFF
> 3. Surface 由前端 Header 声明，权限由服务端 JWT 兜底校验
> 4. `agent-server/varda` 禁止导入其他 `agent-server/*` 目录
> 5. 所有 AI 模型调用通过 `@vxture/model-runtime-client`，禁止直接集成 provider SDK

---

## 2. Portal 层变更：tenant → console

### 2.1 变更决策

原 `portals/tenant` 更名为 `portals/console`，原 `bff/tenant-bff` 更名为 `bff/console-bff`。

**变更原因：**

- 代码层 JWT 已有 `userType: tenant_user`，service 层有 `@vxture/service-subscription` 等 tenant 语义包，三处撞名导致混淆
- `console` 语义为「工作台」，与账号体系术语完全隔离，语义更稳定
- 用户感知更主动：「我在操作我的工作台」而非「我是租户」

### 2.2 变更清单

| 变更项         | 变更前                    | 变更后                    |
| -------------- | ------------------------- | ------------------------- |
| 目录           | `portals/tenant/`         | `portals/console/`        |
| 目录           | `bff/tenant-bff/`         | `bff/console-bff/`        |
| 包名           | `@vxture/bff-tenant`      | `@vxture/bff-console`     |
| 域名（规划）   | `tenant.vxture.com`       | `console.vxture.com`      |
| Nginx 路由     | `/tenant → tenant-bff`    | `/console → console-bff`  |
| JWT userType   | `tenant_user`（保持不变） | `tenant_user`（保持不变） |
| auth-design.md | tenant 门户相关描述       | 更新为 console            |

> ⚠️ JWT payload 中的 `userType: tenant_user` 字段保持不变，只是门户名称变更。数据库表名、service 包名均不受影响。

---

## 3. 目录结构详解

### 3.1 agent-studio/varda/（前端）

```
agent-studio/varda/
├── package.json
├── tsconfig.json
├── next.config.ts
└── src/
    ├── app/
    │   ├── layout.tsx          # 根布局（embedded 模式下无 shell）
    │   └── page.tsx            # 对话主页面
    ├── components/
    │   ├── VardaChat.tsx        # 核心对话组件（宿主 portal embed 入口）★
    │   ├── MessageList.tsx     # 消息列表渲染 ★
    │   ├── MessageBubble.tsx   # 单条消息气泡 ★
    │   ├── ToolCallCard.tsx    # 工具调用结果展示 ★
    │   ├── InputBar.tsx        # 输入栏 + 发送 ★
    │   └── SurfaceBadge.tsx    # 当前 surface 标识 ★
    ├── hooks/
    │   ├── useVardaChat.ts      # 对话状态管理（消息列表、loading、流式）★
    │   └── useVardaSurface.ts   # 读取当前 surface（来自宿主注入）★
    ├── lib/
    │   ├── varda.client.ts      # 调用 varda-bff 的 HTTP client ★
    │   └── stream.ts           # SSE 流式响应处理 ★
    ├── stores/
    │   └── varda.store.ts       # Zustand store（会话历史）★
    └── types/
        └── varda.types.ts       # 前端类型定义 ★
```

### 3.2 bff/varda-bff/（BFF 层）

```
bff/varda-bff/
├── package.json
├── tsconfig.json
└── src/
    ├── app.module.ts
    ├── main.ts
    ├── middleware/
    │   ├── auth.middleware.ts        # JWT 验证 + jti 黑名单 ★
    │   └── surface.middleware.ts     # X-Varda-Surface 校验 + CallerContext 构造 ★
    ├── routers/
    │   └── chat.router.ts            # POST /varda/chat（流式转发）★
    ├── types/
    │   ├── caller-context.types.ts   # CallerContext 定义 ★
    │   └── chat.types.ts             # 请求/响应 DTO ★
    └── index.ts
```

### 3.3 agent-server/varda/（后端）

```
agent-server/varda/
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma               # varda 私有数据表
└── src/
    ├── app.module.ts
    ├── main.ts
    ├── context/
    │   ├── caller-context.types.ts  # CallerContext 完整类型 ★
    │   └── context.guard.ts         # CallerContext 校验 Guard ★
    ├── chat/
    │   ├── chat.module.ts           ★
    │   ├── chat.controller.ts       # POST /internal/varda/chat ★
    │   ├── chat.service.ts          # 对话编排主逻辑 ★
    │   └── chat.types.ts            ★
    ├── tools/
    │   ├── tool-registry.ts         # 工具注册中心 ★
    │   ├── tool.types.ts            # Tool 接口定义 ★
    │   ├── tool-whitelist.const.ts  # Surface 工具白名单常量 ★
    │   ├── admin/                   # admin surface 专用工具
    │   │   ├── tenant-query.tool.ts       ★
    │   │   ├── billing-query.tool.ts      ★
    │   │   └── subscription-query.tool.ts ★
    │   └── console/                 # console surface 专用工具
    │       ├── my-billing.tool.ts         ★
    │       └── my-subscription.tool.ts    ★
    ├── storage/
    │   ├── session.repository.ts    # 会话持久化 ★
    │   └── message.repository.ts    # 消息持久化 ★
    └── audit/
        └── audit.service.ts         # 操作审计日志 ☆（二期执行类工具必需）
```

---

## 4. CallerContext — 上下文隔离核心

### 4.1 设计原理

CallerContext 是 Varda 上下文隔离的核心数据结构。由 **varda-bff 在服务端构造**，携带到 agent-server/varda，决定：

- 当前会话允许调用哪些工具（工具白名单）
- 数据查询的范围（全平台 or 当前租户）
- LLM 的 system prompt 口吻（运营视角 or 租户管理视角）

**安全原则**：Surface 由前端 Header 声明，但权限完全由服务端 JWT 兜底校验。

```
X-Varda-Surface: admin  +  JWT userType: operator     → ✅ 合法，admin context
X-Varda-Surface: admin  +  JWT userType: tenant_user  → ❌ 403 拒绝
X-Varda-Surface: console + JWT userType: tenant_user  → ✅ 合法，console context
X-Varda-Surface: console + JWT userType: operator     → ❌ 403 拒绝
```

### 4.2 CallerContext 类型定义

```typescript
// bff/varda-bff/src/types/caller-context.types.ts
// agent-server/varda/src/context/caller-context.types.ts
// （两处保持一致）

export type VardaSurface = "admin" | "console";

export type VardaUserType = "operator" | "tenant_user";

export interface CallerContext {
  // 来自 X-Varda-Surface Header（服务端校验合法性）
  surface: VardaSurface;

  // 来自 JWT payload
  userId: string;
  userType: VardaUserType;
  role: string; // 'super_admin' | 'admin' | 'owner' | 'member'
  tenantId: string | null; // operator 为 null

  // 派生字段（varda-bff 计算后注入）
  allowedTools: string[]; // 当前 surface + role 允许的工具 ID 列表
  dataScope: "global" | "tenant";
}
```

### 4.3 Surface × userType 合法矩阵

| Surface   | userType      | 合法   | dataScope | allowedTools 来源                 |
| --------- | ------------- | ------ | --------- | --------------------------------- |
| `admin`   | `operator`    | ✅     | `global`  | `ADMIN_TOOLS`（全平台工具集）     |
| `admin`   | `tenant_user` | ❌ 403 | —         | —                                 |
| `console` | `tenant_user` | ✅     | `tenant`  | `CONSOLE_TOOLS`（租户范围工具集） |
| `console` | `operator`    | ❌ 403 | —         | —                                 |

### 4.4 surface.middleware.ts 实现

```typescript
// bff/varda-bff/src/middleware/surface.middleware.ts

import { Injectable, NestMiddleware, ForbiddenException } from "@nestjs/common";
import { ADMIN_TOOLS, CONSOLE_TOOLS } from "../tools/tool-whitelist.const";
import type {
  CallerContext,
  VardaSurface,
  VardaUserType,
} from "../types/caller-context.types";

const VALID_COMBINATIONS: Record<VardaSurface, VardaUserType> = {
  admin: "operator",
  console: "tenant_user",
};

@Injectable()
export class SurfaceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const surface = req.headers["x-varda-surface"] as VardaSurface;
    const { userType, userId, role, tenantId } = req["user"]; // 由 auth middleware 注入

    if (!surface || VALID_COMBINATIONS[surface] !== userType) {
      throw new ForbiddenException("Surface and userType mismatch");
    }

    const callerContext: CallerContext = {
      surface,
      userId,
      userType,
      role,
      tenantId: tenantId ?? null,
      allowedTools: surface === "admin" ? ADMIN_TOOLS : CONSOLE_TOOLS,
      dataScope: surface === "admin" ? "global" : "tenant",
    };

    req["callerContext"] = callerContext;
    next();
  }
}
```

### 4.5 tool-whitelist.const.ts

```typescript
// bff/varda-bff/src/tools/tool-whitelist.const.ts
// agent-server/varda/src/tools/tool-whitelist.const.ts

export const ADMIN_TOOLS = [
  "tenant_search",
  "tenant_detail",
  "billing_overview",
  "subscription_list",
  "ticket_list",
] as const;

export const CONSOLE_TOOLS = [
  "my_subscription",
  "my_billing",
  "my_usage",
  "my_tickets",
] as const;
```

### 4.6 CallerContext 传递方式（BFF → agent-server）

CallerContext 通过 HTTP Header 以 Base64 编码的 JSON 传递：

```typescript
// varda-bff → agent-server/varda
// Header: X-Varda-Context: <base64(JSON.stringify(callerContext))>

// varda-bff 发送侧
const encoded = Buffer.from(JSON.stringify(callerContext)).toString("base64");
headers["x-varda-context"] = encoded;

// agent-server/varda/src/context/context.guard.ts 接收侧
const raw = req.headers["x-varda-context"] as string;
const ctx: CallerContext = JSON.parse(
  Buffer.from(raw, "base64").toString("utf-8"),
);
// 二次校验 surface × userType 合法性（防内部误调用）
if (VALID_COMBINATIONS[ctx.surface] !== ctx.userType) {
  throw new ForbiddenException();
}
```

---

## 5. 工具调用系统

### 5.1 Tool 接口定义

```typescript
// agent-server/varda/src/tools/tool.types.ts

import type {
  CallerContext,
  VardaSurface,
} from "../context/caller-context.types";

export interface VardaTool {
  id: string; // 工具唯一 ID，对应 LLM function name
  name: string; // 工具显示名称
  description: string; // 提供给 LLM 的工具描述
  surfaces: VardaSurface[]; // 允许调用的 surface 白名单
  dataScope: "global" | "tenant"; // 数据范围要求
  inputSchema: Record<string, unknown>; // JSON Schema（用于 LLM function calling）
  execute: (input: unknown, ctx: CallerContext) => Promise<VardaToolResult>;
}

export interface VardaToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  displayHint?: "table" | "list" | "text" | "card"; // 前端渲染提示
}
```

### 5.2 一期工具集（★ 全部只读）

**Admin Surface 工具（operator 专用）**

| 工具 ID             | 功能                     | 调用 Service                   | 返回 displayHint |
| ------------------- | ------------------------ | ------------------------------ | ---------------- |
| `tenant_search`     | 按名称/ID 搜索租户       | service-billing                | `table`          |
| `tenant_detail`     | 查询租户详情             | service-billing + subscription | `card`           |
| `billing_overview`  | 平台账单总览（GMV、ARR） | service-billing                | `card`           |
| `subscription_list` | 查询租户订阅列表         | service-subscription           | `table`          |
| `ticket_list`       | 查询支持工单列表         | service-ticket                 | `table`          |

**Console Surface 工具（tenant_user 专用，tenantId 强制隔离）**

| 工具 ID           | 功能             | 调用 Service         | 数据范围      |
| ----------------- | ---------------- | -------------------- | ------------- |
| `my_subscription` | 查询当前租户订阅 | service-subscription | 当前 tenantId |
| `my_billing`      | 查询当前租户账单 | service-billing      | 当前 tenantId |
| `my_usage`        | 查询当前租户用量 | service-subscription | 当前 tenantId |
| `my_tickets`      | 查询当前租户工单 | service-ticket       | 当前 tenantId |

### 5.3 ToolRegistry 实现

```typescript
// agent-server/varda/src/tools/tool-registry.ts

import { Injectable } from "@nestjs/common";
import type { CallerContext } from "../context/caller-context.types";
import type { VardaTool, VardaToolResult } from "./tool.types";

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, VardaTool>();

  register(tool: VardaTool): void {
    this.tools.set(tool.id, tool);
  }

  // 根据 CallerContext 返回当前会话允许的工具集（用于构造 LLM functions）
  getAvailableTools(ctx: CallerContext): VardaTool[] {
    return ctx.allowedTools
      .map((id) => this.tools.get(id))
      .filter(
        (t): t is VardaTool =>
          !!t &&
          t.surfaces.includes(ctx.surface) &&
          t.dataScope === ctx.dataScope,
      );
  }

  // 将工具列表转换为 LLM function calling 格式
  toLLMFunctions(tools: VardaTool[]) {
    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  async execute(
    toolId: string,
    input: unknown,
    ctx: CallerContext,
  ): Promise<VardaToolResult> {
    const tool = this.tools.get(toolId);

    // 双重校验：tool 存在 + 在当前 context 白名单内
    if (!tool || !ctx.allowedTools.includes(toolId)) {
      return { success: false, error: "Tool not allowed in current context" };
    }

    try {
      return await tool.execute(input, ctx);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
```

### 5.4 工具实现示例：tenant_search

```typescript
// agent-server/varda/src/tools/admin/tenant-query.tool.ts

import { getBillingStatus } from "@vxture/service-billing";
import type { VardaTool } from "../tool.types";

export const tenantSearchTool: VardaTool = {
  id: "tenant_search",
  name: "搜索租户",
  description:
    "根据租户名称或 ID 搜索平台租户，返回基本信息、订阅状态和账单状态",
  surfaces: ["admin"],
  dataScope: "global",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词（租户名称或 ID）" },
      limit: { type: "number", default: 10, description: "最多返回条数" },
    },
    required: ["query"],
  },
  async execute(input, ctx) {
    // ctx.dataScope === 'global' 已由 ToolRegistry 校验
    const { query, limit = 10 } = input as { query: string; limit?: number };
    const results = await getBillingStatus({ query, limit });
    return { success: true, data: results, displayHint: "table" };
  },
};
```

### 5.5 工具实现示例：my_subscription（console，租户隔离）

```typescript
// agent-server/varda/src/tools/console/my-subscription.tool.ts

import { getSubscription } from "@vxture/service-subscription";
import type { VardaTool } from "../tool.types";

export const mySubscriptionTool: VardaTool = {
  id: "my_subscription",
  name: "我的订阅",
  description: "查询当前租户的订阅计划、到期时间和功能权限",
  surfaces: ["console"],
  dataScope: "tenant",
  inputSchema: { type: "object", properties: {} },
  async execute(_input, ctx) {
    // tenantId 强制来自 CallerContext，前端无法篡改
    const data = await getSubscription({ tenantId: ctx.tenantId! });
    return { success: true, data, displayHint: "card" };
  },
};
```

---

## 6. 对话编排与 LLM 集成

### 6.1 chat.service.ts 主流程（Tool Use Loop）

```typescript
// agent-server/varda/src/chat/chat.service.ts

import { Injectable } from "@nestjs/common";
import { llmClient } from "@vxture/model-runtime-client/llm";
import { ToolRegistry } from "../tools/tool-registry";
import { buildSystemPrompt } from "./prompts/system.prompt";
import type { CallerContext } from "../context/caller-context.types";

const MAX_TOOL_ITERATIONS = 5;

@Injectable()
export class ChatService {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  async *chat(
    message: string,
    sessionId: string | null,
    ctx: CallerContext,
  ): AsyncGenerator<ChatStreamEvent> {
    // 1. 加载会话历史
    const history = sessionId ? await this.loadHistory(sessionId) : [];

    // 2. 获取当前可用工具
    const availableTools = this.toolRegistry.getAvailableTools(ctx);
    const functions = this.toolRegistry.toLLMFunctions(availableTools);

    // 3. 构造完整消息列表
    const messages = [
      { role: "system", content: buildSystemPrompt(ctx) },
      ...history,
      { role: "user", content: message },
    ];

    // 4. Tool Use Loop
    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      const stream = await llmClient.chatStream({
        provider: "doubao",
        model: "doubao-pro-32k",
        messages,
        functions: functions.length > 0 ? functions : undefined,
        stream: true,
      });

      let toolCallRequest: { name: string; arguments: unknown } | null = null;

      for await (const chunk of stream) {
        if (chunk.type === "text") {
          yield { type: "text", delta: chunk.delta };
        } else if (chunk.type === "tool_call") {
          toolCallRequest = chunk;
          yield { type: "tool_call", toolId: chunk.name, status: "running" };
        }
      }

      // 无工具调用 → 对话结束
      if (!toolCallRequest) break;

      // 5. 执行工具
      const toolResult = await this.toolRegistry.execute(
        toolCallRequest.name,
        toolCallRequest.arguments,
        ctx,
      );

      yield {
        type: "tool_result",
        toolId: toolCallRequest.name,
        data: toolResult.data,
        displayHint: toolResult.displayHint,
      };

      // 6. 将工具结果追加到消息历史，继续循环
      messages.push(
        { role: "assistant", content: null, function_call: toolCallRequest },
        {
          role: "function",
          name: toolCallRequest.name,
          content: JSON.stringify(toolResult),
        },
      );

      iterations++;
    }

    // 7. 持久化会话
    const newSessionId = await this.saveSession(sessionId, messages, ctx);
    yield { type: "done", sessionId: newSessionId };
  }
}
```

### 6.2 System Prompt 模板

```typescript
// agent-server/varda/src/chat/prompts/system.prompt.ts

import type { CallerContext } from "../../context/caller-context.types";

export function buildSystemPrompt(ctx: CallerContext): string {
  const base = `你是瓦尔妲 Varda，Vxture 平台的智能助手。当前时间：${new Date().toISOString()}。`;

  if (ctx.surface === "admin") {
    return `${base}
你正在协助平台运营人员（角色：${ctx.role}）管理 Vxture 平台。
你可以查询全平台的租户、账单、订阅、工单数据。
回答时使用专业、简洁的运营视角。如需执行操作，明确告知用户操作的影响范围。`;
  }

  if (ctx.surface === "console") {
    return `${base}
你正在协助租户管理员（租户 ID：${ctx.tenantId}，角色：${ctx.role}）管理其工作台。
你只能查询当前租户的数据，不能访问其他租户的任何信息。
回答时使用友好、实用的管理视角，聚焦当前租户的实际需求。`;
  }

  return base;
}
```

### 6.3 流式响应链路

```
agent-server/varda  →  SSE stream
       ↓
bff/varda-bff       →  透传（不缓冲、不解析内容）
       ↓
agent-studio/varda  →  EventSource / fetch ReadableStream 接收，逐 token 渲染
```

> ⚠️ varda-bff 对流式响应只做透传，Nginx 必须配置 `proxy_buffering off` 和 `Connection: ''`。

### 6.4 流式事件类型定义

```typescript
// 共享类型（前端和后端各自引用）

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolId: string; status: "running" }
  | { type: "tool_result"; toolId: string; data: unknown; displayHint?: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };
```

---

## 7. 接口协议

### 7.1 前端 → varda-bff

**POST /varda/chat**

```
Request Headers:
  Content-Type: application/json
  X-Varda-Surface: admin | console        # 必填
  Cookie: access_token=<jwt>             # HttpOnly Cookie，宿主 portal 已登录态

Request Body:
{
  "sessionId": "string | null",          // null 表示新建会话
  "message": "string"                    // 用户输入内容
}

Response: SSE Stream (text/event-stream)
data: {"type":"text","delta":"正在查询..."}
data: {"type":"tool_call","toolId":"tenant_search","status":"running"}
data: {"type":"tool_result","toolId":"tenant_search","data":[...],"displayHint":"table"}
data: {"type":"text","delta":"找到以下租户："}
data: {"type":"done","sessionId":"cld_xxxxxxxx"}
```

### 7.2 varda-bff → agent-server/varda（内部接口）

**POST /internal/varda/chat**

```
Request Headers:
  Content-Type: application/json
  X-Varda-Context: <base64(JSON.stringify(CallerContext))>   # 必填

Request Body:
{
  "sessionId": "string | null",
  "message": "string"
}

Response: SSE Stream（同上，透传给前端）
```

### 7.3 错误响应格式

```typescript
// 非流式错误（HTTP 层面）
{
  "statusCode": 401 | 403 | 429 | 500,
  "code": "UNAUTHORIZED" | "SURFACE_FORBIDDEN" | "TOOL_FORBIDDEN" | "RATE_LIMITED" | "LLM_ERROR",
  "message": "string"
}

// 流式错误（在 SSE 流中）
data: {"type":"error","message":"LLM service unavailable"}
```

**HTTP 状态码对照**

| 状态码 | 场景                      | code                |
| ------ | ------------------------- | ------------------- |
| 401    | JWT 无效或过期            | `UNAUTHORIZED`      |
| 403    | Surface × userType 不匹配 | `SURFACE_FORBIDDEN` |
| 403    | 工具调用超出权限范围      | `TOOL_FORBIDDEN`    |
| 429    | 请求频率超限              | `RATE_LIMITED`      |
| 500    | LLM 调用失败              | `LLM_ERROR`         |

---

## 8. 前端 Embedded 集成

### 8.1 VardaChat 组件（对外入口）

```typescript
// agent-studio/varda/src/components/VardaChat.tsx

import type { VardaSurface } from "../types/varda.types";

interface VardaChatProps {
  surface: VardaSurface; // 宿主 portal 注入，不能由用户修改
  defaultOpen?: boolean;
  position?: "sidebar" | "float";
}

export function VardaChat({
  surface,
  defaultOpen = false,
  position = "float",
}: VardaChatProps) {
  // surface prop 注入到 HTTP 请求 Header（X-Varda-Surface）
  // 组件内部只管 UI 状态，不做任何权限判断
  // 权限判断完全在服务端（varda-bff surface.middleware.ts）
}
```

### 8.2 宿主 portal 接入

```typescript
// portals/admin/src/app/layout.tsx

import dynamic from 'next/dynamic';

// 动态导入避免 SSR 问题
const VardaChat = dynamic(
  () => import('@varda/ui').then(m => m.VardaChat),
  { ssr: false }
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <main className="flex-1">{children}</main>
      <VardaChat surface="admin" position="float" />
    </div>
  );
}
```

```typescript
// portals/console/src/app/layout.tsx

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <main className="flex-1">{children}</main>
      <VardaChat surface="console" position="sidebar" />
    </div>
  );
}
```

### 8.3 Zustand Store

```typescript
// agent-studio/varda/src/stores/varda.store.ts

import { create } from "zustand";
import type { VardaMessage, VardaSurface } from "../types/varda.types";

interface VardaStore {
  // State
  sessionId: string | null;
  messages: VardaMessage[];
  isOpen: boolean;
  isStreaming: boolean;
  surface: VardaSurface | null;

  // Actions
  setSurface: (surface: VardaSurface) => void;
  sendMessage: (text: string) => Promise<void>;
  appendDelta: (delta: string) => void;
  appendToolResult: (
    toolId: string,
    data: unknown,
    displayHint?: string,
  ) => void;
  openChat: () => void;
  closeChat: () => void;
  clearSession: () => void;
}

export const useVardaStore = create<VardaStore>((set, get) => ({
  sessionId: null,
  messages: [],
  isOpen: false,
  isStreaming: false,
  surface: null,

  setSurface: (surface) => set({ surface }),

  sendMessage: async (text) => {
    const { sessionId, surface } = get();
    if (!surface) return;

    set((s) => ({
      isStreaming: true,
      messages: [...s.messages, { role: "user", content: text }],
    }));

    // 调用 varda.client.ts，处理 SSE 流
    // 具体实现见 lib/varda.client.ts
  },

  appendDelta: (delta) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta };
      } else {
        msgs.push({ role: "assistant", content: delta });
      }
      return { messages: msgs };
    }),

  appendToolResult: (toolId, data, displayHint) =>
    set((s) => ({
      messages: [...s.messages, { role: "tool", toolId, data, displayHint }],
    })),

  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false }),
  clearSession: () => set({ sessionId: null, messages: [] }),
}));
```

### 8.4 varda.client.ts（SSE 处理）

```typescript
// agent-studio/varda/src/lib/varda.client.ts

import type { VardaSurface } from "../types/varda.types";
import type { ChatStreamEvent } from "../types/varda.types";

export async function* streamChat(
  message: string,
  sessionId: string | null,
  surface: VardaSurface,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch("/varda/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Varda-Surface": surface,
    },
    credentials: "include", // 携带 HttpOnly Cookie
    body: JSON.stringify({ message, sessionId }),
  });

  if (!res.ok) {
    const err = await res.json();
    yield { type: "error", message: err.message };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6)) as ChatStreamEvent;
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
}
```

---

## 9. 数据存储设计

### 9.1 Prisma Schema

```prisma
// agent-server/varda/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 对话会话
model VardaSession {
  id        String   @id @default(cuid())
  userId    String
  tenantId  String?               // console surface 携带，admin 为 null
  surface   String                // 'admin' | 'console'
  title     String?               // 会话标题（取第一条消息前 20 字）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  VardaMessage[]

  @@index([userId, surface])
  @@index([tenantId])
}

// 对话消息
model VardaMessage {
  id          String   @id @default(cuid())
  sessionId   String
  role        String              // 'user' | 'assistant' | 'tool'
  content     String              // 文本内容
  toolId      String?             // tool call 时记录工具 ID
  toolInput   Json?               // 工具输入参数
  toolResult  Json?               // 工具返回结果
  displayHint String?             // 'table' | 'list' | 'text' | 'card'
  createdAt   DateTime @default(now())
  session     VardaSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}

// 操作审计日志（☆ 二期，执行类工具上线前必须完成）
model VardaAuditLog {
  id          String   @id @default(cuid())
  userId      String
  tenantId    String?
  surface     String
  toolId      String              // 执行的工具 ID
  input       Json                // 工具输入
  result      Json                // 工具输出
  confirmed   Boolean @default(false) // 是否经过用户二次确认
  executedAt  DateTime @default(now())

  @@index([userId])
  @@index([toolId])
}
```

---

## 10. 演进阶段规划

### 阶段一（★ 当前实现）— 感知 · 查询 · 引导

| 模块          | 实现内容                                       | 优先级 |
| ------------- | ---------------------------------------------- | ------ |
| CallerContext | Surface 校验、JWT 解析、工具白名单构造         | P0     |
| ToolRegistry  | 注册中心、权限过滤、执行调度                   | P0     |
| 一期工具集    | 5 个 admin 只读工具 + 4 个 console 只读工具    | P0     |
| 对话编排      | Tool Use Loop、System Prompt、流式响应         | P0     |
| 前端组件      | VardaChat、MessageList、ToolCallCard、InputBar | P0     |
| Embedded 集成 | admin + console portal 接入                    | P0     |
| 会话持久化    | VardaSession + VardaMessage 存储               | P1     |

**一期所有工具均为只读，无副作用，无需二次确认机制。**

### 阶段二（☆）— 确认 · 执行 · 反馈

| 模块                  | 实现内容                                | 前提条件               |
| --------------------- | --------------------------------------- | ---------------------- |
| 审计日志              | VardaAuditLog 完整记录操作链路          | 执行工具上线前必须完成 |
| 二次确认机制          | 执行前 UI 确认弹窗 + confirmed 字段记录 | 审计日志完成           |
| 执行类工具（admin）   | 暂停租户、调整订阅 plan、发送通知       | 二次确认机制完成       |
| 执行类工具（console） | 升级/降级订阅（含支付流程）             | 审计 + 确认完成        |
| 操作回滚              | 可撤销操作的回滚接口                    | 视操作类型评估         |

### 阶段三（— 待规划）— 自主 · 批量 · 规则驱动

| 模块       | 实现内容                                             | 前提条件           |
| ---------- | ---------------------------------------------------- | ------------------ |
| 规则引擎   | 基于触发条件自动执行工具                             | 阶段二审计体系完善 |
| 批量操作   | 批量清理、批量通知等高频重复任务                     | 操作类工具库完善   |
| 工作流编排 | `@vxture/model-runtime-client/workflow` 驱动多步流程 | workflow 模块成熟  |

---

## 11. 依赖边界与 AI Coding 规则

### 11.1 各层依赖规则

| 层                   | 允许依赖                                                          | 禁止依赖                                                      |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `agent-studio/varda` | `@vxture/design-system`, `@vxture/shared`, varda-bff（HTTP only） | `core-*`, `service-*`, `ai-sdk`, `bff-*`（as package）        |
| `bff/varda-bff`      | `@vxture/core-*`, `@vxture/shared`                                | `design-system`, `platform-*`, `ai-sdk`, 其他 `bff-*`         |
| `agent-server/varda` | `@vxture/model-runtime-client`, `service-*`, `core-*`, `shared`   | 其他 `agent-server/*`, `bff-*`, `design-system`, `platform-*` |

### 11.2 tsconfig 继承关系

```jsonc
// agent-studio/varda/tsconfig.json（应用层，两级路径）
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true } }

// bff/varda-bff/tsconfig.json（应用层，两级路径）
{ "extends": "../../tsconfig.base.json" }

// agent-server/varda/tsconfig.json（应用层，两级路径）
{ "extends": "../../tsconfig.base.json" }
```

### 11.3 AI Coding 检查清单

> ⚠️ 生成代码前逐条检查

```
□ varda 前端请求直接打到 varda-bff，不经过 admin-bff / console-bff
□ Surface 校验在 surface.middleware.ts 完成，不在 router 或 service 中重复
□ tenantId 只从 CallerContext（JWT 派生）获取，禁止从请求 body / query 接收
□ 工具执行前必须通过 ToolRegistry 校验 allowedTools 白名单
□ console surface 的所有工具调用必须携带 ctx.tenantId 作为数据过滤条件
□ 所有 LLM 调用通过 @vxture/model-runtime-client/llm，禁止直接 import 任何 provider SDK
□ agent-server/varda 禁止 import 其他 agent-server/* 目录的任何内容
□ 无 any 类型，严格遵循 tsconfig.base.json strict 配置
□ 所有公共 API 通过 src/index.ts 导出，禁止深层路径导入
□ 执行类工具（阶段二）必须先写入 VardaAuditLog 再执行操作
□ 新增工具时必须同步更新 ADMIN_TOOLS 或 CONSOLE_TOOLS 白名单常量
□ 中间件执行顺序：auth.middleware → surface.middleware → router
```

---

## 12. 容器与部署

### 12.1 新增容器（★）

| 容器名          | 类型    | 说明                                                           |
| --------------- | ------- | -------------------------------------------------------------- |
| `varda-bff`     | NestJS  | `bff/varda-bff`，对外暴露 `/varda/*`                           |
| `varda-server`  | NestJS  | `agent-server/varda`，内部服务，不对外暴露                     |
| `varda`（前端） | Next.js | `agent-studio/varda`，embedded 模式可合并到 admin/console 构建 |

### 12.2 更新后本仓容器清单（Ruyin 已迁出）

| 容器                           | 类型    | 变更说明                                                       |
| ------------------------------ | ------- | -------------------------------------------------------------- |
| `auth-bff`                     | NestJS  | 不变                                                           |
| `website`                      | Next.js | 不变                                                           |
| `admin`                        | Next.js | 新增 VardaChat embedded                                        |
| `console`（原 tenant）         | Next.js | **更名**，新增 VardaChat embedded                              |
| `website-bff`                  | NestJS  | 不变                                                           |
| `admin-bff`                    | NestJS  | 不变                                                           |
| `console-bff`（原 tenant-bff） | NestJS  | **更名**                                                       |
| `varda-bff`                    | NestJS  | ★ 新增                                                         |
| `assistant-server`             | NestJS  | 不变                                                           |
| `varda-server`                 | NestJS  | ★ 新增                                                         |
| `Nginx`                        | —       | 新增 varda-bff 路由 + SSE 配置                                 |
| `PostgreSQL`                   | —       | 新增 varda 私有表（VardaSession、VardaMessage、VardaAuditLog） |
| `Redis`                        | —       | 不变                                                           |
| `varda`（前端）                | Next.js | ★ 新增（或合并到 admin/console 构建产物）                      |

Ruyin 相关前端、BFF、Server 和 vx-worker-02 部署已迁出到 `vxture/agentstudio-ruyin`，不再纳入本仓 Varda 实施清单。

### 12.3 Nginx 新增路由规则

```nginx
# varda-bff（SSE 必须关闭 buffering）
location /varda/ {
    proxy_pass         http://varda-bff:3000;
    proxy_http_version 1.1;
    proxy_set_header   Connection '';        # SSE 保持长连接必需
    proxy_buffering    off;                  # SSE 禁止缓冲必需
    proxy_cache        off;
    proxy_read_timeout 300s;                 # 防止长对话超时断开
}
```

### 12.4 环境变量新增

```bash
# varda-bff
VARDA_SERVER_URL=http://varda-server:3100/internal   # agent-server/varda 内部地址
JWT_SECRET=                                         # 与 auth-bff 相同值（用于验证，平台部署从 secrets/platform.env 注入）

# varda-server
DATABASE_URL=postgresql://...                       # PostgreSQL 连接（可与主库共用）
VARDA_INTERNAL_SECRET=                              # 内部服务间调用鉴权（可选，内网环境）
```

---

_End of Document — 瓦尔妲 Varda Implementation Spec v1.0.0_
