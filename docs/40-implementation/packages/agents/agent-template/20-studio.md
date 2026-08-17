# @vxture/agent-studio-agent01

> 新 Agent 前端分叉起点。从 `agent-studio/agent-template/` 克隆，重命名后开始开发。
> 架构层参考：[`docs/30-design/architecture/06-agent-server.md`](../../../../30-design/architecture/06-agent-server.md)

---

## 包信息

| 项     | 值                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------ |
| 包名   | `@vxture/agent-studio-agent01`（分叉后按 `@vxture/agent-studio-{name}` 命名）                    |
| 路径   | `agent-studio/agent-template/`                                                                   |
| @layer | `Presentation`                                                                                   |
| 端口   | 按[端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)登记，不自取 |
| 框架   | Next.js（可嵌入式或独立部署）                                                                    |

## 职责

Agent 前端 UI。负责对话界面渲染、消息流展示、工具调用反馈。

`CallerContext` 由对应 bff 构建，此包只负责 UI 渲染和用户交互，不参与鉴权逻辑。

## 目录结构（模板）

```
src/
├── app/            ← Next.js App Router
├── components/     ← 聊天 UI 组件（消息列表、输入框、工具调用气泡）
├── hooks/          ← useChat / useStream 等
├── stores/         ← Zustand UI 状态
├── lib/            ← SSE 客户端、消息序列化
└── types/          ← 前端类型定义
```

## 分叉步骤

1. 复制 `agent-studio/agent-template/` → `agent-studio/{name}/`
2. 在 `package.json` 中更新包名为 `@vxture/agent-studio-{name}`
3. 按 `docs/40-implementation/ai/port-allocation.md` 登记端口
4. 创建 `docs/40-implementation/packages/agents/{name}/studio.md`（参照本文件）
5. 在 `docs/30-design/architecture/00-index.md` Agent 实例表中添加一行

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/platform-browser
✅ 对应 bff（HTTP / SSE only，禁止包引用）
❌ @vxture/model-runtime-client / agent-server/* / @vxture/core-*（core-locale 除外）
```
