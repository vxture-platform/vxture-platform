#!/usr/bin/env node

/**
 * check-ops-todo-alerts.mjs — 运营待办：页面列出的 == 告警考虑过的（#231）。
 *
 * ── 补的是哪个盲区 ──
 * 待办清单在**浏览器里**拼（admin 的 OpsTodosPage.buildOpsTodos），告警在**服务端**扫
 * （platform-api 的 OpsTodoAlertJob → findOpsTodoOrders）。两边各写各的判据，谁也不
 * 认识谁。加一类待办到页面上时，**不报错、不影响构建**，只是那一类永远不会有人被通知
 * ——而它看起来完全正常：页面上红红地列着，只是没人收到邮件。#231 的病根就是这种坏法。
 *
 * 所以这条守卫不判「该不该告警」（那是 owner 的裁定），只判**有没有人做过裁定**：
 * 页面上的待办类必须每一类都在下面的 DECIDED 里有明文归属。
 *
 * ── owner 2026-09-08 的裁定 ──
 *   pending_verify      → 告警（客户在等你确认收款，拖着就是拖客户的钱）
 *   paid_unprovisioned  → 告警（2026-09-08 事故正是它）
 *   partial_pending     → 不告警（那一类在等客户，不在等运营）
 * 另有「自愈放弃」一条不在页面上，由 OrderService 在放弃点直接报（ops-alerter.ts）。
 *
 * ── 还判两条对应关系 ──
 * 告警扫的是**原始订单态**，靠 admin-bff 的 mapEntityOrderStatus 一一对应到页面上的
 * 派生态。那个映射一改，服务端的谓词就悄悄错位，同样不报错。
 *
 * 用法：node scripts/guardrails/check-ops-todo-alerts.mjs
 */

import { readFileSync } from "node:fs";
import process from "node:process";

const ROOT = process.cwd();
const PAGE = `${ROOT}/portals/admin/src/modules/ops/OpsTodosPage.tsx`;
const MAPPER = `${ROOT}/bff/admin-bff/src/routers/orders.router.ts`;
const REPO = `${ROOT}/services/commerce/subscription/src/repository/pg-order.repository.ts`;

/** 页面待办类 → 是否告警。owner 2026-09-08 定；改这里等于改裁定。 */
const DECIDED = {
  pending_verify: true,
  paid_unprovisioned: true,
  partial_pending: false,
};

/** 告警的派生态 → 它在库里的原始订单态（由 mapEntityOrderStatus 保证）。 */
const RAW_STATUS = {
  pending_verify: "pending_verify",
  paid_unprovisioned: "paid",
};

const problems = [];

// ── 1. 页面列了哪些待办类 ──────────────────────────────────────────────
const pageSrc = readFileSync(PAGE, "utf8");
const block = pageSrc.match(/const ORDER_TODO[\s\S]*?\n> = \{([\s\S]*?)\n\};/);
if (!block) {
  console.error(
    "在 OpsTodosPage 里找不到 ORDER_TODO —— 判据失效，拒绝给出通过结论",
  );
  process.exit(1);
}
const listed = [...block[1].matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1]);
if (listed.length === 0) {
  console.error("ORDER_TODO 解析出 0 个待办类 —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}

const undecided = listed.filter((k) => !(k in DECIDED));
const stale = Object.keys(DECIDED).filter((k) => !listed.includes(k));
if (undecided.length) {
  problems.push(
    `运营待办页新增了 ${undecided.length} 类，但没人裁定它要不要告警：\n    ` +
      undecided.join("\n    ") +
      "\n  → 请 owner 定「推 / 不推」，然后写进本文件的 DECIDED（推的还要接 OpsTodoAlertJob）。",
  );
}
if (stale.length) {
  problems.push(
    `DECIDED 里有页面已经不列的待办类（裁定过期）：\n    ` + stale.join("\n    "),
  );
}

// ── 2. 派生态 ← 原始订单态的映射还成立吗 ────────────────────────────────
const mapperSrc = readFileSync(MAPPER, "utf8");
const mapper = mapperSrc.match(
  /function mapEntityOrderStatus\([\s\S]*?\n\}/,
)?.[0];
if (!mapper) {
  console.error(
    "在 orders.router 里找不到 mapEntityOrderStatus —— 判据失效，拒绝给出通过结论",
  );
  process.exit(1);
}
for (const [derived, raw] of Object.entries(RAW_STATUS)) {
  const expected = new RegExp(
    `case "${raw}":\\s*\\n\\s*return "${derived}";`,
  );
  if (!expected.test(mapper)) {
    problems.push(
      `mapEntityOrderStatus 不再把订单态 \`${raw}\` 映射成 \`${derived}\`——` +
        `服务端告警扫的是 \`${raw}\`，这层对应一断，扫的就不是页面上那一类了。`,
    );
  }
}

// ── 3. 服务端谓词扫的就是那几个原始态吗 ─────────────────────────────────
const repoSrc = readFileSync(REPO, "utf8");
const scan = repoSrc.match(/async findOpsTodoOrders\([\s\S]*?\n  \}/)?.[0];
if (!scan) {
  console.error(
    "在 pg-order.repository 里找不到 findOpsTodoOrders —— 判据失效，拒绝给出通过结论",
  );
  process.exit(1);
}
const alerting = Object.entries(DECIDED)
  .filter(([, on]) => on)
  .map(([k]) => RAW_STATUS[k])
  .filter(Boolean)
  .sort();
const scanned = [
  ...(scan.match(/o\.status in \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g),
]
  .map((m) => m[1])
  .sort();
if (scanned.length === 0) {
  console.error(
    "findOpsTodoOrders 里解析不出 `o.status in (...)` —— 判据失效，拒绝给出通过结论",
  );
  process.exit(1);
}
if (JSON.stringify(alerting) !== JSON.stringify(scanned)) {
  problems.push(
    `告警扫描的订单态与裁定对不上：\n` +
      `    裁定要告警的（原始态）：${alerting.join(", ")}\n` +
      `    findOpsTodoOrders 实扫：${scanned.join(", ")}`,
  );
}

console.log("══ 运营待办告警一致性检查（check-ops-todo-alerts）══");
console.log(
  `运营待办页列出 ${listed.length} 类（${listed.join(" / ")}），` +
    `其中裁定告警 ${alerting.length} 类（原始态 ${scanned.join(" / ")}）。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error("  ✗ " + p);
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ 页面待办类全部有明文裁定，派生映射与服务端扫描谓词一致。");
console.log("\n── 汇总 ──\nerror: 0");
