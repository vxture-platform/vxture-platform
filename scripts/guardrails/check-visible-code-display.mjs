#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 导出的 CSV 不得直接吐裸 id
//
// ## 为什么单独守 CSV
//
// owner 铁律「任何界面不展示 UUID」把**导出的 CSV 也算作展示**。但 CSV 和界面上
// 其余泄露面的**可观测性完全不同**：
//
//   · 页面文本 / title / aria-label —— 渲染后就在 DOM 里，运行时探针扫得到
//     （scripts/dev/uuid-probe.mjs 干这个）。
//   · **CSV —— 点击导出那一刻才由 Blob 生成，DOM 里从不存在**，探针一行都照不到。
//
// 所以 CSV 这一半只能静态守。反过来，页面那一半**不能**静态守：admin 的
// title/aria-label 共五百多处、绝大多数是中文说明，静态扫必然大面积误报，
// 而误报的守卫会被关掉、连带真问题一起放过。两半各用各的手段，是有意的分工。
//
// ## 判据
//
// `CsvColumn.value` 的取值表达式里，直接取 `.id` / `.xxxId` 结尾的字段 → 报错。
// 取 `.xxxCode` / `.xxxNo` / 标签函数 / 金额时间之类 → 放行。
//
// 判的是**字段名形状**，不是值：静态扫本来就分不清一个字符串在运行时是编码还是
// UUID（铁律原文自己写着这一点）。但 CSV 列定义是个很窄的面——它只有
// `value: (row) => row.<字段>` 这一种形状，字段名就是判据本身，误报空间很小。
//
// ## 现状与这条守卫的职责
//
// 2026-09-17 建立时实测：9 个文件 135 个列定义，取值全是 tenantCode / billNo /
// invoiceNo / subscriptionCode / expressNo / orderNo 这类可视码或标签函数，
// **一个裸 id 都没有**。所以它**上线即绿**。
//
// 也就是说这条守卫不是来抓存量的，是来**钉住现状**的：将来谁往导出里加一列
// `value: (row) => row.tenantId`，CI 当场拦下。一条上线即绿的守卫比一条上来就
// 报一堆待修项的守卫更容易活下去。
//
// 运行：  node scripts/guardrails/check-visible-code-display.mjs
// 别名：  pnpm lint:visible-code
// 退出码：有违反 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PORTALS = resolve(REPO_ROOT, "portals");

/** `value: (row) => row.someField` 里的取值字段名。 */
const CSV_VALUE = /value:\s*\(\s*\w+\s*\)\s*=>\s*\w+\.(\w+)/g;

/**
 * 裸 id 的字段名形状：`id` 本身，或以 `Id` 结尾。
 *
 * 不含 `...Code` / `...No` —— 那正是可视码。也不含 `channelOrderNo` 这类外部
 * 句柄：它们是对方系统签发的单号，本就该原样导出给运营对账。
 */
function isRawIdField(name) {
  return name === "id" || /[a-z0-9]Id$/.test(name);
}

function collectTsx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const violations = [];
let columnCount = 0;
let fileCount = 0;

for (const file of collectTsx(PORTALS)) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("CsvColumn")) continue;
  fileCount += 1;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    CSV_VALUE.lastIndex = 0;
    let m;
    while ((m = CSV_VALUE.exec(line)) !== null) {
      columnCount += 1;
      if (isRawIdField(m[1])) {
        violations.push({
          file: relative(REPO_ROOT, file).split("\\").join("/"),
          line: i + 1,
          field: m[1],
          text: line.trim(),
        });
      }
    }
  });
}

console.log("══ 导出 CSV 的可视码检查（check-visible-code-display）══");
console.log(`  扫描 ${fileCount} 个含 CsvColumn 的文件，共 ${columnCount} 个列定义。`);

if (violations.length) {
  console.error("");
  for (const v of violations) {
    console.error(
      `✗ ${v.file}:${v.line}\n` +
        `  导出列直接取了裸 id 字段 \`${v.field}\`：${v.text}\n` +
        `  owner 铁律：任何界面不展示 UUID，导出的 CSV 也算展示。\n` +
        `  修法：改取可视码（tenantCode / billNo / orderNo …）；确实拿不到就用\n` +
        `  visibleIdOr(value, "未知") 说「未知」，永不退回 id。`,
    );
  }
  console.error(`\n── 汇总 ──\nerror: ${violations.length}`);
  process.exit(1);
}

console.log("\n✓ 没有导出列直接吐裸 id。");
console.log("\n── 汇总 ──\nerror: 0");
