#!/usr/bin/env node
/**
 * check-partition-window.mjs — 分区预建窗口还剩多久（2026-10-03 新增，2026-10-04 按对抗审查加固）
 *
 * ── 为什么要这道门 ──
 * `96_partitions.sql` 按月预建三张表的分区：metering.usage_events（计费事件）、
 * metering.usage_event_pools、support.audit_logs。Postgres 的声明式分区**不会自己长出
 * 新分区**，窗口走到头之后写入落进 `*_default`：不丢数，但分区失效、按月 detach/drop
 * 做不了，而且**零信号** —— 那份 DDL 的注释曾把滚动交给「维护 Job（pg_cron / 外部调度）」，
 * 而那个 Job 不存在、pg_cron 没装、它说的「巡检有行=告警」也不存在。
 *
 * owner 2026-10-03：「暂时不要复杂化」。所以不装调度、不加作业，只把窗口推远 + 用这道门
 * 在到期前叫一声。**判据会随时间自己变化**：同一份代码放到窗口剩 90 天以内就会红。
 * 它被两处调用：ci.yml（每次提交，不再按 docs_only 跳过）与 partition-window.yml
 * （每月 1 日定时，不靠有人推代码——低活跃期也会被求值）。
 *
 * ── 这道门看不见什么（写下来，别让它假装全知）──
 * ① 它只读**仓库里声明的**窗口，读不到生产库里**实际**铺到哪个月。两者会不一致：
 *    新库按 DDL+seed 直建、不跑迁移；存量库建库那天就定了窗口、再也不重跑 DDL。
 *    所以推窗口必须 DDL + 迁移两份一起改 —— 判据 ② 就是查这个。
 *    真实窗口要去问库（迁移里的审计段会把每张表的上界打出来）。
 * ② 它不验分区是否真的被 apply 过，也不验 `*_default` 里有没有行。
 * ③ 它不验分区边界的时区解释 —— 那一面由 DDL 与迁移各自的 `SET LOCAL TIME ZONE 'UTC'` 钉住，
 *    不是本门的事。
 *
 * ── 2026-10-04 加固（对抗审查：「①只证明有个叫 cover_until 的字面量，不证明循环读它」）──
 * 原版 ① 只要 DDL 里**出现**一个 `cover_until date := date '…'` 就绿 —— 整个 DO 块被注释掉也绿，
 * 把 while 循环改回「起点 + 个数」也绿（窗口静默缩短）。现在：
 *   · 先剥掉 SQL 注释（`--` 到行尾），只看活代码；
 *   · ① 还要求活代码里有一行 `WHILE mn < cover_until LOOP`（循环真的读那个日期），
 *     且**没有** `FOR i IN 0..` 这种定数写法；
 *   · ② 对迁移同样只看活代码。
 * `--self-test` 用合成的 DDL/迁移文本把这几条反例逐一喂进去，必须各自红。
 *
 * 判据：
 *   ① DDL 活代码里有 cover_until 日期字面量 + 读它的 while 循环；找不到 = 红，不是「通过」
 *   ② 必须存在一份迁移在活代码里声明同一个 cover_until —— 否则存量库拿不到新窗口
 *   ③ 距 cover_until 不足 WARN_DAYS(90) 天 = 红，附带下一步怎么做
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const DDL = join(ROOT, "deploy/database/ddl/96_partitions.sql");
const MIG_DIR = join(ROOT, "deploy/database/migrations");
const WARN_DAYS = 90;

/** 剥掉 `--` 行注释（SQL 只有这一种会出现在本文件与迁移里；这两份都不用块注释）。 */
export function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const COVER_RE = /cover_until\s+date\s*:=\s*date\s*'(\d{4}-\d{2}-\d{2})'/i;
const LOOP_RE = /WHILE\s+mn\s*<\s*cover_until\s+LOOP/i;
const FIXED_COUNT_RE = /FOR\s+i\s+IN\s+0\s*\.\./i;

/** 从活代码里取 cover_until；读不到回 null。 */
export function coverUntilIn(sql) {
  const m = stripSqlComments(sql).match(COVER_RE);
  return m ? m[1] : null;
}

/**
 * 核心判据，纯函数：输入 DDL 文本、迁移 {name→文本}、今天；输出 failures 与摘要。
 * 拆成纯函数是为了 --self-test 能用合成文本喂反例，而不是靠临时改真文件再还原。
 */
export function evaluate({ ddlSrc, migrations, today }) {
  const failures = [];
  const live = stripSqlComments(ddlSrc);
  const declared = coverUntilIn(ddlSrc);

  // ── ① DDL：字面量 + 真的读它的循环 ───────────────────────────────────────
  if (!declared) {
    failures.push(
      `① 在 deploy/database/ddl/96_partitions.sql 的**活代码**里找不到 cover_until 的日期字面量 —— ` +
        `这道门因此量不到任何东西。要么是那一行被改了写法（同步改本守卫的正则），` +
        `要么被注释掉 / DO 块被挪走了，要么窗口机制被换掉了（那就重写这道门，别删了它）`,
    );
  } else {
    if (!LOOP_RE.test(live)) {
      failures.push(
        `① DDL 里有 cover_until = ${declared}，但活代码里**没有** \`WHILE mn < cover_until LOOP\` ` +
          `这一行 —— 那个日期没人读，窗口实际由别的东西决定。要么循环被改了形状（同步改本守卫），` +
          `要么它被注释掉了`,
      );
    }
    if (FIXED_COUNT_RE.test(live)) {
      failures.push(
        `① DDL 活代码里出现了 \`FOR i IN 0..\` 的定数写法 —— 那是 2026-10-03 之前「起点 + 个数」的形状，` +
          `个数与 cover_until 分两处写，漏改一处窗口就静默变短。只能用 while 铺到 cover_until`,
      );
    }
  }

  // ── ② 存量库那一半：必须有迁移在活代码里声明同一个上界 ──────────────────────
  let migHit = null;
  if (declared) {
    for (const name of Object.keys(migrations).sort()) {
      if (!name.endsWith(".sql")) continue;
      if (coverUntilIn(migrations[name]) === declared) {
        migHit = name;
        break;
      }
    }
    if (!migHit) {
      failures.push(
        `② DDL 声明窗口覆盖到 ${declared}，但 migrations/ 里没有任何一份在活代码里声明同一个 cover_until。\n` +
          `     **只改 DDL 等于只给新库推了窗口** —— 新库按 DDL+seed 直建、不跑迁移；\n` +
          `     存量库建库那天就定了窗口、再也不会重跑 96_partitions.sql。生产会留在旧窗口上，\n` +
          `     而这件事不报错（2026-10-03 之前正是这个状态）。补一份迁移：\n` +
          `     deploy/database/migrations/<日期>-extend-partition-window.sql（照 2026-10-03 那份的形状）`,
      );
    }
  }

  // ── ③ 还剩多少天 ─────────────────────────────────────────────────────────────
  let days = null;
  if (declared) {
    const until = new Date(`${declared}T00:00:00Z`);
    const t0 = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z");
    days = Math.round((until - t0) / 86_400_000);
    if (days < WARN_DAYS) {
      failures.push(
        `③ 分区窗口只剩 ${days} 天（< ${WARN_DAYS}），到 ${declared} 之后写入会静默落进 *_default 分区：\n` +
          `     不丢数，但分区失效、按月 detach/drop 做不了，且没有任何运行时信号。\n` +
          `     处置（两步，缺一步只有新库受益）：\n` +
          `       1. 把 deploy/database/ddl/96_partitions.sql 的 cover_until 往后推（惯例：再推一年）\n` +
          `       2. 另写一份 migrations/<日期>-extend-partition-window.sql 声明同一个日期，给存量库补子表\n` +
          `     注意本门读不到生产库实际铺到哪个月 —— 跑完迁移看它审计段打出的每张表上界`,
      );
    }
  }
  return { failures, declared, migHit, days };
}

// ── --self-test：合成文本把每条反例喂进去，必须各自红；正例必须绿 ───────────────
function selfTest() {
  const GOOD_DDL = [
    "-- cover_until date := date '1999-01-01' 这是注释里的字面量，不算数",
    "DO $$ DECLARE",
    "  cover_from date := date '2026-07-01';",
    "  cover_until date := date '2028-02-01';",
    "BEGIN",
    "  mn := cover_from;",
    "  WHILE mn < cover_until LOOP",
    "    mn := mn + interval '1 month';",
    "  END LOOP;",
    "END $$;",
  ].join("\n");
  const GOOD_MIG = { "2026-10-03-extend.sql": "BEGIN;\n  cover_until date := date '2028-02-01';\nCOMMIT;" };
  const today = new Date("2026-10-04T00:00:00Z");

  const cases = [
    {
      name: "正例：活代码有字面量 + while 循环 + 同值迁移 + 486 天 ⇒ 绿",
      ddl: GOOD_DDL, mig: GOOD_MIG, expectRed: null,
    },
    {
      name: "反例①a：整个 DO 块被注释掉（字面量只在注释里）⇒ ① 红",
      ddl: GOOD_DDL.split("\n").map((l) => "-- " + l).join("\n"), mig: GOOD_MIG, expectRed: "①",
    },
    {
      name: "反例①b：字面量在，但循环改回 FOR i IN 0..6 定数写法 ⇒ ① 红",
      ddl: GOOD_DDL.replace("WHILE mn < cover_until LOOP", "FOR i IN 0..6 LOOP"), mig: GOOD_MIG, expectRed: "①",
    },
    {
      name: "反例①c：字面量在，循环那一行被注释掉 ⇒ ① 红",
      ddl: GOOD_DDL.replace("  WHILE mn < cover_until LOOP", "  -- WHILE mn < cover_until LOOP"), mig: GOOD_MIG, expectRed: "①",
    },
    {
      name: "反例②a：没有任何迁移声明同一个日期 ⇒ ② 红",
      ddl: GOOD_DDL, mig: { "2026-10-03-extend.sql": "BEGIN;\n  cover_until date := date '2027-02-01';\nCOMMIT;" }, expectRed: "②",
    },
    {
      name: "反例②b：迁移里的同值字面量只在注释里 ⇒ ② 红",
      ddl: GOOD_DDL, mig: { "2026-10-03-extend.sql": "BEGIN;\n-- cover_until date := date '2028-02-01'\nCOMMIT;" }, expectRed: "②",
    },
    {
      name: "反例③：两处都是 2026-11-01（剩 28 天）⇒ ③ 红",
      ddl: GOOD_DDL.replace("'2028-02-01'", "'2026-11-01'"),
      mig: { "2026-10-03-extend.sql": "cover_until date := date '2026-11-01';" }, expectRed: "③",
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const r = evaluate({ ddlSrc: c.ddl, migrations: c.mig, today });
    const red = r.failures.map((f) => f.trim()[0]);
    const ok = c.expectRed === null ? red.length === 0 : red.includes(c.expectRed);
    console.log(`  ${ok ? "✓" : "✗"} ${c.name}${ok ? "" : `  —— 实际：${red.join("") || "绿"}`}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.log(`\n✗ 自检 ${bad} 条不符 —— 守卫的判据与它自己声称拦得住的反例对不上，先修守卫`);
    process.exit(1);
  }
  console.log(`✓ 自检 ${cases.length}/${cases.length}`);
}

// ── 入口 ──────────────────────────────────────────────────────────────────────
console.log("══ 分区预建窗口（check-partition-window）══");
if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const migrations = {};
  for (const f of readdirSync(MIG_DIR)) {
    if (f.endsWith(".sql")) migrations[f] = readFileSync(join(MIG_DIR, f), "utf8");
  }
  const r = evaluate({
    ddlSrc: readFileSync(DDL, "utf8"),
    migrations,
    today: new Date(),
  });
  if (r.declared) {
    console.log(
      `  · 声明覆盖到 ${r.declared}，距今 ${r.days} 天${r.migHit ? `（存量库迁移：${r.migHit}）` : ""}`,
    );
    console.log(
      `  · 三张表：metering.usage_events / metering.usage_event_pools / support.audit_logs`,
    );
  }
  if (r.failures.length) {
    console.log(`\n✗ ${r.failures.length} 处违规：`);
    for (const f of r.failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log("✓ 窗口充足，DDL 的循环真的读 cover_until，且迁移声明一致");
}
