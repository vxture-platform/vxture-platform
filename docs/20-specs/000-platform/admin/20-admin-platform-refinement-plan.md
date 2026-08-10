# Admin 平台全面完善 — 分析与实施计划（第二轮）

> 状态：📋 计划待审定 · v1 · 2026-07-11 · 分支 `feature/admin-platform-refinement`
> 依据 = 12-agent 全量盘点（portal 三组 × bff × docs × services × 行业对标 × 盲区稽查 × 4 补查，2026-07-11）
> 前序 = [admin-app-completion-plan.md](./10-admin-app-completion-plan.md)（B1–B18，2026-07-05 收尾）
> 定位：B1–B18 解决的是「每页出真数据 + 基础写路径」；本轮解决 **功能闭环断点、RBAC 安全收口、占位板块建设、数据真实化、工程质量兜底**。

## 0. 现状盘点结论

### 0.1 进展总览

admin 平台 = portals/admin（44 路由板块）+ bff/admin-bff（29 controller）。上一轮 B1–B18 + TD-017/018/019/021 闭环后，主体读写路径已对接 18/19-schema 活库，写路径普遍事务化+事务内审计。42 个实质板块现状：

| 状态 | 数量 | 板块                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整 | 16   | billing、invoices、orders、payments、subscriptions、promotion-redemptions、announcements、maintenance-windows、tickets、model-platform、model-grants、ops-todos、platform 总览、risk-records、compliance-events、login（OIDC RP）                                                                                                                                                      |
| 部分 | 14   | platform-admins / admin-roles / admin-permissions（**写路径 UI 全 403，见 §0.2-2**）、accounts（只读）、tenants（跨域字段零值+凭据操作缺）、audit-logs（导出缺+服务端筛选未接）、promotions / usage-metering / commerce-overview（BFF 硬编码归零字段）、products / product-solutions / service-plans（**硬编码 mock 数据**）、settings（仅改邮箱）、service-monitor（dev-only 数据源） |
| 坏死 | 1    | **verifications（路由遮蔽 → 列表恒 500，生产缺陷，见 §0.2-1）**                                                                                                                                                                                                                                                                                                                        |
| 占位 | 9    | approval-center / platform-jobs / platform-secrets（Q1 无 SoT 表，设计性空态）、feature-toggles / system-parameters / notification-logs（**表已建无应用层**）、notification-channels / data-dictionaries / skills（三层全缺或近全缺）                                                                                                                                                  |

另有 2 个 legacy 重定向（plans、product-plans → /service-plans），属有意保留。

**在册项对账修正**：task #23（8 死 billing router）已于 2026-07-02 删除（commit `3203bf9a`）、07-04 按 18-schema 重建（#608），当前代码零残留引用，**可销号**；operator 安全 P4 已经 PR #356（`9cfbb1bc`）合入 develop，`feature/operator-session-hardening` 分支不存在——P4 交付的是后端 guard/端点，**step-up ceremony UI 从未建过**（全历史 pickaxe 证实）。

### 0.2 实弹缺陷清单（盘点实证，按危害排序）

1. **verifications 路由遮蔽（生产缺陷）**：`tenants.router.ts` 中 `@Get(":id")`（L64）声明先于 `@Get("verifications")`（L434），Nest/Express 按声明序匹配 → `GET /api/tenants/verifications` 落入 `getTenant(id="verifications")` → uuid 转型 22P02 → 500。已用同版本 Nest 11.1.16+Express 4.22.1 最小复现证实。**实名认证审核在 admin 门户实际完全不可用**（approve/reject 端点无遮蔽但列表无数据不可达）。未在 tech-debt 登记。
2. **step-up 闭环断裂**：platform-admins（8）+ admin-roles（6）+ admin-permissions（3）共 **17 个写端点** 100% 挂 `@RequireStepUp`，guard 无旁路；而 portal 全仓无任何代码调用 `POST /api/operator/step-up/totp`——三页面仅在 catch 弹「需二次验证」toast 后 return。**运营端 RBAC/账号治理全部写操作从 UI 永远 403 dead-end**。
3. **越权实弹（低权限 operator 可利用）**：
   - `announcements.router.ts` 全部写路径（发布/删除全站公告）仅校验登录态（L359-364 注释自认），`content:announcement.manage` 零消费——**任何 operator（含 auditor/support/finance）可发/删平台公告**；
   - `audit-logs.router.ts` GET 仅校验登录态，`audit:read` 未挂——**任何 operator 可全量读中央审计（含操作者 IP/邮箱）**。
4. **RBAC 授权矩阵与实际可达性双向错位**：37 个 seed perm 码仅 14 个有消费端点（38%），23 个零消费；8 个高危码中 5 个零实现（`support:impersonate`、`commerce:refund.execute`、`security:signing_key.manage`、`security:oidc_client.manage` 等为 designed-only）；`tenant:lifecycle.suspend` 被弱守卫 `platform.tenant.manage` 替代且无 step-up（**operation 角色可停用任意租户**）；`user:pii.read` 两级脱敏纯纸面（**accounts 端点明文回传 email/phone**）；subscriptions 写事务挂 `platform.pricing.manage`（finance 进不去、operation 反而能写）；tickets 挂 `platform.tenant.manage`（support 角色进不了工单）。read/manage 分级形同虚设，auditor 的 22 个只读授权无法兑现。`LEGACY_CAPABILITY_BRIDGE` 自注释承认待「follow-up authz pass」但无 TD 编号跟踪。
5. **金融写路径无 step-up**：账单作废/减免/调整、支付核销/驳回、订阅四动作、线下开票同步复用普通读侧能力守卫（billing.router.ts:104 自认）——completion-plan §4 在册 follow-up。
6. **commerce-overview 风险卡链接 404**：BFF 返回 `/commercial/billing`、`/commercial/overview`（commercial.router.ts:546/555/564），实际路由是 `/billing`、`/commerce-overview`，逾期/待收风险跟进链路断裂。
7. **announcements 编辑静默覆盖**：读模型不回传 severity/target 明细，编辑保存会把 severity 重置为 info、投放对象重置为全部（§4 在册 follow-up ④）。

### 0.3 结构性问题

- **产品目录假数据面**：products.router.ts 9 端点中 8 个返回文件内约 700 行硬编码 mock（时间戳恒 2026-04-25，虚构演示数据），/products、/product-solutions、/service-plans 三个生产页展示虚构内容，编辑动作全 disabled。product_210 v1.0 已定稿（T1–T3 实施待逐项授权），此处是与其汇合的主战场。
- **列表统一 limit 500 无服务端分页**：商业化/治理全部列表端点全量拉取+前端内存筛选，超 500 行静默截断、CSV 导出不完整；audit-logs BFF 已有服务端筛选参数但前端不传。
- **错误不可观测**：前端 `readJson` 对列表请求静默吞错回退空数组——BFF 宕机/会话过期/缺权限时页面显示「暂无数据」，运营无法区分故障与空库。
- **零自动化验证兜底**：admin-bff 仅 2 个 spec（均 stub 纯逻辑），全部事务写路径零测试；portals/admin 零测试文件、无 test 脚本（CI `--if-present` 静默跳过）；全仓无 e2e harness；无 boot-smoke（TD-024 Open，admin-bff 用 esbuild bundle，正是 DI 静默 undefined 高危形态，#640 前科）。
- **BFF 绕过服务层双轨**：admin-bff 约 1.45 万行 router 直连 SQL，与 services 层（billing/subscription/ticket）业务规则双轨维护（R4 治理拆分设计未启动，仓内无设计文档）；5 个孤儿服务目录（commerce/invoice、commerce/payment、platform/ops、platform/product、platform/model）无 package.json 零消费方待决议；services/tenant 实际不存在（仅 node_modules 残留）。
- **运营观测盲区**：provisioning webhook 投递/死信无任何 admin 观测面（C3 生产化后的运维盲区）；sharing.grants 作为控制面 SoT 无任何授予/回收写入通道（createGrant/revokeGrant 全仓零调用）。
- **文档陈旧误导级**：docs/40-implementation/packages/bff/admin.md 记载 4 个已不存在端点、缺 15+ 现存 router，登录链路描述整体过期（Batch 8 已 OIDC RP 化，Turnstile 归 auth-bff/accounts 侧，照文档配置会被 39-audit-env 拦部署）；docs/30-design/auth.md §12、docs/40-implementation/ai/05、docs/40-implementation/packages/00-index.md 同口径残留；admin/index.md（05-11）与 docs/00-meta/status.md（06-10）状态表滞后；workplans/2026-06-02-admin-turnstile-independent-surface.md 剩余项落点已失效应关闭。

### 0.4 行业对标（多租户 SaaS 内部运营平台 ~19 标准板块）

名义覆盖约 7 成（商业化、目录定价、促销、operator RBAC、审批、审计合规、工单、配置开关、通知公告、作业调度、密钥、字典均有板块位）；AI 治理三板块（model-platform/model-grants/skills）超出经典基线属加分项。**行业普遍有、我们缺失/薄弱的方向**：

| 方向                                   | 判定          | 备注                                                                     |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Impersonation/代登录支持操作           | designed-only | `support:impersonate` 权限码+角色授权+设计文档三重在册，实现为零         |
| 退款/贷记/争议/催收                    | partial       | `commerce:refund.execute` designed-only；无争议(chargeback)/dunning 板块 |
| 平台级经营分析（MRR/ARR/churn/cohort） | partial       | commerce-overview 仅商业化快照，无趋势/BI                                |
| 租户健康分/客户成功视图                | missing       | B2B SaaS 运营后台标配                                                    |
| API key/Webhook 运营（租户集成视角）   | missing       | platform-secrets 只管平台自身密钥；provisioning 投递观测同缺             |
| 隐私 DSAR 处理                         | missing       | compliance-events 只记录事件不承担请求工作流                             |
| 事件(incident)管理与状态页             | partial       | service-monitor 仅健康监测且 dev-only                                    |
| operator 行为回放                      | 进阶项        | 头部平台可见，非基线                                                     |

## 1. 完善目标

- **G1 功能闭环修复**：已建板块的断点全部接通——verifications 可用、step-up ceremony UI 落地解锁 17 个写端点、404 链接与静默覆盖修复。
- **G2 RBAC 安全收口**：以 seed 权限矩阵（data_admin_200 §4）为权威做一次全面 authz pass——守卫全覆盖、域对齐、read/manage 分级兑现、危码落地或显式登记、金融写加 step-up。
- **G3 占位板块建成（表已建优先）**：system-parameters、feature-toggles、notification-logs 三个「DDL 已建无应用层」板块全链建成；settings 页补全。
- **G4 数据真实化**：产品目录去 mock（与 product_210 T1–T3 汇合）；commercial 硬编码归零字段逐一治理（能补数补数、补不了从 UI 摘除）。
- **G5 工程质量兜底**：服务端分页/筛选、错误可观测、admin-bff 写路径测试、boot-smoke（TD-024 落地）。
- **G6 行业对标新能力**：impersonation、webhook 投递观测、经营分析、租户健康、DSAR 等——**待产品定义后另行立项，本计划仅登记不实施**。
- **G7 文档与在册项对账**：陈旧文档重写/销号/关闭，memory 过时项修正。

## 2. 批次 backlog（执行序，逐批授权）

### P0 — 实弹缺陷修复（C1–C3）

- **C1 verifications 路由遮蔽修复**：tenants.router.ts 把 verifications 三路由挪到 `:id` 之前 + `getTenant` 加 UUID 预校验（400 而非 500）；补路由级回归测试；tech-debt 登记并销号。
- **C2 step-up ceremony UI**：portals/admin 建 ceremony 组件（捕获 `step_up_required` → TOTP 输入弹窗 → `POST /api/operator/step-up/totp` → 自动重试原 mutation），三治理页接入；覆盖「operator 未注册 TOTP → 引导去 accounts 门户注册」分支。
- **C3 小缺陷清扫**：commerce-overview 风险卡 href 修正；announcements 读模型 enrich（severity/target_plans/target_tenant_types 回传）修编辑静默覆盖；ops-todos 死交互复选框处置（接批量或移除）。

### P1 — RBAC 安全收口（C4–C7，权威=data_admin_200 §4 + seed-catalog.mjs）

- **C4 越权实弹封堵**：announcements 写路径挂 `content:announcement.manage`、audit-logs 挂 `audit:read`（经桥 `platform.audit.read` 已可用）；顺带清理 `platform.admin.manage` 永假死检查与 `tenant:manage` 孤儿 shim。
- **C5 authz pass（全 router 域对齐）**：逐 router 把守卫从 legacy 平铺串迁到三段式 perm 码正确域（tickets→`support:ticket.*`、subscriptions/orders→`commerce:*`、accounts→`user:profile.read`、billing/payments→对应域），read/manage 分级兑现（auditor 只读可达、operation 不可写金融）；`LEGACY_CAPABILITY_BRIDGE` 收敛计划与 TD 登记。**注意**：先核对角色授权矩阵避免上线即 403（TD-021「先 perm 后代码」教训）。
- **C6 危码落地**：`tenant:lifecycle.suspend` 专码替换弱守卫并加 step-up；accounts PII 两级脱敏（默认 masked，持 `user:pii.read` 才明文）。其余三个 designed-only 危码（impersonate/refund/signing_key+oidc_client）归 P4 登记，不投机实现。
- **C7 金融写路径 step-up**：billing 三写、payments verify/reject、orders 线下支付确认、subscriptions 四动作全部加 `@RequireStepUp`（依赖 C2 ceremony UI 先行）。

### P2 — 占位板块建设 + 可用性（C8–C13）

- **C8 system-parameters**：admin.settings 表 CRUD 全链（router+页面），含变更审计。
- **C9 feature-toggles**：admin.feature_flags 表 CRUD 全链，含启停审计；灰度/租户级定向按表结构现状实现，不投机扩表。
- **C10 notification-logs**：support.notification_logs 只读台账（列表/筛选/详情）；notification-channels 无表，归 P4 待产品定义。
- **C11 settings 页补全**：自助改手机号/改密码/MFA 管理（全部委派 IdP，镜像 operator-contact 模式）。
- **C12 accounts 写路径**：C 端用户处置（禁用/强制下线/凭据重置）——需 identity 域新增 account 侧 internal 委派端点（镜像 operator 通道），先出接口设计再实施。
- **C13 列表工程化**：audit-logs 前端接服务端筛选+导出端点；高流量列表（accounts/audit-logs/billing/payments）服务端分页改造；readJson 错误态 UI（区分故障与空数据）。

### P3 — 数据真实化 + 测试兜底（C14–C17）

- **C14 产品目录去 mock**：products.router 8 个 mock 端点接活库（product schema），编辑动作按 product_210 定稿逐步启用——**与线 A T1–T3 汇合，须逐项授权后执行**。
- **C15 commercial 字段治理**：promotions 金额字段、usage-metering token/请求数、redemptions status/operator、overview planRevenue——有数据源的接上，无数据源的从 UI/CSV 摘除并留注释，消除「恒 0 误导」。
- **C16 admin-bff 测试兜底**：事务写路径（billing 三写、订阅四动作、verifications 审批、支付核销）单测覆盖 + 路由声明序回归（防 C1 复发）。
- **C17 boot-smoke（TD-024 admin 侧落地）**：CI 假 env 启动断言无 DI 异常，覆盖 admin-bff（esbuild bundle 高危形态），可顺带覆盖其余 4 个 Nest BFF 则一并做。

### P4 — 登记区（待产品定义/待 owner 决议，本计划不实施）

| 项                                                          | 前置                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| impersonation（support:impersonate 落地）                   | 产品定义（会话切换机制/审计标识/UI 横幅）                  |
| 退款执行（commerce:refund.execute）+ 争议/催收              | 产品定义 + T05 在线支付前置                                |
| approval-center / platform-jobs / platform-secrets SoT 建表 | Q1 决策待产品定义三类治理模型                              |
| skills 数据层                                               | 产品定义（技能注册表）                                     |
| notification-channels（通道配置）                           | 产品定义 + 无表                                            |
| data-dictionaries                                           | 产品定义 + 无表                                            |
| 经营分析 dashboard / 租户健康分 / DSAR                      | 产品定义                                                   |
| service-monitor 生产遥测源                                  | 基础设施决策（Q6 维持 dev-only）                           |
| provisioning 投递观测面 / sharing grants 授予回收通道       | 跨线（arda C3 / P4 sharing 工作线）协调                    |
| R4：admin-bff raw SQL → service 层治理拆分                  | 需先出设计文档（memory 在册、仓内无文档）                  |
| 5 个孤儿服务目录 + services/tenant 残留决议（删/复活）      | owner 决议                                                 |
| security:signing_key.manage / oidc_client.manage 管理面     | 产品定义 + admin-signing-isolation workplan entry criteria |

### 文档线（C18，可与任意批次并行）

- docs/40-implementation/packages/bff/admin.md 按现行 30 router 整页重写（OIDC RP 化、\_\_Host-vx_rp_session）；
- docs/30-design/auth.md §12、docs/40-implementation/ai/05-bff-data-access-guide.md、docs/40-implementation/packages/00-index.md 的 Turnstile/签发旧口径修正；
- docs/20-specs/platform/admin/00-index.md 状态表回填（B1–B18/TD-021 后实况）；docs/00-meta/status.md T12/T15 销号；
- workplans/2026-06-02-admin-turnstile-independent-surface.md 按现行落点（auth-bff/accounts 侧，已生效）关闭销号；
- tech-debt 新登记：verifications 路由遮蔽（C1 修复后 Resolved）、LEGACY_CAPABILITY_BRIDGE 收敛、announcements/audit-logs 守卫缺失（C4 修复后 Resolved）。

## 3. 纪律（沿用前序计划 + 本轮追加）

- **单一权威**：新查询只用 106 表真实名；权限键以 seed-catalog.mjs + data_admin_200 §4 为权威；每批过 `pnpm lint:schema-residue`。
- **授权边界**：逐批授权执行；P4 登记区一律不投机实施；C14 须与 product_210 线 A 逐项授权对齐。
- **验证**：每批 type-check（admin-bff + portal）+ eslint；SQL 对 worker-01 活库 PREPARE 验证；authz 变更须先对照角色矩阵模拟各角色可达性再合并。
- **部署门控**：worker-01 部署须显式放行；本计划到代码+本地验证+合 develop。
- **回填**：实测结果回填本文件 §4。

## 4. 进度回填

### P0 完成（2026-07-11，分支 `feature/admin-platform-refinement`，未提交/未部署）

**C1 verifications 路由遮蔽修复** ✅

- `bff/admin-bff/src/routers/tenants.router.ts`：`@Get("verifications")` + approve/reject 三路由前移至 `@Get(":id")` 之前；`getTenant` 加 `requireUuid` 预校验（异常输入 400 而非 500）。
- `bff/admin-bff/src/routers/route-order.spec.ts`（新增）：源码级扫描全部 router，静态段被同方法参数路由遮蔽即 fail——扫描确认其余 28 个 router 无同类问题。
- `portals/admin/src/modules/tenants/VerificationsPage.tsx`：`loadVerifications` 补 catch + toast（此前无 catch，路由 500 时静默 unhandled rejection）。
- tech-debt 登记 [TD-026](../../../60-operations/10-tech-debt.md#td-026) 并同步销号。

**C2 step-up ceremony UI** ✅（解锁 17 个 `@RequireStepUp` 写端点）

- `portals/admin/src/providers/StepUpProvider.tsx`（新增）：`useStepUp().runWithStepUp(fn)` — 执行 mutation，若命中 `step_up_required` 则弹 TOTP 对话框，验证成功后自动重试；取消抛 `StepUpCancelledError`（各页静默处理）；未绑定验证器有引导文案。挂载于 `ConsoleAppProviders`（ToastProvider 内）。
- `portals/admin/src/api/admin-bff.ts`：新增 `submitOperatorStepUpTotp(code)` → `POST /api/operator/step-up/totp`。
- 三治理页全部 17 个写路径以 `runWithStepUp` 包裹：admin-permissions（3）、admin-roles（6：含权限矩阵替换）、platform-admins（8）。各页 `reportError` 增加 `isStepUpCancelled` 静默分支，旧「需二次验证」warning 降级为「未完成/已过期请重试」兜底。
- `portals/admin/src/styles/admin-step-up.css`（新增，注册进 globals.css）。

**C3 小缺陷清扫** ✅

- commerce-overview 风险卡 404：`commercial.router.ts` 三处 `href` `/commercial/billing|overview` → `/billing`、`/commerce-overview`。
- announcements 编辑静默覆盖：读模型 enrich `severity`/`targetPlans`/`targetTenantTypes`/`publishAt`（`announcements.router.ts` + `console.types.ts` + 前端 `entities/console.ts`），前端 `formFromRecord` 精确回填并保留 UI 不可编辑的 `targetPlans`（不再被重置为 info/全部）。
- ops-todos 死复选框：移除只读聚合页无消费的行/全选选择态（JSX + 6→保留列 CSS，ticket 选择样式保留不动）。

**验证**：admin-bff type-check + lint + 41 vitest（含新 route-order spec）全绿；portal type-check + lint 全绿。未跑活库 PREPARE（本轮无新 SQL 结构，仅 announcements 读列名新增 severity，列在 DDL 80_admin.sql 已存在）。

**遗留/未做（转后续批次）**：C2 依赖 operator 已在 IdP 注册 TOTP，ceremony 仅给引导文案未做深链；金融写路径加 step-up（C7）待 P1；authz 收口（C4–C6）待 P1。

### P1 部分完成（2026-07-11，同分支，未提交/未部署）

**C4 越权实弹封堵 + 死码清理** ✅

- `audit-logs.router.ts`：GET 由 session-only → `audit:read` 守卫（super_admin/admin/auditor）。
- `announcements.router.ts`：写路径（POST/PUT/DELETE/publish/archive）由 session-only → `content:announcement.manage`（super_admin/admin/operation）；list 读保持 session-only（低敏内部内容）。
- `platform-governance.router.ts`：移除永假死的 `platform.admin.manage` 析取（无码/无桥能产生），保留 `platform.model.manage`/`audit:read`。
- `auth.service.ts`：移除引用不存在码的 `tenant:manage` 孤儿 shim。

**C6a tenant 生命周期危码 + step-up** ✅

- `tenants.router.ts`：suspend/resume 由 `platform.tenant.manage` → 专用危码 `tenant:lifecycle.suspend`（super_admin/admin，operation 不再可停用任意租户）+ `@RequireStepUp()`。
- `TenantsPage.tsx`：suspend/resume 以 `runWithStepUp` 包裹（否则新 step-up 会 403 无 ceremony），取消静默处理。

**C6b accounts PII 两级脱敏** ✅

- `accounts.router.ts`：email/phone 默认脱敏（`j***@domain`、`137****5678`），持 `user:pii.read`（危码，admin 独有）才明文；访问门槛暂不动（属 C5 域收口，见下）。

**设计校正（重要）**：原 C7「所有金融写加 step-up」经对照设计权威 data_admin_200 §4 危码清单（仅 `tenant:lifecycle.suspend`/`user:pii.read`/`commerce:refund.execute`/`support:impersonate`/`security:*`/`operator:*` 为危码需 step-up），**routine 账单/支付/订阅写不属危码**——故 C7 blanket step-up 超出设计范围，不做；仅对真危码（tenant lifecycle）加 step-up（已随 C6a 落地）。若要给 routine 金融写加 step-up，属超出现行危码定义的策略决定，需 owner 拍板。

**C5 阻塞发现（登记 TD-027）**：seed 目录缺 finance/commerce **写码**（billing/payment/invoice/subscription write），故业务 router 全面域收口受阻于 catalog 设计决策（补写码 = seed 改 + 生产 reseed + 角色矩阵更新，需 owner）。C4 已把两个**真实越权洞**按正确码收口；剩余「域错位 + read/manage 分级未兑现」是一致性债，非即时可利用，转 TD-027 待 catalog 定案后逐 router 迁移。

**P1 验证**：admin-bff + portal type-check + lint + 41 vitest 全绿。

### P2 部分完成（2026-07-11，分支 `feature/admin-placeholder-boards`）

**C9 feature-toggles 板块建成** ✅（admin.feature_flags，码齐直接建）

- `bff/admin-bff/src/routers/feature-toggles.router.ts`（新）：读(list/detail) + 写(create/update/toggle/archive)，事务 + 事务内审计；守卫 `release:feature_flag.read|.manage`（seed §4.3 已有码）。灰度 0-100、逐租户覆盖(tenant_overrides jsonb)、全局开关、归档/恢复。flag_key 创建后不可改（锚点），23505 → 友好报错。
- `portals/admin/src/modules/feature-toggles/FeatureTogglesPage.tsx`（新）：替占位页,镜像 MaintenanceWindowsPage,筛选(分类/环境/归档)+ 列表 + 创建/编辑 DialogForm + 启停/编辑/归档动作。编辑**round-trip tenant_overrides**（避免 announcements 式静默覆盖）。
- CSS：`admin-governance-feature-flags.css`（新叶子，仅 fr 轨道无 raw 值,过 DS 护栏）；register 进 admin-governance wrapper。app.module + api client + entities 全接线。
- 验证：admin-bff+portal type-check/lint/46 vitest/DS 护栏 全绿。

**C8 system-parameters + C10 notification-logs 建成（owner 授权定码，2026-07-11）** ✅
owner 将定码授权交予我，按 catalog 哲学定 3 新码并补齐缺口（seed 47→50 + 角色矩阵 + `data_admin_200 §4` 同步）：

- `platform:setting.read`（查看，sensitive/encrypted 脱敏）— super_admin/admin/tech_ops/auditor
- `platform:setting.manage`（管理系统配置）— super_admin/**tech_ops**（角色描述含"system settings"；admin **不含**，因 admin.settings 含 operator.mfa.policy 等安全邻接项，admin 只读）
- `notification:log.read`（通知台账只读）— super_admin/admin/support/tech_ops/auditor
- **C8 板块**：`system-parameters.router.ts` + `SystemParametersPage.tsx`。读脱敏 sensitive/encrypted；**编辑仅非 sensitive/非 encrypted/非 readonly 行**（encrypted→secret manager、readonly→业务锁、sensitive→专用安全流，各 409 拒），值按 value_type 校验（int/bool/json），事务+审计。**敏感配置不拆危码**——v1 只编辑良性配置故 manage 一档足够（符合 C7 校准）。
- **C10 板块**：`notification-logs.router.ts`（只读 + 渠道/状态/时间/搜索筛选，left join tenant 名）+ `NotificationLogsPage.tsx`（只读台账，失败/退回高亮）。
- CSS：`admin-governance-config-boards.css`（fr 轨道，过 DS 护栏）。app.module + api client + entities 全接线。
- 验证：admin-bff + portal type-check/lint/48 vitest/DS 护栏 全绿。
- **登记后续**：sensitive/encrypted 平台配置的安全编辑流（含可能的危码 + step-up + secret-manager 集成）v1 未做，待专项。

**P2 剩余（未做）**：C11 settings 页补全（判定已被 accounts 门户覆盖，跳过）、C12 accounts 写路径（需 identity 域 internal 委派端点）；notification-channels/data-dictionaries/skills（无表或近全缺，待产品定义）。

### P2 C13 列表工程化 — 错误可观测部分完成（2026-07-11，分支 `feature/admin-list-engineering`）

**audit-logs 服务端筛选 + 导出 + 错误态**（commit `f38d4d32`）✅

- 前端接 BFF 已有的服务端筛选：日期范围（from/to）+ result 驱动 fetch（审计日志无限增长，日期范围可查 500 窗口之外）；自由文本搜索保留客户端。
- 「导出审计」按钮启用（共享 `exportCsv`，导出当前筛选集）。
- `fetchAuditLogs` 改 `readJsonStrict`，故障不再静默回退空数组。零 BFF 改动。

**错误可观测推广**（commit `8e8dc30f` + `bb80e2f0`）✅ — 14 板块

- 把 `readJson`(吞错→`[]`) 改为 `readJsonStrict` + 页面 `loadError` 态 + 空态错误感知，让「BFF 故障/会话过期/缺权限」与「真空库」可区分（§0.3「错误不可观测」）。
- 覆盖：金融 5（billing/payments/subscriptions/orders/invoices）+ 核心 9（accounts/tenants/commercial×3/announcements/治理×3）。单调用方 fetch 直接改 strict；tenants 用已有 `fetchTenantOperationsStrict`（不动 TenantDetailPage）；reload-after-action 调用点本在 try/catch 内。
- 剩余吞错为低价值（products=mock 待替换、skills=占位）或已 strict（model 系列），核心运营板块已覆盖。

**C13 剩余：服务端分页（独立重活，未做）** — 高流量板块仍 `limit 500` 全量拉+前端内存分页，超 500 静默截断、CSV 导出不完整。需 BFF 加 `limit/offset/count` 契约 + 多板块前端分页模型重构，涉及 BFF 契约改动，建议单独立项排期，不混入本前端为主的工程线。设计出处见 §0.3。

### P2 C12 accounts 写路径 — 停用/恢复/强制下线（2026-07-12，分支 `feature/admin-accounts-write`）✅

owner 裁：A（全禁用 status='disabled'）+ 本轮做停用/恢复 + 强制下线，凭据重置延后。**4 层建设**（镜像 operator B9，对 C 端用户）：

- **account service**（services/identity/account）：加 admin 方法 `adminDisableAccount`（status='disabled' + 吊销全部会话）/`adminEnableAccount`/`adminForceLogout`（revoke all customer sessions）+ repo `adminSetAccountStatus`/`revokeAllSessions`（realm='customer' 过滤）。无自助的防自锁（管理员可全禁用）。
- **auth-bff**：新 `internal/account/users` 内部委派 router（`:id/disable|enable|sessions/revoke`，InternalAuthGuard/AUTH_INTERNAL_TOKEN，realm 隔离——operator id → 404）。
- **admin-bff**：`OperatorAdminService` 复用 delegate 加 3 个 account 方法；`accounts.router` 加 3 个 POST 写端点（守卫 `user:account.manage`，事务外委派 + 本地写审计）。
- **前端**：AccountsPage 启用「停用/恢复」+「强制下线」动作（确认对话框 + 可选备注写审计）；「重置密码」保持置灰（延后）。
- **catalog 补码**：`user:account.manage`（seed 50→**51**，super_admin/admin，可逆故无 step-up；`data_admin_200 §4` 同步）。**需并入生产 reseed，计数目标现为 51。**
- **延后登记**：C 端凭据重置（社交-only/无验证邮箱语义 + 带外改密），需专用设计。
- 验证：service-account/auth-bff/admin-bff/portal type-check + admin-bff lint + 48 vitest 全绿。

### P3 C14 产品目录去 mock — capabilities + agents 接活库（2026-07-12，分支 `feature/admin-products-demock`）✅

**摸底关键发现**：`products.router` 8 端点中真实活库支撑两极分化。`plans` 早已接活库；`capabilities`/`agents` 可接 `product.products`（统一目录，合并旧 agent+application，seed 只 4 真产品 ruyin/umbra/runos/arda）；`solutions`/`service-plans`/`releases`/`model-policies` 在 `product` schema **无对应表**，是纯 mock 概念。**去 mock 不是代码机械问题，是产品目录成熟度问题**（无表可接）。

**owner 裁定 2026-07-12：C14 仅接 capabilities+agents，其余保留 mock+显式注释+登记 TD-029。**

- **capabilities**：`listCapabilities`/`getCapability` 改 async，`loadProductCapabilities(pool)` 查 `product.products`（+ `product_categories` 品类）联 `product_metrics`（真 metrics）+ `product_webhooks`（真 integration）+ 子查询 `plan_components→plan_versions` 算 planCount。类型映射 `product_type`(client/external/agent/data_platform)→`ProductCapabilityType`；`external`→partner。无 schema 归属字段（ownerTeam/accessModes/billingMode/relatedSolutions/releases/modelPolicyCount）**返回空而非编造**——诚实反映稀疏，不造数据。
- **agents**：`listAgents` 改 async，`loadProductAgents(pool)` 查 `product.products WHERE product_type='agent'`；agentType/defaultModelCode 无列 → 默认 chat/null。
- **保留 mock（无表）**：solutions/service-plans/releases/model-policies 加 `STILL MOCK` 注释指明无 schema，登记 **TD-029**（产品目录细化设计定义 solutions/releases 模型 + seed 后方可接库；model-policies 随 B11）。
- 删除 mock：capabilityProfiles 富 demo（无人机/洪涝视频/法务库）+ CapabilitySeed/CapabilityProfile 类型 + 所有 capability-only 派生 helper + productAgents 常量 + 两 ID 常量。
- 验证：admin-bff type-check + lint + 48 vitest + portal type-check 全绿。SQL 依 `40_product.sql` DDL 写就（schema 精确），生产 PREPARE 验证待放行。**本批无 seed/perm 变更、无生产动作。**

### P3 C15 commercial 字段治理 — 消除「恒 0 误导」（2026-07-12，分支 `feature/admin-commercial-field-hygiene`）✅

按规则「有源接上、无源摘除留注释」逐字段清理 commercial 四端点的恒 0/恒单值字段（源码+schema 实证）。**两处 owner 裁决**（2026-07-12）：券金额（originalPrice/salePrice/usedAmount）**摘除**（券面金额藏 effect JSONB 按 kind 异构，无干净统一源，登记 TD-030）；redemption「操作人」**保留"客户自助"恒值**（核销确为客户自助，voucher_redemptions.user_id 是客户非运营，诚实恒值非误导）。

- **摘除（无源）**：
  - usage-metering：`requestCount`/`inputTokens`/`outputTokens`（usage_summary_months 月表只 total_amount，无 token 分维列）、`tierName`（订阅 join 未 surface tier）。
  - promotions：`planCode`/`planName`/`tierName`（voucher_batches 无 plan 关联）、`originalPrice`/`salePrice`/`discountAmount`/`usedAmount`（金额在 effect JSONB，TD-030）。
  - redemptions：**`status` 状态机**（voucher_redemptions **无 status 列**，核销记录即终态；前端 redeemed/reversed/applied 三态筛选+统计恒单值/恒 0，全删——「状态」列改「核销方」展示 operatorName，避免动 DS 网格 CSS）、`tierName`。
  - overview planRevenue：`tierName`（未按 tier 分组）、`paidAmount`（=revenueAmount 重复，误导"实付"）、`discountAmount`（恒 0 未算）。
- **保留（真源）**：redemptions `discountAmount`←`invoices.discount_amount`（真账单减免）、`operatorName`="客户自助"。
- 前端：4 页去除对应列/CSV/卡片/汇总统计/筛选器，恒 0 汇总卡替换为真实计数（计量项数/覆盖租户/账单已结清数）；两处 PageHeader 描述改为诚实口径。两份类型（BFF console.types + 前端 entities/console）同步删字段并留 C15 注释。
- **TD-030**（新开，Design Pending）：券批次金额面无展示，待 effect-schema 感知的券金额投影设计。
- 验证：admin-bff type-check + lint + 48 vitest + portal type-check + lint 全绿。**纯前后端展示治理，无 seed/perm/schema/生产变更。**

### P3 C16 admin-bff 写路径测试兜底（2026-07-12，分支 `feature/admin-writepath-tests`）✅

新增 `write-paths.spec.ts`（21 例），对四个事务写域断言两条 tsc/lint 看不见的不变量：① **授权先于 DB**——缺码必须在取连接前被拒（镜像 C4/C6/TD-027 收口，用「connect 抛错」的 noDbPool 证明零 DB 触碰）；② **事务健全**——任一前置不变量抛错则 ROLLBACK + 连接 ALWAYS release，仅成功路径 COMMIT（用可编程 mock client 记录 begin/commit/rollback/release 断言结局）。

- **订阅四动作**（runSubscriptionAction）：缺 subscription.manage→403（无 DB）；未知 action→400（无 DB）；订阅缺失→404+rollback+release；5 个非法状态迁移（renew-cancelled/suspend-suspended/suspend-cancelled/resume-active/cancel-cancelled）→409+rollback+release；合法 suspend（active→suspended）→commit+release。
- **支付核销**（verifyPayment settle / rejectPayment）：缺 payment.settle→403；非法 payment id→401（payments requireUuid 抛 Unauthorized 的既有契约，记录在案）；支付缺失→404+rollback；状态不可核销→400+rollback；合法核销（pending 支付+发票）→commit+release；reject 缺 payment.manage→403。均无 DB 触碰（守卫路径）。
- **租户实名审批**（approve/reject via reviewVerification）：缺 platform.tenant.manage→403；reject 缺 reason→400（无 DB）；审批记录缺失→404+rollback；合法 approve→commit+release。
- **billing 三写**（runBillAction 例行动作）：缺 billing.manage→403；作废已作废账单→409+rollback+release。（危动作 step-up 绕过守卫在既有 `billing-action-guard.spec.ts`。）
- **路由声明序回归（防 C1 复发）**：既有 `route-order.spec.ts`（C1/P0 全 router 遮蔽扫描）已覆盖，本批不复制。
- 验证：admin-bff 48→**69 vitest** 全绿 + type-check + lint。**纯测试新增，无生产/schema/perm 变更。**

### P3 C17 boot-smoke — TD-024 admin 侧落地（2026-07-12，分支 `feature/admin-boot-smoke`）✅

给 admin-bff 加**真实 bundle 启动冒烟**，堵住 esbuild bundle 隐式构造注入陷阱（tsc/unit 失明的高危形态，源=#637 生产 40min 崩溃）。选真实 `dist/main.cjs` boot 而非 compile 级冒烟——后者跑 ts 源码，看不见 bundle 特有的 DI 陷阱，而生产跑的正是 bundle。

- **main.ts** 加 `BOOT_SMOKE=1` 分支：`NestFactory.create → app.init() → app.close() → exit 0`，不 listen 不服务流量——但完整解析 DI 图（陷阱就在此暴露）。
- **通用 runner** `scripts/guardrails/boot-smoke.mjs`：从干净 env 用假但 schema-valid 的值 spawn bundle，60s 超时杀，非 0 即失败；接受 bundle 路径参数，通用可复用于其余 BFF。
- **admin-bff** 加脚本 `build:bundle`（拆出 esbuild 部分，跳过重建 deps）+ `boot-smoke`。
- **ci.yml** `build` job 加两步「Build admin-bff bundle」+「Boot-smoke」（docs-only 跳过）。
- 本地在**无 .env.local**（镜像 CI）验证 exit 0；冒烟实证**非 no-op**（DATABASE_URL 须 `postgresql://`、缺 JWT secret 均 exit 1 拦下）。
- **TD-024 → In Progress**（admin 侧落地；其余 4 个 Nest BFF 采纳同款 BOOT_SMOKE 分支后接同一 runner，逐个增量，全覆盖后销号）。
- 验证：build:bundle + boot-smoke 全绿（无 .env.local）；prettier 全绿。**无 seed/perm/schema/生产运行变更（仅新增 CI 步骤 + 冒烟入口）。**
