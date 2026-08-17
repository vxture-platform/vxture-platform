# @vxture/agent-studio-varda

> 架构层参考：[`docs/30-design/architecture/06-agent-server.md`](../../../../30-design/architecture/06-agent-server.md)
> 产品规格：[`docs/20-specs/agents/varda/spec.md`](../../../../20-specs/001-varda/10-spec.md)

---

## 包信息

| 项     | 值                           |
| ------ | ---------------------------- |
| 包名   | `@vxture/agent-studio-varda` |
| 路径   | `agent-studio/varda/`        |
| @layer | `Presentation`               |

| 框架 | Next.js（嵌入式微前端） |

## 职责

Varda 智能助手前端。以嵌入式微前端形式加载到 `portals/admin` 和 `portals/console` 中，提供对话 UI、消息流渲染、工具调用反馈展示。

**CallerContext 由 varda-bff 构建**，此包只负责 UI 渲染和用户交互，不参与鉴权逻辑。

## 目录结构

```
src/
├── app/            ← Next.js App Router
├── components/     ← 聊天 UI 组件（消息列表、输入框、工具调用气泡）
├── hooks/          ← useChat / useStream 等
├── stores/         ← Zustand UI 状态
├── lib/            ← SSE 客户端、消息序列化
└── types/          ← 前端类型定义
```

## 依赖约束

```typescript
✅ @vxture/design-system / @vxture/shared / @vxture/platform-browser
✅ varda-bff（HTTP / SSE only，禁止包引用）
❌ @vxture/model-runtime-client / agent-server/* / @vxture/core-*（core-locale 除外）
```

## 待核查

- [ ] 确认当前嵌入方式（iframe / module federation / script tag）
- [ ] 确认 SSE 消费实现（EventSource vs fetch streaming）
