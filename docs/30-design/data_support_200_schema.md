# Support 域细化设计：工单 / 审计 / 通知

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_support_200`（细化设计层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律
> 取代范围：**取代** [`data_platform_200_schema.md`](./data_platform_200_schema.md) §15（support 域）字段级内容。
> 命名：plural 化——`tickets` / `ticket_comments` / `audit_logs` / `notification_logs`。

---

## 0. 定位与三类写入语义（先厘清，避免误加触发器）

| 表                  | 写入语义                                           | append-only                                                     | 分区                 |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| `tickets`           | 可变（status/assignee/SLA 时间戳随生命周期）+ 软删 | 否                                                              | 否                   |
| `ticket_comments`   | **仅追加**                                         | **是**（BEFORE UPDATE RAISE，保留 CASCADE DELETE 供父表 purge） | 否                   |
| `audit_logs`        | **仅追加**                                         | **是**（BEFORE UPDATE OR DELETE RAISE）                         | **是（按月 RANGE）** |
| `notification_logs` | **可变**（投递/打开回执回填 status/delivered_at）  | **否（绝不加不可变触发器）**                                    | 否                   |

三类语义不同是本域最易踩的坑：`notification_logs` 必须可 UPDATE（回执），`audit_logs`/`ticket_comments` 必须封写后修改。

## 1. `tickets`（工单聚合根）

| 字段                                                                           | 类型          | 约束                                                                                          | 说明                                                                                                         |
| ------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                                                                           | uuid          | PK                                                                                            |                                                                                                              |
| `tenant_id`                                                                    | uuid          | NOT NULL, FK→`tenancy.tenants.id`                                                             | **本次修正**：归属租户，按铁律一建真 FK（原裸值；tenant 软删，FK 安全）                                      |
| `account_id`                                                                   | uuid          | NULL                                                                                          | 报单账号；**逻辑引用** identity `account.users`（**边界#3**：报单者可注销、工单须留存，actor_name 冗余留痕） |
| `ticket_no`                                                                    | varchar(64)   | UNIQUE NOT NULL                                                                               | 可视码                                                                                                       |
| `category`                                                                     | varchar(64)   | NOT NULL DEFAULT `'general'`                                                                  | 开放分类法，无 CHECK，应用层校验                                                                             |
| `priority`                                                                     | varchar(16)   | NOT NULL DEFAULT `'p2'`, CHECK(p0/p1/p2/p3)                                                   |                                                                                                              |
| `source`                                                                       | varchar(64)   | NOT NULL DEFAULT `'console'`, CHECK(console/website/email/admin/api)                          |                                                                                                              |
| `status`                                                                       | varchar(32)   | NOT NULL DEFAULT `'open'`, CHECK(open/pending/in_progress/resolved/closed/reopened/cancelled) |                                                                                                              |
| `title`                                                                        | varchar(200)  | NOT NULL                                                                                      |                                                                                                              |
| `description`                                                                  | text          | NOT NULL DEFAULT `''`                                                                         |                                                                                                              |
| `reporter_name`                                                                | varchar(100)  | NULL                                                                                          |                                                                                                              |
| `assignee_id`                                                                  | uuid          | NULL                                                                                          | 受理坐席；**逻辑引用** `admin.operator_accounts`（**边界#2** realm 隔离，workforce）                         |
| `assignee_name`                                                                | varchar(100)  | NULL                                                                                          |                                                                                                              |
| `tags`                                                                         | varchar(64)[] | NOT NULL DEFAULT `'{}'`                                                                       |                                                                                                              |
| `satisfaction_score`                                                           | int           | NULL, CHECK(NULL OR 1..5)                                                                     |                                                                                                              |
| `satisfaction_comment`                                                         | varchar(512)  | NULL                                                                                          |                                                                                                              |
| `sla_breach_at` / `first_response_at` / `due_at` / `resolved_at` / `closed_at` | timestamptz   | NULL                                                                                          | SLA 五时间戳；`sla_breach_at` 是**派生违约时刻**（非状态）                                                   |
| `created_at` / `updated_at`                                                    | timestamptz   | NOT NULL DEFAULT now()                                                                        |                                                                                                              |
| `deleted_at`                                                                   | timestamptz   | NULL                                                                                          | 软删                                                                                                         |

索引：`(tenant_id, status)`、`(priority, updated_at DESC)`、`(assignee_id) WHERE assignee_id IS NOT NULL`（坐席工作台）、`deleted_at`。

- **不引入 workspace_id**：工单是租户/账号级支持工件、非计量对象（守起步最小化）。

## 2. `ticket_comments`（工单流水/事件流，append-only）

| 字段         | 类型         | 约束                                        | 说明                                                                                                                      |
| ------------ | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`         | uuid         | PK                                          |                                                                                                                           |
| `ticket_id`  | uuid         | NOT NULL, FK→`tickets.id` ON DELETE CASCADE | 域内真 FK                                                                                                                 |
| `event_type` | varchar(64)  | NOT NULL                                    | comment/status_changed/assigned/reopened/sla_breached/satisfaction_submitted…（含事件，名 comment 语义偏窄但沿用 deploy） |
| `actor_type` | varchar(32)  | NOT NULL, CHECK(customer/operator/system)   |                                                                                                                           |
| `actor_id`   | uuid         | NULL                                        | 可空（system 事件）；**逻辑引用**，按 actor_type 跨 realm（边界#2/#3）                                                    |
| `actor_name` | varchar(100) | NOT NULL                                    | 冗余留痕（actor 注销后仍可读）                                                                                            |
| `payload`    | jsonb        | NOT NULL DEFAULT `'{}'`                     | 评论正文/前后值/附件引用                                                                                                  |
| `created_at` | timestamptz  | NOT NULL DEFAULT now()                      |                                                                                                                           |

索引：`(ticket_id, created_at DESC)`。
**append-only**：`BEFORE UPDATE RAISE EXCEPTION` 触发器（禁 `DO INSTEAD NOTHING` RULE）。**仅封 UPDATE，保留 ON DELETE CASCADE**——`tickets` 软删、常规不硬删，CASCADE 仅作留存到期 purge 兜底（封 DELETE 会让 purge 失败）。

## 3. `audit_logs`（跨域操作审计，append-only + 按月分区 + 留存 ≥2 年）

平台**中央审计**：identity/commerce/admin 全域"谁在何时对什么做了什么"统一落此（各域不另建审计表；如 identity.audit_event 退役、operator 审计以 actor_type=operator 复用）。

```sql
support.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_type    varchar(32)  NOT NULL,          -- customer | operator | system | api
  actor_id      uuid NOT NULL,                  -- 逻辑引用，按 actor_type 跨 realm（边界#2/#3）
  tenant_id     uuid,                            -- 可空(平台级操作)；**边界#3**：审计不可变、须活过租户注销，不建 FK
  action        varchar(128) NOT NULL,          -- 'tenant.member.invite'
  result        varchar(32)  NOT NULL DEFAULT 'success', CHECK(success/failure/denied),
  resource_type varchar(64)  NOT NULL,
  resource_id   varchar(128) NOT NULL,
  error_code    varchar(64),
  before        jsonb, after jsonb,             -- 变更前后快照
  request_id    varchar(128),                   -- 跨库关联键（边界#1）
  duration_ms   int, ip_address varchar(64), user_agent varchar(512),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),                 -- 分区键必进 PK
  CONSTRAINT chk_audit_actor CHECK (actor_type IN ('customer','operator','system','api'))
) PARTITION BY RANGE (created_at);              -- 按月，预建 + DEFAULT 兜底
```

索引：`(tenant_id, created_at DESC)`、`(actor_id, created_at DESC)`、`(action)`、`(resource_type, resource_id)`、`(request_id) WHERE request_id IS NOT NULL`。
**append-only**：`BEFORE UPDATE OR DELETE RAISE`（分区父声明传播全分区，禁 RULE）。留存 24 月靠 **DROP PARTITION**（O(1) 清理，逐行 DELETE 不可行且被触发器封死），维护脚本与 metering usage_events 共用一套。

> **tenant_id/actor_id 不建 FK 的理由**：审计是不可变合规记录，须在租户/actor 注销后继续留存（**边界#3**）；actor 跨 customer/operator 两 realm（**边界#2**）。这是刻意的，非遗漏。

## 4. `notification_logs`（多渠道通知，可变，投递/打开追踪）

| 字段                              | 类型         | 约束                                                         | 说明                                             |
| --------------------------------- | ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| `id`                              | uuid         | PK                                                           |                                                  |
| `tenant_id`                       | uuid         | NULL, FK→`tenancy.tenants.id`                                | 真 FK（普通引用，短留存日志）                    |
| `account_id`                      | uuid         | NULL                                                         | 逻辑引用 `account.users`（边界#3，收件人可注销） |
| `channel`                         | varchar(32)  | NOT NULL, CHECK(email/sms/inapp/webhook/push)                |                                                  |
| `template_code`                   | varchar(64)  | NOT NULL                                                     | 模板键（模板不在本库建模）                       |
| `status`                          | varchar(32)  | NOT NULL, CHECK(queued/sent/delivered/opened/failed/bounced) |                                                  |
| `reference_type` / `reference_id` | varchar      | NULL                                                         | 业务来源（ticket/invoice/verification…）         |
| `recipient`                       | varchar(256) | NOT NULL                                                     | 收件地址                                         |
| `subject`                         | varchar(256) | NULL                                                         |                                                  |
| `provider`                        | varchar(64)  | NULL                                                         | 发送商                                           |
| `provider_message_id`             | varchar(256) | NULL                                                         | 回执 id，投递/打开 webhook 据此回写              |
| `error_message`                   | text         | NULL                                                         |                                                  |
| `retry_count`                     | int          | NOT NULL DEFAULT 0                                           |                                                  |
| `delivered_at` / `opened_at`      | timestamptz  | NULL                                                         | 回执回填                                         |
| `created_at`                      | timestamptz  | NOT NULL DEFAULT now()                                       |                                                  |

索引：`(tenant_id, created_at DESC)`、`(account_id)`、`(status)`、`(channel)`、`(provider_message_id) WHERE ...`（回执反查）、`(reference_type, reference_id) WHERE ...`。
**不加 append-only 触发器**（投递回执/重试要 UPDATE，与 audit_logs 的关键区别）。留存 6–12 月定期批删；量大再升级按月分区（届时 PK 改 `(id, created_at)`）。

## 4.1 `inbox_messages`（站内消息收件箱，可变；product_330 P2-g，2026-09-03）

与 `notification_logs` 的分工：logs 是**发送账本**（每次投递一行，治理台审计），本表是**收件箱**（每个收件人一行，可读 / 未读）。同一条业务通知先落本表（去重键），再按偏好发邮件并记 logs。

| 字段                              | 类型                | 约束                              | 说明                                                                                 |
| --------------------------------- | ------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `id`                              | uuid                | PK                                |                                                                                      |
| `tenant_id`                       | uuid                | NOT NULL, FK→`tenancy.tenants.id` | 真 FK（普通引用）                                                                    |
| `account_id`                      | uuid                | NOT NULL                          | 收件人，裸值→`account.users`（边界#3，同 logs）                                      |
| `template_code`                   | varchar(64)         | NOT NULL                          | 与 logs 同一套键（subscription.\* / order.\* / refund.\*）                           |
| `title` / `body`                  | varchar(256) / text | NOT NULL                          | 渲染后的文案（模板在代码里）                                                         |
| `link`                            | varchar(512)        | NULL                              | console 内相对路径                                                                   |
| `reference_type` / `reference_id` | varchar             | NOT NULL                          | 业务引用；`UNIQUE(account_id, template_code, reference_type, reference_id)` = 去重键 |
| `read_at`                         | timestamptz         | NULL                              | 已读                                                                                 |
| `created_at`                      | timestamptz         | NOT NULL DEFAULT now()            |                                                                                      |

索引：`(account_id, created_at DESC)`、`(account_id) WHERE read_at IS NULL`（未读数）、`(tenant_id)`。可变（read_at）；留存与 logs 同策略。

## 5. FK / 边界速查表

| 从                                                                           | 到                                  | 类型              | 依据                                         |
| ---------------------------------------------------------------------------- | ----------------------------------- | ----------------- | -------------------------------------------- |
| `tickets.tenant_id`、`notification_logs.tenant_id`                           | `tenancy.tenants.id`                | 真 FK             | 普通引用（本次修正）                         |
| `ticket_comments.ticket_id`                                                  | `tickets.id`                        | 真 FK             | 域内                                         |
| `tickets.account_id`、`notification_logs.account_id`、`*.actor_id`(customer) | `account.users.id`                  | **裸值**，不建 FK | 边界#3（记录须活过 actor 注销）              |
| `tickets.assignee_id`、`*.actor_id`(operator)                                | `admin.operator_accounts.id`        | **裸值**，不建 FK | 边界#2（realm 隔离，workforce）              |
| `audit_logs.tenant_id`、`audit_logs.actor_id`                                | `tenancy.tenants` / 两 realm        | **裸值**，不建 FK | 边界#3（合规不可变留存）+ 边界#2（跨 realm） |
| `*.request_id`                                                               | reqlog/usage_events/moderation_logs | **裸值**，不建 FK | 边界#1（跨库单一关联键）                     |
