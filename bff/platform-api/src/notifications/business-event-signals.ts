/**
 * business-event-signals.ts — 业务事件巡检的映射表与 SQL（第二批，owner 2026-09-28）。
 * @package @vxture/bff-platform-api
 *
 * owner：「先把通知、信息、任务、提醒这些信息做全、做多，后续再在订阅选择上做筛选。
 * 本轮需要充分考虑信息完整性。」——所以这里的取向是**宁可多一条，不漏一条**，
 * 去重与分级靠去重键和 severity，不靠「这条会不会太吵」的预判。
 *
 * ── 为什么是巡检，不是在十个包的热路径里插代码 ──
 * 盘出来的业务事件里，绝大多数在库里**本来就有一行带时刻的记录**（注册、建租户、
 * 提认证、下单、买加油包、申请开票、评价、核销、注销申请、关自动续费、开工单）。
 * 于是这一批不动业务代码：每类一条 SQL，扫「最近 N 分钟新出现的行」，一行写一条
 * 运营通告。好处是一处实现、一处测试、失败只影响巡检自己；以后加事件只加一条 SQL。
 *
 * ── 一事一条 ──
 * 去重锚 = `reference_type = 'business_event'` + `reference_id = {事件码}:{行键}`，
 * 对上 `admin.operator_notices` 的部分唯一索引 `uq_operator_notices_system`。
 * 行键优先用可视码（order_no / invoice_no / ticket_no / redemption_no / user_no /
 * tenant_no）；那张表没有可视码时用行 id——`reference_id` 不上屏，这是允许的
 * （见 CreateSystemNoticeInput.referenceId 的注释）。所以回看窗口重叠、作业重启
 * 重扫都只会落成 `inserted: false`。
 *
 * 长度**不能只靠估**：`reference_id` 是 varchar(128)，而
 * `metering.addon_purchases.order_no` 是 **varchar(128)**（50_metering.sql:453，比
 * billing.orders 的 varchar(64) 宽一倍），`addon.created:` 这 14 个字符一加就越界。
 * 越界的后果是 22001——那一条通告静默丢掉（巡检把写失败汇总成一段失败，但丢的是
 * 具体哪件事看不出来）。所以去重键统一过一道 `opsNoticeReferenceId`（ops-notice.ts）：
 * 128 以内原样，超长截断并缀全键的 8 位 sha256，两件长前缀相同的事不会撞成一条。
 * 与热路径那一侧共用同一个函数，不各写一份长度规则。
 *
 * ── 标题与正文里绝不出现 UUID ──
 * 全站铁律。标题只用名称 + 可视码，主体码按 @shared 的 `formatPrincipalNo` 带
 * U- / T- 前缀上屏（owner 2026-09-21：裸 10 位数字分不出是用户还是租户）。
 * 链接只给 admin 里真实存在的路由，且只喂可视码：
 *   /accounts/{user_no}、/tenants/{tenant_no}、/orders/{order_no}、
 *   /tickets/{ticket_no}、/subscriptions/{order_no}、/verifications、/invoices、
 *   /reviews、/promotion-redemptions、/addon-orders。
 *
 * ── 两处与第一批（客户消息镜像）重叠，是有意留着的 ──
 * 续费单（intent='renew'）既会被 `order.renewal_created` 的客户消息镜像出一条，
 * 也会被本文件的 `order.created` 扫出一条——两条去重锚不同，所以并存。本轮的方向
 * 是完整性优先（owner 原话），去重叠属于「后续在订阅选择上做筛选」那一步。
 *
 * ── 没能覆盖的一类，写在这里而不是悄悄消失 ──
 * `risk.flagged`（`admin.risk_records` 的租户风险标记）**不在本文件**：本进程的库
 * 角色 `svc_platform_api` 对那张表的权限被 `2026-11-21-platform-api-operator-notices-grant.sql`
 * 的审计段**显式断言为 0 项**（与 operator_account / operator_credential 一起）。
 * 授它 SELECT 会让那份已合并迁移在下一次全量重放时抛 EXCEPTION，所以不授。
 * 运营侧的可见性由运营动作巡检（audit-event-signals.ts 的 governance.risk.*）承担
 * ——风险标记是人在治理台按出来的，那条路有审计行。要把「库里凭空多一行风险记录」
 * 也扫出来，需要 owner 先放宽那条断言；一行 GRANT + 一条 SQL 的事，不在本批自决。
 *
 * `addon.declared`（加油包已申报付款）也不在本文件：`metering.addon_purchases` 的
 * status 值域只有 pending_payment / completed / cancelled（DDL chk_addon_purchases_status），
 * 没有申报态、也没有 declared_at 列——库里根本没有那个事实，不是漏写。
 */
import { formatPrincipalNo } from "@vxture-platform/shared";
import type {
  CreateSystemNoticeInput,
  NoticePlane,
  NoticeSeverity,
} from "@vxture/service-notice";
import { opsNoticeReferenceId } from "./ops-notice";

/**
 * A 段一律只投 admin 平面（与第一批镜像同口径）：这些都是客户经营事实，
 * 不是运维（opera）或治理（arche）该被打扰的事。
 */
export const BUSINESS_EVENT_PLANES: readonly NoticePlane[] = ["admin"];

/** 去重锚的类别位。与镜像的 `customer_event`、人工发布的空值天然分开。 */
export const BUSINESS_EVENT_REFERENCE_TYPE = "business_event";

/** info 类 30 天后退出列表（不删行）；warning / critical 不过期，直到有人处理。 */
export const BUSINESS_EVENT_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const BUSINESS_EVENT_CODES = [
  "user.signed_up",
  "tenant.created",
  "tenant.verification_submitted",
  "order.created",
  "addon.created",
  "invoice.applied",
  "review.submitted",
  "voucher.redeemed",
  "account.deletion_requested",
  "subscription.autorenew_off",
  "ticket.created",
] as const;
export type BusinessEventCode = (typeof BUSINESS_EVENT_CODES)[number];

/**
 * 一行巡检结果的**统一形状**。每条 SQL 都把自己那几列 alias 成这里的名字，
 * 于是纯函数只认一种 row，单测喂普通对象即可（假 pool 不解析 SQL）。
 *
 * `dedupe_key` 必给；其余按事件各取所需，取不到就是 null。
 */
export interface SignalRow {
  /** 去重锚的后半段：可视码，或该表没有可视码时的行 id（不上屏）。 */
  readonly dedupe_key: string;
  /** 本事件自己的可视码（上屏、进链接）。 */
  readonly code?: string | null;
  readonly tenant_no?: string | null;
  readonly tenant_name?: string | null;
  /** 人名：注册用户 / 租户所有者 / 核销人。 */
  readonly display_name?: string | null;
  readonly product_name?: string | null;
  readonly plan_name?: string | null;
  /** 订阅类事件的订单可视码（/subscriptions/{order_no}）。 */
  readonly order_no?: string | null;
  /** 金额（numeric::text，避免 pg 交回 number 丢精度）。 */
  readonly amount?: string | null;
  readonly currency?: string | null;
  /** 事件自己的分类轴：注册来源 / 认证主体 / 下单意图 / 券种 / 工单分类。 */
  readonly kind?: string | null;
  /** 认证方式轴（lite / face / documents）。 */
  readonly method?: string | null;
  readonly priority?: string | null;
  /** 主体文本：申报企业名 / 发票抬头 / 工单标题。 */
  readonly subject_text?: string | null;
  /** 次要文本：评语 / 工单来源 / 配额量。 */
  readonly note?: string | null;
  readonly actor_type?: string | null;
  readonly product_score?: number | null;
  readonly price_score?: number | null;
  readonly service_score?: number | null;
}

/** 一条事件映射出的可变部分（纯函数产物，单测逐条断言的就是它）。 */
export interface ShapedSignal {
  readonly severity: NoticeSeverity;
  readonly title: string;
  readonly body: string;
  readonly link: string | null;
}

export interface BusinessEventPass {
  readonly code: BusinessEventCode;
  /** 日志与 itest 用的人话标签。 */
  readonly label: string;
  /** $1 = 回看分钟数，$2 = 本轮上限。两个都是绑定参数，不拼串。 */
  readonly sql: string;
  readonly shape: (row: SignalRow) => ShapedSignal;
}

/**
 * 去重键：`{事件码}:{行键}`（契约 A 段），再过一道列宽收口。
 *
 * 绝大多数键远不到 128，`opsNoticeReferenceId` 原样放过——读的人一眼看得出这条通告
 * 是哪件事。加油包那类可视码可以宽到 128（见文件头注），超长时它截断并缀 8 位内容
 * 哈希：仍然一事一条，且两个长前缀相同的键不会撞成一条（那比多发一条坏得多）。
 */
export function businessEventDedupeKey(
  code: BusinessEventCode,
  rowKey: string,
): string {
  return opsNoticeReferenceId(`${code}:${rowKey}`);
}

/** 纯函数：一行 + 一个时刻 → 一条待写的系统通告。 */
export function composeBusinessNotice(
  pass: BusinessEventPass,
  row: SignalRow,
  now: Date,
): CreateSystemNoticeInput {
  const shaped = pass.shape(row);
  return {
    targetPlanes: BUSINESS_EVENT_PLANES,
    severity: shaped.severity,
    // title 列是 varchar(256)：库里的名称 / 单号正常远不到，截断只是兜底。
    title: shaped.title.slice(0, 256),
    body: shaped.body,
    link: shaped.link,
    referenceType: BUSINESS_EVENT_REFERENCE_TYPE,
    referenceId: businessEventDedupeKey(pass.code, row.dedupe_key),
    expiresAt:
      shaped.severity === "info"
        ? new Date(now.getTime() + BUSINESS_EVENT_INFO_TTL_MS)
        : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 文案零件
// ════════════════════════════════════════════════════════════════════════════

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 正文按 ` · ` 串起来，空段不留空位。 */
function join(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((p) => text(p))
    .filter((p) => p.length > 0)
    .join(" · ");
}

function personName(row: SignalRow): string {
  return text(row.display_name) || "未命名用户";
}

function tenantName(row: SignalRow): string {
  return text(row.tenant_name) || "未命名租户";
}

function productName(row: SignalRow): string {
  return text(row.product_name) || "未知产品";
}

/** `atlas 基础版`；两段都取不到就空串（调用方据此省掉那对括号）。 */
function planText(row: SignalRow): string {
  return [text(row.product_name), text(row.plan_name)]
    .filter((p) => p.length > 0)
    .join(" ");
}

/** `¥99.00`；金额缺失回 `金额未记录`——不写成 ¥0.00，那是另一回事。 */
function money(row: SignalRow): string {
  const raw = text(row.amount);
  if (raw.length === 0) return "金额未记录";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "金额未记录";
  const currency = text(row.currency) || "CNY";
  const symbol = currency === "CNY" ? "¥" : `${currency} `;
  return `${symbol}${value.toFixed(2)}`;
}

/** `（U-1799729056）`；码缺失回空串。 */
function codeSuffix(
  code: string | null | undefined,
  kind: "user" | "tenant",
): string {
  const shown = formatPrincipalNo(text(code) || null, kind);
  return shown === null ? "" : `（${shown}）`;
}

function labelOf(
  table: Readonly<Record<string, string>>,
  raw: string | null | undefined,
  fallback: string,
): string {
  const key = text(raw);
  if (key.length === 0) return fallback;
  return table[key] ?? key;
}

const SIGNUP_SOURCE: Readonly<Record<string, string>> = {
  web: "官网注册",
  invite: "受邀注册",
  oidc: "三方登录",
};

const VERIFICATION_TYPE: Readonly<Record<string, string>> = {
  enterprise: "企业认证",
  individual: "个人认证",
};

const VERIFICATION_METHOD: Readonly<Record<string, string>> = {
  lite: "简易认证",
  face: "法人扫脸",
  documents: "提交资料",
};

const ORDER_INTENT: Readonly<Record<string, string>> = {
  new: "新购",
  upgrade: "升级",
  renew: "续费",
};

const INVOICE_TYPE: Readonly<Record<string, string>> = {
  electronic_general: "电子普票",
  electronic_special: "电子专票",
  paper_special: "纸质专票",
};

const VOUCHER_KIND: Readonly<Record<string, string>> = {
  credit_voucher: "抵扣券",
  recharge_card: "充值卡",
  redemption: "兑换码",
  discount: "折扣",
  extension: "延期",
  invite: "邀请订阅",
};

const TICKET_PRIORITY: Readonly<Record<string, string>> = {
  p0: "P0 最高",
  p1: "P1 高",
  p2: "P2 中",
  p3: "P3 低",
};

const TICKET_SOURCE: Readonly<Record<string, string>> = {
  console: "客户控制台",
  website: "官网",
  email: "邮件",
  admin: "运营代建",
  api: "接口",
};

/** 关自动续费是谁按的：客户自助 / 运营代客户 / 系统。 */
const AUTORENEW_ACTOR: Readonly<Record<string, string>> = {
  customer: "客户",
  operator: "运营代客户",
  system: "系统",
};

/** 评分缺一项就画「—」，不画 0——三项都可空（DDL chk_product_reviews_any_score）。 */
function score(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "—";
}

/** 任一分 ≤ 2 即 warning（契约 A 段）。三项全空不可能，DDL 拦住了。 */
function reviewSeverity(row: SignalRow): NoticeSeverity {
  const scores = [row.product_score, row.price_score, row.service_score].filter(
    (s): s is number => typeof s === "number" && Number.isFinite(s),
  );
  return scores.some((s) => s <= 2) ? "warning" : "info";
}

function path(prefix: string, code: string | null | undefined): string | null {
  const value = text(code);
  return value.length === 0 ? null : `${prefix}${encodeURIComponent(value)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// 每类一条 SQL。列名与谓词都对着 deploy/database/ddl 逐列核过。
// 共同形状：`created_at`（或该事件自己的时刻列）落在回看窗口内，按时刻升序，限量。
// ════════════════════════════════════════════════════════════════════════════

/** 注册：account.users 按 created_at；显示名在 1:1 的 user_profiles 里。 */
const USER_SIGNED_UP_SQL = `
  select u.user_no::text as dedupe_key,
         u.user_no::text as code,
         coalesce(nullif(p.display_name, ''), u.account) as display_name,
         u.source as kind
    from account.users u
    left join account.user_profiles p on p.user_id = u.id
   where u.created_at > now() - make_interval(mins => $1::int)
     and u.deleted_at is null
   order by u.created_at asc
   limit $2::int
`;

/**
 * 建组织租户：只扫 type='organization'。
 * 个人租户是注册时顺手建的（每个账号一个），扫它等于把 user.signed_up 抄一遍。
 */
const TENANT_CREATED_SQL = `
  select t.tenant_no::text as dedupe_key,
         t.tenant_no::text as code,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name,
         coalesce(nullif(op.display_name, ''), ou.account) as display_name
    from tenancy.tenants t
    left join account.users ou on ou.id = t.owner_user_id
    left join account.user_profiles op on op.user_id = t.owner_user_id
   where t.type = 'organization'
     and t.created_at > now() - make_interval(mins => $1::int)
     and t.deleted_at is null
   order by t.created_at asc
   limit $2::int
`;

/**
 * 提交认证：kyc.tenant_verifications status='pending'。
 * 这张表没有可视码，去重键用行 id——同一租户被驳回后重新提交会是新的一行，
 * 所以两次提交各一条通告（用 tenant_no 当键就会把第二次吞掉）。
 */
const VERIFICATION_SUBMITTED_SQL = `
  select v.id::text as dedupe_key,
         v.verification_type as kind,
         v.verification_method as method,
         nullif(v.company_name, '') as subject_text,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from kyc.tenant_verifications v
    join tenancy.tenants t on t.id = v.tenant_id
   where v.status = 'pending'
     and v.created_at > now() - make_interval(mins => $1::int)
   order by v.created_at asc
   limit $2::int
`;

/**
 * 下单待付款：billing.orders status='pending_payment'。
 * 套餐名经 plan_version → plan（plan_versions 自己只有版本号，名字在 plans 上）。
 */
const ORDER_CREATED_SQL = `
  select o.order_no as dedupe_key,
         o.order_no as code,
         o.payable_amount::text as amount,
         o.currency as currency,
         o.intent as kind,
         p.product_name as product_name,
         pl.plan_name as plan_name,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from billing.orders o
    join tenancy.tenants t on t.id = o.tenant_id
    left join product.products p on p.id = o.product_id
    left join product.plan_versions pv on pv.id = o.plan_version_id
    left join product.plans pl on pl.id = pv.plan_id
   where o.status = 'pending_payment'
     and o.created_at > now() - make_interval(mins => $1::int)
   order by o.created_at asc
   limit $2::int
`;

/**
 * 买加油包：metering.addon_purchases status='pending_payment'。
 * 注意两个 amount 不是一回事：`price` 是钱，`amount` 是授予的配额量——
 * 所以这里把钱 alias 成 amount（统一 row 的金额位），配额量放 note。
 */
const ADDON_CREATED_SQL = `
  select a.order_no as dedupe_key,
         a.order_no as code,
         a.price::text as amount,
         a.currency as currency,
         a.pack_name as product_name,
         a.metric_key as kind,
         a.amount::text as note,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from metering.addon_purchases a
    join tenancy.tenants t on t.id = a.tenant_id
   where a.status = 'pending_payment'
     and a.created_at > now() - make_interval(mins => $1::int)
   order by a.created_at asc
   limit $2::int
`;

/** 申请开票：billing.invoice_receipts invoice_status='applying'。 */
const INVOICE_APPLIED_SQL = `
  select r.invoice_no as dedupe_key,
         r.invoice_no as code,
         r.invoice_amount::text as amount,
         r.currency as currency,
         r.invoice_type as kind,
         nullif(r.invoice_title, '') as subject_text,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from billing.invoice_receipts r
    join tenancy.tenants t on t.id = r.tenant_id
   where r.invoice_status = 'applying'
     and r.deleted_at is null
     and r.created_at > now() - make_interval(mins => $1::int)
   order by r.created_at asc
   limit $2::int
`;

/** 客户评价：support.product_reviews，三项分各自可空。 */
const REVIEW_SUBMITTED_SQL = `
  select r.id::text as dedupe_key,
         r.product_score as product_score,
         r.price_score as price_score,
         r.service_score as service_score,
         nullif(r.comment, '') as note,
         p.product_name as product_name,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from support.product_reviews r
    join tenancy.tenants t on t.id = r.tenant_id
    left join product.products p on p.id = r.product_id
   where r.deleted_at is null
     and r.created_at > now() - make_interval(mins => $1::int)
   order by r.created_at asc
   limit $2::int
`;

/**
 * 优惠核销：promotion.voucher_redemptions。
 * 时刻列是 `redeemed_at`，**不是** created_at——这张表没有 created_at。
 */
const VOUCHER_REDEEMED_SQL = `
  select vr.redemption_no as dedupe_key,
         vr.redemption_no as code,
         vr.kind as kind,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name,
         coalesce(nullif(up.display_name, ''), u.account) as display_name
    from promotion.voucher_redemptions vr
    join tenancy.tenants t on t.id = vr.tenant_id
    left join account.users u on u.id = vr.user_id
    left join account.user_profiles up on up.user_id = vr.user_id
   where vr.redeemed_at > now() - make_interval(mins => $1::int)
   order by vr.redeemed_at asc
   limit $2::int
`;

/**
 * 申请注销：account.users status='deleting'，时刻列是 `deletion_requested_at`
 * （按 created_at 扫会把「很久以前注册、今天申请注销」的人漏掉——那正是要看的那类）。
 */
const DELETION_REQUESTED_SQL = `
  select u.user_no::text as dedupe_key,
         u.user_no::text as code,
         coalesce(nullif(p.display_name, ''), u.account) as display_name
    from account.users u
    left join account.user_profiles p on p.user_id = u.id
   where u.status = 'deleting'
     and u.deletion_requested_at is not null
     and u.deletion_requested_at > now() - make_interval(mins => $1::int)
   order by u.deletion_requested_at asc
   limit $2::int
`;

/**
 * 关自动续费：`metering.subscription_histories.change_type = 'auto_renew_off'`。
 *
 * 契约写的是「change_type / remark 能认出关自动续费则用它」——认得出：仓储在
 * `PgSubscriptionRepository.update` 里为纯续费开关翻转专门写了 auto_renew_off /
 * auto_renew_on 两个值（"不淹没在杂项 updated 里"，2026-08-21 自助线）。
 * 所以不必退到 remark 的英文字面串，也不必去读审计表。
 * 去重键用历史行 id：同一订阅关掉、又开、又关是两件事，两条通告。
 */
const AUTORENEW_OFF_SQL = `
  select h.id::text as dedupe_key,
         h.actor_type as actor_type,
         o.order_no as order_no,
         p.product_name as product_name,
         pl.plan_name as plan_name,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from metering.subscription_histories h
    join metering.subscriptions s on s.id = h.subscription_id
    join tenancy.tenants t on t.id = h.tenant_id
    left join billing.orders o on o.id = s.current_order_id
    left join product.products p on p.id = s.product_id
    left join product.plan_versions pv on pv.id = s.plan_version_id
    left join product.plans pl on pl.id = pv.plan_id
   where h.change_type = 'auto_renew_off'
     and h.created_at > now() - make_interval(mins => $1::int)
   order by h.created_at asc
   limit $2::int
`;

/**
 * 新工单：support.tickets 按 created_at。
 * 客户端目前没有开单入口，运营代建（source='admin'）也算——扫的是表，不是入口。
 */
const TICKET_CREATED_SQL = `
  select k.ticket_no as dedupe_key,
         k.ticket_no as code,
         k.title as subject_text,
         k.priority as priority,
         k.category as kind,
         k.source as note,
         t.tenant_no::text as tenant_no,
         coalesce(nullif(t.display_name, ''), t.name) as tenant_name
    from support.tickets k
    join tenancy.tenants t on t.id = k.tenant_id
   where k.deleted_at is null
     and k.created_at > now() - make_interval(mins => $1::int)
   order by k.created_at asc
   limit $2::int
`;

// ════════════════════════════════════════════════════════════════════════════
// 映射表
// ════════════════════════════════════════════════════════════════════════════

export const BUSINESS_EVENT_PASSES: readonly BusinessEventPass[] = [
  {
    code: "user.signed_up",
    label: "新用户注册",
    sql: USER_SIGNED_UP_SQL,
    shape: (row) => {
      const who = `${personName(row)}${codeSuffix(row.code, "user")}`;
      return {
        severity: "info",
        title: `新用户注册：${who}`,
        body: join([who, labelOf(SIGNUP_SOURCE, row.kind, "注册来源未记录")]),
        link: path("/accounts/", row.code),
      };
    },
  },
  {
    code: "tenant.created",
    label: "新建组织租户",
    sql: TENANT_CREATED_SQL,
    shape: (row) => {
      const who = `${tenantName(row)}${codeSuffix(row.code, "tenant")}`;
      return {
        severity: "info",
        title: `新建组织租户 ${who}`,
        body: join([who, `所有者 ${personName(row)}`]),
        link: path("/tenants/", row.code),
      };
    },
  },
  {
    code: "tenant.verification_submitted",
    label: "提交企业认证",
    sql: VERIFICATION_SUBMITTED_SQL,
    shape: (row) => {
      const typeLabel = labelOf(VERIFICATION_TYPE, row.kind, "主体认证");
      const methodLabel = labelOf(
        VERIFICATION_METHOD,
        row.method,
        "方式未记录",
      );
      return {
        // 在等运营审核：不过期，直到有人处理。
        severity: "warning",
        title: `${tenantName(row)} 提交${typeLabel}（${methodLabel}）`,
        body: join([
          `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
          `申报名称 ${text(row.subject_text) || "未填写"}`,
          `认证方式 ${methodLabel}`,
          "等待运营审核。",
        ]),
        link: "/verifications",
      };
    },
  },
  {
    code: "order.created",
    label: "客户下单待付款",
    sql: ORDER_CREATED_SQL,
    shape: (row) => {
      const plan = planText(row);
      const suffix = plan.length > 0 ? `（${plan}）` : "";
      return {
        severity: "info",
        title: `客户下单待付款 ${money(row)} · ${text(row.code) || "无单号"}${suffix}`,
        body: join([
          `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
          plan,
          money(row),
          `下单类型 ${labelOf(ORDER_INTENT, row.kind, "未记录")}`,
          "等待客户付款。",
        ]),
        link: path("/orders/", row.code),
      };
    },
  },
  {
    code: "addon.created",
    label: "客户下单加油包",
    sql: ADDON_CREATED_SQL,
    shape: (row) => {
      const pack = text(row.product_name) || "加油包";
      return {
        severity: "info",
        title: `客户下单加油包 ${money(row)} · ${text(row.code) || "无单号"}（${pack}）`,
        body: join([
          `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
          pack,
          money(row),
          text(row.kind).length > 0
            ? `配额 ${text(row.kind)} ${text(row.note) || "未记录"}`
            : "",
          "等待客户付款。",
        ]),
        link: "/addon-orders",
      };
    },
  },
  {
    code: "invoice.applied",
    label: "客户申请开票",
    sql: INVOICE_APPLIED_SQL,
    shape: (row) => ({
      // 在等运营开票：不过期。
      severity: "warning",
      title: `客户申请开票 ${money(row)} · ${text(row.code) || "无申请号"}`,
      body: join([
        `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
        `抬头 ${text(row.subject_text) || "未填写"}`,
        labelOf(INVOICE_TYPE, row.kind, "票种未记录"),
        money(row),
        "等待运营开票。",
      ]),
      link: "/invoices",
    }),
  },
  {
    code: "review.submitted",
    label: "客户评价",
    sql: REVIEW_SUBMITTED_SQL,
    shape: (row) => ({
      severity: reviewSeverity(row),
      title:
        `客户评价 ${productName(row)}：产品 ${score(row.product_score)}` +
        `/价格 ${score(row.price_score)}/服务 ${score(row.service_score)}`,
      body: join([
        `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
        productName(row),
        text(row.note).length > 0 ? `评语「${text(row.note)}」` : "未留评语",
      ]),
      link: "/reviews",
    }),
  },
  {
    code: "voucher.redeemed",
    label: "优惠核销",
    sql: VOUCHER_REDEEMED_SQL,
    shape: (row) => {
      const kindLabel = labelOf(VOUCHER_KIND, row.kind, "优惠");
      const code = text(row.code) || "无核销号";
      return {
        severity: "info",
        // 邀请档单独给一句：它不只是一次核销，还意味着一个新客户被带进来了。
        title:
          text(row.kind) === "invite"
            ? `邀请订阅已核销：${code}`
            : `优惠已核销：${kindLabel} · ${code}`,
        body: join([
          `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
          `类型 ${kindLabel}`,
          `核销人 ${personName(row)}`,
        ]),
        link: "/promotion-redemptions",
      };
    },
  },
  {
    code: "account.deletion_requested",
    label: "用户申请注销账号",
    sql: DELETION_REQUESTED_SQL,
    shape: (row) => {
      const who = `${personName(row)}${codeSuffix(row.code, "user")}`;
      return {
        // 保留期内还能撤销，但运营得知道有人在往门外走：不过期。
        severity: "warning",
        title: `用户申请注销账号：${who}，30 天后清除`,
        body: join([
          who,
          "保留期 30 天，期内客户自己撤销即恢复；到期由清扫作业脱敏并软删。",
        ]),
        link: path("/accounts/", row.code),
      };
    },
  },
  {
    code: "subscription.autorenew_off",
    label: "关闭自动续费",
    sql: AUTORENEW_OFF_SQL,
    shape: (row) => {
      const actor = labelOf(AUTORENEW_ACTOR, row.actor_type, "客户");
      const plan = planText(row);
      return {
        severity: "info",
        title: `${actor}关闭自动续费 ${plan || "未知套餐"} · ${tenantName(row)}`,
        body: join([
          `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
          plan,
          "本期到期后不再自动开续费单。",
        ]),
        link: path("/subscriptions/", row.order_no),
      };
    },
  },
  {
    code: "ticket.created",
    label: "新工单",
    sql: TICKET_CREATED_SQL,
    shape: (row) => ({
      // p0 是「现在就得有人看」，单独一档；其余在等运营，warning 不过期。
      severity: text(row.priority) === "p0" ? "critical" : "warning",
      title:
        `新工单 ${text(row.code) || "无单号"}：${text(row.subject_text) || "无标题"}` +
        `（${labelOf(TICKET_PRIORITY, row.priority, "优先级未记录")}）`,
      body: join([
        `租户 ${tenantName(row)}${codeSuffix(row.tenant_no, "tenant")}`,
        text(row.kind).length > 0 ? `分类 ${text(row.kind)}` : "",
        `来源 ${labelOf(TICKET_SOURCE, row.note, "未记录")}`,
      ]),
      link: path("/tickets/", row.code),
    }),
  },
];
