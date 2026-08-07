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

/** product_metrics.merge_strategy (product_220 §2 / data_product_200). */
export const MERGE_STRATEGIES = ["max", "union", "pool", "tiered"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/** consume_mode for pool metrics (reply-01 R5). */
export const CONSUME_MODES = ["divisible", "atomic"] as const;
export type ConsumeMode = (typeof CONSUME_MODES)[number];

/** platform_metrics.kind (product_220 §4 / D7). */
export const METRIC_KINDS = ["counter", "gauge"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];
