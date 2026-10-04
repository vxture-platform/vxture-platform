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
// ① 整份源码先剥掉注释（换行一个不少，行号与编辑器一致），再扫 `bff/platform-api/**` 里所有
//    `scopeToS2sCaller(` 调用点（`(` 前允许空白 / 换行），解析第三、第四个实参；
// ② 每个调用点（文件:行 + 它解析出的两档）必须与快照逐字相符；
// ③ 第三 / 第四个实参必须**整个**是一个档位字面量，或「条件 ? 字面量 : 字面量」（两支都整个是
//    字面量）；别的形状——变量、嵌套三元、注释里夹一个字面量、不在词表里的字面量——→ 红
//    （动态值等于说不清这一格是哪档）；少于四个实参 → 红（缺一档就是缺一张登记）；
// ④ 在产文件里 `scopeToS2sCaller` 这个名字只许两种出现：import 说明符里的原名、与一次调用。
//    `as` 改名（import / export）、赋给变量、当回调传 → 红：守卫按原名找调用点，改了名就看不见，
//    而看不见的那一格照样在信请求体；
// ⑤ 快照里的 `trustDeclared` 与 `delegatedAttributing` 两个计数只应**减少**。增加必须是
//    有意的，改快照时要写理由。`--self-test` 的正例也只认这个方向（计数 ≤ 快照），不钉今天的数：
//    钉「正好 5 个 / 正好 2 格」会让一次合法的收紧（某格 attribute-declared → deny，`--update`
//    之后主检查绿）在 CI 里紧跟着跑的自检上红掉，而守卫打印的处置里没有一条能解开它
//    （2026-10-05 审查 3c 抓到）。
//
// ## 本守卫看不见什么
//
//   · 它只看 `scopeToS2sCaller` 这一个函数。别处若另写一份「没有 s2sCaller 就信请求体」
//     的逻辑，本守卫一无所知 —— 那种情况靠 `PlatformAuthGuard` 的调用点清单去兜；
//   · 把这一次调用包进一个 wrapper、再从多处调 wrapper：登记只有 wrapper 里那一处。今天没有
//     这种写法；出现时要连 wrapper 的调用方一起读，快照上看不出「一处登记、多处生效」；
//   · 它不验运行时：`trust-declared` 的那几处今天**确实**在信任自报值，这是登记而非修复；
//     `attribute-declared` 的两处也**确实**只凭 `delegated` claim 就信自报的归属与工作区；
//   · 三元之外的条件形式（if/else 分支里各调一次）会被当成两个独立调用点，那是对的；
//   · 档位若经一个**变量**传进来（`scopeToS2sCaller(c, r, policyVar, …)`），取不到字面量会报红
//     —— 那是刻意的：类型系统只保证它是两个值之一，而快照要的是「哪一格是哪档」看得见。
//     要用变量就把它内联成三元，别绕过登记；
//   · 去注释是按字符走的简单扫描（认 " ' ` 三种字符串与反斜杠转义），正则字面量里的 `//`
//     会被当成行注释——同一行它后面的调用会丢；`import * as ns` 之后 `ns.scopeToS2sCaller(`
//     按名能看见；
//   · 它不验 `delegated` claim 怎么来的——那是 `platform-auth.guard.spec.ts` 与 auth-bff
//     `token-exchange.service.spec.ts` 的事（谁能铸、铸出来长什么样）。
//
// 运行：node scripts/guardrails/check-s2s-legacy-scope.mjs
//      node scripts/guardrails/check-s2s-legacy-scope.mjs --update
//      node scripts/guardrails/check-s2s-legacy-scope.mjs --self-test   （解析器与棘轮的反例）
// 退出码：新增调用点 / 档位与快照不符 / 动态实参 / 缺实参 / 改名引用 / 计数变多 → 1
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
 * 剥掉注释；字符串原样留着，换行一个不少（行号要和编辑器里一致）。
 * 认 " ' ` 三种字符串与反斜杠转义；正则字面量不认（见文件头「看不见什么」）。
 * @param {string} text
 */
export function stripComments(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      // 块注释换成一个空格 + 它里面的换行，行号不漂。
      out += " " + text.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const FN = "scopeToS2sCaller";
const CALL_RE = /\bscopeToS2sCaller\s*\(/g;
const NAME_RE = /\bscopeToS2sCaller\b/g;
/** `import { … } from "…"` / `import type { … } from "…"`：说明符括号的范围。 */
const IMPORT_RE = /\bimport\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["']/g;

/** 顶层逗号切分实参串。 */
function splitArgs(args) {
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
  return parts;
}

/**
 * 一个实参 → 档位。整个实参必须是 `"档"`，或 `条件 ? "档" : "档"`（两支都整个是字面量）。
 *
 * 第一版「取实参里所有字符串」把三元条件里的 "reserve" 当成未知档位报了红；第二版改成
 * 「取实参里任何位置属于词表的字面量」，于是 `/* "deny" *​/ policyVar` 也登记成了固定档
 * （2026-10-05 审查 3c）。现在：注释在 extractSites 里已先剥掉，这里只认整体形状。
 * @param {string} raw
 * @param {Set<string>} allowed
 * @returns {{ tier: string } | { error: string }}
 */
export function parseTier(raw, allowed) {
  const text = raw.replace(/\s+/g, " ").trim();
  const words = [...allowed].join(" / ");
  const lit = /^"([a-z-]+)"$/.exec(text);
  if (lit) {
    return allowed.has(lit[1])
      ? { tier: lit[1] }
      : { error: `"${lit[1]}" 不在词表里（${words}）` };
  }
  // 贪婪的 `(.*)\?` 把条件吃到最后一个 `?`；条件里不许再有 `?`（嵌套三元拒——拆成 if/else
  // 各调一次才登记得清）。`?.` / `??` 与字符串里的 `?` 不算。
  const tern = /^(.*)\?\s*"([a-z-]+)"\s*:\s*"([a-z-]+)"$/.exec(text);
  if (tern) {
    const cond = tern[1]
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "")
      .replace(/\?\?|\?\./g, "");
    if (!cond.includes("?")) {
      const [a, b] = [tern[2], tern[3]];
      if (!allowed.has(a) || !allowed.has(b))
        return {
          error: `三元两支里有不在词表里的："${a}" / "${b}"（${words}）`,
        };
      return { tier: `${a}+${b}` };
    }
  }
  return {
    error: `不是档位字面量，也不是「条件 ? 字面量 : 字面量」：${text.slice(0, 80)}`,
  };
}

/**
 * @param {string} rawSrc
 * @param {string} rel  仓库相对路径（只用来标 at 与判 spec）
 * @returns {{ sites: {at:string, policy:string, delegated:string}[], findings: string[] }}
 */
export function extractSites(rawSrc, rel) {
  const sites = [];
  const findings = [];
  // spec 里的调用是测这个函数本身，不是「一个在产的调用点」；
  // s2s-scope.ts 里那一处是**函数定义**（第一版把它当调用点报了红）。
  const isSpec = /\.spec\.ts$/.test(rel) || /\/s2s-scope\.ts$/.test(rel);
  if (isSpec) return { sites, findings };
  const src = stripComments(rawSrc);
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;

  // ④ 这个名字只许以原名 import、与被调用。
  const importRanges = [...src.matchAll(IMPORT_RE)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  for (const m of src.matchAll(NAME_RE)) {
    const after = src.slice(m.index + FN.length);
    if (/^\s*\(/.test(after)) continue;
    const inImport = importRanges.some(
      ([a, b]) => m.index >= a && m.index < b,
    );
    if (inImport && !/^\s+as\s+/.test(after)) continue;
    findings.push(
      inImport
        ? `${rel}:${lineOf(m.index)} —— scopeToS2sCaller 被 as 改名导入：守卫按原名找调用点，改了名就看不见`
        : `${rel}:${lineOf(m.index)} —— scopeToS2sCaller 被当成值引用（改名导出 / 赋给变量 / 当回调传），不是一次可登记的调用`,
    );
  }

  for (const m of src.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1;
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
    const line = lineOf(m.index);
    const parts = splitArgs(args);
    if (parts.length < 4) {
      findings.push(
        `${rel}:${line} —— 只有 ${parts.length} 个实参，缺 ${parts.length < 3 ? "legacy 与 delegated" : "delegated"} 档位`,
      );
      continue;
    }
    const policy = parseTier(parts[2], POLICIES);
    const delegated = parseTier(parts[3], DELEGATED_POLICIES);
    if ("error" in policy)
      findings.push(`${rel}:${line} —— 第三个实参${policy.error}`);
    if ("error" in delegated)
      findings.push(`${rel}:${line} —— 第四个实参${delegated.error}`);
    if ("error" in policy || "error" in delegated) continue;
    sites.push({
      at: `${rel}:${line}`,
      policy: policy.tier,
      delegated: delegated.tier,
    });
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
  // 正例 3：`(` 前有空白 / 换行也是调用；注释掉的调用不是；行号按原文算。
  {
    const { sites, findings } = extractSites(
      `// scopeToS2sCaller(s2sCaller, parsed, "deny", "deny");
      /* scopeToS2sCaller(s2sCaller, parsed, "trust-declared", "attribute-declared") */
      const a = scopeToS2sCaller (s2sCaller, parsed, "deny", "deny");
      const b = scopeToS2sCaller
        (s2sCaller, parsed, "deny", "attribute-declared");`,
      R,
    );
    must(findings.length === 0 && sites.length === 2, "空白 / 换行后的 `(` 也是调用；注释掉的调用不计");
    must(sites[0].at === `${R}:3` && sites[1].at === `${R}:4`, "行号按原文算（去注释不吃换行）");
  }
  // 正例 4：跨多行的块注释在前，行号仍对。
  {
    const { sites } = extractSites(
      `/* 一
         二
         三 */
      scopeToS2sCaller(s2sCaller, parsed, "deny", "deny");`,
      R,
    );
    must(sites.length === 1 && sites[0].at === `${R}:4`, "多行块注释之后的调用，行号不漂");
  }
  // 反例 1：只有三个实参（2026-10-04 之前的写法）→ 红。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(s2sCaller, parsed, "trust-declared");`,
      R,
    );
    must(sites.length === 0 && findings.length === 1 && /缺 delegated 档位/.test(findings[0]), "三个实参 → 红「缺 delegated 档位」");
  }
  // 反例 5：注释里夹一个档位字面量、实际传的是变量 → 两条红（上一版把它登记成了固定档）。
  {
    const { sites, findings } = extractSites(
      `scopeToS2sCaller(s2sCaller, parsed, /* "deny" */ policyVar, /* "deny" */ delegatedVar);`,
      R,
    );
    must(
      sites.length === 0 && findings.length === 2 && /第三个实参/.test(findings[0]) && /第四个实参/.test(findings[1]),
      "注释里的字面量不算：变量仍红（两档各一条）",
    );
  }
  // 反例 6：字面量不在词表里 / 三元一支不在词表里 → 红。
  {
    const a = extractSites(`scopeToS2sCaller(s2sCaller, parsed, "maybe", "deny");`, R);
    const b = extractSites(`scopeToS2sCaller(s2sCaller, parsed, "deny", x ? "attribute-declared" : "allow");`, R);
    must(a.sites.length === 0 && a.findings.length === 1 && /不在词表里/.test(a.findings[0]), "不在词表里的字面量 → 红");
    must(b.sites.length === 0 && b.findings.length === 1 && /三元两支/.test(b.findings[0]), "三元一支不在词表里 → 红");
  }
  // 反例 7：嵌套三元 → 红；条件里的 `?.` / `??` 不当成嵌套。
  {
    const nested = extractSites(`scopeToS2sCaller(s2sCaller, parsed, a ? "deny" : b ? "deny" : "trust-declared", "deny");`, R);
    must(nested.sites.length === 0 && nested.findings.length === 1 && /第三个实参/.test(nested.findings[0]), "嵌套三元 → 红");
    const chain = extractSites(`scopeToS2sCaller(s2sCaller, parsed, parsed?.kind === (x ?? "amount") ? "deny" : "trust-declared", "deny");`, R);
    must(chain.sites.length === 1 && chain.sites[0].policy === "deny+trust-declared", "条件里的 ?. / ?? 不当成嵌套三元");
  }
  // 反例 8：改名导入 / 改名导出 / 赋给变量 → 红，且改名后的调用不算调用点；多行 import 里的原名不报。
  {
    const alias = extractSites(
      `import { scopeToS2sCaller as bind } from "../authn/s2s-scope";
      const { workspaceId } = bind(s2sCaller, parsed, "deny", "attribute-declared");`,
      R,
    );
    must(alias.sites.length === 0 && alias.findings.length === 1 && /改名导入/.test(alias.findings[0]), "import … as … → 红，改名后的调用不计");
    const reexport = extractSites(`export { scopeToS2sCaller as scope } from "./s2s-scope";`, "bff/platform-api/src/authn/index.ts");
    must(reexport.sites.length === 0 && reexport.findings.length === 1 && /值引用/.test(reexport.findings[0]), "export … as … → 红");
    const value = extractSites(
      `import { scopeToS2sCaller } from "../authn/s2s-scope";
      const bind = scopeToS2sCaller;
      bind(s2sCaller, parsed, "deny", "deny");`,
      R,
    );
    must(value.sites.length === 0 && value.findings.length === 1 && /值引用/.test(value.findings[0]), "赋给变量 → 红");
    const plain = extractSites(
      `import {
        type S2sCallerCtx,
        scopeToS2sCaller,
      } from "../authn/s2s-scope";
      scopeToS2sCaller(s2sCaller, parsed, "deny", "deny");`,
      R,
    );
    must(plain.sites.length === 1 && plain.findings.length === 0, "多行 import 里的原名不报");
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
  // 正例 5：真仓里信号会动——至少一个调用点、零 finding，两个计数不高于快照。
  //   只认棘轮的方向，不钉今天的数（「正好 5 个 / 正好 2 格」会让一次合法的收紧在这里红掉，
  //   而 --update 解不开它；2026-10-05 审查 3c）。哪几格收代上报票，看快照的 diff。
  {
    const real = scanRepo();
    let snap = null;
    try {
      snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    } catch {
      snap = null;
    }
    must(
      snap !== null && typeof snap.trustDeclared === "number" && typeof snap.delegatedAttributing === "number",
      "读得到快照（读不到要红，不当通过）",
    );
    const t = tally(real.sites);
    must(real.findings.length === 0, "真仓零 finding");
    must(real.sites.length >= 1, `真仓至少命中一个调用点（实得 ${real.sites.length}）`);
    must(t.trustDeclared <= snap.trustDeclared, `trust-declared 计数不高于快照（实得 ${t.trustDeclared}，快照 ${snap.trustDeclared}）`);
    must(
      t.delegatedAttributing <= snap.delegatedAttributing,
      `attribute-declared 计数不高于快照（实得 ${t.delegatedAttributing}，快照 ${snap.delegatedAttributing}）`,
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
