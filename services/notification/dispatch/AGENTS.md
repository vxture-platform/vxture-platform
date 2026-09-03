# @vxture/service-notification

> 上下文导航指针 | 完整文档在 `docs/` 体系

## 工作前必读

| 步骤          | 文档                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 全局规则   | 根目录 `AGENTS.md`（G1–G6）                                                                                                                                                                                                                            |
| 2. 任务路由   | [`docs/90-memory/agent.md`](../../../docs/90-memory/10-agent.md)                                                                                                                                                                                       |
| 3. 层架构规范 | [`docs/30-design/architecture/07-service-layer.md`](../../../docs/30-design/architecture/04-service-layer.md)                                                                                                                                          |
| 4. 设计       | [`docs/30-design/design_notification_100_overview.md`](../../../docs/30-design/design_notification_100_overview.md)「扩展点」、[`docs/30-design/product_330_order-entity-split.md`](../../../docs/30-design/product_330_order-entity-split.md) §7 P2-g |

> 职责：客户通知分发——站内（`support.inbox_messages`）+ 邮件（注入的 `MailSender`），每次投递记 `support.notification_logs`。

## 不变量

- **best-effort**：业务写已提交才通知；单个收件人失败只记日志，`notify` 不抛。
- **去重 = 收件箱唯一键** `(account_id, template_code, reference_type, reference_id)`：站内没落成（冲突）就不发邮件——扫描作业每分钟重跑也只通知一次；调用方用复合 `reference.id`（如 `订阅id:到期日`）表达"同一件事"。
- **偏好门**：`PreferenceGate.allows(user, topic, channel)`（`@vxture/service-account` 的 `NotificationPreferencesService` 结构兼容）；偏好读不到按允许处理。
- **收件人** = 调用方给的 ∪ 租户 owner。
- 不引 Nest、不引邮件实现：sender / 偏好都是接口，由 BFF 装配处注入（platform-api / console-bff / admin-bff 各一个 wiring）。
- 模板在代码里（`templates.ts`），键稳定（治理台「通知审计」按 `template_code` 搜）；文案只写机制不写承诺；zh-CN / en-US 两张平表按收件人 `user_profiles.language` 选（别写成同形对象字面量，Sonar 会判重复）。
- 公告推送（`announcements.ts`）：行级 `meta.broadcast_at` + 收件人级唯一键两层幂等；公告自带语言与正文，`announcement.published` 模板只是 `{{title}}` / `{{content}}` 透传。
