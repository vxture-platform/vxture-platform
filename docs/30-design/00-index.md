# 技术设计文档索引

> 跨包能力域的端到端技术设计。回答"某个能力如何在多个包之间协作实现"。
>
> 区别：
>
> - `architecture/` — 层级结构和依赖边界（系统形状）
> - `design/` — 具体能力域跨包设计（能力实现）
> - `packages/` — 单个包的实现约束

---

## 设计文档

| 文件                                                                                                                          | 覆盖能力                                                                                  | 状态             |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| [`auth.md`](./identity/010-auth.md)                                                                                           | 账号体系 / JWT 签发 / Cookie / 跨域 SSO / OAuth / 统一登录体验 / Turnstile / 会话同步     | ✅ v1.3.0        |
| [`session.md`](./identity/020-session.md)                                                                                     | Session 管理 / Cookie 生命周期 / 黑名单                                                   | ✅ 已编制        |
| [`tenant.md`](./identity/030-tenant.md)                                                                                       | 多租户解析 / PLG 租户模型 / 隔离原则                                                      | ✅ 已编制        |
| [`notification.md`](./design_notification_100_overview.md)                                                                    | 邮件 / 短信通知流程                                                                       | ✅ 已编制        |
| [`identity-platform-authorization.md`](./identity/060-authorization.md)                                                       | RBAC 模型 / 跨包权限流 / BFF 守卫 / menu code 映射 / 两套权限域                           | ✅ v1.0.0        |
| [`locale.md`](./design_locale_100_overview.md)                                                                                | i18n 解析链路 / BCP47 locale 系统重构                                                     | ✅ 已有          |
| [`model-platform.md`](./platform/40-model-platform.md)                                                                        | Model Platform — 已退役，实现迁至外部 `vxture-atlas` 仓，本文仅留指针                     | 退役 v2.0.0      |
| [`control-plane.md`](./platform/10-control-plane.md)                                                                          | 平台控制面与业务数据面 / Beta-Prod 治理 / 数据库边界 / 容器网络                           | ✅ 已迁入        |
| [`commerce.md`](./commerce/10-commerce.md)                                                                                    | Commerce 能力域 — 订阅 / 配额 / 用量计量 / 账单 / 付款 / Feature Gating                   | ✅ v1.0.0        |
| [`console.md`](./platform/20-console.md)                                                                                      | Console UI 设计规范 — 视觉原则 / Shell 规格 / 页面模板 / 视觉系统 / Workspace Switcher    | ✅ v1.0.0        |
| ~~`database.md`~~（已删除）→ [`data_platform_100_architecture.md`](./data_platform_100_architecture.md)（已并入，superseded） | 数据库顶层架构 — 双平面拓扑 / Platform DB 8 域 Schema / 业务 DB Beta-Prod 分离 / 治理原则 | ✅ v1.0.0        |
| [`data_platform_100_architecture.md`](./data_platform_100_architecture.md)                                                    | Platform DB 详细设计 — 8 个 Schema 字段级目标态 / 现态对照 / 迁移行动清单                 | ✅ v1.0.0 待评审 |
| [`docs/10-standards/design-system.md`](../10-standards/060-design-system.md)                                                  | DS 使用规范 / 应用侧禁止自建样式·组件·图标 / AI 行为约束                                  | ✅ 在 standards/ |
| [`docs/10-standards/font-system.md`](../10-standards/090-font-system.md)                                                      | 字体系统 / Virtual Nature Studio 字体规范                                                 | ✅ 在 standards/ |

---

## 判断文档归属

- 描述**层结构 / 依赖规则**？→ `architecture/`
- 描述**某能力端到端跨多个包如何工作**？→ `design/`（本目录）
- 描述**某个具体包的实现约束**？→ `packages/`
