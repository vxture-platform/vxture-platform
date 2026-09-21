#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 主体码上屏守卫：租户号 / 账号码 / 工作空间号**上屏必须带前缀**（T- / U- / W-），
// 且前缀只能来自 `@vxture-platform/shared` 的那一份实现。
//
// ── 为什么需要 ──
// 2026-09-21 owner 实看 admin：「所有的租户账号显示中，缺失了 T- 前缀」「同样检查
// U-、T-、W- 前缀，所有显示页面」。查下来 admin 有 48 处在裸显示这三种码。
//
// 更糟的是实现有**三套**：console 一份（U/T/W 全，带反向规整与校验）、opera 一份
// （只有 T/W，`PrincipalKind` 里没有 user）、admin 一处都没有。而 console 那份文件
// 的头注写着它就是为了消灭「三套写法」才建的——它自己又变成了三套里的一套。
//
// 号形是 10 位纯数字（类别位 + 随机 8 + Luhn），三种码长得一模一样。屏幕上不带
// 前缀，运营看到 `2143889307` 分不出是租户还是工作空间；复制去搜也搜不到——因为
// 别处显示的是带前缀的。
//
// ── 它检两件事 ──
// ① 不许再出现第四份实现：`principal-no` 只允许 @shared 那一份是真实现，门户侧
//    只能是薄再导出（文件里不得出现 PREFIX 表）。
// ② 上屏点不许裸用：`.tenantCode` / `.accountCode` / `.workspaceCode` / `.tenantNo`
//    / `.userNo` / `.workspaceNo` 出现在 JSX 子节点、模板串、非路由 JSX 属性里时，
//    必须被 `formatPrincipalNo*` 包住。
//
// 路由与比较**不算上屏**，不能加前缀——加了所有详情页当场 404。所以用 TS AST 按
// 语法位置判，不用正则：正则分不开 `href={`/x/${t.tenantCode}`}` 与
// `<span>{t.tenantCode}</span>`。
//
// 运行:  node scripts/guardrails/check-principal-no-display.mjs
// 别名:  pnpm lint:principal-no
// 退出码:发现裸上屏、或发现第四份实现 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PORTALS = join(REPO_ROOT, "portals");
const CANON = "packages/shared/shared/src/principal-no.ts";

/**
 * 认字段名，但**按后缀认**，不是钉死一张表。
 *
 * 2026-09-21 走查在账号详情页上看见 `示例科技（2515306732）`——裸租户号。守卫
 * 当时钉死了六个名字，而那处叫 `primaryTenantCode`，于是完全看不见。同族还有
 * `newPersonalTenantNo`。名字前面加个定语不改变它装的是什么。
 *
 * `accountCode` 单列：它不带主体前缀（历史上同名字段两种含义，见
 * `principal-no.ts` 头注），但仍是要带 U- 上屏的可视码。
 */
const FIELD_RE = /(?:^|[a-z])(?:[Tt]enant|[Uu]ser|[Ww]orkspace)(?:Code|No)$/;
const EXTRA_FIELDS = new Set(["accountCode"]);
const isPrincipalField = (name) =>
  EXTRA_FIELDS.has(name) || FIELD_RE.test(name);

/** 这些上下文里的用法是路由 / 比较 / 键，不是上屏。 */
const ROUTE_CALLS =
  /encodeURIComponent|\.push|\.replace|startsWith|includes|localeCompare|toLowerCase|toUpperCase|formatPrincipalNo/;
const ROUTE_ATTRS = /^(href|key|id|value|tabId|rowKey|name)$/;

// ── ① 真实现只准有一份 ──────────────────────────────────────────────────────
if (!existsSync(join(REPO_ROOT, CANON))) {
  console.error(`✗ 找不到 ${CANON}——判据失效，不是「没问题」。`);
  process.exit(1);
}

const problems = [];
const copies = [];

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

let scanned = 0;
let displaySites = 0;

walk(PORTALS, (file) => {
  if (!/\.tsx?$/.test(file) || /\.spec\./.test(file)) return;
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");

  // 第四份实现：门户里的 principal-no 若自带 PREFIX 表，就是又抄了一份
  if (/\/lib\/principal-no\.ts$/.test(rel) && /PREFIX\s*[:=]/.test(src)) {
    copies.push(rel);
  }

  if (!/[Tt]enant(Code|No)|accountCode|[Uu]ser(Code|No)|[Ww]orkspace(Code|No)/.test(src)) {
    return;
  }
  scanned += 1;

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      isPrincipalField(node.name.text)
    ) {
      let display = false;
      let prev = node;
      let p = node.parent;
      let guard = 0;
      while (p && guard++ < 8) {
        if (ts.isCallExpression(p) && ROUTE_CALLS.test(p.expression.getText(sf))) break;
        if (ts.isBinaryExpression(p)) break;
        /* `disabled={!member.userNo}` / `!x && …`：前缀 `!` 是**存在性判断**，
           结果是布尔，不可能上屏。不断在这里，链会一路走到外层的
           `items={[…]}` 属性上，把整条菜单判成显示（2026-09-21 实际误报过）。 */
        if (
          ts.isPrefixUnaryExpression(p) &&
          p.operator === ts.SyntaxKind.ExclamationToken
        ) {
          break;
        }
        /* `x.tenantNo ? <PrincipalNo …/> : null` 的**条件位**是存在性判断，不是上屏
           ——真正上屏的是分支里那一个，它自己会被单独走到。 */
        if (ts.isConditionalExpression(p) && p.condition === prev) break;
        /* `rowKey={(item) => `${item.tenantNo}-…`}` 里的模板串是**键**，不上屏。
           判据取箭头函数所在的那个 JSX 属性名，不是模板串本身。 */
        if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
          const attr = p.parent;
          if (attr && ts.isJsxExpression(attr) && attr.parent && ts.isJsxAttribute(attr.parent)) {
            if (ROUTE_ATTRS.test(attr.parent.name.getText(sf))) { display = false; break; }
          }
        }
        if (ts.isJsxAttribute(p)) {
          /* `<PrincipalNo no={x} kind="tenant" />` 是收口件本身（它内部调
             formatPrincipalNo），把号传给它不算裸上屏。认的是**组件名**，
             不是属性名——属性叫 `no` 很普通，只按属性名放行会放过真裸用。 */
          const owner = p.parent?.parent;
          const tagName =
            owner && (ts.isJsxSelfClosingElement(owner) || ts.isJsxOpeningElement(owner))
              ? owner.tagName.getText(sf)
              : "";
          if (tagName === "PrincipalNo") break;
          if (!ROUTE_ATTRS.test(p.name.getText(sf))) display = true;
          break;
        }
        /* JsxExpression 先于 JsxAttribute 出现在链上（`attr={expr}` 的 expr 外面
           就是 JsxExpression），所以**不能在这里就判上屏**——那样永远走不到下面的
           属性/组件判定。只有它的父不是 JsxAttribute 时，才是真的 JSX 子节点。 */
        if (ts.isJsxExpression(p)) {
          if (!p.parent || !ts.isJsxAttribute(p.parent)) { display = true; break; }
          prev = p;
          p = p.parent;
          continue;
        }
        /* TemplateSpan 同 JsxExpression：不能就地判定。`rowKey={(item) =>
           `${item.tenantNo}-…`}` 的模板串在箭头函数体里，立刻判上屏就会把键当成
           显示。继续往上走，交给下一轮的箭头函数/属性判定。 */
        if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) {
          display = true;
          prev = p;
          p = p.parent;
          continue;
        }
        prev = p;
        p = p.parent;
      }
      if (display) {
        displaySites += 1;
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        problems.push(`${rel}:${line + 1}  ${node.getText(sf)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
});

console.log("══ 主体码上屏(check-principal-no-display)══");
console.log(`  · 扫描 ${scanned} 个含主体码的门户文件，裸上屏 ${displaySites} 处，额外实现 ${copies.length} 份`);

// 一个文件都没扫到 = 遍历坏了，不是「没问题」。
if (scanned === 0) {
  console.error("✗ 一个含主体码的文件都没扫到——判据失效（仓库里有几十个）。");
  process.exit(1);
}

if (copies.length) {
  console.error(`\n✗ ${copies.length} 份额外实现：`);
  for (const c of copies) {
    console.error(`  · ${c} 自带 PREFIX 表。实现只留 ${CANON} 一份，门户侧写薄再导出。`);
  }
}
if (problems.length) {
  console.error(`\n✗ ${problems.length} 处裸上屏（少了 T- / U- / W- 前缀）：`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    `\n  包成 formatPrincipalNoOr(x, "tenant" | "user" | "workspace", "—")。\n` +
      `  路由与比较不要包——包了详情页会 404。`,
  );
}
if (copies.length || problems.length) process.exit(1);

console.log("✓ 主体码上屏都带前缀，实现只有一份。");
