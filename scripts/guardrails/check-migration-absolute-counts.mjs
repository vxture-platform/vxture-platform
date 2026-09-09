#!/usr/bin/env node

/**
 * check-migration-absolute-counts.mjs — 迁移里不得断言「全库某类共 N 个」。
 *
 * ── 补的是哪个盲区 ──
 * `db-init action=migrate` 是**全量重放**：整个 `migrations/` 按文件名顺序重跑一遍，
 * 靠每份自身幂等。这意味着**每份迁移都跑在最终状态上**，不是它当年被写下时的那个
 * 状态。于是一条「全库菜单节点应为 25 个」的断言，在下一个人加了一个节点之后就是错的
 * ——错的是断言，不是那次新增。
 *
 * 2026-09-09 实测代价：三份迁移各写了一条（25 / 21 / 18），我加了一个
 * `tenant.menu.skills`，三条一起被顶偏 1。生产上 `migrate` 连跑三次失败，
 * 第三次才暴露到这一层（前两次分别死在 SHA pin 与基线审计上，一次只露一个）。
 *
 * ── 为什么删掉而不是把数字加一 ──
 * 加一只是把同一颗雷埋到下一次菜单改动。而且全局计数**证明不了本迁移做对了什么**：
 * 它是一张无关状态的快照。那三份迁移本来就各自写了按职责的断言（删掉的码是否真没了、
 * 挂靠是否正确、同级序号是否补齐），那些才是判据，且与全库有多少节点无关。
 *
 * ── 这条守卫查什么、不查什么 ──
 * 查：把一个「无本迁移过滤条件的 count(*)」变量拿去和一个 **≥2 的字面量**比较。
 *
 * 不查这三类，它们都是稳定的、正是想要的写法：
 *   · 断言 **0**（「不该有残留」）或 **1**（「这一个东西在/不在」）——0 和 1 不是
 *     快照，它们由本迁移的动作直接决定，后来者加多少行都不影响。
 *   · 按具体对象过滤的计数（`perm_code IN (...)` / `column_name = '…'` /
 *     `JOIN … VALUES`）——数的是点名的那几个，不是一整类。
 *   · 只进 `RAISE NOTICE` 的计数——那是给人看的信息量，不是判据。
 *
 * 初版没有 ≥2 这一条，把 `IF v <> 1`（某列是否存在）和 `IF n_after <> 0`
 * （是否还有残留）一起标红了。**误报的守卫比没有守卫更糟**：它会被关掉，
 * 连带真问题一起放过。
 *
 * 用法：node scripts/guardrails/check-migration-absolute-counts.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DIR = path.join(process.cwd(), "deploy/database/migrations");

/** 「整表/整类计数」：count(*) 之后到分号之间没有把范围收窄到本迁移动的那些行。 */
const BROAD_COUNT =
  /SELECT\s+count\(\*\)\s+INTO\s+(\w+)\s+FROM\s+([\w.]+)([^;]*);/gi;

/**
 * 收窄的标志：数的是点名的那几个对象，不是一整类。
 * `column_name` / `table_name` 是 information_schema 那一族的点名方式。
 */
const NARROWING =
  /perm_code\s+(IN|=)|\bid\s+IN\b|\bJOIN\b|\bVALUES\b|column_name\s*=|table_name\s*=|grantee\s*=/i;

const problems = [];
let scanned = 0;

for (const name of (await readdir(DIR)).filter((f) => f.endsWith(".sql"))) {
  const text = await readFile(path.join(DIR, name), "utf8");
  scanned += 1;

  /* 同一个变量名（`v` 尤其常见）在一个 DO 块里会被反复赋值，每次数的是不同的东西。
     所以只在**本次赋值到下一次同名赋值之间**找判据——拿变量名在整份文件里搜，
     会把别处那次赋值的断言算到这一次头上。初版就是这么误报了 2026-09-20 的：
     那份里 `IF v <> 2` 属于上一段按列名收窄的计数，与被标红的那次赋值无关。 */
  const assigns = [...text.matchAll(BROAD_COUNT)];
  for (let i = 0; i < assigns.length; i += 1) {
    const m = assigns[i];
    const [, varName, table, tail] = m;
    if (NARROWING.test(tail)) continue; // 已按具体对象收窄，正是想要的写法

    // 作用域：到下一次给**同名**变量赋值为止（没有下一次就到文末）。
    const next = assigns
      .slice(i + 1)
      .find((a) => a[1] === varName);
    const scope = text.slice(m.index + m[0].length, next ? next.index : undefined);

    // 在这段里，变量有没有被拿去和一个 ≥2 的字面量比较（= 当判据用）？
    // 0 / 1 放过（稳定断言）；只进 RAISE NOTICE 的也放过（信息量不是门）。
    const guard = new RegExp(
      `IF\\s+${varName}\\s*(?:<>|!=|=)\\s*(\\d+)\\s+THEN`,
      "gi",
    );
    for (const g of scope.matchAll(guard)) {
      const n = Number(g[1]);
      if (n < 2) continue;
      problems.push(
        `${name}：${varName} 取的是 ${table.trim()} 的**全量计数**，却被拿去和 ${n} 比较。` +
          `migrate 是全量重放，这个数会随后来的任何一次新增而失效——` +
          `改成按本迁移动过的那些对象去断言，或只留作 RAISE NOTICE。`,
      );
    }
  }
}

console.log("══ 迁移绝对计数(check-migration-absolute-counts)══");
console.log(`  · 扫描 ${scanned} 份迁移`);
if (problems.length > 0) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("✓ 没有「全库共 N 个」式的断言。");
