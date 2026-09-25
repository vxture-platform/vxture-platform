/**
 * catalog-domains.constants.ts — the platform's value-domain CONTRACT
 * (product_220). SINGLE AUTHORITY for the allowed string values of the
 * entitlement axes and metering config vocab.
 *
 * The DB CHECK constraints, seed, in-repo services, and external products
 * CONFORM to these. This file never derives an alias or a compat value to
 * accommodate a non-conforming product — if something doesn't match, that
 * thing is fixed to match here. tier is exactly five; a product that wants a
 * sixth is not supported and corrects itself.
 *
 * Pure value sets + types. ZERO business logic: which status grants coverage,
 * how to project/aggregate, how tiers rank — all live in the owning domain
 * (subscription service / entitlement engine), reading these values.
 *
 * DB sync is enforced by scripts/guardrails/check-catalog-domains.mjs.
 */

/** Commercial tier ladder (product_220 §1), lowest → highest. Five, no sixth. */
export const TIERS = [
  "free",
  "starter",
  "pro",
  "business",
  "enterprise",
] as const;
export type Tier = (typeof TIERS)[number];

/**
 * 档位的**高低序**。`TIERS` 本身就是「低 → 高」排的，但在 2026-09-24 之前**全仓没有
 * 任何消费方**——序摆在那里，没人拿它比过大小。代价是真实的：换档只判「是不是同一个
 * 套餐」，不判方向，于是一张 0 元 Free 单被当作「升级」，就地把付费 Starter 订阅改写
 * 成 Free、周期重置，`cashDue=0` 即时结清，全程不报错（生产实撞，ORD-202609-63E0E32517）。
 *
 * 不在 `TIERS` 里的值（含 null / 空 / 历史脏值）返回 `-1`，由调用方**按拒绝处理**——
 * 比不出高低时放行等于没有这道判定，而这道判定管的是钱。
 */
export function tierRank(tier: string | null | undefined): number {
  if (!tier) return -1;
  return (TIERS as readonly string[]).indexOf(tier);
}

/**
 * 从 `from` 换到 `to` 是不是**升档**。
 *
 * 两边都必须是已知档位；任一不可比即 false（fail closed）。同档也是 false——同档延长
 * 周期是续订，不是升级（服务端另有一条 `samePlan` 判定）。
 */
export function isTierUpgrade(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const a = tierRank(from);
  const b = tierRank(to);
  if (a < 0 || b < 0) return false;
  return b > a;
}

/** Plan component role (product_220 §2). primary sells a tier; bundled = backing. */
export const COMPONENT_ROLES = ["primary", "bundled"] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/**
 * plan_versions.status — a plan version's publish lifecycle (product_320).
 * draft = editable working copy (is_locked=false, never current); the admin
 * sets prices/quotas here. published = released: on publish the version is
 * frozen (is_locked=true) and plans.current_version_id points at it. A prior
 * published version that a new one supersedes stays 'published' (subscriptions
 * pinned to it keep resolving) — "currently live" is plans.current_version_id,
 * not a third status. Business logic (what may edit/publish) lives in the
 * product/admin domain, not here.
 */
export const PLAN_VERSION_STATUSES = ["draft", "published"] as const;
export type PlanVersionStatus = (typeof PLAN_VERSION_STATUSES)[number];

/**
 * The states a subscription can be in (metering.subscriptions.status), from the
 * subscription's own perspective. "No subscription" is NOT a state here — it is
 * conveyed by absence (null) in the entitlement view, never by a value in this set.
 *
 * Array order is load-bearing: it is the representative-status precedence the
 * C2 entitlement view selects by when a workspace holds several subscriptions
 * for one product (earlier wins). suspended outranks expired/cancelled on
 * purpose — an operator freeze must not be masked by an older lapsed row.
 *
 * overdue = renewal charge failed, dunning grace, entitlements retained
 * (contrast: expired = entitlements gone). Reserved ahead of the payment
 * plane — nothing writes it yet; it exists now so the contract and DDL do
 * not move again when payment lands. Exit paths: settle → active, grace
 * lapses → expired.
 *
 * expiring = still entitled, end_at is near. A live state, not a lapsed one,
 * which is why it ranks second: an expiring row must not be masked by an
 * older trialing one, but a fully active row still wins. Distinct from
 * expired — one is a warning, the other is the entitlement being gone, and
 * conflating them tells an operator the opposite of the truth (admin did
 * exactly that until 2026-08-07: it mapped the DB's expired onto overdue).
 * Reserved like overdue — nothing writes it yet; whoever lands renewal
 * reminders flips it from end_at.
 */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "expiring",
  "trialing",
  "overdue",
  "suspended",
  "expired",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * metering.subscription_suspensions.reason — why a subscription is paused, and
 * therefore whether the paused days are given back.
 *
 * A suspension is a platform action: a customer cannot pause their own service
 * (the self-service action domain is upgrade/cancel only). Since the customer
 * cannot use the service while it is paused, those days are owed back to them
 * unless the pause is their own fault — so extension is the default and
 * `customer_violation` is the single exception. Extending a violation pause
 * would hand the violator the days for free.
 *
 * platform_ops      — platform-side maintenance, incident or migration.
 * dispute_review    — a dispute, risk or compliance review is in progress. Still
 *                     extends: if the review clears the customer, they should not
 *                     be out those days; if it confirms a violation, the operator
 *                     re-handles it under customer_violation.
 * customer_violation— the customer broke the terms. The only non-extending reason.
 * other             — anything unclassified; defaults to the customer's side.
 *
 * Mirrors chk_subscription_suspensions_reason (50_metering.sql). The *decision*
 * lives here rather than in either portal because both admin-bff (which writes
 * `extends_term`) and the admin UI (which tells the operator what they are about
 * to do) must agree — two copies would drift into an operator pausing a
 * subscription without knowing whether the term moves.
 *
 * `extends_term` is snapshotted onto the episode row at pause time, not derived
 * on read: this policy may change, but a pause that already happened must not be
 * rewritten (same reason plan_versions are immutable).
 */
export const SUSPENSION_REASONS = [
  "platform_ops",
  "dispute_review",
  "customer_violation",
  "other",
] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/** Does this reason give the paused days back on resume? */
export const SUSPENSION_REASON_EXTENDS_TERM = {
  platform_ops: true,
  dispute_review: true,
  customer_violation: false,
  other: true,
} as const satisfies Record<SuspensionReason, boolean>;

export function isSuspensionReason(value: unknown): value is SuspensionReason {
  return (
    typeof value === "string" &&
    (SUSPENSION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * billing.invoices.bill_status — where a bill sits on the way to being settled.
 *
 * unpaid → paying (a payment attempt is in flight) → paid. partial = money
 * arrived but not all of it, and the bill stays open (the remainder is carried,
 * not written off). overdue = past due and still open — it is a *timing* fact
 * layered on unpaid/partial, which is why nothing transitions out of it except
 * by being paid or cancelled. cancelled = voided, no money owed.
 *
 * Mirrors chk_invoices_bill_status (52_billing.sql).
 */
export const BILL_STATUSES = [
  "unpaid",
  "paying",
  "paid",
  "partial",
  "cancelled",
  "overdue",
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/**
 * billing.payments.pay_source — how the money reached us.
 *
 * online = the customer paid through a channel (Alipay/WeChat/bank gateway).
 * offline = wire/transfer the operator confirms by hand. voucher = a settlement
 * leg backed by a voucher or credit rather than new money (product_321 P7) —
 * it is a REAL source, not the absence of one. Three admin pages used to lack
 * this branch and rendered voucher payments as "无" (2026-09-21).
 *
 * "no source at all" is NOT in this domain: the column is NOT NULL with a
 * default, and a row that has no payment simply has no payments row. Callers
 * that hold a nullable reference render the absence themselves.
 *
 * Mirrors chk_payments_pay_source (52_billing.sql).
 */
export const PAY_SOURCES = ["online", "offline", "voucher"] as const;
export type PaySource = (typeof PAY_SOURCES)[number];

/**
 * support.tickets.status — where a ticket sits on the way to being closed.
 *
 * open (nobody has picked it up) → in_progress → resolved (we believe it is
 * answered) → closed (the customer agreed, or it aged out). pending is the
 * parked state: we are waiting on somebody outside the queue, so it is neither
 * open nor being worked. reopened is resolved-that-did-not-hold — a distinct
 * value rather than a return to `open`, because "came back" is the fact an
 * operator needs to see. cancelled = withdrawn, nothing was owed.
 *
 * **These seven are not the vocabulary the ticket LIST speaks.** admin-bff
 * projects them onto a coarser four (`open` / `processing` / `blocked` /
 * `closed`) for the queue view. The seven are the stored values — the ones a
 * write may set; the four are a display grouping laid over them. Anything that
 * writes status uses this domain.
 *
 * Mirrors chk_tickets_status (72_support.sql).
 */
/**
 * kyc.user_kycs.status — 自然人实名认证。
 *
 * `unverified` 是**没提交过**，不是"提交了没过"——后者是 `rejected`。两者在界面上
 * 语气不同：没认证是常态，驳回才是要跟进的事。
 *
 * Mirrors chk_user_kycs_status (16_kyc.sql).
 */
export const USER_KYC_STATUSES = [
  "unverified",
  "pending",
  "verified",
  "rejected",
] as const;
export type UserKycStatus = (typeof USER_KYC_STATUSES)[number];

export const TICKET_STATUSES = [
  "open",
  "pending",
  "in_progress",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * support.tickets.priority — how far up the queue a ticket jumps.
 *
 * p0 is the only one that means "now"; p1..p3 are ordinary backlog ordering.
 * The ladder is numeric rather than named (urgent/high/normal) on purpose: the
 * names invite argument about where a ticket belongs, while the numbers keep
 * sort order and label pointing the same way.
 *
 * Mirrors chk_tickets_priority (72_support.sql).
 */
export const TICKET_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** product_metrics.merge_strategy (product_220 §2 / data_product_200). */
export const MERGE_STRATEGIES = ["max", "union", "pool", "tiered"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/** consume_mode for pool metrics (reply-01 R5). */
export const CONSUME_MODES = ["divisible", "atomic"] as const;
export type ConsumeMode = (typeof CONSUME_MODES)[number];

/** platform_metrics.kind (product_220 §4 / D7). */
export const METRIC_KINDS = ["counter", "gauge"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

/**
 * 产品的**接入方式**（`product.products.integration_mode`）——答的是「平台向这个产品
 * 下发东西吗」。与生命周期（走到哪一步）、承诺等级（承诺什么）、层级、来源都正交。
 *
 * ── 为什么非得显式声明 ──
 * admin 的接入态此前**靠「有没有 product_webhooks 行」去推**，而那是**沉默**，沉默同时
 * 兼容两件相反的事：「还没配」与「按设计不需要」。2026-09-24 一天之内两种猜法都上线过，
 * 各错一批产品：
 *   · 先全判 `not_required`（「无需接入」）—— 12 个什么都没建的智能体被说成不需要接入，
 *     owner 当场指出「很多产品仅仅填写了信息…应该谈不上接入」。
 *   · 改成全判 `config_required`（「待配置」）—— 反过来冤了 umbra：它只做账号统一登录，
 *     其余全在它自己那边，**没有任何配置在等人做**，而界面在催一件不存在的工作。
 * 一个笼统答案换另一个笼统答案，因为缺的不是更好的推断，是**一处声明**。
 *
 * ── 为什么不拿 origin 当代理 ──
 * 2026-09-24 实测 umbra 是唯一 `origin='third_party'` 的产品，所以「按来源判」当天恰好
 * 只框中它。但那是巧合：合作方产品照样可以收平台下发，自建产品也可以只用统一登录。
 * 接入方式是**接入契约**的属性，不是**来源**的属性（[[加列先问这是谁的属性]]）。
 *
 * ── 各值的判据 ──
 *   platform_managed  收平台下发（开通 / 权益 / 用量回调）。默认值：绝大多数产品如此。
 *                     没登记回调 ⇒ 「待配置」，确实有事等人做。
 *   login_only        只用统一登录，平台不向它下发任何东西。没有回调 ⇒ 「无需接入」，
 *                     那是终态而不是缺配置。
 */
export const PRODUCT_INTEGRATION_MODES = [
  "platform_managed",
  "login_only",
] as const;
export type ProductIntegrationMode = (typeof PRODUCT_INTEGRATION_MODES)[number];

/**
 * 产品生命周期（`product.products.status`）——**接入状态轴**，答的是「这个产品走到
 * 接入流程的哪一步」。与承诺等级（`release_stage`，答「买了之后平台承诺什么」）、
 * 层级、类型、来源都正交。
 *
 * ── 这份清单此前不存在，而它的缺席让一个值瘫在库里 ──
 * `developing` 2026-10-29 随 DDL 加进 `chk_products_status`，列注释写着
 * 「开发中(admin 可录营销、官网可预告)」。但 TS 这一侧**从来没有权威源**：
 * opera-bff 与 opera 门户各写了一份四值联合类型，谁都不知道另一份存在，于是
 * `developing` 在 `bff/` `portals/` `packages/` 里**出现 0 次**——库收得下，
 * 而没有任何代码能产生、接受或显示它。加了值域却不接消费方，值就是死的。
 * `lint:catalog-domains` 的注释当时就记着「等它收口到 @shared 再补一对」；现在补上。
 *
 * ── 各值的判据 ──
 *   draft       只在 opera 可见。已登记、拿到产品码，接入尚未完成。
 *   developing  开发中：admin 可录营销、官网可预告，**但不可订阅**。
 *               「信息填好了，东西还没建」正是这一档——而不是 active。
 *   active      已上线：可订阅、可进入。
 *   inactive    已停用：曾经上线，现在关掉了。与 developing 的区别是**有没有上过线**。
 *   deprecated  已退役（终态）。
 */
export const PRODUCT_STATUSES = [
  "draft",
  "developing",
  "active",
  "inactive",
  "deprecated",
] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

/**
 * products.layer — where a product sits in the product stack
 * (product_100_matrix.md §2). L1 = foundational capability (atlas, runos),
 * L2 = domain platform (arda, karda, terra), L3 = agent application.
 *
 * This is the *position* axis and it is deliberately separate from two others:
 * `product_type` says what a product IS (the symmetric 2x2 in @vxture/core-utils)
 * and `origin` says where it CAME FROM (self / third_party / other). External
 * products are an origin, not a layer; a desktop client and an internal service
 * are not catalogue products at all — none of the three occupies a layer value.
 * A product with no layer set carries NULL and renders as unclassified, so the
 * DB CHECK admits NULL. Closed domain (unlike product_type, an open kind with
 * no CHECK): lint:catalog-domains pins this array to chk_products_layer.
 */
export const PRODUCT_LAYERS = ["L1", "L2", "L3"] as const;
export type ProductLayerValue = (typeof PRODUCT_LAYERS)[number];

/** Display definitions for the layer picker — order is the dropdown order. */
export const PRODUCT_LAYER_DEFS: readonly {
  readonly value: ProductLayerValue;
  readonly labelZh: string;
  readonly labelEn: string;
}[] = [
  { value: `L1`, labelZh: `L1 · 基础支撑`, labelEn: `L1 · Foundation` },
  { value: `L2`, labelZh: `L2 · 域平台`, labelEn: `L2 · Domain platform` },
  { value: `L3`, labelZh: `L3 · 智能体`, labelEn: `L3 · Agent` },
] as const;

/**
 * 一个**新产品**可以落在哪几层 —— 与 `PRODUCT_LAYERS`（值域）刻意分开。
 *
 * owner 2026-09-23：「L0、L1 层级的产品都是平台的基础环境，不应出现在平台的产品中」。
 * L1 仍留在值域里，因为软删的历史行（atlas / runos）带着这个值——那是事实，不是
 * 待修的错误。所以这里回答的是另一个问题：**下拉里该给哪几项**。
 *
 * 两处必须一致，库上有 `chk_products_live_layer_not_l1` 焊着同一条规则
 * （lint:catalog-domains 锁这一对）。给了 L1 而库上拦着，运营选完会撞成 500；
 * 库上放开而这里不给，就是一条只写在一边的规矩。
 */
export const PRODUCT_LAYER_CHOICES = ["L2", "L3"] as const;

/**
 * Write-side validation, mirroring isValidProductType.
 *
 * 只验**值域**，不验可选性：一个已存在的 L1 行读回来仍是合法值。写侧「不许新建
 * L1」由 `isSelectableProductLayer` 与库上的 CHECK 两道管，理由见上。
 */
export function isValidProductLayer(value: string): value is ProductLayerValue {
  return (PRODUCT_LAYERS as readonly string[]).includes(value);
}

/** 这一层还能不能被新产品选中（下拉与写侧共用）。 */
export function isSelectableProductLayer(value: string): boolean {
  return (PRODUCT_LAYER_CHOICES as readonly string[]).includes(value);
}

/** Display label; an unregistered value falls back to itself, never silently blank. */
export function productLayerLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = PRODUCT_LAYER_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}
