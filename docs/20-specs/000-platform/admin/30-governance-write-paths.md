# 平台治理写路径设计 — risk_records / compliance_events / maintenance_windows（TD-021）

> 状态：✅ 已审定（owner 2026-07-05 委托代审；对抗式核对权威源后修订 4 处，见 §7）· v1.1 · 2026-07-05
> 对应技术债：[TD-021](../../../60-operations/10-tech-debt.md#td-021--风险合规维护窗口治理写路径未定义)（Design Pending）
> 表权威定义：`deploy/database/ddl/80_admin.sql` + `docs/30-design/data_admin_200_schema.md` §2.4–2.6
> 实施参照模式：`admin-app-completion-plan.md` 纪律 + `platform-admins.router.ts`（能力门控/审计/step-up）+ `announcements.router.ts`（CRUD 端点形状）

## 0. 背景与范围

18-schema cutover 时 `admin.risk_records`（租户风险评估）、`admin.compliance_events`（合规事件）、`admin.maintenance_windows`（维护窗口）三表已建（含列级锁），但**零写入者**——目前全仓唯一引用是 `platform-admins.router.ts:516` 的 `openRiskCount` 只读聚合。本文档补齐 TD-021 要求的产品定义（字段用法 + 工作流 + 权限门槛），作为实施依据。

**范围**：三表的 admin-bff 读/写端点 + admin portal 页面。
**非目标（本期不做）**：机器自动写入（风控引擎/合规扫描）、维护窗口自动通知、跨表联动（如 ticket→risk 自动升级）、`event_type` 枚举化。

## 1. 既有事实（设计约束）

1. **列级锁**（`deploy/database/ddl/98_column_locks.sql:440-450`）：
   - `maintenance_windows` 锚点 `id, created_by, created_at` 不可 UPDATE；**无 `deleted_at` 列**（生命周期终态即归档，不提供删除）。
   - `risk_records` / `compliance_events` 锚点 `id, created_at`；均有 `deleted_at`（软删）。
2. **operator 归属字段不一致**：仅 `maintenance_windows` 有 `created_by`(NOT NULL)/`updated_by`；risk/compliance 无 created_by 列，**创建者归属以审计日志为准，不加列**（不动 DDL）。
3. **权限目录**（`deploy/database/seed/seed-catalog.mjs` + `data_admin_200` §4.2）：
   - 维护窗口的 perm code **已预置**：`release:maintenance.read` / `.manage`（manage=super_admin/admin/tech_ops，read 另含 operation/auditor）。
   - 风险/合规**无现成 code**，需新增（见 §2 GQ1）。
4. **openRiskCount 语义已固定**（overview 聚合）：未处置 = `deleted_at IS NULL AND reviewer_id IS NULL AND risk_level IN ('follow_up','high')` → 「审阅」动作 = 写 `reviewer_id`，与既有聚合天然一致。
5. **审计**：`insertOperatorAuditLog`（`bff/admin-bff/src/audit/audit-log.ts`）**须在写事务内调用**（审计行与业务写原子提交）。公告 router 无事务、无审计是历史欠账，本设计不沿袭。
6. **门控实现形态**：admin-bff 无 capability 装饰器，各 router 手写 `assert*` 断言 `req.capabilities`；新 router 直接检查三段式新码（活库已按新目录 seed，无需走 LEGACY_CAPABILITY_BRIDGE）。

## 2. 开放问题的默认决策（可逆，owner 可改判）

| #   | 问题                                      | 决策（默认）                                                                                                                                                                                                                                                                  | 理由 / 可逆性                                                                                   |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GQ1 | 风险/合规 perm code 归属                  | 新增两对：`tenant:risk.read`/`.manage`（风险=租户风险评估，归 tenant 域）、`compliance:event.read`/`.manage`（合规自成 domain，因 tenant_id 可空=平台级）。目录先例支持跨 schema 的业务域命名：`tenant:verification.review` 映 kyc 表、`release` 域映 admin 治理表（§4.2 注） | 目录三段式约定即为可扩展；复用 `tenant:profile.manage` 会混淆语义。改判只影响字符串与 seed 映射 |
| GQ2 | 是否 @RequireStepUp                       | **不加**。三表操作均非凭据/资金/PII 类，目录亦未标危                                                                                                                                                                                                                          | 与 §4.2「危才 step-up」一致；后续任一动作升危只需加装饰器                                       |
| GQ3 | 风险「审阅」可否撤销                      | **不提供撤销端点**。审阅幂等（重复审阅覆盖 reviewer_id 为当前 actor）；**risk_level 任何变更自动清空 reviewer_id**（重新待处置，见 §3.1），误审即经编辑归位                                                                                                                   | 最小面；审计日志留痕。需要时补一个 unreview 端点即可                                            |
| GQ4 | 合规事件 resolved/dismissed 后可否重开    | **终态不可重开**，同一事项再发生 = 新建事件（可用 tags/regulation_code 关联）                                                                                                                                                                                                 | 状态机最简；重开语义（谁能重开/次数）待真实需要再定义                                           |
| GQ5 | 维护窗口是否自动通知/建公告               | **不自动**。页面文案引导运营手工发公告（`admin.announcements` 能力已就绪）；「一键生成公告草稿」列为 future                                                                                                                                                                   | 通知策略（渠道/提前量/受众）是独立产品决策，不投机                                              |
| GQ6 | `compliance_events.event_type` 是否枚举化 | **保持自由文本**（非空、≤64、trim），不建应用层枚举                                                                                                                                                                                                                           | DDL 注释「枚举待业务」；枚举化是业务分类决策                                                    |
| GQ7 | `risk_records.source_table/source_id`     | 本期仅人工录入，两字段**留 NULL**；保留给未来机器写入者回溯用                                                                                                                                                                                                                 | 不投机建自动风控                                                                                |
| GQ8 | `risk_score` 取值约定                     | 应用层约定 0–100 整数（可空）；DDL 无 CHECK，不动                                                                                                                                                                                                                             | 仅前端/BFF 校验，改区间零成本                                                                   |

## 3. 各表工作流定义

### 3.1 risk_records（租户风险评估）

- **创建**：人工录入。必填 `tenant_id`（须存在于 `tenancy.tenants`——**行存在即可，含软删/`status='deleted'`**：边界#3 治理记录活过注销，tenancy.tenants 为软删模型）+ `reason`；可选 `risk_level`（默认 normal）、`risk_score`、`scope`、`tags`。`source_table/source_id` 不暴露（GQ7）。
- **编辑**：`risk_level / risk_score / scope / reason / tags` 可改（含已审阅记录，见 GQ3）。**risk_level 变更时应用层清空 `reviewer_id`（重新进入待处置）**——否则已审阅记录后续升险（改为 follow_up/high）会因 reviewer_id 仍在而永不回到 `openRiskCount`，风险升级被静默吞掉；降为 normal 亦清空但 normal 本就不计数，语义自洽。
- **审阅**（核心动作）：`reviewer_id = 当前 operator`，幂等覆盖。审阅后即退出 `openRiskCount`。**无 reviewed_at 列，审阅时间以审计日志为准**（不加列）。
- **软删**：`deleted_at = now()`；已删记录列表默认隐藏。

### 3.2 compliance_events（合规事件）

状态机（CHECK 已固化四态）：

```
open ──assign──▶ in_review ──resolve──▶ resolved   (终态)
  │                  │
  └──dismiss──┐      └──dismiss──▶ dismissed        (终态)
              └──────────────────▶
```

- **创建**：必填 `event_type`（自由文本，GQ6）；`tenant_id` 可空（NULL=平台级事件）；可选 `regulation_code / evidence_url / detail(jsonb) / tags`。初始 `status='open'`。
- **指派**（open→in_review）：`handler_id` 须为 active 的 `admin.operator_account`（域内真 FK 兜底）；指派即转 in_review。in_review 下允许改派（状态不变）。
- **办结**：`resolve`（仅 in_review→resolved，须已有 handler）；`dismiss`（open/in_review→dismissed，误报/不适用）。终态只读（GQ4）。
- **编辑**：非终态下 `event_type / regulation_code / evidence_url / detail / tags / tenant_id` 可改。
- **软删**：仅限终态记录（open/in_review 先办结再删，防止「删除」被当作第三种办结方式绕过状态机）。

### 3.3 maintenance_windows（维护窗口）

状态机（CHECK 已固化四态；**无删除**——历史窗口对账留存）：

```
scheduled ──start──▶ in_progress ──complete──▶ completed   (终态, 记 actual_end_at)
    │                    │
    └──cancel──▶ cancelled ◀──cancel──┘                     (终态; in_progress 取消也记 actual_end_at)
```

- **创建**：必填 `title / start_at / end_at`（校验 `end_at > start_at`；允许创建过去窗口用于补录）；可选 `severity`（默认 minor）、`description / impact_description / affected_services`（自由字符串数组，每项非空 ≤64）。`created_by = 当前 operator`。
- **编辑**：`scheduled` 态全字段可编（除锚点列）；`in_progress` 态仅允许 `end_at` 顺延、`impact_description / description` 更新（现场追记）；终态只读。所有 UPDATE 均写 `updated_by = 当前 operator`。
- **状态转移**：`start`（scheduled→in_progress，手动触发，不做定时器）；`complete`（in_progress→completed，`actual_end_at` = 传入值或 now()）；`cancel`（scheduled/in_progress→cancelled；自 in_progress 取消时同样记 `actual_end_at`）。

## 4. API 设计（admin-bff）

路由风格镜像 `announcements.router.ts`（资源 CRUD + 独立状态转移 POST），事务与审计对齐 `platform-admins.router.ts`（**所有写 = withTx + 事务内 `insertOperatorAuditLog`**，公告 router 的无事务/无审计模式不沿袭）。双池注入 RO(读)/RW(写)。

### 4.1 端点清单

| Router                    | 端点                                                     | 门控                                  | 审计 action                       |
| ------------------------- | -------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| `api/risk-records`        | GET `/`（filters: tenantId/riskLevel/reviewed/tag/分页） | `tenant:risk.read`\|`.manage`         | —                                 |
|                           | GET `/:id`                                               | 同上                                  | —                                 |
|                           | POST `/`                                                 | `tenant:risk.manage`                  | `governance.risk.create`          |
|                           | PUT `/:id`                                               | 同上                                  | `governance.risk.update`          |
|                           | POST `/:id/review`                                       | 同上                                  | `governance.risk.review`          |
|                           | DELETE `/:id`（软删）                                    | 同上                                  | `governance.risk.delete`          |
| `api/compliance-events`   | GET `/`（filters: status/tenantId/eventType/tag/分页）   | `compliance:event.read`\|`.manage`    | —                                 |
|                           | GET `/:id`                                               | 同上                                  | —                                 |
|                           | POST `/`                                                 | `compliance:event.manage`             | `governance.compliance.create`    |
|                           | PUT `/:id`                                               | 同上                                  | `governance.compliance.update`    |
|                           | POST `/:id/assign` `{handlerId}`                         | 同上                                  | `governance.compliance.assign`    |
|                           | POST `/:id/resolve`                                      | 同上                                  | `governance.compliance.resolve`   |
|                           | POST `/:id/dismiss`                                      | 同上                                  | `governance.compliance.dismiss`   |
|                           | DELETE `/:id`（软删，仅终态）                            | 同上                                  | `governance.compliance.delete`    |
| `api/maintenance-windows` | GET `/`（filters: state/from/to/分页）[^mw-state]        | `release:maintenance.read`\|`.manage` | —                                 |
|                           | GET `/:id`                                               | 同上                                  | —                                 |
|                           | POST `/`                                                 | `release:maintenance.manage`          | `governance.maintenance.create`   |
|                           | PUT `/:id`                                               | 同上                                  | `governance.maintenance.update`   |
|                           | POST `/:id/start`                                        | 同上                                  | `governance.maintenance.start`    |
|                           | POST `/:id/complete` `{actualEndAt?}`                    | 同上                                  | `governance.maintenance.complete` |
|                           | POST `/:id/cancel`                                       | 同上                                  | `governance.maintenance.cancel`   |

审计 `resourceType` 分别为 `risk_record` / `compliance_event` / `maintenance_window`，状态转移类动作记 `before/after`。

[^mw-state]:
    维护窗口迁入 opera-bff 后，接口字段与过滤参数由 `status` 改为 `state`
    （`product_251` B-3：一个产品内不得混用多个「算不算数」的字段名）。**只改接口层**，
    `admin.maintenance_windows.status` 这个列不动。`api/risk-records` 与
    `api/compliance-events` 仍在 admin-bff、仍用 `status`——它们不在 opera 管理面，
    留待 admin 侧一并收敛，不在这里单独改一半。

### 4.2 实现要点

- **状态转移用条件 UPDATE 串行化**（TD-019 教训）：`UPDATE ... SET status=$new WHERE id=$1 AND status IN ($合法前态) RETURNING *`，0 行即 409（非法转移/并发竞争），不做 read-then-write。
- **读 join 展示名**：list/detail LEFT JOIN `tenancy.tenants`（租户名，已注销租户返回 id + 标记）与 `admin.operator_account`（reviewer/handler 显示名）。跨 schema 只读 join，不建 FK（边界#3 既有约定）。
- **校验**：镜像公告 router 的 normalize 帮手（枚举 Set 白名单与 CHECK 同步、`requireText(maxLen)`、`normalizeStringArray`、ISO 时间解析）；枚举在应用层先挡，避免打到 DB CHECK。**`evidence_url` 仅接受 `http(s)://` scheme**（前端渲染为链接，拒 `javascript:` 等存储型注入面）；`detail` jsonb 序列化后限 16KB。
- **UPDATE 列集合严格落在列级锁允许范围内**（§1.1），锚点列永不出现在 SET。

### 4.3 权限落地（GQ1 采纳后）

1. `deploy/database/seed/seed-catalog.mjs`：`OPERATOR_PERMISSIONS` 增 4 码；`OPERATOR_ROLE_PERMS` 按下表映射（super_admin 经 OP_ALL 自动全授，§4.4 断言强制不漏）。
2. `docs/30-design/data_admin_200_schema.md` §4.2/§4.3 目录同步（过 `pnpm lint:data-design`）。
3. **活库补投**：新增 perm + role_permission 行需一次性 DML（或幂等重跑 seed-catalog）——与 owner 确认投放方式后执行，属部署动作（放行门控）。**注意补投范围待核**：worker-01 cutover（2026-07-02）早于 operator RBAC seed 补齐（PR #610，2026-07-04 合 develop、未部署），活库 `admin.operator_permission` 目录现状未核实——可能需要补投**整个新目录**而非仅增量 4 码。并入 TD-018 授权后的活库核查一起确认。

| perm_code          | super_admin | admin | operation | finance | tech_ops | support | auditor |
| ------------------ | ----------- | ----- | --------- | ------- | -------- | ------- | ------- |
| `tenant:risk`      | ✔           | ✔     | ✔         | —       | —        | —       | R       |
| `compliance:event` | ✔           | ✔     | —         | —       | —        | —       | R       |

（维护窗口沿用既有 `release:maintenance` 行：super_admin/admin/tech_ops ✔，operation/auditor R。）

## 5. 前端设计（portals/admin）

- **导航**（`src/config/navigation.ts`，platform-autonomy workspace，只加不改）：
  - `securityAudit`（安全审计）组 + 风险记录 `/risk-records`、合规事件 `/compliance-events`；
  - `runtimeOps`（运行保障）组 + 维护窗口 `/maintenance-windows`；
  - `PlatformAutonomyPage` 「待处理风险」指标卡链接到 `/risk-records?reviewed=false&riskLevel=follow_up,high`（**双过滤与 `openRiskCount` 口径对齐**——只带 reviewed=false 会混入 normal 级未审记录，卡片数字与列表行数不一致）。
- **页面模式**：沿用 B8/B10 已定型 house 模式——div-grid directory 列表（B16 决策：不迁 DataTable）+ 筛选 pills + DS DialogForm 创建/编辑 + 行内动作按钮（审阅/指派/办结/驳回/开始/完成/取消，带确认 Dialog）+ Toast 反馈；能力不足时动作按钮隐藏（以 `fetchCapabilities` 判定）。
- **api client**（`src/api/admin-bff.ts`）：读 `fetchRiskRecords / fetchComplianceEvents / fetchMaintenanceWindows`（+detail），写动词式 `createRiskRecord / reviewRiskRecord / assignComplianceEvent / resolveComplianceEvent / startMaintenanceWindow / …`，DRY 走既有 `mutateJson`。

## 6. 实施批次与验证

- **G1 后端**：3 个 router + seed/目录改（§4.3.1-2）→ type-check + `lint:schema-residue` + `lint:data-design` + **全部 SQL 对 worker-01 活库 PREPARE**（读/写/锁全覆盖，含条件 UPDATE）。
- **G2 前端**：导航 + 3 页面 + client 方法 → type-check + eslint。
- **G3 部署**：合 develop 后按放行门控走；活库 perm 补投与代码部署同批次（先 perm 后代码，避免 403 窗口）。
- 实测结果回填本文档；TD-021 于 G1+G2 合入后销号（G3 部署不阻塞销号，与 completion-plan 口径一致）。

### 6.1 实测回填（2026-07-05，全链完成）

- **G1 验证**：throwaway PG（postgres:18-alpine + 全量 DDL）**22 条 PREPARE 全过**（读/写/锁全覆盖，含条件 UPDATE）；三状态机 runtime 实测——升险清 reviewer_id（§7-1 修订项生效）、合规 assign 转 in_review、维护窗口 complete 记 actual_end_at、终态守卫拒绝重开；seed 真跑 4 码映射核对（admin=4 / operation=2 / auditor=2 / super_admin 全授自检过）。
- **G2 验证**：bff + portal type-check/eslint 绿；schema-residue / data-design / seed / column-locks 全绿。DS quality-gate 护栏对治理记录网格的告警已在 `859dab79` 满足。
- **G3 执行**（PR #615 合 develop=`30f01951` → beta → main）：活库 `db-init action=seed`（expected_sha pinned，run 28740812232）幂等补投 → 37 operator_permission、super_admin 全授 37/37、**4 码自动获得 i18n 键**（`ops.perm.tenant.risk.read` 等，data_platform_100 §3.2.5 派生管道）、baseline audit PASSED（含 C2 列完备轴）；随后部署 success，admin/admin-bff healthy、日志零真实错误。批次顺序=先 perm 后代码（§6-G3），无 403 窗口。
- **§7-4 风险项结论**：担心的"全目录补投"未发生——活库经 reset round-3（data_platform_320 §9.6）已含完整 33 码目录，本次真增量 4 码。
- **偏差记录**：UI 不做客户端能力隐藏（对齐 house 模式，后端强制 403）。

**TD-021 已销号**（tech-debt.md 状态 Resolved）。

## 7. 审定记录（2026-07-05，owner 委托代审）

逐项对照权威源核实（98 列锁白名单 ✔、openRiskCount 语义 ✔、`normalizePlatformPermissions` 保留原始新式码故新 router 直查新码成立 ✔、tenancy.tenants 软删模型 ✔、seed OP_ALL 自动覆盖新码 ✔），GQ1–GQ8 默认决策全部维持。修订 4 处：

1. **升险静默吞掉**（工作流缺陷，最重要）：已审阅记录再改 risk_level 时 reviewer_id 残留 → 永不回 `openRiskCount`。修订 = risk_level 变更即清空 reviewer_id（§3.1/GQ3）。
2. **总览卡链接口径**：补 `riskLevel=follow_up,high` 双过滤，与 openRiskCount 对齐（§5）。
3. **evidence_url 注入面**：限 `http(s)://` scheme；detail jsonb 限 16KB（§4.2）。
4. **活库 perm 目录现状风险**：cutover（07-02）早于 RBAC seed 补齐（#610，07-04 合、未部署），补投范围可能是全目录而非增量 4 码，并入 TD-018 活库核查（§4.3）。
