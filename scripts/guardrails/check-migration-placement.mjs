#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 迁移放置守卫：新迁移只能放进 `28d-apply-migrations.sh` **真正重放的那个目录**。
//
// ── 为什么需要 ──
// 2026-09-21：给「运营备注」写迁移时，我把它放进了
// `deploy/database/prisma/migrations/0013_tenant_operator_notes/migration.sql`
// ——那个目录长得完全像迁移目录（有 0000_baseline，有编号递增的十几个子目录，
// 最近一个 0012 看着还很新），于是我照着 0012 的样子写了一份，本机真库上验过
// 幂等，守卫全绿，PR 九条 CI 全绿，合并，派发生产 migrate。
//
// **那个目录零消费方。** deploy/ 与 .github/ 里没有任何东西引用它。真正被重放的是
// `deploy/database/migrations/*.sql`（扁平文件，按文件名排序）。
//
// 生产上的表现：60 条真迁移照常幂等重放，我那份从没被执行，紧接着 28d 重跑
// `98_column_locks.sql` 时死在
//   psql:/column_locks.sql:516: ERROR: relation "admin.tenant_operator_notes" does not exist
// ——列锁走 `-1` 单事务整体回滚，库没被改坏，但那次生产 migrate 白跑一趟。
//
// 更难堪的是判据当时就在手边：`db-init.yml` 的头注写着「The legacy prisma runners
// (22-migrate / 23-seed / 26-reset) are SUPERSEDED and no longer called」，我当天
// 读过那段，没把它和「迁移该放哪」连起来。人会漏读，守卫不会。
//
// ── 它检两件事 ──
// ① 活目录是从 runner 脚本里**解析出来**的，不是这里写死的。runner 改了挂载点而
//    没人改这道守卫 → 解析不到 → 抛（不是放行）。
// ② 已知的死目录不许长大：文件数超过登记值就红。加新迁移只能加进活目录。
//
// 为什么不直接删掉死目录：那是 owner 的取舍（删除不可逆，且 0000_baseline 还是
// 一份有价值的历史快照）。守卫只保证它**不再骗人**，删不删另说。
//
// 运行:  node scripts/guardrails/check-migration-placement.mjs
// 别名:  pnpm lint:migration-placement
// 退出码:活目录解析不到 / 活目录为空 / 死目录长大 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const RUNNER = "deploy/scripts/28d-apply-migrations.sh";

/**
 * 已知的死目录，连同「为什么它还在」与当前文件数。
 *
 * 数字只准**往下**改（删文件）。往上改等于又往死目录里塞了一份——那正是这道守卫
 * 要拦的事。真要加迁移，加进活目录。
 */
const DEAD_DIRS = new Map([
  [
    "deploy/database/prisma/migrations",
    {
      files: 11,
      why:
        "Prisma 那套 runner（22-migrate / 23-seed / 26-reset）已退役，db-init 的头注" +
        "写明 SUPERSEDED and no longer called。此处只剩历史快照，**不会被执行**。",
    },
  ],
]);

function countSqlFiles(dir) {
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".sql")) n += 1;
    }
  };
  walk(dir);
  return n;
}

// ── ① 活目录：从 runner 解析，不写死 ────────────────────────────────────────
let runnerSrc;
try {
  runnerSrc = readFileSync(join(REPO_ROOT, RUNNER), "utf8");
} catch (error) {
  console.error(`✗ 读不到 ${RUNNER}：${error.message}`);
  process.exit(1);
}

const mount = /MIG_DIR="\$COMPOSE_DIR\/([^"]+)"/.exec(runnerSrc);
if (!mount) {
  console.error(
    `✗ 在 ${RUNNER} 里解析不到 MIG_DIR —— runner 改了挂载点？\n` +
      `  判据读不到就抛，不放行：放行等于把「迁移放哪」这件事重新交给记忆。`,
  );
  process.exit(1);
}
const liveDir = `deploy/${mount[1]}`;
const liveCount = countSqlFiles(join(REPO_ROOT, liveDir));

console.log("══ 迁移放置(check-migration-placement)══");
console.log(`  · 活目录（从 ${RUNNER} 解析）：${liveDir}，${liveCount} 份 .sql`);

// 一份都没有 = 解析到了错的地方，不是「没有迁移」。
if (liveCount === 0) {
  console.error(
    `✗ ${liveDir} 里一份 .sql 都没有——判据失效，不是「没有迁移」（仓库里有几十份）。`,
  );
  process.exit(1);
}

// ── ② 死目录不许长大 ───────────────────────────────────────────────────────
const problems = [];
for (const [dir, { files, why }] of DEAD_DIRS) {
  const actual = countSqlFiles(join(REPO_ROOT, dir));
  console.log(`  · 死目录 ${dir}：${actual} 份（登记 ${files}）`);
  if (actual > files) {
    problems.push(
      `${dir} 从 ${files} 涨到 ${actual} 份。\n` +
        `      这个目录**不会被执行**：${why}\n` +
        `      新迁移请放进 ${liveDir}/YYYY-MM-DD-简述.sql（扁平文件，须幂等）。`,
    );
  } else if (actual < files) {
    problems.push(
      `${dir} 从 ${files} 降到 ${actual} 份——登记值陈旧，请把 DEAD_DIRS 里的数字改成 ${actual}。`,
    );
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} 处:\n`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log("✓ 迁移都在会被重放的目录里，死目录没有长大。");
