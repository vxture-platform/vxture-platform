#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// admin 导航词条守卫:navigation.ts 里的每个 id 都必须有中英两本词条。
//
// ── 为什么需要 ──
// AdminAppShell 原来对侧栏用 `t.has(key) ? t(key) : 配置里的中文`。理由写的是
// 「键由数据驱动,词条目录不可能穷举」——那句话不成立:数据驱动的是运行时选哪
// 一个,不是可能有哪些。取值集合就是 navigation.ts,它在仓里,可枚举。
//
// 而那个托底的代价是**静默的半中半英**:有词条的菜单项在英文界面变英文,没词条
// 的原样留中文,并排出现在同一条侧栏里,谁也不会报错,中文环境下永远发现不了。
// 2026-09-20 owner 实看报出来,查实缺 3 条(planVersions/atlas/capabilityPricing)。
//
// 托底摘掉之后,「缺词条」这件事必须在别处被挡住——就是这里。
//
// ── 判据 ──
// 用 TypeScript 解析器读 navigation.ts(不用正则:sections 是标识符引用,要解引用),
// 取出工作域 / 分组 / 菜单项的 id,与两本 messages 逐一对照。孤儿词条也报:
// cutover 之后留下的死词条会掩盖「某个 id 拼错了」——拼错的那个正好撞上孤儿,
// 检查就看不出来。
//
// ── 它覆盖不到什么 ──
// 只查**键在不在**、类型对不对,不走 next-intl 的 ICU 解析。所以「键有值但文案
// 里的 ICU 特殊字符把渲染搞坏了」这一类它看不见(撇号在 ICU 里是转义符,一个落单
// 的 `'` 会把后半句吞掉;`{` 会被当成插值起头)。
// 立这道守卫时用 next-intl 的真 `createTranslator` 把 31 个键 x 2 本共 62 次渲染
// 跑过一遍,全部出真实文案——那是一次性核对,不是常驻检查。文案里真出现撇号或
// 大括号时,补一条渲染守卫,别指望这一条。
//
// 运行:  node scripts/guardrails/check-admin-nav-messages.mjs
// 别名:  pnpm lint:admin-nav-messages
// 退出码:缺词条或有孤儿 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const NAV = resolve(REPO_ROOT, "portals/admin/src/config/navigation.ts");
const CATALOGS = [
  ["zh-CN", resolve(REPO_ROOT, "portals/admin/messages/zh-CN.json")],
  ["en-US", resolve(REPO_ROOT, "portals/admin/messages/en-US.json")],
];

const sf = ts.createSourceFile(
  NAV,
  readFileSync(NAV, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
// 解析不出来就抛,不当成「没问题」。
if (!sf || sf.statements.length === 0) {
  throw new Error("[admin-nav-messages] navigation.ts 解析失败");
}

// 顶层 const:`sections: tenantOpsSections` 这类引用要解得开。
const consts = new Map();
for (const st of sf.statements) {
  if (!ts.isVariableStatement(st)) continue;
  for (const d of st.declarationList.declarations) {
    if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  }
}
function deref(node) {
  let cur = node;
  for (let hops = 0; cur && ts.isIdentifier(cur) && consts.has(cur.text) && hops < 10; hops++) {
    cur = consts.get(cur.text);
  }
  return cur && ts.isAsExpression(cur) ? cur.expression : cur;
}
function str(node) {
  const d = deref(node);
  return d && (ts.isStringLiteral(d) || ts.isNoSubstitutionTemplateLiteral(d)) ? d.text : null;
}
function props(node) {
  const out = {};
  const d = deref(node);
  if (!d || !ts.isObjectLiteralExpression(d)) return out;
  for (const p of d.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (key) out[key] = p.initializer;
  }
  return out;
}
function elems(node) {
  const d = deref(node);
  return d && ts.isArrayLiteralExpression(d) ? d.elements : null;
}

const wsNodes = elems(consts.get("adminWorkspaces"));
if (!wsNodes) throw new Error("[admin-nav-messages] adminWorkspaces 解不出数组——判据失效");

const workspaceIds = [];
const sectionIds = [];
const itemIds = [];
for (const wNode of wsNodes) {
  const w = props(wNode);
  const wid = str(w.id);
  if (!wid) throw new Error("[admin-nav-messages] 有工作域没有字面量 id——判据失效");
  workspaceIds.push(wid);
  const secNodes = elems(w.sections);
  if (!secNodes) throw new Error(`[admin-nav-messages] 工作域 ${wid} 的 sections 解不出数组——判据失效`);
  for (const sNode of secNodes) {
    const s = props(sNode);
    const sid = str(s.id);
    if (!sid) throw new Error(`[admin-nav-messages] 工作域 ${wid} 下有分组没有字面量 id`);
    sectionIds.push(sid);
    const itNodes = elems(s.items);
    if (!itNodes) throw new Error(`[admin-nav-messages] 分组 ${sid} 的 items 解不出数组——判据失效`);
    for (const iNode of itNodes) {
      const iid = str(props(iNode).id);
      if (!iid) throw new Error(`[admin-nav-messages] 分组 ${sid} 下有菜单项没有字面量 id`);
      itemIds.push(iid);
    }
  }
}

console.log("══ admin 导航词条(check-admin-nav-messages)══");
console.log(
  `  · 工作域 ${workspaceIds.length} · 分组 ${sectionIds.length} · 菜单项 ${itemIds.length}`,
);
// 一个都没解出来 = 遍历坏了,不是「没问题」。
if (workspaceIds.length === 0 || sectionIds.length === 0 || itemIds.length === 0) {
  console.error("✗ 导航配置解出来是空的——判据失效,不是没问题。");
  process.exit(1);
}

const problems = [];
for (const [locale, file] of CATALOGS) {
  const nav = JSON.parse(readFileSync(file, "utf8")).navigation;
  if (!nav) {
    problems.push(`${locale}: 没有 navigation 段`);
    continue;
  }
  const check = (kind, ids, bag, needLabel) => {
    const have = bag ?? {};
    for (const id of ids) {
      const entry = have[id];
      if (entry === undefined) {
        problems.push(`${locale}: 缺 navigation.${kind}.${id}`);
      } else if (needLabel && (typeof entry !== "object" || !entry.label)) {
        problems.push(`${locale}: navigation.${kind}.${id} 没有 label`);
      } else if (!needLabel && typeof entry !== "string") {
        problems.push(`${locale}: navigation.${kind}.${id} 应当是字符串`);
      }
    }
    // 孤儿会掩盖拼错:拼错的 id 正好撞上一条孤儿时,上面那轮检查什么也发现不了。
    for (const id of Object.keys(have)) {
      if (!ids.includes(id)) problems.push(`${locale}: navigation.${kind}.${id} 是孤儿(配置里已没有这个 id)`);
    }
  };
  check("workspaces", workspaceIds, nav.workspaces, true);
  check("sections", sectionIds, nav.sections, false);
  check("items", itemIds, nav.items, true);
}

if (problems.length === 0) {
  console.log("✓ 两本词条与导航配置逐一对齐,没有孤儿。");
  process.exit(0);
}
console.error(`\n✗ ${problems.length} 处不一致:\n`);
for (const p of problems) console.error("  " + p);
console.error(
  "\n  侧栏已经不再回落到配置里的中文——缺词条会直接渲染成键路径。补词条,或把",
);
console.error("  配置里那一项删掉。");
process.exit(1);
