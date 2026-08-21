#!/usr/bin/env node
/**
 * check-catalog-domains.mjs — enforce that the DB CHECK constraints match the
 * platform value-domain contract in @vxture-platform/shared (catalog-domains.constants.ts).
 * SQL cannot import TS, so this guardrail is the mechanical link: any tier / role
 * / status / strategy / mode / kind value added to the DDL but not to @shared (or
 * vice versa) fails CI. @shared is the authority — the fix is always to make the
 * DDL match @shared, never the reverse.
 *
 * Run: node scripts/guardrails/check-catalog-domains.mjs  (pnpm lint:catalog-domains)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

/** Extract a `const NAME = [ "a", "b" ] as const` string array from TS source. */
function tsArray(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`, "s"));
  if (!m) throw new Error(`@shared array ${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Extract the value list of a named CHECK ... IN ('a','b') constraint from DDL. */
function ddlCheckIn(src, constraintName) {
  const m = src.match(
    new RegExp(`CONSTRAINT ${constraintName}[^\\n]*?IN \\(([^)]*)\\)`, "s"),
  );
  if (!m)
    throw new Error(`DDL constraint ${constraintName} (…IN(…)) not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const dom = read(
  "packages/shared/shared/src/constants/catalog-domains.constants.ts",
);
const p40 = read("deploy/database/ddl/40_product.sql");
const p50 = read("deploy/database/ddl/50_metering.sql");

// [ label, @shared value domain, DB CHECK values ]
const pairs = [
  ["tier", tsArray(dom, "TIERS"), ddlCheckIn(p40, "chk_plan_components_tier")],
  [
    "component_role (plan_components)",
    tsArray(dom, "COMPONENT_ROLES"),
    ddlCheckIn(p40, "chk_plan_components_role"),
  ],
  [
    "component_role (quota_pools)",
    tsArray(dom, "COMPONENT_ROLES"),
    ddlCheckIn(p50, "chk_quota_pools_component_role"),
  ],
  [
    "plan version status",
    tsArray(dom, "PLAN_VERSION_STATUSES"),
    ddlCheckIn(p40, "chk_plan_versions_status"),
  ],
  [
    "subscription status",
    tsArray(dom, "SUBSCRIPTION_STATUSES"),
    ddlCheckIn(p50, "chk_subscriptions_status"),
  ],
  [
    "merge_strategy",
    tsArray(dom, "MERGE_STRATEGIES"),
    ddlCheckIn(p40, "chk_product_metrics_merge_strategy"),
  ],
  [
    "consume_mode (product_metrics)",
    tsArray(dom, "CONSUME_MODES"),
    ddlCheckIn(p40, "chk_product_metrics_consume_mode"),
  ],
  [
    "consume_mode (platform_metrics)",
    tsArray(dom, "CONSUME_MODES"),
    ddlCheckIn(p40, "chk_platform_metrics_consume"),
  ],
  [
    "metric kind",
    tsArray(dom, "METRIC_KINDS"),
    ddlCheckIn(p40, "chk_platform_metrics_kind"),
  ],
];

const errors = [];
for (const [label, shared, ddl] of pairs) {
  const ss = new Set(shared),
    sd = new Set(ddl);
  const onlyShared = shared.filter((v) => !sd.has(v));
  const onlyDdl = ddl.filter((v) => !ss.has(v));
  if (onlyShared.length || onlyDdl.length) {
    errors.push(
      `  ✗ ${label}: @shared=[${shared.join(",")}] vs DDL=[${ddl.join(",")}]` +
        (onlyShared.length
          ? `\n      only in @shared: ${onlyShared.join(",")}`
          : "") +
        (onlyDdl.length ? `\n      only in DDL: ${onlyDdl.join(",")}` : ""),
    );
  }
}

console.log("── 汇总 ──");
if (errors.length) {
  console.log(`error: ${errors.length}\n${errors.join("\n")}`);
  console.log(
    "\n修复:把 DDL CHECK 改成与 @vxture-platform/shared catalog-domains 一致(@shared 是权威)。",
  );
  process.exit(1);
}
console.log(`error: 0   (${pairs.length} 组 DDL↔@shared 值域一致)`);
