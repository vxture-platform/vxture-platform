#!/usr/bin/env node

/**
 * check-audit-actions.mjs — 审计动作码：UI 目录 == BFF 实写集合。
 *
 * ── 补的是哪个盲区 ──
 * 两边各自维护一份动作码清单，谁也不认识谁。不一致**不报错、不影响构建**，只在界面上
 * 现形，而且现形的样子是「看起来正常」：
 *
 *  · **UI 多**（列了 BFF 从不写的码）→ 那个筛选项永远返回空列表。而空列表看起来像
 *    「这段时间没发生过」，不像「这个筛选项是假的」。
 *  · **UI 少**（BFF 写了 UI 不认识的码）→ 日志行显示成原始码 `tenant.owner.transfer`，
 *    且筛选下拉里根本没有。转让所有权、注销租户这两条恰恰是这一页最该被看见的。
 *
 * 2026-09-08 首次清点：BFF 实写 37 个、UI 认 18 个，差 19 个。**人工核对不出来**——
 * 我自己第一遍用 `action: "..."` 双引号匹配去扫，把模板串写法的
 * （`` action: `subscription.${action}` ``）整批漏掉，据此报出「5 个假筛选项」的
 * 错误结论。判据必须覆盖三种写法，见下。
 *
 * ── 三种写法都要认 ──
 *   action: "tenant.member.invite"                    字面量
 *   action: `subscription.${action}`                  模板串（值域来自同文件的 VALID）
 *   action: body.enabled ? "a.on" : "a.off"           三元
 * 后两种无法静态求值，用**显式登记**兜底（DYNAMIC）：登记项必须能在源码里找到佐证，
 * 否则守卫自己报错——不给「登记了就算数」的后门。
 *
 * 用法：node scripts/guardrails/check-audit-actions.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";

const ROOT = process.cwd();
const ROUTERS = `${ROOT}/bff/console-bff/src/routers`;
const PAGE = `${ROOT}/portals/console/src/modules/settings/AuditLogsPage.tsx`;
const MSGS = `${ROOT}/portals/console/messages/zh-CN.json`;

/**
 * 动态写法的登记表：`证据片段` → 该处实际会写出的动作码。
 * 证据片段必须在对应源文件里出现，否则视为登记过期。
 */
const DYNAMIC = [
  {
    file: "subscription.router.ts",
    evidence: "action: `subscription.${action}`",
    codes: ["subscription.pause", "subscription.resume", "subscription.cancel"],
  },
  {
    file: "subscription.router.ts",
    evidence: '? "subscription.auto_renew_on"',
    codes: ["subscription.auto_renew_on", "subscription.auto_renew_off"],
  },
];

const problems = [];
const written = new Set();

const files = readdirSync(ROUTERS).filter((f) => f.endsWith(".router.ts"));
if (files.length === 0) {
  console.error("扫不到 console-bff 的 router —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}

for (const f of files) {
  const src = readFileSync(`${ROUTERS}/${f}`, "utf8");
  for (const m of src.matchAll(/action: "([a-z_.]+)"/g)) written.add(m[1]);
}

for (const d of DYNAMIC) {
  const src = readFileSync(`${ROUTERS}/${d.file}`, "utf8");
  if (!src.includes(d.evidence)) {
    problems.push(
      `动态登记已过期：${d.file} 里找不到证据片段 \`${d.evidence}\`——` +
        `那几个码（${d.codes.join(" / ")}）现在还写不写？`,
    );
    continue;
  }
  for (const c of d.codes) written.add(c);
}

const pageSrc = readFileSync(PAGE, "utf8");
const setBlock = pageSrc.match(/const KNOWN_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
if (!setBlock) {
  console.error("在 AuditLogsPage 里找不到 KNOWN_ACTIONS —— 判据失效");
  process.exit(1);
}
const ui = new Set([...setBlock[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]));

const labels = JSON.parse(readFileSync(MSGS, "utf8")).auditPage?.action ?? {};

const missing = [...written].filter((a) => !ui.has(a)).sort();
const extra = [...ui].filter((a) => !written.has(a)).sort();
const unlabelled = [...written]
  .filter((a) => !(a.replace(/\./g, "_") in labels))
  .sort();

if (missing.length)
  problems.push(
    `UI 少 ${missing.length} 个（日志会显示成原始码、且筛不到）：\n    ` +
      missing.join("\n    "),
  );
if (extra.length)
  problems.push(
    `UI 多 ${extra.length} 个（筛选项永远空列表）：\n    ` + extra.join("\n    "),
  );
if (unlabelled.length)
  problems.push(
    `缺中文文案 ${unlabelled.length} 个（auditPage.action.*）：\n    ` +
      unlabelled.join("\n    "),
  );

console.log("══ 审计动作码一致性检查（check-audit-actions）══");
console.log(
  `BFF 实写 ${written.size} 个（含 ${DYNAMIC.reduce((n, d) => n + d.codes.length, 0)} 个动态写法）、UI 目录 ${ui.size} 个、文案 ${Object.keys(labels).length} 条。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error("  ✗ " + p);
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ UI 目录、BFF 实写集合、动作文案三者一致。");
console.log("\n── 汇总 ──\nerror: 0");
