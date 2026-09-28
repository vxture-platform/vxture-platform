# 平台服务角色最小权限拆分（data_platform_330，TD-020）

> 定位：把共享单一 DB 角色 `platform_svc`（全 19 schema RW = owner 访问范围）按**每个平台进程实际触达的 schema 集**拆成多个更窄角色，收窄"单进程凭据泄露的横向移动半径"。承 TD-018（列级锁前置的非-owner 角色）之后的独立纵深防御项。
> 权威 DDL = [`97_service_roles.sql`](../../deploy/database/ddl/97_service_roles.sql)；供给 = `32-provision-service-db-roles.sh`；单服务重建 = `33-recreate-service.sh`（TD-037）。

---

## 1. 进程 → schema 访问矩阵（运行时实测）

所有表均 schema 限定（无 `search_path` 取巧），映射经代码路径分析得出。`RW`=读写、`R`=只读、`·`=不访问。

| schema       | auth-bff | admin-bff | console-bff | website-bff | platform-api | model-platform |
| ------------ | :------: | :-------: | :---------: | :---------: | :----------: | :------------: |
| account      |    RW    |     R     |     RW      |     RW¹     |      ·       |       ·        |
| identity     |    RW    |     ·     |     RW      |      R      |      ·       |       ·        |
| credential   |    RW    |     ·     |     RW      |      R      |      ·       |       ·        |
| kyc          |    ·     |    RW     |      ·      |      ·      |      ·       |       ·        |
| tenancy      |    RW    |    RW     |     RW      |      R      |      R       |       ·        |
| access       |    R     |     R     |      R      |      R      |      ·       |       ·        |
| appoidc      |    R     |     ·     |      R      |      ·      |      ·       |       ·        |
| session      |    RW    |     R     |     RW      |      R      |      ·       |       ·        |
| loyalty      |    W     |     ·     |      W      |      R      |      ·       |       ·        |
| metering     |    RW    |    RW     |     RW      |      ·      |      RW      |       RW       |
| billing      |    ·     |    RW     |     RW      |      ·      |      RW      |       ·        |
| provisioning |    R     |     ·     |      ·      |      ·      |      RW      |       ·        |
| promotion    |    ·     |     R     |      ·      |      ·      |      RW      |       ·        |
| product      |    R     |    RW     |      R      |      ·      |      R       |       ·        |
| model        |    ·     |     ·     |      ·      |      ·      |      ·       |       RW       |
| **safety**   |    ·     |     ·     |      ·      |      ·      |      ·       |       ·        |
| support      |    W     |    RW     |      W      |      ·      |      ·       |       ·        |
| admin        |    RW    |    RW     |     RW      |      ·      |      W²      |       ·        |
| sharing      |    ·     |     ·     |      ·      |      ·      |      RW      |       ·        |
| **触达数**   |  **13**  |  **11**   |   **13**    |    **7**    |    **8**     |     **2**      |

¹ website-bff 的 account 写 = `PUT /api/me/profile`（name/email）；其余多为读，但 AccountModule/OrganizationModule 写能力在同池。
² platform-api 的 admin 不是整 schema，而是**一张表**：`admin.operator_notices` 的 SELECT + INSERT（运营镜像，见 §2 的表级例外）。billing / promotion 两格是 product_321 的超时/对账 sweep 与券释放（§2 已记，2026-09-28 补进本矩阵）。
**`safety` schema 零进程访问**——现 platform_svc 授它纯属多余。

## 2. 角色设计（本轮授权面）

6 个进程角色，**只授各自触达的 schema、在其内给 RW**：

| 角色                 | 进程           | schema 集（RW）                                                                                                                                                                                           |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc_auth_bff`       | auth-bff       | account, identity, credential, tenancy, access, appoidc, session, loyalty, metering, provisioning, product, support, admin（13）                                                                          |
| `svc_admin_bff`      | admin-bff      | admin, billing, kyc, metering, product, support, tenancy, access, account, promotion, session, provisioning（12；provisioning 为 320 期缺口，随 product_321 PR2 收口）                                    |
| `svc_console_bff`    | console-bff    | account, identity, credential, session, loyalty, tenancy, access, billing, metering, product, admin, support, appoidc, promotion, provisioning（15；后两项 product_321：券结算 + cashDue=0 段 2 enqueue） |
| `svc_website_bff`    | website-bff    | account, identity, credential, session, tenancy, access, loyalty（7）                                                                                                                                     |
| `svc_platform_api`   | platform-api   | metering, product, sharing, provisioning, tenancy, billing, promotion（7；后两项 product_321：超时/对账 sweep + 券释放）+ 表级例外 `admin.operator_notices`                                               |
| `svc_model_platform` | model-platform | model, metering（2）                                                                                                                                                                                      |

**表级例外：`svc_platform_api` ← `admin.operator_notices`（SELECT + INSERT，2026-09-28）**。客户消息落库后由 `NotificationDispatcher` 顺手镜像一条运营通告（`OperatorMirror` → `PgNoticeRepository.createSystemNotice` → `insert into admin.operator_notices`）。这条镜像路长在 dispatcher 里，**每一个**构造它的 BFF 都会走，platform-api 的到期 / 续订 / 逾期 / 暂停 / 恢复作业都在内；而 platform-api 的 7 schema 面里没有 admin，那些镜像会 42501。镜像失败**只记日志、不影响客户消息**（那是设计），所以症状是运营端「一条都没有」且不报错——与 2026-09-28 那张挂着的 ¥99 退款单同一个病理。授权面按用法给到表一级：镜像只判重（SELECT，走部分唯一索引 `uq_operator_notices_system`）+ 插一行（INSERT），不改不删、不碰 admin 的运营账号 / 角色 / 审计 / 风险记录，所以**不是** `ALL TABLES IN SCHEMA admin`，也不给 `ALTER DEFAULT PRIVILEGES`（将来新增的 admin 表不会跟着漏进去）。落点：`97_service_roles.sql` 文件末尾两行 + 活库迁移 `2026-11-21-platform-api-operator-notices-grant.sql`（逐字一致，全量重放幂等）。

**为什么本轮不精调 R-vs-RW**：schema 级收窄已拿到主要爆炸半径收益（如 website-bff 从全库降到 7 schema，碰不到 billing/metering/admin/model/kyc 等 12 个）。R-vs-RW 逐 schema 精调易错——AccountModule/OrganizationModule 写能力在同池、一个新增写路径就让"设为 R 的 schema"运行时炸；且已发现映射中 website-bff account 实为 RW（me/profile 写）。精调留独立后续项（先确认每进程每 schema 的确切写路径）。`safety` 一律不授。

## 3. 生产切换 runbook（owner 分批，每次只动一个进程）

角色建成后（随 reseed 应用 97）执行，**逐进程**、每次验证后再下一个：

**前置（一次）**：`32-provision-service-db-roles.sh` 为 6 个 svc\_\* 角色设真实密码，生成 per-service DB 凭据 overlay 文件（`platform-app-{svc}.env`，各只挂给对应服务；机制变更见 §4）。

**每进程**：

1. 该进程的 `platform-app-{svc}.env` 里 `DATABASE_URL` 从 `platform_svc` 改指 `svc_{svc}`；
2. `bash 33-recreate-service.sh <svc>` 重建该单进程（不牵连其它）；
3. 验证：容器 healthy + 冒烟该进程主路径（如 auth-bff 登录一次、admin-bff 后台一次、platform-api C2 探针）；日志无 `permission denied for schema/table`；
4. 通过 → 下一个进程；失败 → 该文件 DATABASE_URL 改回 `platform_svc` + 重建回滚。

**全部切完**：platform_svc 可退役（`REVOKE ALL` + 保留角色或 DROP，另行处置）。

## 4. env 机制变更（切换前置，独立增量）

现状：单一 `platform-app.env`（`DATABASE_URL=platform_svc`）经 env_file 覆盖全部 6 服务。要让各进程连各自角色，需拆成 per-service overlay：

- `32-provision`：生成 6 个 `platform-app-{svc}.env`（各含该角色 DATABASE_URL）；
- `compose.platform.yml`：把各服务的 `platform-app.env` 挂载换成对应 `platform-app-{svc}.env`；
- `39-audit-env.mjs`：为 6 个新 overlay 文件加规则（仅允许 DATABASE_URL/REPORTING_RO_DATABASE_URL）；
- **staging 安全法**：机制上线时 6 个 overlay 文件的 DATABASE*URL 先全指 `platform_svc`（行为与今日完全一致、零变更），切换 = §3 逐个把某文件改指 svc*\* 角色 + 重建。

本增量与 §3 切换均属 owner 生产窗口，不在建角色的本轮 PR 内。

## 5. 状态

- ✅ **本轮**：6 角色 + 最小权限授权 DDL 落 `97_service_roles.sql`（活库 rolled-back 事务验证过：6 角色建成、授权面正确收窄、零残留）；本设计文档。角色随 reseed 建成即在库、无人用、零运行时影响。
- ⏳ **待 owner**：§4 env 机制变更 + §3 逐进程 DATABASE_URL 切换（分批窗口）。
- ✅ **2026-09-28**：`svc_platform_api` 的表级例外（`admin.operator_notices` SELECT + INSERT）落 97 + 迁移，本机活库跑过两遍幂等、授权面实测只多这一张表的两项。
- 后续项：R-vs-RW 精调（§2）；platform_svc 退役。
