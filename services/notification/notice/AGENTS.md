# @vxture/service-notice

> 上下文导航指针 | 完整文档在 `docs/` 体系

## 工作前必读

| 步骤          | 文档                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. 全局规则   | 根目录 `AGENTS.md`（G1–G6）                                                                                   |
| 2. 任务路由   | [`docs/90-memory/10-agent.md`](../../../docs/90-memory/10-agent.md)                                           |
| 3. 层架构规范 | [`docs/30-design/architecture/04-service-layer.md`](../../../docs/30-design/architecture/04-service-layer.md) |

## 这个包管什么

运营通告的**读侧**：`admin.operator_notices` / `admin.operator_notice_reads`
（DDL 见 `deploy/database/ddl/80_admin.sql`）。

一句话边界：**「谁能看见哪些通告」这条谓词的唯一落点。**

## 为什么只收读侧

| 侧  | 在哪                                           | 收不收 | 判据                                                                                                                                   |
| --- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 读  | 本包，三个 BFF 各自注入                        | 收     | 2026-09-20 arche 接入时正从一份变两份；依赖只有 `pg`                                                                                   |
| 写  | `opera-bff/routers/operator-notices.router.ts` | 不收   | 只有 opera 一家发布（owner：「面向内部运营的由 opera 发布」）。收它不消除任何重复，却要连带搬 opera 的事务、审计、错误工厂三套基础设施 |

写侧仍从本包取 `NOTICE_PLANES` / `NOTICE_SEVERITIES` —— 那两组值是表上 CHECK
约束的代码投影，此前在 opera 与 admin 各有一份。

## 三个消费方各传什么

| BFF       | plane     | 能力门                                           |
| --------- | --------- | ------------------------------------------------ |
| admin-bff | `"admin"` | 平面根码 `admin.plane`——进得了本平台就看得见     |
| arche-bff | `"arche"` | 平面根码 `arche.plane`——同上                     |
| opera-bff | —         | 只用类型与枚举，发布面有自己的 `ops:notice.*` 门 |

读侧两个平面都不另立权限码：读通告不是一项需要单独授权的能力，是进了门就有的。
arche 初版检了 `ops:notice.read`，被 `lint:operator-planes` 拦下——那是 opera 的
码，三平面严格隔离规定跨平台同能力各注册一个码，arche 不写别家码字面量。

`plane` 与 `operatorId` **都不来自请求**：平面是 BFF 自己的身份，运营者是会话
里的人。任一可由调用方指定，这个接口就变成了探测别的平面 / 别人已读状态的面。

## 两条容易踩的

1. **`@Inject` 必须显式写。** BFF 打包走 esbuild，它不产 `emitDecoratorMetadata`。
   漏在 router 上启动期就抛（boot-smoke 红）；**漏在服务包自己身上不抛**，造出
   依赖为 undefined 的壳，第一次调用才 500。2026-09-20 的评价 500 就是后者。
2. **`target_planes = '{}'` 是「全部平面」的唯一表示。** 写侧把「三个都选」收敛成
   空数组正是为了读侧这一句成立。展开成三个元素存一份的话，将来加第四个平面，
   那些历史行会把新平面漏掉。
