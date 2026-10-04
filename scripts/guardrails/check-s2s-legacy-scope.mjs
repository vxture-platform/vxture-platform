#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-s2s-legacy-scope.mjs — 旧凭据那条路上，每个调用点的选择必须在册
//                               （2026-10-04 起：代上报票那条路也是）
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
// ## 第二条路：代上报票（决策 3 PR C，2026-10-04）
//
// auth-bff 为 L1 上报者（atlas）铸的 `aud=vxture` 票带 `delegated: true`、没有 workspace：
// `act.sub` 是上报者，请求体自报的产品是**归属产品**、自报的 workspace 照用。这与旧凭据
// 那条路同形——都是「信请求体」，区别只在发送方身份可证。所以第四个实参 `delegated`
// 同样必填（`attribute-declared` / `deny`），同样登记进快照：那张表就是
// 「一张被盗的代上报票能驱动什么」的清单。今天只有两格收它（C2 读、C3 token 上报），
// 其余 deny——守卫只长在一条分支等于给别条留门。
//
// 为什么是「必填参数 + 快照」而不是「一条 lint 规则」：一个隐式的 `return requested`
// 不会出现在任何清单上（E4 那一批的同一条教训——守卫只长在一条分支，等于给别条留门）。
// 必填参数让编译器先拦一道，快照让**新增一处**在 CI 上现形。
//
// ## 判据
//
// ① 扫 `bff/platform-api/**` 里所有 `scopeToS2sCaller(` 调用点，解析第三、第四个实参；
// ② 每个调用点（文件:行 + 它解析出的两档）必须与快照逐字相符；
// ③ 第三 / 第四个实参既不是字面量也不是三元里的两个字面量 → 红（动态值等于说不清这一格是哪档）；
//    少于四个实参 → 红（缺一档就是缺一张登记）；
// ④ 快照里的 `trustDeclared` 与 `delegatedAttributing` 两个计数只应**减少**。增加必须是
//    有意的，改快照时要写理由。
//
// ## 本守卫看不见什么
//
//   · 它只看 `scopeToS2sCaller` 这一个函数。别处若另写一份「没有 s2sCaller 就信请求体」
//     的逻辑，本守卫一无所知 —— 那种情况靠 `PlatformAuthGuard` 的调用点清单去兜；
//   · 它不验运行时：`trust-declared` 的那几处今天**确实**在信任自报值，这是登记而非修复；
//     `attribute-declared` 的两处也**确实**只凭 `delegated` claim 就信自报的归属与工作区；
//   · 三元之外的条件形式（if/else 分支里各调一次）会被当成两个独立调用点，那是对的；
//   · 档位若经一个**变量**传进来（`scopeToS2sCaller(c, r, policyVar, …)`），取不到字面量会报红
//     —— 那是刻意的：类型系统只保证它是两个值之一，而快照要的是「哪一格是哪档」看得见。
//     要用变量就把它内联成三元，别绕过登记；
//   · 它不验 `delegated` claim 怎么来的——那是 `platform-auth.guard.spec.ts` 与 auth-bff
//     `token-exchange.service.spec.ts` 的事（谁能铸、铸出来长什么样）。
//
// 运行：node scripts/guardrails/check-s2s-legacy-scope.mjs
//      node scripts/guardrails/check-s2s-legacy-scope.mjs --update
//      node scripts/guardrails/check-s2s-legacy-scope.mjs --self-test   （解析器与棘轮的反例）
// 退出码：新增调用点 / 档位与快照不符 / 动态实参 / 缺实参 / 计数变多 → 1
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
const SELF_TEST = process.argv.includes("--self-test");
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
/** 第三个实参：旧凭据那条路的档位。 */
const POLICIES = new Set(["trust-declared", "deny"]);
/** 第四个实参：代上报票那条路的档位。 */
const DELEGATED_POLICIES = new Set(["attribute-declared", "deny"]);

const NOTE =
  "本文件由 check-s2s-legacy-scope.mjs --update 生成，不要手改。登记的是 scopeToS2sCaller 每个调用点在两条「信请求体」的路上各自的选择：policy = 走旧凭据（共享 x-vxture-internal-auth，无 s2sCaller）时怎么办；delegated = 来的是代上报票（auth-bff 为 L1 上报者 atlas 铸的 aud=vxture 票，delegated:true、无 workspace）时怎么办。trust-declared 的条目是**已登记的缺口**：那一格今天确实在信任请求体自报的 workspace，收紧要先让五个对接方换凭据（E2/E3）。attribute-declared 的条目是代上报票**被允许驱动的能力**（C2 读、C3 token 上报），一张被盗的票能做的事就是这两格。两个计数都只应减少，增加必须是有意的。";

// ── 解析：一份源码里的所有调用点 ────────────────────────────────────────────
/**
 * @param {string} src
 * @param {string} rel  仓库相对路径（只用来标 at 与判 spec）
 * @returns {{ sites: {at:string, policy:string, delegated:string}[], findings: string[] }}
 */
export function extractSites(src, rel) {
  const sites = [];
  const findings = [];
  // spec 里的调用是测这个函数本身，不是「一个在产的调用点」；
  // s2s-scope.ts 里那一处是**函数定义**（第一版把它当调用点报了红）。
  const isSpec = /\.spec\.ts$/.test(rel) || /\/s2s-scope\.ts$/.test(rel);
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

    // 顶层逗号切分 → 第三、第四个实参。
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
    // 末尾的 trailing comma 会多切出一个空串。
    while (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    if (parts.length < 4) {
      findings.push(
        `${rel}:${line} —— 只有 ${parts.length} 个实参，缺 ${parts.length < 3 ? "legacy 与 delegated" : "delegated"} 档位`,
      );
      continue;
    }
    const pick = (text, allowed, name) => {
      // **只取属于各自词表的字面量**。三元里会有别的字符串（如
      // `parsed.intent === "reserve" ? …`、`parsed.kind === "tokens" ? …`），
      // 第一版把 "reserve" 当成未知档位报了红。
      const literals = [...text.matchAll(/"([a-z-]+)"/g)]
        .map((m) => m[1])
        .filter((l) => allowed.has(l));
      if (literals.length === 0) {
        findings.push(
          `${rel}:${line} —— 第${name}个实参里找不到任何档位字面量：${text.trim().replace(/\s+/g, " ").slice(0, 80)}`,
        );
        return null;
      }
      // 三元会给出两个字面量，按顺序记下来；一个就是固定档。
      return literals.join("+");
    };
    const policy = pick(parts[2], POLICIES, "三");
    const delegated = pick(parts[3], DELEGATED_POLICIES, "四");
    if (policy === null || delegated === null) continue;
    sites.push({ at: `${rel}:${line}`, policy, delegated });
  }
  return { sites, findings };
}

/** 汇总两个棘轮计数。 */
export function tally(sites) {
  return {
    trustDeclared: sites.filter((s) => s.policy.includes("trust-declared"))
      .length,
    delegatedAttributing: sites.filter((s) =>
      s.delegated.includes("attribute-declared"),
    ).length,
  };
}

/** 与快照比对，返回 findings（空 = 相符）。 */
export function compare(sites, snap) {
  const findings = [];
  // 「读不到就抛，不要当通过」：快照缺字段时不许静默放行。
  if (
    !Array.isArray(snap?.sites) ||
    typeof snap?.trustDeclared !== "number" ||
    typeof snap?.delegatedAttributing !== "number"
  ) {
    findings.push("快照结构不对（缺 sites / trustDeclared / delegatedAttributing）");
    return findings;
  }
  const key = (s) => `${s.at}\t${s.policy}\t${s.delegated ?? "(缺)"}`;
  const have = new Set(sites.map(key));
  const want = new Set(snap.sites.map(key));
  for (const s of sites) {
    if (!want.has(key(s)))
      findings.push(
        `新增 / 变更的调用点未登记：${s.at} → legacy=${s.policy} delegated=${s.delegated}`,
      );
  }
  for (const s of snap.sites) {
    if (!have.has(key(s)))
      findings.push(
        `快照里有、代码里没有（行号变了也算）：${s.at} → legacy=${s.policy} delegated=${s.delegated}`,
      );
  }
  const t = tally(sites);
  if (t.trustDeclared > snap.trustDeclared) {
    findings.push(
      `含 trust-declared 的调用点从 ${snap.trustDeclared} 增到 ${t.trustDeclared} —— 这个数只该减少`,
    );
  }
  if (t.delegatedAttributing > snap.delegatedAttributing) {
    findings.push(
      `含 attribute-declared（收代上报票）的调用点从 ${snap.delegatedAttributing} 增到 ${t.delegatedAttributing} —— 这个数只该减少`,
    );
  }
  return findings;
}

// ── 自检：解析器与棘轮的反例，每条都要能让它红 ───────────────────────────────
function selfTest() {
  const R = "bff/platform-api/src/routers/x.router.ts";
  const must = (cond, label) => {
    if (!cond) {
      console.error(`✗ self-test: ${label}`);
      process.exit(1);
    }
    console.log(`  ✓ ${label}`);
  };
  // 正例 1：四个字面量。
  {
    const { sites, findings } = extractSites(
      `const { workspaceId } = scopeToS2sCaller(s2sCaller, parsed, "trust-declared", "attribute-declared");`,
      R,
    );
    must(findings.length === 0 && sites.length === 1, "四个字面量 → 一个调用点、零 finding");
    must(
      sites[0].policy === "trust-declared" && sites[0].delegated === "attribute-declared",
      "两档各自取自第三、第四个实参",
    );
  }
  // 正例 2：两个三元；别的字符串字面量（"amount" / "reserve" / "tokens"）不算档位。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(
        s2sCaller,
        { workspaceId: parsed.workspaceId, productCodes: [parsed.productCode] },
        parsed.kind === "amount" && parsed.intent === "reserve" ? "deny" : "trust-declared",
        parsed.kind === "tokens" ? "attribute-declared" : "deny",
      );`,
      R,
    );
    must(findings.length === 0 && sites.length === 1, "两个三元 → 一个调用点");
    must(
      sites[0].policy === "deny+trust-declared" && sites[0].delegated === "attribute-declared+deny",
      "三元记两个字面量，无关字符串不入档（amount/reserve/tokens）",
    );
    must(
      tally(sites).trustDeclared === 1 && tally(sites).delegatedAttributing === 1,
      "三元里含那一档就计入棘轮",
    );
  }
  // 反例 1：只有三个实参（2026-10-04 之前的写法）→ 红。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(s2sCaller, parsed, "trust-declared");`,
      R,
    );
    must(sites.length === 0 && findings.length === 1 && /缺 delegated 档位/.test(findings[0]), "三个实参 → 红「缺 delegated 档位」");
  }
  // 反例 2：第四个实参走变量 → 红。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(s2sCaller, parsed, "trust-declared", delegatedPolicy);`,
      R,
    );
    must(sites.length === 0 && findings.length === 1 && /第四个实参/.test(findings[0]), "第四个实参是变量 → 红");
  }
  // 反例 3：第三个实参走变量 → 红（既有规则不因加了第四档而松动）。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(s2sCaller, parsed, policyVar, "deny");`,
      R,
    );
    must(sites.length === 0 && findings.length === 1 && /第三个实参/.test(findings[0]), "第三个实参是变量 → 红");
  }
  // 反例 4：spec 与定义处不算调用点。
  {
    const spec = extractSites(`scopeToS2sCaller(undefined, r, "deny", "deny")`, R.replace(/\.ts$/, ".spec.ts"));
    const def = extractSites(`export function scopeToS2sCaller(a, b, c, d) {}`, "bff/platform-api/src/authn/s2s-scope.ts");
    must(spec.sites.length === 0 && def.sites.length === 0, "spec 与函数定义不计");
  }
  // 棘轮 1：代码里多了一格收代上报票 → 红。
  {
    const sites = [
      { at: `${R}:1`, policy: "deny", delegated: "attribute-declared" },
      { at: `${R}:9`, policy: "deny", delegated: "attribute-declared" },
    ];
    const snap = { trustDeclared: 0, delegatedAttributing: 1, sites: [sites[0]] };
    const f = compare(sites, snap);
    must(f.some((x) => /attribute-declared.*从 1 增到 2/.test(x)), "delegatedAttributing 变多 → 红");
    must(f.some((x) => /未登记/.test(x)), "未登记的新调用点 → 红");
  }
  // 棘轮 2：同一调用点只改 delegated 档位（attribute-declared → deny）是收紧，但快照要重算。
  {
    const snapSites = [{ at: `${R}:1`, policy: "trust-declared", delegated: "attribute-declared" }];
    const now = [{ at: `${R}:1`, policy: "trust-declared", delegated: "deny" }];
    const f = compare(now, { trustDeclared: 1, delegatedAttributing: 1, sites: snapSites });
    must(f.some((x) => /未登记/.test(x)) && f.some((x) => /代码里没有/.test(x)), "档位变了但快照没重算 → 红（两条）");
  }
  // 棘轮 3：旧格式快照（无 delegatedAttributing / 条目无 delegated）→ 红，不许静默放行。
  {
    const f = compare([], { trustDeclared: 0, sites: [] });
    must(f.length === 1 && /快照结构不对/.test(f[0]), "缺 delegatedAttributing 的旧快照 → 红");
  }
  // 正例 3：真仓里信号会动——五个调用点、两格收代上报票（entitlements、usage.consume）。
  {
    const real = scanRepo();
    const t = tally(real.sites);
    must(real.findings.length === 0, "真仓零 finding");
    must(real.sites.length === 5, `真仓命中 5 个调用点（实得 ${real.sites.length}）`);
    must(t.delegatedAttributing === 2, `真仓两格收代上报票（实得 ${t.delegatedAttributing}）`);
    must(
      real.sites.filter((s) => s.delegated.includes("attribute-declared")).every((s) => /platform-(entitlements|usage)\.router\.ts/.test(s.at)),
      "收代上报票的两格只在 entitlements 与 usage router",
    );
  }
  console.log("✓ check-s2s-legacy-scope --self-test 全部通过");
}

// ── 扫仓 ──────────────────────────────────────────────────────────────────
function scanRepo() {
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
  const sites = [];
  const findings = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    const r = extractSites(readFileSync(file, "utf8"), rel);
    sites.push(...r.sites);
    findings.push(...r.findings);
  }
  sites.sort((a, b) => a.at.localeCompare(b.at));
  return { files, sites, findings };
}

if (SELF_TEST) {
  selfTest();
  process.exit(0);
}

const { files, sites, findings } = scanRepo();
const counts = tally(sites);

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
        note: NOTE,
        trustDeclared: counts.trustDeclared,
        delegatedAttributing: counts.delegatedAttributing,
        sites,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `快照已重算：${sites.length} 个调用点，其中 ${counts.trustDeclared} 个含 trust-declared、${counts.delegatedAttributing} 个含 attribute-declared` +
      (prev
        ? `（上一版 ${prev.trustDeclared} / ${prev.delegatedAttributing ?? "无此计数"}）`
        : ""),
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
findings.push(...compare(sites, snap));

console.log("══ 旧凭据 / 代上报票作用域档位检查（check-s2s-legacy-scope）══");
console.log(
  `扫 ${files.length} 份 .ts，命中 ${sites.length} 个在产调用点（spec 不计）；含 trust-declared ${counts.trustDeclared} 个、收代上报票（attribute-declared）${counts.delegatedAttributing} 个。`,
);
for (const s of sites)
  console.log(`  · ${s.at}  →  legacy=${s.policy}  delegated=${s.delegated}`);

if (findings.length) {
  console.log("\n── 汇总 ──");
  for (const f of findings) console.log(`  ERROR ${f}`);
  console.log(
    `error: ${findings.length}\n` +
      "新增调用点必须自己选 legacy 与 delegated 两个档位并 --update 快照；把某一格改成 deny 之前，先确认那一格今天没有在产的旧凭据调用方；把某一格改成 attribute-declared 之前，先确认上报者真的需要替人驱动它。",
  );
  process.exit(1);
}
console.log("\n✓ 未发现问题（每个调用点的两个档位都在册）。");
