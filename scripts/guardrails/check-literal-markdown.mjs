#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-literal-markdown.mjs — 界面文案里不许写 markdown 的 **强调**
//
// ## 补的是哪个盲区
//
// JSX 文本与字符串属性**都不是 markdown**。`**不是急停**` 写进去，运营者看到的
// 就是带星号的「**不是急停**」本身。这件事：
//   · 编译通过、类型通过、lint 通过、测试通过；
//   · 写的人在编辑器里看到的是高亮后的粗体（IDE 把中文串当散文渲染），所以
//     **写的时候看起来是对的**；
//   · 只有真的打开那个页面、并且正好触发那条文案（多半是个确认框或错误提示）
//     才会看见。
// 三条凑在一起，它能活很久：2026-09-11 首次全量扫出 16 处，散在 opera 七个文件，
// 最早的可以追到能力登记册那一批。
//
// ## 为什么不能「统一换成 <b>」了事
//
// 宿主分两类，只有一类塞得进标签：
//   · **JSX 文本**（`<FieldDescription>…</FieldDescription>`、`<p>…</p>`）——可以
//     用 `<b>`，强调保得住；
//   · **字符串属性**（toast 的 `description`、`DestructiveConfirm.consequence`、
//     `note=`、检查项的 `what`）——类型就是 `string`，塞 `<b>` 一样是字面量。
//     这一类只能改写文案，让语序和标点承担强调。
// 所以本守卫只报位置，不给自动修复：修法取决于宿主是哪一类，机器判不了。
//
// ## 判据
//
// 挖掉注释（本仓注释全是中文散文，markdown 记号在那里是**对的**），再找成对的
// `**…**`，且中间含中日韩字符——后者用来排除 JS 的幂运算符 `a ** b`（标识符与
// 数字不含中文）。
//
// **模板串也要算**。第一版为了避开 JS 插值把模板串整段挖空，于是「模板串当文案用」
// 这一整类被漏掉（漏了 entitlements 的一条）；**扫描范围也不能只看 .tsx**，
// 检查项文案住在 `.ts` 里（又漏两条）。两次都是范围定错，而范围错比算错隐蔽——
// 它让报告看起来是完整的。
//
// 测试文件豁免：用例名是写给维护者的散文，和注释同一类。
//
// 运行：  node scripts/guardrails/check-literal-markdown.mjs
// 别名：  pnpm lint:literal-markdown
// 退出码：发现任何一处 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** 扫描根。BFF 的错误消息同样会原样冒到界面上，所以也扫。 */
const ROOTS = ["portals", "bff", "packages"];

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^[^\S\n]*\/\/.*$/gm;
/** 成对的 `**…**`，中间不跨行、不含 `*`。 */
const EMPHASIS = /\*\*([^*\n]{2,60})\*\*/g;
const CJK = /[一-鿿]/;

/** 等长空白替换：挖掉注释但保住行号。 */
const blank = (m) => m.replace(/\S/g, " ");

function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const root of ROOTS) collect(join(REPO_ROOT, root), files);

/*
 * 读不到文件就抛，不兜底跳过。一个「扫了 0 个文件」的守卫会永远报绿，而那看起来
 * 和「一处都没有」一模一样。
 */
if (files.length === 0) {
  console.error("check-literal-markdown：一个源文件都没扫到，扫描根写错了？");
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const stripped = raw.replace(BLOCK_COMMENT, blank).replace(LINE_COMMENT, blank);
  for (const m of stripped.matchAll(EMPHASIS)) {
    if (!CJK.test(m[1])) continue; // `a ** b` 不是文案
    const line = stripped.slice(0, m.index).split("\n").length;
    findings.push({
      file: file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/"),
      line,
      text: m[0],
    });
  }
}

console.log("══ 界面文案里的字面 markdown（check-literal-markdown）══");
console.log(`  扫描 ${files.length} 个源文件`);

if (findings.length > 0) {
  console.log("");
  for (const f of findings) {
    console.log(`  ✗ ${f.file}:${f.line}  ${f.text}`);
  }
  console.log("");
  console.log("  JSX 文本与字符串属性都不是 markdown，星号会原样显示给用户。");
  console.log("  · 宿主是 JSX 文本      → 用 <b>…</b>，强调保得住");
  console.log("  · 宿主是字符串属性     → 改写文案，让语序和标点承担强调");
  console.log("    （toast 的 description、DestructiveConfirm.consequence、");
  console.log("      note=、检查项的 what —— 这些类型就是 string，塞标签没用）");
}

console.log("");
console.log("── 汇总 ──");
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
