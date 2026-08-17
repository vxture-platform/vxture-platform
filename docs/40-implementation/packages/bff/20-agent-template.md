# @vxture/bff-agent01

> 新 Agent 分叉起点。从此文件和 `bff/agent-template-bff/` 克隆，重命名后开始开发。
> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项       | 值                                                          |
| -------- | ----------------------------------------------------------- |
| 包名     | `@vxture/bff-agent01`（分叉后按 `@vxture/bff-{name}` 命名） |
| 路径     | `bff/agent-template-bff/`                                   |
| @layer   | `Application`                                               |
| 服务对象 | 对应 `agent-studio/agent-template` 前端                     |
| 端口     | 按端口登记表登记（见文末「分叉步骤」）                      |

## 唯一职责

1. 验证 JWT（来自宿主 portal 的 Cookie）
2. 构造 `CallerContext`（userId / tenantId / 权限范围）
3. 将前端请求转发给对应的 `agent-server/{name}`
4. 必要时聚合多个 service 响应

**不做**：登录/登出、直接调用 LLM、操作数据库、JWT 签发。

## 目录结构（模板）

```
src/
├── middleware/
│   └── auth.middleware.ts       # JWT 验证，挂载 req.user
├── routers/
│   ├── chat.router.ts          # 主业务路由（按需重命名）
│   └── health.router.ts
├── types/
│   ├── caller-context.types.ts
│   └── request.types.ts
└── index.ts
```

## 分叉步骤

1. 复制 `bff/agent-template-bff/` → `bff/{name}-bff/`
2. 在 `package.json` 中更新包名为 `@vxture/bff-{name}`
3. 在[端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)登记新端口——L3 智能体在 `4000–5999` 段内**另起一个 10 位子块**，不接着上一个挤。**先登记，后用号**
4. 创建 `docs/40-implementation/packages/bff/{name}.md`（参照本文件）
5. 在 `docs/30-design/architecture/00-index.md` Agent 实例表中添加一行

## 依赖约束

**允许：**

- `@vxture/core-auth`（JWT 类型，不引入签发逻辑）
- `@vxture/core-config` / `@vxture/shared`
- NestJS / `@nestjs/jwt` / `cookie-parser`

**禁止：**

- `@vxture/model-runtime-client` / `@vxture/service-*` / `design-system` / `platform-*`
- 跨 BFF 导入 / JWT 签发逻辑
