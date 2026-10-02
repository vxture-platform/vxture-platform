#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-s2s-legacy-scope.mjs — 旧凭据那条路上，每个调用点的选择必须在册
//
// ## 补的是哪个盲区
//
// `PlatformAuthGuard` 两条路：Bearer（令牌带 workspace_id，D2 铸币时校验过）与
// **旧凭据**（共享 `x-vxture-internal-auth`，不设 `req.s2sCaller`）。走旧凭据时
// `scopeToS2sCaller` 此前**原样回显请求体自报的 workspace**，而那个值下一跳就进 SQL 的
// 归属谓词（配额池 / 共享可见集，后者还会**往那个工作空间写**物化行）。
//
// 根治要五个产品端换凭据（E2/E3，owner 的取舍 + 对外协调）。在那之前，本守卫守的是
// **别再悄悄多一处**：2026-10-02 起 `legacy` 参数必填，每个调用点自己写明
// `trust-declared` 还是 `deny`，本守卫把这些选择钉进快照。
//
// 为什么是「必填参数 + 快照」而不是「一条 lint 规则」：一个隐式的 `return requested`
// 不会出现在任何清单上（E4 那一批的同一条教训——守卫只长在一条分支，等于给别条留门）。
// 必填参数让编译器先拦一道，快照让**新增一处**在 CI 上现形。
//
// ## 判据
//
// ① 扫 `bff/platform-api/**` 里所有 `scopeToS2sCaller(` 调用点，解析第三个实参；
// ② 每个调用点（文件:行 + 它解析出的档位）必须与快照逐字相符；
// ③ 第三个实参既不是字面量也不是三元里的两个字面量 → 红（动态值等于说不清这一格是哪档）；
// ④ 快照里的 `trustDeclared` 计数只应**减少**。增加必须是有意的，改快照时要写理由。
//
// ## 本守卫看不见什么
//
//   · 它只看 `scopeToS2sCaller` 这一个函数。别处若另写一份「没有 s2sCaller 就信请求体」
//     的逻辑，本守卫一无所知 —— 那种情况靠 `PlatformAuthGuard` 的调用点清单去兜；
//   · 它不验运行时：`trust-declared` 的那几处今天**确实**在信任自报值，这是登记而非修复；
//   · 三元之外的条件形式（if/else 分支里各调一次）会被当成两个独立调用点，那是对的；
//   · 档位若经一个**变量**传进来（`scopeToS2sCaller(c, r, policyVar)`），取不到字面量会报红
//     —— 那是刻意的：类型系统只保证它是两个值之一，而快照要的是「哪一格是哪档」看得见。
//     要用变量就把它内联成三元，别绕过登记。
//
// 运行：node scripts/guardrails/check-s2s-legacy-scope.mjs
//      node scripts/guardrails/check-s2s-legacy-scope.mjs --update
// 退出码：新增调用点 / 档位与快照不符 / 动态实参 / trustDeclared 变多 → 1
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SNAPSHOT = join(
  REPO_ROOT,
  "scripts",
  "guardrails",
  "s2s-legacy-scope.snapshot.json",
);
const SCAN_ROOT = join(REPO_ROOT, "bff", "platform-api");
const UPDATE = process.argv.includes("--update");
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
const POLICIES = new Set(["trust-declared", "deny"]);

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) files.push(p);
  }
}
walk(SCAN_ROOT);

const findings = [];
const sites = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  // spec 里的调用是测这个函数本身，不是「一个在产的调用点」；
  // s2s-scope.ts 里那一处是**函数定义**（第一版把它当调用点报了红）。
  const isSpec = /\.spec\.ts$/.test(file) || /\/s2s-scope\.ts$/.test(rel);
  let idx = 0;
  for (;;) {
    idx = src.indexOf("scopeToS2sCaller(", idx);
    if (idx === -1) break;
    const open = src.indexOf("(", idx);
    // 括号配平取出整个实参串。
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const args = src.slice(open + 1, i);
    const line = src.slice(0, idx).split("\n").length;
    idx = i;
    if (isSpec) continue;

    // 顶层逗号切分 → 第三个实参。
    const parts = [];
    let d = 0;
    let cur = "";
    for (const ch of args) {
      if ("([{".includes(ch)) d++;
      else if (")]}".includes(ch)) d--;
      if (ch === "," && d === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    if (parts.length < 3) {
      findings.push(`${rel}:${line} —— 只有 ${parts.length} 个实参，缺 legacy 档位`);
      continue;
    }
    const third = parts[2].trim().replace(/,$/, "");
    // **只取属于 POLICIES 的字面量**。三元里会有别的字符串（如
    // `parsed.intent === "reserve" ? …`），第一版把 "reserve" 当成未知档位报了红。
    const literals = [...third.matchAll(/"([a-z-]+)"/g)]
      .map((m) => m[1])
      .filter((l) => POLICIES.has(l));
    if (literals.length === 0) {
      findings.push(
        `${rel}:${line} —— 第三个实参里找不到任何档位字面量：${third.replace(/\s+/g, " ").slice(0, 80)}`,
      );
      continue;
    }
    sites.push({
      at: `${rel}:${line}`,
      // 三元会给出两个字面量，按顺序记下来；一个就是固定档。
      policy: literals.join("+"),
    });
  }
}

sites.sort((a, b) => a.at.localeCompare(b.at));
const trustDeclared = sites.filter((s) => s.policy.includes("trust-declared")).length;

if (UPDATE) {
  const prev = (() => {
    try {
      return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    } catch {
      return null;
    }
  })();
  writeFileSync(
    SNAPSHOT,
    `${JSON.stringify(
      {
        note:
          "本文件由 check-s2s-legacy-scope.mjs --update 生成，不要手改。登记的是走旧凭据（共享 x-vxture-internal-auth，无 s2sCaller）时各调用点的选择。trust-declared 的条目是**已登记的缺口**：那一格今天确实在信任请求体自报的 workspace，收紧要先让五个对接方换凭据（E2/E3）。条目只应减少（改成 deny），增加必须是有意的。",
        trustDeclared,
        sites,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `快照已重算：${sites.length} 个调用点，其中 ${trustDeclared} 个含 trust-declared` +
      (prev ? `（上一版 ${prev.trustDeclared}）` : ""),
  );
  process.exit(0);
}

let snap;
try {
  snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
} catch {
  console.error("✗ 读不到快照 s2s-legacy-scope.snapshot.json —— 先跑一次 --update");
  process.exit(1);
}

// 「读不到就抛，不要当通过」：快照缺字段时不许静默放行。
if (!Array.isArray(snap.sites) || typeof snap.trustDeclared !== "number") {
  console.error("✗ 快照结构不对（缺 sites / trustDeclared）");
  process.exit(1);
}

const key = (s) => `${s.at}\t${s.policy}`;
const have = new Set(sites.map(key));
const want = new Set(snap.sites.map(key));
for (const s of sites) {
  if (!want.has(key(s))) findings.push(`新增 / 变更的调用点未登记：${s.at} → ${s.policy}`);
}
for (const s of snap.sites) {
  if (!have.has(key(s)))
    findings.push(`快照里有、代码里没有（行号变了也算）：${s.at} → ${s.policy}`);
}
if (trustDeclared > snap.trustDeclared) {
  findings.push(
    `含 trust-declared 的调用点从 ${snap.trustDeclared} 增到 ${trustDeclared} —— 这个数只该减少`,
  );
}

console.log("══ 旧凭据作用域档位检查（check-s2s-legacy-scope）══");
console.log(
  `扫 ${files.length} 份 .ts，命中 ${sites.length} 个在产调用点（spec 不计）；含 trust-declared ${trustDeclared} 个。`,
);
for (const s of sites) console.log(`  · ${s.at}  →  ${s.policy}`);

if (findings.length) {
  console.log("\n── 汇总 ──");
  for (const f of findings) console.log(`  ERROR ${f}`);
  console.log(
    `error: ${findings.length}\n` +
      "新增调用点必须自己选一个 legacy 档位并 --update 快照；把某一格改成 deny 之前，先确认那一格今天没有在产的旧凭据调用方。",
  );
  process.exit(1);
}
console.log("\n✓ 未发现问题（每个调用点的 legacy 档位都在册）。");
