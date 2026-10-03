#!/usr/bin/env node

/**
 * check-ops-todo-alerts.mjs — 运营待办：算法产出的每一类都有「推不推告警」的裁定（#231），
 * 且每一类**有升档阈值**的都有人扫（2026-10-04 owner 裁定 3「通告尽量覆盖全」）。
 *
 * ── 补的是哪个盲区 ──
 * 2026-09-28 之前待办在**浏览器里**拼（admin 的 OpsTodosPage.buildOpsTodos），告警在
 * **服务端**扫（platform-api 的 OpsTodoAlertJob → findOpsTodoOrders）。两边各写各的判据，
 * 谁也不认识谁——退款单挂着无人知，就是这么漏的。根治后判据只有一处：
 * `@vxture/service-ops-todos` 的 OpsTodoRepository，页面与作业都读它。
 *
 * 但「同一份算法」只保证两边**看到的一样**，不保证**每一类都有人裁定过要不要告警**：
 * 往算法里加一类待办，**不报错、不影响构建**，页面上红红地列着，只是永远没人收到邮件
 * ——而它看起来完全正常。所以这条守卫不判「该不该告警」（那是 owner 的裁定），只判
 * **有没有人做过裁定**：算法的类别值域里每一类都必须在下面的 DECIDED 或 UNRULED 里明文归属。
 *
 * ── owner 的裁定（邮件这根轴）──
 *   confirm_payment    → 告警（2026-09-08：客户在等你确认收款，拖着就是拖客户的钱）
 *   reprovision        → 告警（2026-09-08：那天的事故正是它）
 *   follow_up_balance  → 不告警（2026-09-08：那一类在等客户，不在等运营）
 *   refund_audit       → 告警（2026-09-28：退款单挂着无人知，根治批加的正是这一类）
 * 2026-09-28 第三批把类别扩到十九类，裁定规则：**严重度恒为 rose 的推邮件，其余只上页面**
 * （逐类明文见下方 DECIDED）。verification / risk / ticket 三类从未被裁定过（它们不在
 * 2026-09-08 那次裁定的范围里，且 risk / ticket 的严重度随行变，那条规则对它们不成立），
 * 明写在 UNRULED——「没裁定」是写下来的状态，不是默认。要推告警先找 owner，再搬进 DECIDED。
 * 另有「自愈放弃」一条不在待办里，由 OrderService 在放弃点直接报（ops-alerter.ts）。
 *
 * ── 第二根轴：通告（2026-10-04 owner 裁定 3）──
 * 升档（等太久）的待办另写一条 critical 运营通告——与邮件裁定是两件事。此前只有四类有
 * 升档阈值、且通告半只覆盖 ALERT_KINDS：九类里六类升不了档，`verification` 升了档也没有
 * 通告（owner：「6/9 待办类别没有通告兜底」）。现在共享算法 SQL 里十类有阈值（ESCALATES），
 * 有阈值而不推邮件的类别走作业的 NOTICE_ONLY_KINDS（只写通告）。本文件第 7 段守的是：
 * **SQL 里真有阈值的类别 == ESCALATES，且 ESCALATES ⊆ ALERT_KINDS ∪ NOTICE_ONLY**——
 * 有阈值却两边都不在，就是「升档了也没人写通告」，正是 owner 说的那个洞，被做成了判据。
 * 邮件轴不动：NOTICE_ONLY 里的类别仍可以在 UNRULED（邮件半未裁），两轴独立。
 *
 * ── 还判七条对应关系 ──
 *   1. 作业实扫的类别（ops-todo-alert.job.ts 的 ALERT_KINDS）== 裁定要告警的类别。
 *   2. 共享算法确实从库里的原始订单态产出裁定要告警的订单类（`case o.status when … then …`）；
 *      其余告警类（与 NOTICE_ONLY 类）各有一张谓词字面清单（PREDICATE_LITERALS）——谓词漂了就红。
 *   3. admin-bff 的 mapEntityOrderStatus 仍把这些原始态一一映射到订单页的派生态——告警邮件
 *      链接落到的那一页就是按它显示的；映射一改，运营点开看到的就不是告警说的那一类。
 *   4. **作业那两拼 SQL 只碰 svc_platform_api 有权的关系**（2026-09-28 补）。Postgres 对语句里
 *      出现过的每一个关系查权限——哪一支返不返回行都一样。platform-api 的角色只有 7 个
 *      schema（97_service_roles.sql）加逐条写明的表级例外；往作业会拼进去
 *      的那几段片段里加一个 `account.` / `admin.` / `kyc.` / `session.` / `support.` 的 join，
 *      本机（owner 连库）照样全绿，生产上是 42501、整轮作业失败。这一段拿 97 的授权面
 *      对账片段文本，把那种改动挡在合并之前。
 *      **本段看不见什么**：只读片段的字面文本。片段里一旦出现 `${…}` 插值，插进来的那段
 *      本段读不到——碰到就报错而不是放行。真判据是 ops-todos.itest 里 `set role
 *      svc_platform_api` 之后跑作业那两个调用形状的那一条。
 *
 *      2026-09-28 第三批起，作业那一拼**合法地**碰表级例外（97 末尾逐条 GRANT SELECT，
 *      活库由 2026-11-23 那份迁移灌）：`support.tickets`（ticket_sla）、
 *      `admin.maintenance_windows`（maintenance_overdue）；2026-10-04 起 NOTICE_ONLY 那一拼
 *      碰 `kyc.tenant_verifications`（verification）。本段读 97 的实际授权面，
 *      所以这几张自动算「有权」，不必在这里另开白名单。
 *   5. **裁定要告警的每一类在 todoAlertInput 里都有文案**（2026-09-28 第三批补）。
 *      ALERT_KINDS 加一类不会让构建红，而 todoAlertInput 的 default 是 throw——
 *      于是症状是「这个作业一直失败」，不是「少了一封邮件」。反向也判：写了文案却没裁定的
 *      那个分支永远走不到。
 *   6. **升档阈值的两根轴对得上**（2026-10-04）：tail 里 `case x.kind when '<kind>' then $n`
 *      解析出的集合 == ESCALATES；ESCALATES ⊆ ALERT_KINDS ∪ NOTICE_ONLY；NOTICE_ONLY 与
 *      邮件裁定不重叠；作业真的把 NOTICE_ONLY_KINDS 传给 list 并调 noticeEscalatedTodo；
 *      每一类的阈值行与升档起点字面钉在 ESCALATION_LITERALS / PREDICATE_LITERALS。
 *   7. 本文件的 NOTICE_ONLY 与作业的 NOTICE_ONLY_KINDS 逐字相等（裁定表只有一份）。
 *   8. **services 包里抄的两张类别表与作业逐字相等**（2026-10-04 评审补）。itest 用
 *      `set role svc_platform_api` 实跑作业的两种调用形状——那是最小权限那件事的真判据；
 *      repository.spec 用假 pool 钉两拼的 SQL 文本。但 services 包不能依赖 bff，所以两处
 *      都只能抄一份 ALERT_KINDS / NOTICE_ONLY_KINDS。作业加了一类而复本没跟上，那些用例
 *      拿着旧表照样绿，新一类的片段从没在生产角色下跑过——恰是它们要抓的 42501。
 *      本段读 KIND_COPIES 里的每个文件，复本与作业对账（找不到声明 → 红，不是空集）。
 *   9. **两份文档逐字写着 `NOTICE_ONLY_KINDS` / `VERIFICATION_TODOS_`**（2026-10-04 评审补）。
 *      prettier 会把裸的下划线标识符当强调改写成 `NOTICE*ONLY_KINDS`——文档里就此指向一个
 *      不存在的名字，grep 零命中。标识符要用反引号包；本段读两份文档，缺了 / 被改写了都红。
 *
 * ── 看不见什么 ──
 *   · 阈值的**值**对不对（那是 env 与 owner 的事；两份 example 的相等由
 *     check-ops-threshold-env-parity 守）；
 *   · 通告真的落库了没有（去重键 / 平面在 operator-alerts.wiring.spec 与 notice 包的 itest）；
 *   · 升档的**起点**算得对不对（itest 逐类用「错的起点会得到另一个数」钉）。
 *
 * 用法：node scripts/guardrails/check-ops-todo-alerts.mjs
 *       node scripts/guardrails/check-ops-todo-alerts.mjs --self-test
 *   --self-test 用合成文本证第 6 段三态：SQL 里多一个没登记的阈值要红、登记表多一类要红、
 *   把 NOTICE_ONLY 清空（裁定 3 之前的现场：verification 有阈值没人扫）要红、复原要绿；
 *   再证第 8 / 9 段会动：itest 复本少一类要红、找不到复本要 null（不是空集）、
 *   文档里的标识符被 prettier 改写成 NOTICE*ONLY_KINDS 要红。
 */

import { readFileSync } from "node:fs";
import process from "node:process";

const ROOT = process.cwd();
const TYPES = `${ROOT}/services/ops/todos/src/types.ts`;
const REPO = `${ROOT}/services/ops/todos/src/repository/pg-ops-todo.repository.ts`;
const JOB = `${ROOT}/bff/platform-api/src/jobs/ops-todo-alert.job.ts`;
const WIRING = `${ROOT}/bff/platform-api/src/notifications/operator-alerts.wiring.ts`;
const MAPPER = `${ROOT}/bff/admin-bff/src/routers/orders.router.ts`;
const ROLES = `${ROOT}/deploy/database/ddl/97_service_roles.sql`;
const SCHEMAS = `${ROOT}/deploy/database/ddl/00_schemas.sql`;
/**
 * 第 8 段：services 包里抄了作业两张类别表的文件（它们不能 import bff 的常量）。
 * itest 用 `set role svc_platform_api` 实跑两种调用形状；spec 用假 pool 钉两拼的 SQL 文本。
 */
const KIND_COPIES = {
  "ops-todos.itest": `${ROOT}/services/ops/todos/src/repository/ops-todos.itest.spec.ts`,
  "pg-ops-todo.repository.spec": `${ROOT}/services/ops/todos/src/repository/pg-ops-todo.repository.spec.ts`,
};
/** 第 9 段：记录这条作业的两份文档，以及每份必须逐字出现的标识符。 */
const DOC_LITERALS = {
  "docs/30-design/data_platform_330_service-role-least-privilege.md": [
    "NOTICE_ONLY_KINDS",
    "VERIFICATION_TODOS_",
  ],
  "docs/40-implementation/packages/bff/60-platform-api.md": [
    "ALERT_KINDS",
    "NOTICE_ONLY_KINDS",
  ],
};

/**
 * 每一类待办在「不带富化块」那一拼里用到哪几段片段常量（pg-ops-todo.repository 里
 * 同名的 export）。作业传 includeApplicant: false，所以用 LEAN 那一版、不拼 RICH_JOINS。
 * 名字对不上（片段改名 / 删了）→ 抛，不是放行。
 */
const ORDER_LEAN = [
  "ORDER_TODOS_HEAD",
  "ORDER_TODOS_LEAN_COLUMNS",
  "ORDER_TODOS_FROM",
  "ORDER_TODOS_WHERE",
];
const REFUND_LEAN = [
  "REFUND_TODOS_HEAD",
  "REFUND_TODOS_LEAN_COLUMNS",
  "REFUND_TODOS_FROM",
  "REFUND_TODOS_WHERE",
];

const LEAN_PIECES = {
  confirm_payment: ORDER_LEAN,
  reprovision: ORDER_LEAN,
  follow_up_balance: ORDER_LEAN,
  order_pending_payment_aging: ORDER_LEAN,
  refund_audit: REFUND_LEAN,
  refund_execute: REFUND_LEAN,
  refund_processing_stuck: REFUND_LEAN,
  refund_failed: REFUND_LEAN,
  subscription_overdue: [
    "SUBSCRIPTION_TODOS_HEAD",
    "SUBSCRIPTION_TODOS_LEAN_COLUMNS",
    "SUBSCRIPTION_TODOS_FROM",
    "SUBSCRIPTION_TODOS_WHERE",
  ],
  invoice_applying: [
    "INVOICE_TODOS_HEAD",
    "INVOICE_TODOS_LEAN_COLUMNS",
    "INVOICE_TODOS_FROM",
    "INVOICE_TODOS_WHERE",
  ],
  invoice_approved: [
    "INVOICE_TODOS_HEAD",
    "INVOICE_TODOS_LEAN_COLUMNS",
    "INVOICE_TODOS_FROM",
    "INVOICE_TODOS_WHERE",
  ],
  addon_pending_confirm: [
    "ADDON_TODOS_HEAD",
    "ADDON_TODOS_LEAN_COLUMNS",
    "ADDON_TODOS_FROM",
    "ADDON_TODOS_WHERE",
  ],
  deletion_pending: [
    "USER_TODOS_HEAD",
    "USER_TODOS_LEAN_COLUMNS",
    "USER_TODOS_FROM",
    "USER_TODOS_WHERE",
  ],
  purge_imminent: [
    "USER_TODOS_HEAD",
    "USER_TODOS_LEAN_COLUMNS",
    "USER_TODOS_FROM",
    "USER_TODOS_WHERE",
  ],
  maintenance_overdue: [
    "MAINTENANCE_TODOS_HEAD",
    "MAINTENANCE_TODOS_COLUMNS",
    "MAINTENANCE_TODOS_FROM",
    "MAINTENANCE_TODOS_WHERE",
  ],
  ticket_sla: [
    "TICKET_TODOS_HEAD",
    "TICKET_TODOS_LEAN_COLUMNS",
    "TICKET_TODOS_FROM",
    "TICKET_TODOS_WHERE",
  ],
  // 2026-10-04 起认证有自己的片段，不再从 tenant_base 投影——底座的 HEAD 含
  // `${RISK_LEVEL_SUBQUERY}` 插值，留在这张表里会被第 4 段当场拒绝；拆段不是可选项。
  verification: [
    "VERIFICATION_TODOS_HEAD",
    "VERIFICATION_TODOS_LEAN_COLUMNS",
    "VERIFICATION_TODOS_FROM",
    "VERIFICATION_TODOS_WHERE",
  ],
  risk: [
    "TENANT_BASE_HEAD",
    "TENANT_BASE_LEAN_COLUMNS",
    "TENANT_BASE_FROM",
    "TENANT_BASE_WHERE",
    "RISK_TODOS_CTE",
  ],
  ticket: [
    "TICKET_TODOS_HEAD",
    "TICKET_TODOS_LEAN_COLUMNS",
    "TICKET_TODOS_FROM",
    "TICKET_TODOS_WHERE",
  ],
};

/** 每一拼都带的外层。 */
const SHARED_PIECES = ["LIST_OPS_TODOS_TAIL"];

/**
 * 待办类 → 是否告警（邮件）。owner 定；改这里等于改裁定。
 *
 * ── 2026-09-28 第三批的裁定规则 ──
 * owner 本轮的方针是「先把通知、信息、任务、提醒做全做多，后续再在订阅选择上做筛选」。
 * 落到告警上：**严重度恒为 rose 的类别推邮件，其余只上页面**。rose 在这套契约里的意思
 * 就是「有人在等，而且等的是钱或是服务」。逐个写出来而不是从算法里算：这是一张裁定表，
 * 谁要多发一封邮件就得在这里改一行，而不是顺手把某一类调红就自动开始发信。
 */
const DECIDED = {
  // 2026-09-08 那次裁定的三类。
  confirm_payment: true,
  reprovision: true,
  follow_up_balance: false, // 那一类在等客户，不在等运营
  // 2026-09-28 根治批。
  refund_audit: true,
  // 2026-09-28 第三批：退款链剩下的三格——钱已经该出去了，一格比一格更晚。
  refund_execute: true,
  refund_processing_stuck: true,
  refund_failed: true,
  // 加油包核销与工单首响超时：也是「客户在等我们动手」。
  addon_pending_confirm: true,
  ticket_sla: true,
  // 维护窗口过了计划结束时间还挂着：客户看到的是产品坏了。
  maintenance_overdue: true,
  // 以下只上页面（严重度不是 rose）。不是「忘了推」，是本轮规则的另一半：
  order_pending_payment_aging: false, // 一般档，等客户付钱，不值得半夜发信
  subscription_overdue: false, // 关注档，宽限期内客户仍在服务中
  invoice_applying: false, // 关注档，开票有自然节奏
  invoice_approved: false, // 同上
  deletion_pending: false, // 一般档，30 天保留期里慢慢办
  purge_imminent: false, // 关注档，还剩 3 天；到期由清扫作业执行，不需要人半夜起来
};

/**
 * 从未被裁定过（邮件）的类别：不告警，但这是「没人定过」，不是「定了不推」。
 *
 * 这三类的严重度**随行变**（风险档 high / 工单 p0 或 reopened 才 rose），所以第三批那条
 * 「恒 rose 就推」的规则对它们不成立——要推就得先定「哪一档推」，那是 owner 的裁定。
 * `ticket_sla` 不在此列：它是第三批新立的类别、恒 rose，问的事情也明确（首次响应已超时）。
 *
 * 2026-10-04 起 `verification` 虽然进了作业的 NOTICE_ONLY_KINDS（只写通告），**邮件半仍未裁**，
 * 所以它留在这里——两根轴独立，通告覆盖不替 owner 裁邮件。
 * ticket 的升档（「未结工单 N 小时无动静」）与 risk 的升档（要碰 admin.risk_records，被三份
 * 已合并迁移断言为 0 项权限）都 needsOwner，本表不自决。
 */
const UNRULED = ["verification", "risk", "ticket"];

/**
 * 升档阈值的登记表（2026-10-04 owner 裁定 3）：共享算法 tail 里**有升档阈值**的类别。
 * 升档 ⇒ 作业另写一条 critical 运营通告。通告这根轴与邮件裁定是两根轴：
 *   · 在 ALERT_KINDS 里的：邮件 + 通告两半都有（OperatorAlertsWiring.alertTodo）；
 *   · 在 NOTICE_ONLY 里的：只写通告（noticeEscalatedTodo），邮件半仍在 UNRULED。
 * 第 6 段判：SQL 解析出的集合 == 本表；本表 ⊆ ALERT_KINDS ∪ NOTICE_ONLY；
 * 往 tail 加一行 `when '<kind>'` 而不登记，或登记了却没给阈值，都红。
 */
const ESCALATES = [
  // 2026-09-28 第三批的四类。
  "confirm_payment",
  "refund_audit",
  "reprovision",
  "verification",
  // 2026-10-04 覆盖全加的六类（默认值是设计提议，owner 可调）。
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  "addon_pending_confirm",
  "ticket_sla",
  "maintenance_overdue",
];

/**
 * 只写通告、不发邮件的类别——与 ops-todo-alert.job 的 NOTICE_ONLY_KINDS 逐字相等（第 7 段）。
 * 条件：有升档阈值（在 ESCALATES）且邮件半未裁（不在 DECIDED 为 true 的集合）。
 * ticket（D6）与 risk（D7）等 owner 裁定，没进来。
 */
const NOTICE_ONLY = ["verification"];

/** 告警的订单类 → 它在库里的原始订单态（共享算法的 `case o.status` 保证）。 */
const RAW_STATUS = {
  confirm_payment: "pending_verify",
  reprovision: "paid",
};

/**
 * 不由订单态派生的告警类（以及只写通告的类）→ 它的谓词在共享算法里长什么样（逐字子串）。
 *
 * 为什么钉字面而不是「看得懂 SQL」：这一段要答的问题是「作业扫的还是不是当初裁定的那件事」。
 * 谓词一改（比如把 `refund_status = 'failed'` 换成别的），邮件照发、页面照红，只是发的不再
 * 是那一类——那种坏法不报错。字面断言粗，但它盯的正是那个会静默漂掉的地方。
 * 改谓词是正当的，那时**连这里一起改**，改动就被记在裁定表旁边。
 *
 * 2026-10-04 起三类的**升档起点**也钉在这里（它们不从等待起点算）：卡住的退款从
 * updated_at + $9 算、加油包从申报腿算、工单首响从破约时刻算。
 */
const PREDICATE_LITERALS = {
  refund_audit: [
    "'refund_audit'",
    "where (r.refund_status = 'pending' and r.audit_status in ('pending', 'approved'))",
  ],
  refund_execute: [
    "when r.audit_status  = 'approved'   then 'refund_execute'",
    "then coalesce(r.audit_at, r.updated_at)",
  ],
  refund_processing_stuck: [
    "when r.refund_status = 'processing' then 'refund_processing_stuck'",
    "when 'refund_processing_stuck'     then make_interval(hours => $9::int)",
    "then r.updated_at + make_interval(hours => $9::int) end as escalate_from",
  ],
  refund_failed: ["when r.refund_status = 'failed'     then 'refund_failed'"],
  addon_pending_confirm: [
    "'addon_pending_confirm'::text",
    "where ap.status = 'pending_payment'",
    "decl.declared_at",
    "where p.bill_id = ap.invoice_id and p.pay_status = 'pending_verify'",
  ],
  ticket_sla: [
    "case when sla.breached then 'ticket_sla' else 'ticket' end",
    "and k.first_response_at is null",
    "case when sla.breached then sla_at.deadline end",
  ],
  maintenance_overdue: [
    "'maintenance_overdue'::text",
    "where mw.status = 'in_progress' and mw.end_at < now()",
  ],
  verification: [
    "'verification'::text",
    "where t.deleted_at is null and t.verification_status = 'pending'",
    "from kyc.tenant_verifications tv",
  ],
};

/**
 * 每一类的阈值行在 tail 里长什么样（逐字子串，含参数位）。参数位是绑定顺序
 * （bindListOptions）与 SQL 的唯一对账点——$n 漂了，阈值就静默读成了另一类的值。
 */
const ESCALATION_LITERALS = {
  confirm_payment: "when 'confirm_payment' then $4::int * 3600",
  refund_audit: "when 'refund_audit'    then $5::int * 3600",
  reprovision: "when 'reprovision'     then $6::int * 60",
  verification: "when 'verification'    then $7::int * 86400",
  refund_execute: "when 'refund_execute'  then $10::int * 3600",
  refund_processing_stuck:
    "when 'refund_processing_stuck' then $11::int * 3600",
  refund_failed: "when 'refund_failed'   then $12::int * 3600",
  // 没有申报腿（escalate_from 为 null）连阈值都不给——否则会退回 created_at 算。
  addon_pending_confirm:
    "when 'addon_pending_confirm'\n                 then case when x.escalate_from is null then null else $13::int * 3600 end",
  ticket_sla: "when 'ticket_sla'      then $14::int * 3600",
  maintenance_overdue: "when 'maintenance_overdue' then $15::int * 60",
};

/** 「已等」从升档起点算、没有就退回等待起点——少了这一句，三类的起点改了也没用。 */
const ESCALATE_FROM_LITERAL =
  "extract(epoch from (now() - coalesce(x.escalate_from, x.waiting_since)))";

/** 原始订单态 → admin-bff 订单投影里的派生态（mapEntityOrderStatus 保证）。 */
const DERIVED = {
  pending_verify: "pending_verify",
  paid: "paid_unprovisioned",
};

/* ── 第 6 段的纯函数（--self-test 用合成文本喂反例，不碰真文件）────────────── */

/**
 * tail 里 `select nullif(case x.kind … end, 0)::numeric` 那一段解析出「SQL 里真有阈值的类别」。
 * 找不到那一段 → null（判据瞎了，调用方要 die，不是放行）。
 */
function escalatesInTail(repoText) {
  const block = repoText.match(
    /select nullif\(case x\.kind\n([\s\S]*?)\n\s*end, 0\)::numeric/,
  );
  if (!block) return null;
  return [...block[1].matchAll(/when '([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/**
 * 两根轴对账：返回问题清单（空 = 对得上）。
 * @param {object} p
 * @param {string[]} p.sqlKinds   tail 里解析出的类别
 * @param {string[]} p.registry   ESCALATES
 * @param {string[]} p.alertKinds 作业的 ALERT_KINDS
 * @param {string[]} p.noticeOnly 作业的 NOTICE_ONLY_KINDS
 * @param {string[]} p.alerting   DECIDED 为 true 的集合（邮件裁定）
 * @param {string[]} p.listed     OPS_TODO_KINDS 值域
 */
function escalationProblems({
  sqlKinds,
  registry,
  alertKinds,
  noticeOnly,
  alerting,
  listed,
}) {
  const out = [];
  const reg = [...registry].sort();
  const unregistered = sqlKinds.filter((k) => !reg.includes(k));
  const noThreshold = reg.filter((k) => !sqlKinds.includes(k));
  if (unregistered.length) {
    out.push(
      `共享算法 tail 里有升档阈值、却没登记在本文件 ESCALATES 的类别：${unregistered.join(", ")}\n` +
        "  → 阈值长在 SQL 里就会升档、就会有通告——有阈值的每一类都要在这里登记，才能对账它有没有人扫。",
    );
  }
  if (noThreshold.length) {
    out.push(
      `ESCALATES 登记了、而 tail 里没有阈值的类别：${noThreshold.join(", ")}\n` +
        "  → 登记表过期：那一类升不了档，登记在这里只会让人以为它有通告兜底。",
    );
  }
  const scannedAll = new Set([...alertKinds, ...noticeOnly]);
  const unscanned = reg.filter((k) => !scannedAll.has(k));
  if (unscanned.length) {
    out.push(
      `有升档阈值、却不在作业扫描集（ALERT_KINDS ∪ NOTICE_ONLY_KINDS）的类别：${unscanned.join(", ")}\n` +
        "  → 升档了也没有通告：页面上红着、运营台一条都没有，而且不报错——这正是 owner 2026-10-04 说的「没有通告兜底」。" +
        "推邮件的进 ALERT_KINDS（先找 owner 搬进 DECIDED），只写通告的进 NOTICE_ONLY_KINDS。",
    );
  }
  const overlap = noticeOnly.filter((k) => alerting.includes(k));
  if (overlap.length) {
    out.push(
      `NOTICE_ONLY 里有已裁定要推邮件的类别：${overlap.join(", ")}——它该在 ALERT_KINDS（邮件 + 通告），不该两边都在。`,
    );
  }
  const noticeNoThreshold = noticeOnly.filter((k) => !reg.includes(k));
  if (noticeNoThreshold.length) {
    out.push(
      `NOTICE_ONLY 里有没有升档阈值的类别：${noticeNoThreshold.join(", ")}——它永远升不了档，通告永远不会写（做了没接）。`,
    );
  }
  const unknown = [...reg, ...noticeOnly].filter((k) => !listed.includes(k));
  if (unknown.length) {
    out.push(
      `ESCALATES / NOTICE_ONLY 里有算法不产出的类别：${[...new Set(unknown)].join(", ")}`,
    );
  }
  return out;
}

/* ── 第 8 / 9 段的纯函数（--self-test 同样用合成文本喂反例）──────────────────── */

/**
 * 一段源码里 `const <name>… = [ "a", "b" ];`（export 可有可无）的字符串成员，排好序。
 * 找不到那条声明 → null（判据瞎了，调用方要 die，不是放行）。
 */
function kindListIn(src, name) {
  const block = src.match(
    new RegExp(`(?:export )?const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`),
  );
  if (!block) return null;
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
}

/**
 * 一份复本文件里的两张表与作业对账：返回问题清单（空 = 对得上）。
 * @param {string} label 复本文件（只用于报错）
 * @param {string} src   复本文件的文本
 * @param {{ ALERT_KINDS: string[], NOTICE_ONLY_KINDS: string[] }} job 作业里解析出的两张表
 */
function kindCopyProblems(label, src, job) {
  const out = [];
  for (const name of ["ALERT_KINDS", "NOTICE_ONLY_KINDS"]) {
    const copy = kindListIn(src, name);
    if (copy === null) {
      out.push(
        `${label} 里找不到 ${name} 的复本——` +
          "没有它，那边钉「作业那两拼」的用例就没在跑作业真传的类别。",
      );
      continue;
    }
    if (JSON.stringify(copy) !== JSON.stringify(job[name])) {
      out.push(
        `${label} 里的 ${name} 复本与作业对不上：\n` +
          `    复本：${copy.join(", ") || "（空）"}\n` +
          `    作业：${job[name].join(", ") || "（空）"}\n` +
          "  → 那边的用例拿着旧表照样绿，新一类的片段从没按作业真传的形状跑过（itest 里就是从没在生产角色下跑过）。",
      );
    }
  }
  return out;
}

/** 一个全大写词紧跟 `*` 再跟大写或反斜杠：prettier 把 `A_B_C` 改写成 `A*B_C` / `A*\*` 的痕迹。 */
const PRETTIER_MANGLED = /[A-Z]{2,}\*[A-Z\\]/;

/**
 * 一份文档逐字写着它该写的标识符，且没有被 prettier 改写的痕迹：返回问题清单。
 * @param {string} label 文档路径（只用于报错）
 * @param {string} text  文档文本
 * @param {string[]} literals 必须逐字出现的标识符
 */
function docIdentifierProblems(label, text, literals) {
  const out = [];
  for (const literal of literals) {
    if (!text.includes(literal)) {
      out.push(
        `${label} 里没有逐字出现 \`${literal}\`——它记录的正是这条作业，读者按这个名字去 grep 会零命中。`,
      );
    }
  }
  const mangled = text.match(PRETTIER_MANGLED);
  if (mangled) {
    out.push(
      `${label} 里有被 prettier 改写的标识符（${mangled[0]}…）：裸写的下划线被当成了强调。标识符要用反引号包。`,
    );
  }
  return out;
}

const problems = [];
const die = (msg) => {
  console.error(`${msg} —— 判据失效，拒绝给出通过结论`);
  process.exit(1);
};

// ── 1. 算法产出哪些类别 ──────────────────────────────────────────────────
const typesSrc = readFileSync(TYPES, "utf8");
const kindsBlock = typesSrc.match(
  /export const OPS_TODO_KINDS = \[([\s\S]*?)\] as const;/,
);
if (!kindsBlock)
  die("在 services/ops/todos 的 types.ts 里找不到 OPS_TODO_KINDS");
const listed = [...kindsBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
if (listed.length === 0) die("OPS_TODO_KINDS 解析出 0 个类别");

const ruled = new Set([...Object.keys(DECIDED), ...UNRULED]);
const undecided = listed.filter((k) => !ruled.has(k));
const stale = [...ruled].filter((k) => !listed.includes(k));
if (undecided.length) {
  problems.push(
    `待办算法新增了 ${undecided.length} 类，但没人裁定它要不要告警：\n    ` +
      undecided.join("\n    ") +
      "\n  → 请 owner 定「推 / 不推」，然后写进本文件的 DECIDED（推的还要接 ALERT_KINDS 与 alertTodo）。",
  );
}
if (stale.length) {
  problems.push(
    `DECIDED / UNRULED 里有算法已不产出的类别（裁定过期）：\n    ` +
      stale.join("\n    "),
  );
}
const both = Object.keys(DECIDED).filter((k) => UNRULED.includes(k));
if (both.length) {
  problems.push(`同一类别不能既在 DECIDED 又在 UNRULED：${both.join(", ")}`);
}

const alerting = Object.entries(DECIDED)
  .filter(([, on]) => on)
  .map(([k]) => k)
  .sort();

// ── 2. 作业实扫的类别 == 裁定要告警的类别；只写通告的那一拼也接上了 ───────────
const jobSrc = readFileSync(JOB, "utf8");
const repoSrc = readFileSync(REPO, "utf8");
const wiringSrc = readFileSync(WIRING, "utf8");

const parseKindList = (name) => {
  const list = kindListIn(jobSrc, name);
  if (list === null) die(`在 ops-todo-alert.job 里找不到 ${name}`);
  return list;
};
const scanned = parseKindList("ALERT_KINDS");
if (scanned.length === 0) die("ALERT_KINDS 解析出 0 个类别");
const noticeScanned = parseKindList("NOTICE_ONLY_KINDS");
const jobLists = { ALERT_KINDS: scanned, NOTICE_ONLY_KINDS: noticeScanned };
const copySrcs = Object.fromEntries(
  Object.entries(KIND_COPIES).map(([label, path]) => [
    label,
    readFileSync(path, "utf8"),
  ]),
);
const itestSrc = copySrcs["ops-todos.itest"];
const docTexts = Object.fromEntries(
  Object.keys(DOC_LITERALS).map((rel) => [
    rel,
    readFileSync(`${ROOT}/${rel}`, "utf8"),
  ]),
);

// ── --self-test：用合成文本证第 6 / 8 / 9 段会动，不碰真文件 ─────────────────────
if (process.argv.includes("--self-test")) {
  let bad = 0;
  let total = 0;
  const say = (ok, msg) => {
    total += 1;
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  console.log("══ 自检：第 6 段（升档阈值两根轴）看得见正例，并且会对反例说话 ══\n");

  const real = escalatesInTail(repoSrc);
  say(
    real !== null && real.length > 0,
    `tail 里解析出 ${real ? real.length : 0} 个有阈值的类别（${real ? real.join(" / ") : "没解析到"}）`,
  );
  const base = {
    sqlKinds: real ?? [],
    registry: ESCALATES,
    alertKinds: scanned,
    noticeOnly: NOTICE_ONLY,
    alerting,
    listed,
  };
  say(
    escalationProblems(base).length === 0,
    "正例：真文本 + 本文件登记表 → 0 条问题",
  );

  // 反例一：tail 里多一个没登记的阈值。
  const anchor = ESCALATION_LITERALS.maintenance_overdue;
  const injected = repoSrc.replace(
    anchor,
    `${anchor}\n               when 'subscription_overdue' then $16::int * 3600`,
  );
  say(injected !== repoSrc, "反例一能构造出来（找到了 maintenance_overdue 那一行阈值）");
  const injectedKinds = escalatesInTail(injected) ?? [];
  const p1 = escalationProblems({ ...base, sqlKinds: injectedKinds });
  say(
    injectedKinds.includes("subscription_overdue") &&
      p1.some((m) => m.includes("subscription_overdue")),
    `反例一：tail 里多一个 subscription_overdue 的阈值 → 报「没登记」（${p1.length} 条）`,
  );

  // 反例二：登记表多一类。
  const p2 = escalationProblems({
    ...base,
    registry: [...ESCALATES, "deletion_pending"],
  });
  say(
    p2.some((m) => m.includes("deletion_pending")),
    `反例二：ESCALATES 多登记 deletion_pending → 报「没有阈值 / 没人扫」（${p2.length} 条）`,
  );

  // 反例三：把 NOTICE_ONLY 清空 —— 这就是裁定 3 之前的现场（verification 有阈值、没人扫）。
  const p3 = escalationProblems({ ...base, noticeOnly: [] });
  say(
    p3.some((m) => m.includes("verification") && m.includes("没有通告兜底")),
    `反例三：NOTICE_ONLY 清空 → 报 verification 有阈值却没人扫（${p3.length} 条）`,
  );

  // 反例四：NOTICE_ONLY 与邮件裁定重叠。
  const p4 = escalationProblems({
    ...base,
    noticeOnly: [...NOTICE_ONLY, "confirm_payment"],
  });
  say(
    p4.some((m) => m.includes("confirm_payment")),
    `反例四：NOTICE_ONLY 混进已裁邮件的 confirm_payment → 报重叠（${p4.length} 条）`,
  );

  // 反例五：tail 那一段不见了 → 解析器要说「看不见」，不是回空集。
  say(
    escalatesInTail("select 1") === null,
    "反例五：找不到 case x.kind 那一段 → 返回 null（调用方 die），不是空集",
  );

  // 复原。
  say(
    escalationProblems(base).length === 0,
    "复原：真文本 + 本文件登记表 → 又是 0 条",
  );

  console.log("\n══ 自检：第 8 段（itest 的两份复本）══\n");
  say(
    Object.entries(copySrcs).every(
      ([label, src]) => kindCopyProblems(label, src, jobLists).length === 0,
    ),
    `正例：${Object.keys(copySrcs).join(" / ")} 的复本与作业两张表 → 0 条问题`,
  );
  // 反例六：作业多了一类（ticket 进了 NOTICE_ONLY_KINDS），itest 没跟上。
  const p6 = kindCopyProblems("ops-todos.itest", itestSrc, {
    ...jobLists,
    NOTICE_ONLY_KINDS: [...noticeScanned, "ticket"].sort(),
  });
  say(
    p6.some((m) => m.includes("NOTICE_ONLY_KINDS") && m.includes("ticket")),
    `反例六：作业 NOTICE_ONLY_KINDS 多一个 ticket、itest 复本没动 → 报对不上（${p6.length} 条）`,
  );
  // 反例七：itest 里那条声明不见了 → null，报「找不到复本」，不是当作空集通过。
  const gone = itestSrc.replace(/const NOTICE_ONLY_KINDS[^;]*;/, "");
  say(
    kindListIn(gone, "NOTICE_ONLY_KINDS") === null &&
      kindCopyProblems("ops-todos.itest", gone, jobLists).some((m) =>
        m.includes("找不到"),
      ),
    "反例七：itest 里删掉 NOTICE_ONLY_KINDS 的声明 → 解析得 null、报「找不到复本」",
  );

  console.log("\n══ 自检：第 9 段（文档里的标识符）══\n");
  const [docRel, docLiterals] = Object.entries(DOC_LITERALS)[0];
  const docText = docTexts[docRel];
  say(
    docIdentifierProblems(docRel, docText, docLiterals).length === 0,
    `正例：${docRel} 逐字写着 ${docLiterals.join(" / ")}`,
  );
  // 反例八：prettier 把裸标识符改写成强调——评审在 2026-10-04 那一行抓到的现场。
  const mangledDoc = docText
    .replace("`NOTICE_ONLY_KINDS`", "NOTICE*ONLY_KINDS")
    .replace("`VERIFICATION_TODOS_*`", "`VERIFICATION_TODOS*\\*`");
  const p8 = docIdentifierProblems(docRel, mangledDoc, docLiterals);
  say(
    mangledDoc !== docText &&
      p8.some((m) => m.includes("NOTICE_ONLY_KINDS")) &&
      p8.some((m) => m.includes("prettier")),
    `反例八：把文档里的两个标识符改写回 NOTICE*ONLY_KINDS / VERIFICATION_TODOS*\\* → 报缺名 + 改写痕迹（${p8.length} 条）`,
  );

  console.log(`\n── 汇总 ──\n看得见 ${total - bad}/${total} 项`);
  if (bad) {
    console.log("判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("正例绿、八种反例各自红、复原绿。这个判据可以用了。");
  process.exit(0);
}

if (JSON.stringify(alerting) !== JSON.stringify(scanned)) {
  problems.push(
    `告警作业扫描的类别与裁定对不上：\n` +
      `    裁定要告警的：${alerting.join(", ")}\n` +
      `    ALERT_KINDS 实扫：${scanned.join(", ")}`,
  );
}
if (!/kinds:\s*ALERT_KINDS/.test(jobSrc)) {
  problems.push(
    "ops-todo-alert.job 没有把 ALERT_KINDS 传给 OpsTodoRepository.list({ kinds })——常量在、没接上，等于没扫。",
  );
}
if (!/kinds:\s*NOTICE_ONLY_KINDS/.test(jobSrc)) {
  problems.push(
    "ops-todo-alert.job 没有把 NOTICE_ONLY_KINDS 单独传给 OpsTodoRepository.list({ kinds })——" +
      "常量在、没接上，等于没扫；而且必须是**另一拼**（limit 50 按 rose 优先，并进 ALERT 那拼会把 amber 行挤没）。",
  );
}
if (!/\.noticeEscalatedTodo\(/.test(jobSrc)) {
  problems.push(
    "ops-todo-alert.job 没有调 alerts.noticeEscalatedTodo——只写通告那一拼取回来了，却没写通告。",
  );
}
if (!/async noticeEscalatedTodo\(/.test(wiringSrc)) {
  problems.push(
    "operator-alerts.wiring 里没有 noticeEscalatedTodo——只写通告的类别没有落点。",
  );
}

// ── 3. 共享算法从原始态产出这些类 ────────────────────────────────────────
const caseBlock = repoSrc.match(/case o\.status\n([\s\S]*?)end\s+as kind/);
if (!caseBlock)
  die("在 pg-ops-todo.repository 里找不到 `case o.status … end as kind`");
const produced = new Map(
  [...caseBlock[1].matchAll(/when '([a-z_]+)'\s+then '([a-z_]+)'/g)].map(
    (m) => [m[2], m[1]],
  ),
);
if (produced.size === 0) die("订单态 → 待办类的 case 解析出 0 对");
for (const kind of [...alerting, ...NOTICE_ONLY]) {
  const literals = PREDICATE_LITERALS[kind];
  if (literals) {
    for (const needle of literals) {
      if (!repoSrc.includes(needle)) {
        problems.push(
          `共享算法里找不到 ${kind} 的谓词片段：\n      ${needle}\n` +
            "  → 谓词改了（或改名了）而裁定表没跟着改：作业还在扫这一类，扫的却不是当初裁定的那件事。" +
            "如果谓词是有意改的，请把本文件 PREDICATE_LITERALS 里这一条一起改。",
        );
      }
    }
    continue;
  }
  const raw = RAW_STATUS[kind];
  if (!raw) {
    problems.push(
      `${kind} 裁定要告警（或只写通告），但本文件的 RAW_STATUS / PREDICATE_LITERALS 里都没有它的谓词——` +
        "本段等于对那一类瞎了。新加一类就要在这里登记它的判据。",
    );
    continue;
  }
  if (produced.get(kind) !== raw) {
    problems.push(
      `共享算法不再把订单态 \`${raw}\` 产出为 \`${kind}\`（实际：${produced.get(kind) ?? "未产出"}）——` +
        "告警扫的就不是那一类了。",
    );
  }
}

// ── 4. admin-bff 投影仍把原始态映射到订单页的派生态 ──────────────────────
const mapperSrc = readFileSync(MAPPER, "utf8");
const mapper = mapperSrc.match(
  /function mapEntityOrderStatus\([\s\S]*?\n\}/,
)?.[0];
if (!mapper) die("在 orders.router 里找不到 mapEntityOrderStatus");
for (const [raw, derived] of Object.entries(DERIVED)) {
  const expected = new RegExp(`case "${raw}":\\s*\\n\\s*return "${derived}";`);
  if (!expected.test(mapper)) {
    problems.push(
      `mapEntityOrderStatus 不再把订单态 \`${raw}\` 映射成 \`${derived}\`——` +
        "告警邮件的链接落到订单页，那一页按这个映射显示；映射一断，运营点开看到的就不是告警说的那一类。",
    );
  }
}

// ── 5. 作业那两拼 SQL 只碰 svc_platform_api 有权的关系 ───────────────────────
// 先把 SQL 行注释剥掉再解析：注释掉的 GRANT 不是授权，裸匹配会把它当真的
// （97 里没有含 `--` 的字符串字面量，整行剥安全）。
const rolesSrc = readFileSync(ROLES, "utf8").replace(/--[^\n]*/g, "");
const schemaNames = [
  ...readFileSync(SCHEMAS, "utf8").matchAll(
    /CREATE SCHEMA IF NOT EXISTS (\w+);/g,
  ),
].map((m) => m[1]);
if (schemaNames.length === 0) die("在 00_schemas.sql 里解析出 0 个 schema");

const grantedSchemas = rolesSrc.match(
  /\('svc_platform_api'\s*,\s*ARRAY\[([^\]]*)\]\)/,
);
if (!grantedSchemas) {
  die("在 97_service_roles.sql 里找不到 svc_platform_api 的 schema 数组");
}
const allowedSchemas = new Set(
  [...grantedSchemas[1].matchAll(/'(\w+)'/g)].map((m) => m[1]),
);
if (allowedSchemas.size === 0)
  die("svc_platform_api 的 schema 数组解析出 0 项");

/** 表级例外：97 里逐条写明的 `GRANT … ON <schema>.<table> TO svc_platform_api;`。 */
const allowedRelations = new Set(
  [
    ...rolesSrc.matchAll(
      /GRANT [A-Z, ]+ ON (\w+)\.(\w+) TO svc_platform_api;/g,
    ),
  ].map((m) => `${m[1]}.${m[2]}`),
);
if (!allowedRelations.has("admin.operator_notices")) {
  problems.push(
    "97_service_roles.sql 里没有 `GRANT SELECT, INSERT ON admin.operator_notices TO svc_platform_api;`——" +
      "客户消息的运营镜像长在 NotificationDispatcher 里，platform-api 的作业每发一条客户消息都会走它；" +
      "少了这一行，镜像在生产上 42501 而且只记日志，运营端就是「一条都没有」且不报错。",
  );
}

const leanNames = new Set(SHARED_PIECES);
for (const kind of [...scanned, ...noticeScanned]) {
  const pieces = LEAN_PIECES[kind];
  if (!pieces) {
    die(
      `本文件的 LEAN_PIECES 里没有 ${kind} 的片段清单——新加了待办类就要在这里登记它拼哪几段，` +
        "否则本段等于对那一类瞎了",
    );
  }
  for (const name of pieces) leanNames.add(name);
}

for (const name of leanNames) {
  const piece = repoSrc.match(
    new RegExp("export const " + name + "(?::[^=]*)? = `([^`]*)`;"),
  );
  if (!piece) {
    die(
      `在 pg-ops-todo.repository 里找不到片段常量 ${name}（改名 / 删了 / 不再是模板串）——` +
        "本段读不到它就无法判定作业那条 SQL 碰了哪些关系",
    );
  }
  const text = piece[1];
  if (text.includes("${")) {
    problems.push(
      `片段 ${name} 里有 \${…} 插值——插进来的那段本守卫读不到，无法判定它碰了哪些关系。` +
        "作业会拼进去的片段（LEAN / HEAD / FROM / WHERE）请写成整块字面文本，富化块（RICH_*）不受此限。",
    );
    continue;
  }
  for (const m of text.matchAll(/([a-z_]+)\.([a-z_]+)/g)) {
    const [, schema, relation] = m;
    if (!schemaNames.includes(schema)) continue; // 表别名，不是 schema 限定
    const qualified = `${schema}.${relation}`;
    if (allowedSchemas.has(schema) || allowedRelations.has(qualified)) continue;
    problems.push(
      `告警作业会拼进去的片段 ${name} 引用了 \`${qualified}\`，而 svc_platform_api 没有 ` +
        `${schema} 的权限（97_service_roles.sql 给它的是：${[...allowedSchemas].sort().join(", ")}` +
        `，外加表级例外 ${[...allowedRelations].sort().join(" / ") || "（无）"}）。
` +
        "  → Postgres 对语句里出现过的每一个关系查权限，那一支返不返回行都一样：本机（owner 连库）" +
        "全绿，生产上是 42501、整轮作业失败。把这个 join 挪进富化块（RICH_*，只在 includeApplicant 时拼），" +
        "或者请 owner 扩 svc_platform_api 的授权面。",
    );
  }
}

// ── 6. 升档阈值：SQL 里有阈值的 == 登记的，且每一类都有人扫 ────────────────────
// 这一段补的是 2026-10-04 owner 点名的洞：阈值长在 SQL 里会让页面红、让 escalated 置真，
// 但通告只写给作业扫到的行——有阈值而没人扫，就是「升档了也没有通告」，而且不报错。
const sqlKinds = escalatesInTail(repoSrc);
if (sqlKinds === null) {
  die(
    "在 LIST_OPS_TODOS_TAIL 里找不到 `select nullif(case x.kind … end, 0)::numeric` 那一段——本段读不到阈值表",
  );
}
if (sqlKinds.length === 0) die("tail 的阈值 case 解析出 0 个类别");
problems.push(
  ...escalationProblems({
    sqlKinds,
    registry: ESCALATES,
    alertKinds: scanned,
    noticeOnly: noticeScanned,
    alerting,
    listed,
  }),
);
for (const kind of ESCALATES) {
  const needle = ESCALATION_LITERALS[kind];
  if (!needle) {
    problems.push(
      `${kind} 在 ESCALATES 里，但本文件的 ESCALATION_LITERALS 没有它的阈值行——参数位没人钉，$n 漂了也看不见。`,
    );
    continue;
  }
  if (!repoSrc.includes(needle)) {
    problems.push(
      `共享算法 tail 里找不到 ${kind} 的阈值行：\n      ${needle.replace(/\n\s*/g, " ")}\n` +
        "  → 参数位或单位改了而本文件没跟着改。有意改的话把 ESCALATION_LITERALS 这一条一起改（bindListOptions 的顺序也要对得上）。",
    );
  }
}
for (const kind of Object.keys(ESCALATION_LITERALS)) {
  if (!ESCALATES.includes(kind)) {
    problems.push(
      `ESCALATION_LITERALS 里有 ${kind} 的阈值行，但它不在 ESCALATES——登记表只有一份，两处对不上。`,
    );
  }
}
if (!repoSrc.includes(ESCALATE_FROM_LITERAL)) {
  problems.push(
    `共享算法 tail 里找不到升档起点那一句：\n      ${ESCALATE_FROM_LITERAL}\n` +
      "  → 「已等」不再从 escalate_from 算：加油包 / 工单首响 / 卡住退款的起点改了也没用。",
  );
}

// ── 7. 本文件的 NOTICE_ONLY == 作业的 NOTICE_ONLY_KINDS ─────────────────────────
if (JSON.stringify([...NOTICE_ONLY].sort()) !== JSON.stringify(noticeScanned)) {
  problems.push(
    `只写通告的类别两处对不上：\n` +
      `    本文件 NOTICE_ONLY：${[...NOTICE_ONLY].sort().join(", ") || "（空）"}\n` +
      `    作业 NOTICE_ONLY_KINDS：${noticeScanned.join(", ") || "（空）"}`,
  );
}

// ── 8'. services 包里抄的两张类别表与作业逐字相等（它们不能 import bff 的常量）──
for (const [label, src] of Object.entries(copySrcs)) {
  problems.push(...kindCopyProblems(label, src, jobLists));
}

// ── 9'. 两份文档逐字写着这条作业的标识符（prettier 会把裸下划线改写成强调）────
for (const [rel, literals] of Object.entries(DOC_LITERALS)) {
  problems.push(...docIdentifierProblems(rel, docTexts[rel], literals));
}

// ── 8. 裁定要告警的每一类在 todoAlertInput 里都有文案 ──────────────────────────
// 这一段补的是第三批才出现的洞：ALERT_KINDS 加一类、裁定表加一行，都不会让构建红；
// 而 todoAlertInput 的 default 分支是 `throw`——于是作业每轮扫到那一类就抛，
// 表现是「这个作业一直失败」，而不是「少了一封邮件」，排查时离现场很远。
const alertInputFn = wiringSrc.match(
  /export function todoAlertInput\([\s\S]*?\n\}/,
)?.[0];
if (!alertInputFn) {
  die("在 operator-alerts.wiring 里找不到 todoAlertInput");
}
for (const kind of alerting) {
  if (!alertInputFn.includes(`case "${kind}":`)) {
    problems.push(
      `${kind} 裁定要告警，但 todoAlertInput 里没有它的分支——作业扫到它会走 default 抛异常，` +
        "整轮告警失败（表现是「这个作业一直红」，不是「少了一封邮件」）。",
    );
  }
}
// 反过来：文案写了却没在裁定表里的，说明接线只做了一半（那个分支永远走不到）。
for (const m of alertInputFn.matchAll(/case "([a-z_]+)":/g)) {
  const kind = m[1];
  if (!alerting.includes(kind)) {
    problems.push(
      `todoAlertInput 里有 ${kind} 的邮件文案，但它不在裁定要告警的类别里（ALERT_KINDS 不扫它）——` +
        "那段文案永远不会被用到。要么把它接进裁定表，要么删掉。",
    );
  }
}

console.log("══ 运营待办告警一致性检查（check-ops-todo-alerts）══");
console.log(
  `待办算法产出 ${listed.length} 类（${listed.join(" / ")}），` +
    `裁定告警 ${alerting.length} 类（${alerting.join(" / ")}），` +
    `未裁定 ${UNRULED.length} 类（${UNRULED.join(" / ")}）；` +
    `有升档阈值 ${sqlKinds.length} 类（${sqlKinds.join(" / ")}），` +
    `只写通告 ${noticeScanned.length} 类（${noticeScanned.join(" / ") || "无"}）。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error("  ✗ " + p);
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log(
  "✓ 每一类都有明文归属，作业实扫 == 裁定，共享算法的原始态与 admin 投影的派生态一致，" +
    "作业那两拼只碰 svc_platform_api 有权的关系，有升档阈值的每一类都有人扫。",
);
console.log("\n── 汇总 ──\nerror: 0");
