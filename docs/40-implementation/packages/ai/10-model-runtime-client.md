# @vxture/model-runtime-client

> 更新：2026-05-14
> 架构层：`Infrastructure`（见 `docs/30-design/architecture/03-core-layer.md`）
> 依赖网关：[`docs/40-implementation/packages/services/model-platform.md`](../services/40-model-platform.md)

---

## 包信息

| 项     | 值                                                  |
| ------ | --------------------------------------------------- |
| 包名   | `@vxture/model-runtime-client`                      |
| 路径   | `packages/ai/model-runtime-client/`                 |
| @layer | `Infrastructure`                                    |
| 消费方 | `agent-server/varda`、外部业务仓库中的 Agent Server |

---

## 定位

`@vxture/model-runtime-client` 是平台的 **AI 能力基础层**，对上层 agent-server 提供统一的 LLM 调用、Embedding、RAG 检索和工作流编排接口，屏蔽底层当前 Model Platform / 目标 Model Runtime 的 HTTP 协议细节。

所有 LLM 请求经由当前 **Model Platform**转发，不直接调用 LLM provider API。目标架构中，该入口对应 `model-runtime`；计费归因、模型路由、Provider adapter 和用量计量均在运行面完成。

---

## 模块结构

```
packages/ai/model-runtime-client/src/
├── llm/          # LLM 对话客户端（核心）
│   ├── client.ts   ModelRuntimeLLMClient 实现
│   ├── types.ts    LLM 类型体系
│   └── index.ts
├── embedding/    # 文本向量化（类型定义，实现在 Gateway）
│   ├── types.ts
│   └── index.ts
├── rag/          # 检索增强生成（类型定义）
│   ├── types.ts
│   └── index.ts
├── workflow/     # 工作流编排（类型定义）
│   ├── types.ts
│   └── index.ts
└── index.ts      # 统一导出
```

---

## LLM 模块（核心）

### ModelRuntimeLLMClient

唯一的 LLM 调用入口，通过 HTTP 代理到 Model Platform：

```typescript
import { createModelRuntimeLLMClient } from "@vxture/model-runtime-client";

const client = createModelRuntimeLLMClient({
  tenantId: "tenant-uuid", // 必填，用于计费归因
  applicationId: "application-uuid", // 可选，按应用计量时使用
  applicationType: "agent", // 可选：agent / workflow / api_client / internal_service
  gatewayUrl: process.env.MODEL_PLATFORM_URL, // 默认读环境变量
  defaultTimeoutMs: 60_000,
});
```

历史 `agentId` 入参仅作为兼容别名处理，等价于 `applicationId = agentId` 且 `applicationType = "agent"`；新契约应使用 `applicationId + applicationType`。如果传入 `applicationId`，必须同时传入 `applicationType`，避免 workflow / api client 被误归到 agent。

**两种调用方式：**

```typescript
// 1. 普通对话（同步，等待完整响应）
const response = await client.chat(messages, { model: "doubao-seed-2-0-lite" });
console.log(response.content, response.usage);

// 2. 流式对话（SSE，逐 chunk 处理）
for await (const chunk of client.chatStream(messages, config, { tools })) {
  if (chunk.type === "text") process.stdout.write(chunk.delta);
  if (chunk.type === "tool_call") await runTool(chunk.toolCall);
  if (chunk.type === "done") break;
  if (chunk.type === "error") throw new Error(chunk.message);
}
```

### 消息类型（LLMMessage）

| role        | 用途                                     |
| ----------- | ---------------------------------------- |
| `system`    | 系统提示词                               |
| `user`      | 用户输入                                 |
| `assistant` | 模型输出（Tool Use Loop 中含 toolCalls） |
| `tool`      | 工具执行结果回填，需配合 `toolCallId`    |

### Tool Use Loop 约定

```
发送消息 → chatStream() → chunk.type === 'tool_call'
  → 执行工具，得到结果
  → 追加 { role: 'tool', content: JSON.stringify(result), toolCallId }
  → 再次调用 chatStream()，循环直到 finishReason === 'stop'
```

varda-server 的 `ToolUseLoop` 是当前唯一的实现方。

### 错误类型

| code                     | 含义                                                     |
| ------------------------ | -------------------------------------------------------- |
| `MISSING_TENANT_ID`      | 构造时未传 tenantId                                      |
| `MISSING_GATEWAY_URL`    | 未设置 `MODEL_PLATFORM_URL`                              |
| `GATEWAY_REQUEST_FAILED` | HTTP 请求失败（网络 / 超时）                             |
| `HTTP_4xx / HTTP_5xx`    | Gateway 返回错误状态码                                   |
| `STREAM_NOT_SUPPORTED`   | 对 `chat()` 传入 `stream: true`（应使用 `chatStream()`） |
| `EMPTY_GATEWAY_STREAM`   | Gateway 返回空 SSE 流                                    |

---

## Embedding 模块

当前导出类型定义，实际向量化计算由 Model Platform 执行。消费方通过 Gateway HTTP API 调用，不直接使用 SDK 层的 embedding 功能。

---

## RAG 模块

提供检索增强生成的类型契约（查询参数、检索结果、上下文构建）。具体检索实现依赖向量数据库，由各 agent-server 自行持久化。

---

## Workflow 模块

提供多步骤工作流编排的类型定义（`WorkflowStep`、`WorkflowContext`、`WorkflowTask`）。业务仓库如需工作流编排，应通过受控客户端调用平台 Model Platform。

---

## 依赖约束

**允许引用 `@vxture/model-runtime-client` 的包：**

- `agent-server/varda`
- 外部业务仓库中的 Agent Server（通过明确依赖或发布包方式接入）

**禁止引用的包：**

- `bff/*` — BFF 层不直接调用 AI，通过 agent-server 中转
- `portals/*` / `agent-studio/*` — 前端层禁止
- `services/*`（非 ai/gateway）— 业务服务不直接调用 LLM

**环境变量：**

- `MODEL_PLATFORM_URL`（必填，默认 `http://localhost:3100`）
