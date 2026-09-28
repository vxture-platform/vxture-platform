#!/usr/bin/env node

/**
 * check-ops-todo-alerts.mjs — 运营待办：算法产出的每一类都有「推不推告警」的裁定（#231）。
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
 * ── owner 的裁定 ──
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
 * ── 还判五条对应关系 ──
 *   1. 作业实扫的类别（ops-todo-alert.job.ts 的 ALERT_KINDS）== 裁定要告警的类别。
 *   2. 共享算法确实从库里的原始订单态产出裁定要告警的订单类（`case o.status when … then …`）；
 *      其余告警类各有一张谓词字面清单（PREDICATE_LITERALS）——谓词漂了就红。
 *   3. admin-bff 的 mapEntityOrderStatus 仍把这些原始态一一映射到订单页的派生态——告警邮件
 *      链接落到的那一页就是按它显示的；映射一改，运营点开看到的就不是告警说的那一类。
 *   4. **作业那条 SQL 只碰 svc_platform_api 有权的关系**（2026-09-28 补）。Postgres 对语句里
 *      出现过的每一个关系查权限——哪一支返不返回行都一样。platform-api 的角色只有 7 个
 *      schema（97_service_roles.sql）加一张表级例外 admin.operator_notices；往作业会拼进去
 *      的那几段片段里加一个 `account.` / `admin.` / `kyc.` / `session.` / `support.` 的 join，
 *      本机（owner 连库）照样全绿，生产上是 42501、整轮作业失败。这一段拿 97 的授权面
 *      对账片段文本，把那种改动挡在合并之前。
 *      **本段看不见什么**：只读片段的字面文本。片段里一旦出现 `${…}` 插值，插进来的那段
 *      本段读不到——碰到就报错而不是放行。真判据是 ops-todos.itest 里 `set role
 *      svc_platform_api` 之后跑作业那个调用形状的那一条。
 *
 *      2026-09-28 第三批起，作业那一拼**合法地**碰两张表级例外（97 末尾逐条 GRANT SELECT，
 *      活库由 2026-11-23 那份迁移灌）：`support.tickets`（ticket_sla）与
 *      `admin.maintenance_windows`（maintenance_overdue）。本段读 97 的实际授权面，
 *      所以这两张自动算「有权」，不必在这里另开白名单。
 *   5. **裁定要告警的每一类在 todoAlertInput 里都有文案**（2026-09-28 第三批补）。
 *      ALERT_KINDS 加一类不会让构建红，而 todoAlertInput 的 default 是 throw——
 *      于是症状是「这个作业一直失败」，不是「少了一封邮件」。反向也判：写了文案却没裁定的
 *      那个分支永远走不到。
 *
 * 用法：node scripts/guardrails/check-ops-todo-alerts.mjs
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
  verification: [
    "TENANT_BASE_HEAD",
    "TENANT_BASE_LEAN_COLUMNS",
    "TENANT_BASE_FROM",
    "TENANT_BASE_WHERE",
    "VERIFICATION_TODOS_CTE",
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
 * 待办类 → 是否告警。owner 定；改这里等于改裁定。
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
 * 从未被裁定过的类别：不告警，但这是「没人定过」，不是「定了不推」。
 *
 * 这三类的严重度**随行变**（风险档 high / 工单 p0 或 reopened 才 rose），所以第三批那条
 * 「恒 rose 就推」的规则对它们不成立——要推就得先定「哪一档推」，那是 owner 的裁定。
 * `ticket_sla` 不在此列：它是第三批新立的类别、恒 rose，问的事情也明确（首次响应已超时）。
 */
const UNRULED = ["verification", "risk", "ticket"];

/** 告警的订单类 → 它在库里的原始订单态（共享算法的 `case o.status` 保证）。 */
const RAW_STATUS = {
  confirm_payment: "pending_verify",
  reprovision: "paid",
};

/**
 * 不由订单态派生的告警类 → 它的谓词在共享算法里长什么样（逐字子串）。
 *
 * 为什么钉字面而不是「看得懂 SQL」：这一段要答的问题是「作业扫的还是不是当初裁定的那件事」。
 * 谓词一改（比如把 `refund_status = 'failed'` 换成别的），邮件照发、页面照红，只是发的不再
 * 是那一类——那种坏法不报错。字面断言粗，但它盯的正是那个会静默漂掉的地方。
 * 改谓词是正当的，那时**连这里一起改**，改动就被记在裁定表旁边。
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
  ],
  refund_failed: ["when r.refund_status = 'failed'     then 'refund_failed'"],
  addon_pending_confirm: [
    "'addon_pending_confirm'::text",
    "where ap.status = 'pending_payment'",
  ],
  ticket_sla: [
    "case when sla.breached then 'ticket_sla' else 'ticket' end",
    "and k.first_response_at is null",
  ],
  maintenance_overdue: [
    "'maintenance_overdue'::text",
    "where mw.status = 'in_progress' and mw.end_at < now()",
  ],
};

/** 原始订单态 → admin-bff 订单投影里的派生态（mapEntityOrderStatus 保证）。 */
const DERIVED = {
  pending_verify: "pending_verify",
  paid: "paid_unprovisioned",
};

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

// ── 2. 作业实扫的类别 == 裁定要告警的类别 ─────────────────────────────────
const jobSrc = readFileSync(JOB, "utf8");
const alertKindsBlock = jobSrc.match(
  /export const ALERT_KINDS[^=]*=\s*\[([\s\S]*?)\];/,
);
if (!alertKindsBlock) die("在 ops-todo-alert.job 里找不到 ALERT_KINDS");
const scanned = [...alertKindsBlock[1].matchAll(/"([a-z_]+)"/g)]
  .map((m) => m[1])
  .sort();
if (scanned.length === 0) die("ALERT_KINDS 解析出 0 个类别");
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

// ── 3. 共享算法从原始态产出这些类 ────────────────────────────────────────
const repoSrc = readFileSync(REPO, "utf8");
const caseBlock = repoSrc.match(/case o\.status\n([\s\S]*?)end\s+as kind/);
if (!caseBlock)
  die("在 pg-ops-todo.repository 里找不到 `case o.status … end as kind`");
const produced = new Map(
  [...caseBlock[1].matchAll(/when '([a-z_]+)'\s+then '([a-z_]+)'/g)].map(
    (m) => [m[2], m[1]],
  ),
);
if (produced.size === 0) die("订单态 → 待办类的 case 解析出 0 对");
for (const kind of alerting) {
  const literals = PREDICATE_LITERALS[kind];
  if (literals) {
    for (const needle of literals) {
      if (!repoSrc.includes(needle)) {
        problems.push(
          `共享算法里找不到 ${kind} 的谓词片段：\n      ${needle}\n` +
            "  → 谓词改了（或改名了）而裁定表没跟着改：作业还在发这一类的邮件，扫的却不是当初裁定的那件事。" +
            "如果谓词是有意改的，请把本文件 PREDICATE_LITERALS 里这一条一起改。",
        );
      }
    }
    continue;
  }
  const raw = RAW_STATUS[kind];
  if (!raw) {
    problems.push(
      `${kind} 裁定要告警，但本文件的 RAW_STATUS / PREDICATE_LITERALS 里都没有它的谓词——` +
        "本段等于对那一类瞎了。新加一类告警就要在这里登记它的判据。",
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

// ── 5. 作业那条 SQL 只碰 svc_platform_api 有权的关系 ─────────────────────────
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
for (const kind of scanned) {
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

// ── 6. 裁定要告警的每一类在 todoAlertInput 里都有文案 ──────────────────────────
// 这一段补的是第三批才出现的洞：ALERT_KINDS 加一类、裁定表加一行，都不会让构建红；
// 而 todoAlertInput 的 default 分支是 `throw`——于是作业每轮扫到那一类就抛，
// 表现是「这个作业一直失败」，而不是「少了一封邮件」，排查时离现场很远。
const wiringSrc = readFileSync(WIRING, "utf8");
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
    `未裁定 ${UNRULED.length} 类（${UNRULED.join(" / ")}）。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error("  ✗ " + p);
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log(
  "✓ 每一类都有明文归属，作业实扫 == 裁定，共享算法的原始态与 admin 投影的派生态一致，" +
    "作业那一拼只碰 svc_platform_api 有权的关系。",
);
console.log("\n── 汇总 ──\nerror: 0");
