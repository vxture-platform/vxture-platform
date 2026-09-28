/**
 * audit-event-signals.ts — 运营动作巡检的白名单与 SQL（第二批，owner 2026-09-28）。
 * @package @vxture/bff-platform-api
 *
 * 运营做过的每一次写操作都落 `support.audit_logs`（三个运营门户共写同一张表：
 * opera / admin / arche，`actor_console` 区分来源）。所以「运营侧信息完整」这半边
 * 不需要在每个 router 里插通知代码——扫审计表就够了，一行一条通告。
 *
 * ── 白名单，不是全量 ──
 * `AUDIT_ACTION_RULES` 是 `Record<动作码, {planes, severity, title}>`。**不在表里的
 * 动作码直接跳过，不报错**——审计表里天天有新码（新 router、新动作），把「没登记」
 * 当失败会让这条巡检天天红，而红的原因跟它自己无关。
 *
 * ── 收录判据：主体叫得出名字 ──
 * 一条通告说「运营账号已停用」却说不出是哪个账号，是没有信息量的噪音，不是完整性。
 * 所以只收**主体能从本进程读得到的表里解出可视码或名称**的动作码。据此纳入：
 *   · `governance.maintenance.*`（窗口标题 ← admin.maintenance_windows）
 *   · `catalog.product.*` / `product.*`（产品码 / 套餐码 ← 审计行自己写的可视码）
 *   · `tenant.*`（租户名 + T- 码 ← tenancy.tenants，admin-bff 写了 tenant_id；
 *     成员类还解出那个人的 U- 码 ← account.users，见下「成员类的宾语是两个人」）
 *   · `account.*`（U- 码 ← account.users）
 *   · `governance.risk.create`（租户 ← after->>'tenantId'，契约 B 段第 5 行的「风险变更」；
 *     同族另外三个码解不出租户，落选，见下）
 * 据此排除（每条都点名，不是忘了）：
 *   · `atlas.*` / `runos.*`（上游产品仓的模型 / 能力登记代理，约 50 个码、量最大，
 *     且契约 B 段的五个族没有列它们）——要加就是一族一行的事。
 *   · `operator.account.*` / `operator.role.*` / `operator.permission.*` /
 *     `governance.feature_flag.*` / `governance.compliance.*` / `platform.setting.update`
 *     ——主体分别住在 `admin.operator_account` / `admin.operator_role` /
 *     `admin.feature_flags` / `admin.compliance_events`，本进程角色都读不到
 *     （前者更是被 2026-11-21 那份 grant 迁移的审计段显式断言为 0 项权限），
 *     收进来只能产出「某个东西被改了」这种说不出宾语的通告。
 *   · `governance.operator_notice.create/withdraw`——为「发了一条通告」再发一条通告，
 *     而那条通告就在同一块板上。
 *   · 契约 B 段第 4 行的 `subscription.*` / `order.*` 运营代客户动作：admin-bff 的
 *     subscriptions / orders / payments / invoices 四个 router **一个都没有调
 *     insertOperatorAuditLog**（2026-09-28 查实：admin-bff 只有 accounts / products /
 *     tenants 三个 router 写审计）。登记一个永不被写出的码，等于造一个永远空的筛选项。
 *   · `governance.risk.update` / `.review` / `.delete`——**解不出租户**：arche-bff 的
 *     审计写入连 tenant_id 这一列都没有（bff/arche-bff/src/audit/audit-log.ts 的
 *     INSERT 列表里就没有它），而这三处的 after 里也没有 tenantId（分别只有
 *     riskLevel/riskScore、reviewerId、空）。照本文件自己的收录判据，它们只会产出
 *     「租户风险标记已变更」这种说不出是谁的通告，所以落选；`.create` 的 after 写了
 *     tenantId，留它。要把另外三个收回来，得先由 arche-bff 在那三处 after 里补
 *     tenantId（一行的事，但不在本进程这一侧）。
 *   · `tenant.member.invite`——**不是运营动作**：全仓只有 console-bff 的客户自助
 *     （actor_type='customer'）写这个码，admin-bff 没有邀请成员的端点（2026-09-28
 *     grep 全仓：写者只有 bff/console-bff/src/routers/iam.router.ts 一处）。
 *   · `catalog.product.state`——契约 B 段提过这个码，**仓里不存在**（grep 全仓 0 命中）。
 *     产品上线 / 停用 / 退役观测得到，但走的是另一个码：admin-bff 改产品内容那一处
 *     把 release_stage 写进 `product.content.update` 的 before/after（products.router
 *     的 PATCH），而那个码已经在白名单里。所以这里不是漏了一族，是契约写了个别名。
 *
 * ── 只收 actor_type='operator' ──
 * `support.audit_logs` 不是运营专用表：console-bff 的 `auditCustomerAction`
 * （bff/console-bff/src/audit/audit-log.ts）以 `actor_type='customer'` +
 * `actor_console='console'` 往同一张表写**客户自助**动作，而两边的码真的撞——
 * `tenant.member.remove`：客户自己在控制台移除团队成员写它，运营在 admin 替租户移除
 * 成员也写它。不按主体类型过滤，客户那一行会被当成运营动作播到运营板上，主语还会被
 * 解析成那个客户。所以谓词写在 `actor_type` 上，而**不是** `actor_console`：
 * actor_type 有 DDL 约束（chk_audit_logs_actor_type 只允许四个值），三个运营门户的
 * 审计写入都把它写死成 'operator'；actor_console 是无约束可空 varchar(32)，72_support
 * 的注释明说非控制台发起的行就该是 NULL，按它的三个字面值过滤，将来第四个运营面一上线
 * 就会静默漏掉整整一个面——而漏掉的那些不报错。
 *
 * ── 只收 result='success' ──
 * `denied` / `failure` 行照这里的标题会说成「维护开始」，而那件事根本没发生。
 * 被拒的运营写操作是另一条线（安全审计），标题句式也不一样，不混进来。
 *
 * ── 成员类的宾语是两个人 ──
 * `tenant.member.role_change` / `.remove` / `.suspend` 的 `resource_type` 是
 * **`tenant_member`**（不是 `account_user`），`resource_id` 是那个成员的 user id，
 * 另有 tenant_id 一列。所以宾语拼成「租户（T- 码）的成员 U- 码」：只说 U- 码，读的人
 * 不知道是哪个租户里的谁；只说租户，就跟 `tenant.suspend` 那种整租户动作分不开。
 *
 * ── 操作者显示名：一律角色称谓 ──
 * 审计行只有 `actor_id`（uuid）+ `actor_type`。运营者的显示名在 `admin.operator_account`
 * 里，而本进程的库角色 `svc_platform_api` 被 `2026-11-21-platform-api-operator-notices-grant.sql`
 * 的审计段**显式断言为在该表上 0 项权限**；授它 SELECT 会让那份已合并的迁移在下一次
 * 全量重放时抛 EXCEPTION。所以运营者一律回落成按 `actor_console` 分的角色称谓
 * （「运维台操作员」/「运营台操作员」/「治理台操作员」）。客户的真名不用解了——本巡检
 * 只取 `actor_type='operator'` 的行（见上），account.users 那两个 LEFT JOIN 一行都
 * 匹配不到，已经拆掉。要显示运营者真名，需要 owner 先放宽那条断言——之后这里只多一个
 * LEFT JOIN。**绝不退而求其次把 uuid 放进正文**：那是全站铁律。
 *
 * ── 一事一条 ──
 * 去重锚 = `reference_type='operator_action'` + `reference_id='audit:{audit_logs.id}'`。
 * 审计行是 append-only，所以一行恒对一条通告，回看窗口重叠无害。
 *
 * 白名单与 `scripts/guardrails/check-audit-actions.mjs` 的关系：那道守卫盯的是
 * **console-bff（客户侧）** 的动作码与客户审计页的目录是否一致，与本表不是同一个集合；
 * 本表的码来自 opera-bff / admin-bff / arche-bff 的 router（2026-09-28 逐个 grep 核过）。
 */
import { formatPrincipalNo } from "@vxture-platform/shared";
import type {
  CreateSystemNoticeInput,
  NoticePlane,
  NoticeSeverity,
} from "@vxture/service-notice";

export const AUDIT_REFERENCE_TYPE = "operator_action";

/** info 类 30 天后退出列表；warning 不过期（与业务事件巡检同口径）。 */
export const AUDIT_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuditActionRule {
  readonly planes: readonly NoticePlane[];
  readonly severity: NoticeSeverity;
  /** 标题的主句；宾语（可视码 / 名称）由 composeAuditNotice 拼在后面。 */
  readonly title: string;
}

/** 巡检读回的一行审计（列名即 SQL 的 alias）。 */
export interface AuditSignalRow {
  readonly id: string;
  readonly action: string;
  readonly actor_type: string;
  readonly actor_console?: string | null;
  /** 库里按 Asia/Shanghai 格式化到秒的时刻串（见 SQL 注释）。 */
  readonly occurred_text: string;
  /** 审计行自己写的资源类别——`tenant_member` 那类的宾语要连租户一起说。 */
  readonly resource_type?: string | null;
  /** 审计行自己写下的可视键（resource_id 不是 uuid 时就是它）。 */
  readonly literal_key?: string | null;
  readonly window_title?: string | null;
  readonly product_code?: string | null;
  readonly user_no?: string | null;
  readonly tenant_no?: string | null;
  readonly tenant_name?: string | null;
}

const PLANES_OPERA_ADMIN: readonly NoticePlane[] = ["opera", "admin"];
const PLANES_OPERA: readonly NoticePlane[] = ["opera"];
const PLANES_ADMIN: readonly NoticePlane[] = ["admin"];

/**
 * 白名单。planes 按动作归属（契约 B 段的五个族），severity 只在 info / warning
 * 两档里选——critical 留给运维事故，一次运营动作不占那一档。
 * warning 的判据统一为「这件事收不回来或挡住了客户」：删除、停用、驳回、强制上线、
 * 进入维护、风险标记。其余 info。
 */
export const AUDIT_ACTION_RULES: Readonly<Record<string, AuditActionRule>> = {
  // ── 维护窗口（opera-bff / governance）──────────────────────────────────────
  "governance.maintenance.create": {
    planes: PLANES_OPERA_ADMIN,
    severity: "info",
    title: "维护窗口已创建",
  },
  "governance.maintenance.update": {
    planes: PLANES_OPERA_ADMIN,
    severity: "info",
    title: "维护窗口已调整",
  },
  "governance.maintenance.start": {
    planes: PLANES_OPERA_ADMIN,
    severity: "warning",
    title: "维护开始",
  },
  "governance.maintenance.complete": {
    planes: PLANES_OPERA_ADMIN,
    severity: "info",
    title: "维护结束",
  },
  "governance.maintenance.cancel": {
    planes: PLANES_OPERA_ADMIN,
    severity: "info",
    title: "维护窗口已取消",
  },
  // ── 产品目录（opera-bff / catalog）─────────────────────────────────────────
  "catalog.product.maintenance_start": {
    planes: PLANES_OPERA_ADMIN,
    severity: "warning",
    title: "产品进入维护",
  },
  "catalog.product.maintenance_complete": {
    planes: PLANES_OPERA_ADMIN,
    severity: "info",
    title: "产品维护结束",
  },
  "catalog.product.launch_override": {
    planes: PLANES_OPERA_ADMIN,
    severity: "warning",
    title: "产品强制上线（跳过未完成的接入项）",
  },
  "catalog.product.delete": {
    planes: PLANES_OPERA_ADMIN,
    severity: "warning",
    title: "产品已删除",
  },
  // ── 产品内容与套餐（admin-bff；契约 B 段第 3 行定 planes=opera）────────────
  "product.content.update": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "产品内容已更新",
  },
  "product.catalog.reorder": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "产品排序已调整",
  },
  "product.plan.create": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐已创建",
  },
  "product.plan.update": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐已修改",
  },
  "product.plan.visibility": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐可见性已调整",
  },
  "product.plan.deprecate": {
    planes: PLANES_OPERA,
    severity: "warning",
    title: "套餐已停用",
  },
  "product.plan.delete": {
    planes: PLANES_OPERA,
    severity: "warning",
    title: "套餐已删除",
  },
  "product.plan_version.create": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐版本已创建",
  },
  "product.plan_version.publish": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐版本已发布",
  },
  "product.plan_version.delete": {
    planes: PLANES_OPERA,
    severity: "warning",
    title: "套餐版本已删除",
  },
  "product.plan_version.bundled.replace": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "套餐捆绑组件已替换",
  },
  "product.solution.create": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案已创建",
  },
  "product.solution.update": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案已修改",
  },
  "product.solution.state": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案状态已变更",
  },
  "product.solution.delete": {
    planes: PLANES_OPERA,
    severity: "warning",
    title: "解决方案已删除",
  },
  "product.solution.products.replace": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案产品已替换",
  },
  "product.solution.plan.bind": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案已绑定套餐",
  },
  "product.solution.plan.unbind": {
    planes: PLANES_OPERA,
    severity: "info",
    title: "解决方案已解绑套餐",
  },
  // ── 租户（admin-bff）──────────────────────────────────────────────────────
  "tenant.verification.approve": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "企业认证已通过",
  },
  "tenant.verification.reject": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "企业认证已驳回",
  },
  "tenant.suspend": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "租户已暂停",
  },
  "tenant.resume": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "租户已恢复",
  },
  "tenant.update": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "租户资料已修改",
  },
  "tenant.brand_reset": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "租户品牌已重置",
  },
  "tenant.operator_notes.update": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "租户运营备注已更新",
  },
  // tenant.member.invite 不在这里：只有 console-bff 的客户自助写它（见文件头注）。
  "tenant.member.role_change": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "租户成员角色已变更",
  },
  "tenant.member.remove": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "租户成员已移除",
  },
  "tenant.member.suspend": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "租户成员已停用",
  },
  // ── 客户账号（admin-bff）──────────────────────────────────────────────────
  "account.disable": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "客户账号已停用",
  },
  "account.enable": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "客户账号已启用",
  },
  "account.force_logout": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "客户账号已强制下线",
  },
  "account.avatar_reset": {
    planes: PLANES_ADMIN,
    severity: "info",
    title: "客户头像已重置",
  },
  // ── 租户风险（arche-bff / governance；契约 B 段第 5 行的「风险变更」）──────
  // 只有 .create 的 after 写了 tenantId，所以只有它解得出宾语；同族的
  // .update / .review / .delete 连租户都说不出来，按本文件的收录判据落选（见头注）。
  "governance.risk.create": {
    planes: PLANES_ADMIN,
    severity: "warning",
    title: "租户风险标记已建立",
  },
};

/** 白名单的键，作为 SQL 的 `action = any($2)` 参数——过滤在库里做，不在内存里做。 */
export const AUDIT_WHITELIST_CODES: readonly string[] =
  Object.keys(AUDIT_ACTION_RULES);

/**
 * 审计巡检 SQL。$1 = 回看分钟数，$2 = 白名单动作码数组，$3 = 本轮上限。
 *
 * 四处需要解释的写法：
 *  · `actor_type = 'operator'` 是**必需的**谓词，不是保险：同一张表还装着 console-bff
 *    写的客户自助动作，两边的码撞（`tenant.member.remove`）。为什么按 actor_type 而不是
 *    actor_console，见文件头注「只收 actor_type='operator'」。
 *  · `resource_id` 是 varchar(128)，里面**有时是 uuid、有时是可视码**（例如
 *    catalog.product.delete 写的是 product_code，launch_override 写的是产品 uuid）。
 *    直接 `::uuid` 会在可视码那些行上抛 22P02，所以先用正则挡一道，只对形状对得上的
 *    行做转换；CASE 是惰性求值的，不匹配的行根本不会走到那个 cast。
 *  · 解 U- 码的那个 join 收**两个** resource_type：admin-bff 处置账号写的
 *    `account_user`，以及成员类动作（role_change / remove / suspend）写的
 *    `tenant_member`——后者的 resource_id 也是 user id（tenants.router 的注释里
 *    写明了「resourceId 取成员的 user_id」）。只认前一个，成员类动作的通告就只剩
 *    租户名，说不出是谁被改了角色。
 *  · 时刻串在**库里**用 to_char 拼（`Asia/Shanghai`，到秒）。进程侧不手搓日期格式
 *    ——`check-datetime-discipline` 盯着这件事，而这条正文进的是库里的一列数据，
 *    不该带 locale 口音；秒必须留（同一分钟内的先后顺序恰恰最要紧）。
 */
export const AUDIT_SWEEP_SQL = `
  with picked as (
    select a.id::text as id,
           a.action as action,
           a.actor_type as actor_type,
           a.actor_console as actor_console,
           a.actor_id as actor_id,
           a.tenant_id as tenant_id,
           a.resource_type as resource_type,
           a.resource_id as resource_id,
           a.after as after,
           to_char(a.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as occurred_text
      from support.audit_logs a
     where a.created_at > now() - make_interval(mins => $1::int)
       and a.actor_type = 'operator'
       and a.result = 'success'
       and a.action = any($2::text[])
     order by a.created_at asc
     limit $3::int
  ),
  keyed as (
    select p.*,
           case when p.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then p.resource_id::uuid end as resource_uuid,
           case when coalesce(p.after->>'tenantId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (p.after->>'tenantId')::uuid end as after_tenant_uuid
      from picked p
  )
  select k.id as id,
         k.action as action,
         k.actor_type as actor_type,
         k.actor_console as actor_console,
         k.occurred_text as occurred_text,
         k.resource_type as resource_type,
         case when k.resource_uuid is null then k.resource_id end as literal_key,
         mw.title as window_title,
         pr.product_code as product_code,
         au.user_no::text as user_no,
         tn.tenant_no::text as tenant_no,
         coalesce(nullif(tn.display_name, ''), tn.name) as tenant_name
    from keyed k
    left join tenancy.tenants tn
      on tn.id = coalesce(k.tenant_id, k.after_tenant_uuid)
    left join account.users au
      on k.resource_type in ('account_user', 'tenant_member')
     and au.id = k.resource_uuid
    left join product.products pr
      on k.resource_type = 'product' and pr.id = k.resource_uuid
    left join admin.maintenance_windows mw
      on k.resource_type = 'maintenance_window' and mw.id = k.resource_uuid
   order by k.occurred_text asc
`;

/** 去重键：审计行是 append-only，一行恒一条。 */
export function auditDedupeKey(auditId: string): string {
  return `audit:${auditId}`;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function join(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((p) => text(p))
    .filter((p) => p.length > 0)
    .join(" · ");
}

/** 按 actor_console 分的角色称谓——运营者真名读不到（见文件头注）。 */
const OPERATOR_BY_CONSOLE: Readonly<Record<string, string>> = {
  opera: "运维台操作员",
  admin: "运营台操作员",
  arche: "治理台操作员",
};

/**
 * 正文的主语。按身份给称谓，绝不放 uuid。
 *
 * 走到的实际只有第一支：SQL 与 composeAuditNotice 两处都只放 `actor_type='operator'`
 * 的行过。另外三支是形状兜底——本函数是导出的，而「把非运营主体叫成运营人员」正是
 * 这一轮改掉的那个缺陷，所以宁可它自己也说得出「客户」「系统」。
 */
export function auditActorLabel(row: AuditSignalRow): string {
  switch (text(row.actor_type)) {
    case "operator":
      return OPERATOR_BY_CONSOLE[text(row.actor_console)] ?? "运营人员";
    case "customer":
      return "客户";
    case "system":
      return "系统";
    case "api":
      return "接口调用方";
    default:
      return "未知主体";
  }
}

/** 租户那一段：`示例科技（T-…）` / 只有名 / 只有码 / 什么都没有就 null。 */
function tenantLabel(row: AuditSignalRow): string | null {
  const name = text(row.tenant_name);
  const no = formatPrincipalNo(text(row.tenant_no) || null, "tenant");
  if (name.length > 0) return no === null ? name : `${name}（${no}）`;
  return no;
}

/**
 * 标题的宾语。优先用审计行自己写下的可视键（写的人挑的就是给人看的那个），
 * 其次按资源类别解出来的名称 / 可视码。一个都解不出就返回 null，标题只剩主句
 * ——**宁可没有宾语，也不把 uuid 放上屏**。
 *
 * 成员类动作（`resource_type='tenant_member'`）是唯一要说两个主体的一类：
 * 「租户（T- 码）的成员 U- 码」。只说 U- 码答不出「哪个租户里的」，只说租户又跟
 * `tenant.suspend` 那种整租户动作分不开。
 */
export function auditDisplayKey(row: AuditSignalRow): string | null {
  const literal = text(row.literal_key);
  if (literal.length > 0) return literal;
  const window = text(row.window_title);
  if (window.length > 0) return window;
  const product = text(row.product_code);
  if (product.length > 0) return product;
  const user = formatPrincipalNo(text(row.user_no) || null, "user");
  const tenant = tenantLabel(row);
  if (user !== null) {
    return text(row.resource_type) === "tenant_member" && tenant !== null
      ? `${tenant}的成员 ${user}`
      : user;
  }
  return tenant;
}

/**
 * 链接。**只在通告只投一个平面时给**：同一条通告在 opera 与 admin 的路由不是同一
 * 条（产品在 opera 是 /product/catalog/{code}，在 admin 是 /products/{code}），
 * 一个 link 字段服务不了两个平面，给了就有一半人点出 404。多平面一律 null。
 * 路由都在 portals/{admin,opera}/src/app 里真实存在，且只喂可视码。
 */
export function auditLink(
  rule: AuditActionRule,
  row: AuditSignalRow,
): string | null {
  if (rule.planes.length !== 1) return null;
  const plane = rule.planes[0];
  if (plane === "opera") {
    const code = text(row.product_code) || text(row.literal_key);
    // 只有「产品」这一类在 opera 有详情页；套餐 / 解决方案的码落不到页面上。
    return row.action.startsWith("product.content") ||
      row.action.startsWith("product.catalog")
      ? code.length > 0
        ? `/product/catalog/${encodeURIComponent(code)}`
        : null
      : null;
  }
  if (plane === "admin") {
    const userNo = text(row.user_no);
    const tenantNo = text(row.tenant_no);
    // tenant.* 的主体是租户，成员名单也长在租户详情页上：成员类动作解出了 U- 码
    // 也不该把人送到 /accounts——那一页没有「他在这个租户里的角色」这件事。
    const tenantFirst = row.action.startsWith("tenant.");
    if (tenantFirst && tenantNo.length > 0) {
      return `/tenants/${encodeURIComponent(tenantNo)}`;
    }
    if (userNo.length > 0) return `/accounts/${encodeURIComponent(userNo)}`;
    if (tenantNo.length > 0) return `/tenants/${encodeURIComponent(tenantNo)}`;
    return null;
  }
  return null;
}

/**
 * 纯函数：一行审计 → 一条待写的系统通告。
 * **返回 null = 这行不该出通告**，调用方静默跳过（不是错误，见文件头注）。两种情形：
 *   · 动作码不在白名单；
 *   · 主体不是运营者。这是 SQL 那条 `actor_type='operator'` 谓词的第二道门：客户
 *     自助的 `tenant.member.remove` 与运营代租户移除成员是同一个码，把客户那一行
 *     播成运营动作会连主语一起说错，所以两处都挡——谁被人改了，另一处还在。
 */
export function composeAuditNotice(
  row: AuditSignalRow,
  now: Date,
): CreateSystemNoticeInput | null {
  if (text(row.actor_type) !== "operator") return null;
  const rule = AUDIT_ACTION_RULES[row.action];
  if (!rule) return null;
  const key = auditDisplayKey(row);
  const title = key === null ? rule.title : `${rule.title}：${key}`;
  const body = join([
    `${auditActorLabel(row)} 于 ${row.occurred_text} 执行 ${rule.title}`,
    key === null ? "" : `对象 ${key}`,
    text(row.tenant_name).length > 0 ? `租户 ${text(row.tenant_name)}` : "",
  ]);
  return {
    targetPlanes: rule.planes,
    severity: rule.severity,
    title: title.slice(0, 256),
    body,
    link: auditLink(rule, row),
    referenceType: AUDIT_REFERENCE_TYPE,
    referenceId: auditDedupeKey(row.id),
    expiresAt:
      rule.severity === "info"
        ? new Date(now.getTime() + AUDIT_INFO_TTL_MS)
        : null,
  };
}
