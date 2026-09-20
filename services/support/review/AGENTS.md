# @vxture/service-review

> 上下文导航指针 | 完整文档在 `docs/` 体系

## 工作前必读

| 步骤          | 文档                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. 全局规则   | 根目录 `AGENTS.md`（G1–G6）                                                                                   |
| 2. 任务路由   | [`docs/90-memory/10-agent.md`](../../../docs/90-memory/10-agent.md)                                           |
| 3. 层架构规范 | [`docs/30-design/architecture/04-service-layer.md`](../../../docs/30-design/architecture/04-service-layer.md) |

## 这个包管什么

客户评价：**产品 / 价格 / 服务**三项 5 分制评分 + 一段留言。表是
`support.product_reviews`（DDL 见 `deploy/database/ddl/72_support.sql` §5）。

两个入口：

| 入口           | 来源列            | 判重口径       | 状态                 |
| -------------- | ----------------- | -------------- | -------------------- |
| console 订阅页 | `subscription_id` | 一次订阅评一次 | 已接                 |
| 工单完成       | `ticket_id`       | 一个工单评一次 | **表支持，未接入口** |

工单入口卡在两件事上（owner 2026-09-20 裁定本轮只做订阅入口）：`support.tickets`
上没有任何产品关联列（无 `product_id`、无 `subscription_id`，`category` 是
"frontend" 这类自由字符串），而评价必须落到某个产品上；且 console 目前没有工单
界面，客户建不了工单。console-bff 的 `resolveOrigin` 对 `ticketId` 直接 400，
表与服务层则保持支持——将来接上不必改表。

续订会产生新的 `subscription_id`，因而自然可以重新评价——没有"轮次"字段。

## 三条容易搞错的

1. **三项分数各自可空，空不等于 0 分。** 聚合走 `AVG`，它跳过 `NULL`，于是只评了
   产品的客户不会把价格分的分母也撑大。`aggregate*` 返回的三个 `count` 是**各项
   各自的分母**，`reviewCount` 才是评过的条数——四个数不是一个数。

2. **判重不靠「先查再插」。** 并发下两次提交都会查到「还没评过」。判重交给表上
   那两个部分唯一索引，仓储把 `23505` 翻成 `"duplicate"`。

3. **它不归 service-ticket。** 订阅评价与工单评价共用一张表、一套量表；塞进工单
   服务会让「产品评价」「价格评价」长期挂在工单域下。工单自己的
   `tickets.satisfaction_score` 保持原样不动（owner 2026-09-20：「评价关联到新表，
   工单其他内容保持」）。

## 为什么池令牌是 `REVIEW_PG_POOL` 而不是复用 `SUPPORT_PG_POOL`

同一个 Nest 容器里两个包 provide 同名 token，后注册的会**静默覆盖**前一个。两个
包各自 register 自己的池。
