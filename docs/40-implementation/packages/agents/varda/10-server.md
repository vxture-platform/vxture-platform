# varda-server

> ⚠️ 待大版本重构 | 迁移自 `agent-server/varda/AGENTS.md`
> 架构层参考：[`docs/30-design/architecture/06-agent-server.md`](../../../../30-design/architecture/06-agent-server.md)
> 产品规格：[`docs/20-specs/agents/varda/spec.md`](../../../../20-specs/001-varda/10-spec.md)

---

## 包信息

| 项     | 值                                          |
| ------ | ------------------------------------------- |
| 名称   | `varda-server`（无 @vxture 包名，独立应用） |
| 路径   | `agent-server/varda/`                       |
| @layer | `Application` / `Domain`（agent 私有）      |

| 对外接口 | `POST /internal/varda/chat`（仅 varda-bff 调用） |

## 职责

1. 接收 varda-bff 内部请求，解码并二次校验 `CallerContext`
2. 通过 `ToolRegistry` 过滤当前 context 允许的工具
3. 调用 `@vxture/model-runtime-client/llm` 执行 Tool Use Loop
4. 流式返回 SSE 事件给 varda-bff（透传给前端）
5. 会话 + 消息持久化（Prisma → PostgreSQL）

## 目录结构

```
src/
├── context/
│   ├── caller-context.types.ts  # 与 varda-bff 镜像，禁止跨包 import
│   └── context.guard.ts         # CallerContext 二次校验
├── chat/
│   ├── chat.service.ts          # Tool Use Loop 主逻辑
│   ├── chat.controller.ts
│   └── prompts/system.prompt.ts
├── tools/
│   ├── tool-registry.ts
│   ├── admin/                   # operator 专用工具
│   └── console/                 # tenant_user 专用工具（tenantId 强制隔离）
└── storage/
    ├── session.repository.ts
    └── message.repository.ts
```

## 核心约束（违反破坏安全）

1. 禁止 import 其他 `agent-server/*` 目录
2. 所有 LLM 调用通过 `@vxture/model-runtime-client/llm`，禁止直接 import provider SDK
3. `console` surface 工具执行时必须以 `ctx.tenantId` 作为数据过滤条件
4. 工具执行前必须经过 `ToolRegistry` 的 `allowedTools` 白名单校验
5. 收到 `CallerContext` 后必须二次校验 surface × userType 合法性
6. 执行类工具（二期）必须先写 `VardaAuditLog` 再执行操作

## 依赖约束

**允许：**

- `@vxture/model-runtime-client` / `@vxture/service-billing` / `@vxture/service-subscription` / `@vxture/service-ticket`
- `@vxture/core-auth` / `@vxture/core-config` / `@vxture/shared`
- NestJS / `@prisma/client`

**禁止：** 其他 `agent-server/*` / `bff-*` / `design-system` / `platform-*` / React / Next.js / 直接 import Anthropic/Doubao SDK
