#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-required-settings-seeded.mjs — 代码「读不到就拒绝干活」的设置，seed 里必须有
//
// ## 这条判据为什么存在（2026-10-03）
//
// `2026-10-25-tenant-abuse-caps.sql` 往 `admin.settings` 插了两条租户防滥用闸
// （`tenant.member_limit` = 500、`tenant.workspace_limit` = 200），还自带审计段确认两条都落了。
// **而 `seed-catalog.mjs` 没有这两条。**
//
// 那两列（`tenancy.tenants.member_limit` / `workspace_limit`）可空、无 DEFAULT、建租户时不写，
// 所以每个新租户都是 NULL，而 NULL 的语义是「随 admin.settings 的默认值」。
// `resolveTenantCap` 读不到那条设置时**抛错**而不是回落：
//
//     tenant.member_limit not configured — refusing to proceed without a cap
//
// 拿不到上限就不放行是对的。问题在于：**生产跑迁移所以有那两行，而新库是 DDL + seed
// 建的、不跑迁移**。于是任何新起的环境「接受邀请」与「加成员」一律失败，
// 而且只在有人真去接受邀请的那一刻才现形。这一条是 2026-10-03 一个测试脚手架跑红时挖出来的，
// 不是谁报的 —— 也就是说它可以在仓库里躺任意久。
//
// ## 与既有两条 seed 守卫的关系：这是它们的镜像，谁都没管
//
//   · `check-seed-check-constraints.mjs` —— seed 写进列的**值**违不违反该列的 CHECK。
//     它的来由是一条迁移**收窄了 CHECK** 而三个 seed 没跟上（gender 那次）。
//   · `check-seed-idempotency.mjs` —— `insert into` 带不带 `on conflict`、perm_code 命名。
//
// 两条管的都是「seed 里已经有的那些行写得对不对」。本条管的是**行在不在**：
// 迁移新增了「代码必需」的行，seed 没跟上。方向正好相反，所以哪一条都抓不到。
//
// ## 判据（按它做的事找，不按名字找）
//
// ① 扫 `bff/**` 与 `services/**`，找**读 admin.settings 且读不到就失败**的地方。
//    两种形状都收：
//      · 代码里出现 `"<group>.<key>" ` 形态的字面量，且同一函数体里有
//        `not configured` / `refusing to proceed` / `throw new Error` 之类的拒绝；
//      · `resolveTenantCap(..., "tenant.member_limit")` 这种把 settingKey 当实参传的。
//    **这里不硬编码键名清单** —— 清单会跟不上代码，而代码是事实。
// ② 把 ① 得到的键，对 `deploy/database/seed/*.mjs` 里 `admin.settings` 的 `config_key`
//    字面量求差集。差集非空即红。
//
// ## 看不见什么（写下来，免得「绿了」被当成「没有这类问题」）
//
//   · 只有 `admin.settings` 这一张表。别的「迁移插了必需行、seed 没跟」的表不在本条判据里
//     （要扩就把表名加进 `SETTING_TABLES`，并把取键的办法一并写清）；
//   · 运行期才拼出来的键（`` `tenant.${x}` ``）—— 本条只认字面量，拼出来的看不见；
//   · 「这个默认值对不对」不是本条的事，本条只问「有没有」。
//
// 运行：node scripts/guardrails/check-required-settings-seeded.mjs
//      node scripts/guardrails/check-required-settings-seeded.mjs --self-test
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
const SEED_DIR = join(ROOT, "deploy/database/seed");

/** 读不到就拒绝干活的措辞。按**后果**找，不按函数名找。 */
const REFUSAL =
  /(not configured|refusing to proceed|throw new Error|missing setting|未配置)/i;

/** 形如 `group.key` 的设置键字面量（两段或三段，全小写加下划线）。 */
const KEY_LITERAL = /"([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+){1,2})"/g;

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");

function walk(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs)$/.test(n) && !/\.(spec|test)\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const IS_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+){1,2}$/;
const NOT_A_SETTING = /^(ops|catalog|console|admin|common)\./;

/**
 * 代码侧：哪些设置键是「读不到就拒绝干活」的。
 *
 * **要顺一跳。** 第一版要求「设置键字面量」与「拒绝的措辞」出现在同一个函数体里，
 * 结果代码侧 0 个键 —— 因为拒绝写在 `resolveTenantCap` 里，而键是**调用点**传进去的实参。
 * 一个函数体里看不见这两样同时出现。（守卫因此报的是「有一侧是空集 ⇒ 判据瞎了」
 * 而不是「通过」，这一点是对的：空集不是答案。）
 *
 * 现在的办法：
 *   ① 先找出「读设置且读不到就拒绝」的函数名（体内有拒绝措辞，且碰 admin.settings
 *      或 config_key）；
 *   ② 再找这些函数的**调用点**，把实参里形如 `group.key` 的字面量收下来；
 *   ③ 顺带把这类函数**参数上声明的联合类型**也收下来 —— 本仓习惯把允许的键写成
 *      `settingKey: "tenant.member_limit" | "tenant.workspace_limit"`，
 *      那是代码里最权威的一份清单，比调用点更不容易漏。
 */
function requiredKeys(files) {
  const parsed = files.map((f) => ({
    file: f,
    sf: ts.createSourceFile(
      f,
      readFileSync(f, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    ),
  }));

  // ① 拒绝型函数名
  const refusalFns = new Set();
  const addIfRefusal = (node, sf, name) => {
    if (!node.body) return;
    const body = node.body.getText(sf);
    if (!REFUSAL.test(body)) return;
    if (!/admin\.settings|config_key/.test(body)) return;
    refusalFns.add(name);
  };
  for (const { sf } of parsed) {
    const visit = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name) addIfRefusal(n, sf, n.name.text);
      if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name)) {
        addIfRefusal(n, sf, n.name.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // ②③ 调用点实参 + 参数上的联合类型
  const found = new Map();
  const note = (key, where) => {
    if (!IS_KEY.test(key) || NOT_A_SETTING.test(key)) return;
    if (!found.has(key)) found.set(key, []);
    if (!found.get(key).includes(where)) found.get(key).push(where);
  };
  for (const { file, sf } of parsed) {
    const at = (n) =>
      `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = ts.isIdentifier(n.expression)
          ? n.expression.text
          : ts.isPropertyAccessExpression(n.expression)
            ? n.expression.name.text
            : null;
        if (callee && refusalFns.has(callee)) {
          for (const a of n.arguments) {
            if (ts.isStringLiteral(a)) note(a.text, at(n));
          }
        }
      }
      if (
        (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
        n.name &&
        refusalFns.has(n.name.getText(sf))
      ) {
        for (const p of n.parameters) {
          if (p.type && ts.isUnionTypeNode(p.type)) {
            for (const t of p.type.types) {
              if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
                note(t.literal.text, at(p));
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found;
}

/** seed 侧：`admin.settings` 的 insert 里出现过哪些 config_key 字面量。 */
function seededKeys() {
  const out = new Set();
  for (const f of readdirSync(SEED_DIR).filter((n) => n.endsWith(".mjs"))) {
    const src = readFileSync(join(SEED_DIR, f), "utf8");
    // 只看提到 admin.settings 的那些语句块，免得把别的表的键收进来
    let at = 0;
    for (;;) {
      const i = src.indexOf("admin.settings", at);
      if (i < 0) break;
      const chunk = src.slice(i, i + 4000);
      KEY_LITERAL.lastIndex = 0;
      let k;
      while ((k = KEY_LITERAL.exec(chunk))) out.add(k[1]);
      // 单引号的那一种（seed 里 SQL 字面量用单引号）
      for (const mm of chunk.matchAll(
        /'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+){1,2})'/g,
      )) {
        out.add(mm[1]);
      }
      at = i + 1;
    }
  }
  return out;
}

const CODE_FILES = [...walk(join(ROOT, "bff")), ...walk(join(ROOT, "services"))];
const required = requiredKeys(CODE_FILES);
const seeded = seededKeys();
const missing = [...required.keys()].filter((k) => !seeded.has(k));

if (process.argv.includes("--self-test")) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  console.log("══ 自检：先证这条判据两头都看得见，而且会对反例说话 ══\n");

  say(
    required.has("tenant.member_limit"),
    `代码侧认出了 tenant.member_limit（读不到就抛的那条）` +
      (required.has("tenant.member_limit")
        ? `：${required.get("tenant.member_limit")[0]}`
        : " ← 认不出就等于没判据"),
  );
  say(
    required.has("tenant.workspace_limit"),
    "代码侧认出了 tenant.workspace_limit",
  );
  say(
    seeded.has("subscription.max_suspend_days"),
    "seed 侧认出了 subscription.max_suspend_days（一条确实在 seed 里的）",
  );
  // 反例：把一个**确实在 seed 里**的键从 seed 侧拿掉，差集必须报它。
  // （第一版这里写的是 `missing.length >= 0` —— 恒真，等于没断言。）
  const victim = "tenant.member_limit";
  const seededMinus = new Set([...seeded].filter((k) => k !== victim));
  const diffWithout = [...required.keys()].filter((k) => !seededMinus.has(k));
  say(
    required.has(victim) && diffWithout.includes(victim),
    `反例会被报出来：把 ${victim} 从 seed 侧拿掉 → 差集里出现它` +
      "  —— 判据必须会动，不然它只是看起来在拦",
  );
  say(
    required.size > 0 && seeded.size > 0,
    `两侧都不是空集：代码侧 ${required.size} 个键、seed 侧 ${seeded.size} 个键` +
      "  —— 任一侧为空都说明判据瞎了，而不是「没问题」",
  );

  console.log(`\n── 汇总 ──\n看得见 ${5 - bad}/5 项判据`);
  if (bad) {
    console.log("这条判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("两侧都看得见、差集算得出。这条判据可以用了。");
  process.exit(0);
}

console.log(
  `══ 代码必需的设置键 ${required.size} 个；seed 提供 ${seeded.size} 个`,
);
if (required.size === 0 || seeded.size === 0) {
  console.log(
    "\n✗ 有一侧是空集 —— 那不是「通过」，是判据瞎了（措辞变了？seed 搬家了？）。",
  );
  process.exit(1);
}
for (const [k, where] of required) {
  console.log(`   ${seeded.has(k) ? "有" : "缺"}  ${k}   ${where[0]}`);
}
if (missing.length) {
  console.log(`\n✗ ${missing.length} 个键代码读不到就拒绝干活，而 seed 里没有：`);
  for (const k of missing) {
    console.log(`  · ${k}`);
    for (const w of required.get(k)) console.log(`      读它的地方：${w}`);
  }
  console.log(
    "\n  生产跑迁移所以可能有这几行，而**新库是 DDL + seed 建的、不跑迁移** ——\n" +
      "  差的这几行会让新环境在跑到那条路径的那一刻才失败。\n" +
      "  补法：把迁移里那段 insert 的**同样值**抄进 deploy/database/seed/seed-catalog.mjs\n" +
      "  （config_group 与 value 逐字一致，别另定一套），带 on conflict (config_key) do nothing。",
  );
  process.exit(1);
}
console.log("\n✓ 代码必需的设置键，seed 全都提供了。");
