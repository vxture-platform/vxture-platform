# Agent 层包文档

> Agent = agent-server（后端）+ agent-studio（前端）两部分，各自独立文档

> 部署边界：当前 `vxture` 仓库不负责 vx-worker-02/03/04/05 等业务 beta/prod 部署。以下目录存在不代表本仓拥有部署职责；业务 worker 相关部署由外部业务仓库维护。Ruyin 迁移与 vx-worker-02 部署归属 `vxture/agentstudio-ruyin`；Varda 待 Ruyin 模板跑顺后再规划迁移到 `vxture/agentstudio-varda`。Atlas（原 model-platform）已拆分为独立仓 `vxture-atlas`，不再随本仓平台栈部署。

---

## 本仓保留 Agent

### Varda — 内嵌智能助手

| 部分 | 文档                                      | 路径                  | 说明                                           |
| ---- | ----------------------------------------- | --------------------- | ---------------------------------------------- |
| 后端 | [`varda/server.md`](./varda/10-server.md) | `agent-server/varda/` | Tool Use Loop，持久化会话，接入 model-platform |
| 前端 | [`varda/studio.md`](./varda/20-studio.md) | `agent-studio/varda/` | 嵌入式微前端，渲染对话 UI，SSE 消费            |

**部署模式**：嵌入式（iframe / module federation），载入 admin 和 console portal。后续若迁移到独立业务仓库，目标仓库为 `vxture/agentstudio-varda`；迁移前不得在本仓新增 vx-worker-02 workflow。

### Ruyin — 超级智能体（已迁出）

Ruyin 代码已迁移到 `vxture/agentstudio-ruyin`。本仓 P7b 已删除 Ruyin 本地实现目录和对应实现文档；本仓仅保留平台 auth / SSO / Atlas 等对外契约说明。

---

## 新 Agent Fork 起点

| 部分 | 文档                                                        | 说明                                                            |
| ---- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 后端 | [`agent-template/server.md`](./agent-template/10-server.md) | agent-server fork 模板，含 CallerContext、ToolRegistry 接入规范 |
| 前端 | [`agent-template/studio.md`](./agent-template/20-studio.md) | agent-studio fork 模板，SSE 消费，BFF 接入规范                  |

新增 Agent 时先 fork 这两个模板，再注册端口（见 `docs/40-implementation/ai/port-allocation.md`）。

---

## 共同约束

- 每个 agent-server 是**独立进程**，**禁止**跨 Agent 实例 import
- 所有 LLM 调用**必须**经过平台 model-platform（地址由业务仓库的 `MODEL_PLATFORM_URL` / 内网接入配置提供），禁止直接 import Anthropic / Doubao SDK
- CallerContext 由 BFF 组装并传入，agent-server 必须**二次校验**，不信任前端传入字段
- `allowedTools` 来自 CallerContext，不接受前端覆盖（ToolRegistry 白名单执行）
