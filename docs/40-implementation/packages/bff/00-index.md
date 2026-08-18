# BFF 层包文档

> @layer `Application` | 框架：业务型 BFF → NestJS，代理型 BFF → Hono（见 ADR-004）
> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

> **端口**：端口取号唯一源 = [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)；**本仓文档不再保存端口数值**。

## 分类

### 功能型 BFF

| 包                                        | 路径                | 职责                                                              |
| ----------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| [`auth.md`](./30-auth.md)                 | `bff/auth-bff/`     | JWT 唯一签发源，OAuth 回调，Token 吊销                            |
| [`gateway.md`](./50-gateway.md)           | `bff/gateway-bff/`  | 路径前缀路由转发，零鉴权零业务逻辑（Hono）                        |
| [`platform-api.md`](./60-platform-api.md) | `bff/platform-api/` | 产品面 S2S：C2 权益/可见集 + C3 consume/gauge + commerce 后台作业 |

### Platform BFF（有独立登录页，直接签发 JWT）

| 包                              | 路径               | 职责                                          |
| ------------------------------- | ------------------ | --------------------------------------------- |
| [`website.md`](./80-website.md) | `bff/website-bff/` | 注册、登录、租户初始化                        |
| [`console.md`](./40-console.md) | `bff/console-bff/` | 租户管理、成员、账单、订阅                    |
| [`admin.md`](./10-admin.md)     | `bff/admin-bff/`   | 平台运营：用户、租户、配置、工单、AI 模型管理 |

### Business BFF（复用 console Cookie，未登录跳转 console 登录页）

| 包                                            | 路径                                 | 职责                   |
| --------------------------------------------- | ------------------------------------ | ---------------------- |
| Varda BFF                                     | 已迁 vxture-varda 独立仓(2026-08-18) | ➡ 迁出                 |
| [`agent-template.md`](./20-agent-template.md) | `bff/agent-template-bff/`            | 新 Agent BFF fork 起点 |

---

## 共同约束

- BFF 层**禁止直接操作数据库**，禁止 import Prisma Client
- BFF 层**禁止直接调用 LLM**，AI 请求通过 agent-server → model-platform 路由
- Business BFF 不持有 JWT 签发密钥，仅做验证
- 跨服务调用 auth-bff 必须经 `x-vxture-internal-auth` 头鉴权
