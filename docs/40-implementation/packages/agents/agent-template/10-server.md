# agent-template-server

> 新 Agent 后端分叉起点。从 `agent-server/agent-template/` 克隆，重命名后开始开发。
> 架构层参考：[`docs/30-design/architecture/06-agent-server.md`](../../../../30-design/architecture/06-agent-server.md)

---

## 包信息

| 项       | 值                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------ |
| 名称     | `agent-template-server`（分叉后按 `{name}-server` 命名，无 @vxture 包名）                        |
| 路径     | `agent-server/agent-template/`                                                                   |
| @layer   | `Application` / `Domain`（agent 私有）                                                           |
| 端口     | 按[端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)登记，不自取 |
| 对外接口 | `POST /internal/{name}/chat`（仅对应 bff 调用）                                                  |

## 职责

1. 接收 bff 内部请求，解码并二次校验 `CallerContext`
2. 通过 `ToolRegistry` 过滤当前 context 允许的工具
3. 调用 `@vxture/model-runtime-client/llm` 执行 Tool Use Loop
4. 流式返回 SSE 事件给 bff（透传给前端）
5. 会话 + 消息持久化（Prisma → PostgreSQL）

## 目录结构（模板）

```
src/
├── context/
│   ├── caller-context.types.ts  # 与 bff 镜像，禁止跨包 import
│   └── context.guard.ts         # CallerContext 二次校验
├── chat/
│   ├── chat.service.ts          # Tool Use Loop 主逻辑
│   ├── chat.controller.ts
│   └── prompts/system.prompt.ts # Agent 系统提示词
├── tools/
│   ├── tool-registry.ts
│   └── {domain}/                # 按业务域组织工具
└── storage/
    ├── session.repository.ts
    └── message.repository.ts
```

## 分叉步骤

1. 复制 `agent-server/agent-template/` → `agent-server/{name}/`
2. 更新 `package.json` 中的应用名
3. 按 `docs/40-implementation/ai/port-allocation.md` 登记端口
4. 创建 `docs/40-implementation/packages/agents/{name}/server.md`（参照本文件）
5. 在 `docs/30-design/architecture/00-index.md` Agent 实例表中添加一行

## 核心约束

1. 禁止 import 其他 `agent-server/*` 目录
2. 所有 LLM 调用通过 `@vxture/model-runtime-client/llm`，禁止直接 import provider SDK
3. `CallerContext` 必须在入口处二次校验 surface × userType 合法性
4. 工具执行前必须经过 `ToolRegistry` 的 `allowedTools` 白名单校验

## 依赖约束

**允许：**

- `@vxture/model-runtime-client` / `@vxture/service-*`（按需）
- `@vxture/core-auth` / `@vxture/core-config` / `@vxture/shared`
- NestJS / `@prisma/client`

**禁止：** 其他 `agent-server/*` / `bff-*` / `design-system` / `platform-*` / React / Next.js / 直接 import Anthropic/Doubao SDK
