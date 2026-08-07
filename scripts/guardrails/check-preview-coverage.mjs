#!/usr/bin/env node

/**
 * check-preview-coverage.mjs — 预览面必须覆盖每一个组件。
 *
 * ── 补的是哪个盲区 ──
 * 预览面是这套设计系统唯一的验收面：token 对不对、组件好不好看，只有把它们摆在
 * 一页上才看得见。而 `registry.tsx` 的条目是手写的——**组件加了、改了、重建了，
 * 没人回来加条目，预览面就当它不存在**，统计卡照样给出一个自洽但偏小的数字。
 *
 * 实测发现时：53 个组件文件里有 17 个没有条目，其中 MetricCard / MetricGrid /
 * Section / SectionHeader / ViewLayout 五件刚在批 E–F 重建过，却一眼都看不到。
 *
 * 排除项必须逐条写明理由，不接受"暂时不看"。
 *
 * 用法：node scripts/guardrails/check-preview-coverage.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const REGISTRY = path.join(
  ROOT,
  "packages/design/design-preview/src/preview/registry.tsx",
);
const ROOTS = [
  "packages/design/design-ui/src/components",
  "packages/design/design-system/src/components",
];

/**
 * 不进预览面的文件，逐条带理由。
 *
 * 判据只有一条：**它不是一件可以摆出来看的东西**。"还没做"不是理由——
 * 那种情况应该进 registry 并标 pending，让它以无样式的形态出现在页面上。
 */
const EXCLUDED = new Map([
  [
    "packages/design/design-ui/src/components/layout/fullscreen/Provider.tsx",
    "context provider，无可渲染外观",
  ],
  [
    "packages/design/design-ui/src/components/layout/fullscreen/Portal.tsx",
    "挂载点，无可渲染外观",
  ],
  [
    "packages/design/design-ui/src/components/layout/fullscreen/Container.tsx",
    "只是把子树挂进全屏元素，本身没有外观；与 layout/container/Container 同名不同物",
  ],
]);

async function walk(dir, out = []) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) await walk(p, out);
    else if (f.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const src = await readFile(REGISTRY, "utf8");
/**
 * 条目名，外加 `covers` 里声明的"本条顺带展示了谁"——一族东西并在一条里看
 * 是对的，但不能因此被当成没露过面。
 */
const listed = new Set(
  [...src.matchAll(/name:\s*"([A-Za-z][\w]*)"/g)].map((m) => m[1]),
);
for (const m of src.matchAll(/covers:\s*\[([^\]]*)\]/g)) {
  for (const c of m[1].matchAll(/"([A-Za-z][\w]*)"/g)) listed.add(c[1]);
}

const files = [];
for (const r of ROOTS) files.push(...(await walk(path.join(ROOT, r))));

/**
 * 一个都没扫到就是错。目录挪过而本清单没跟上时，空集会让检查永远全绿——
 * 这份仓库已经在别处栽过一次。
 */
if (files.length === 0) {
  console.error("没有扫到任何组件文件，组件目录可能已经移动。");
  process.exit(1);
}

/**
 * 排除项按**仓库相对路径**登记，不按文件名。
 *
 * `layout/container/Container.tsx` 与 `layout/fullscreen/Container.tsx` 同名不同物——
 * 按文件名匹配时，前者进了预览面就会让后者一起"通过"，而后者其实一眼都没露过。
 */
const missing = [];
const staleExclusions = new Set(EXCLUDED.keys());
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  staleExclusions.delete(rel);
  if (EXCLUDED.has(rel)) continue;
  if (listed.has(path.basename(file, ".tsx"))) continue;
  missing.push(rel);
}

const problems = [];
if (missing.length > 0) {
  problems.push(
    `以下组件在预览面里不存在——改了也没人看得见：\n` +
      missing.map((m) => `  ✗ ${m}`).join("\n"),
  );
}
if (staleExclusions.size > 0) {
  problems.push(
    `以下排除项已无对应文件，请从 EXCLUDED 删掉：\n` +
      [...staleExclusions].map((s) => `  ✗ ${s}`).join("\n"),
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  console.error(
    "\n补条目：packages/design/design-preview/src/preview/registry.tsx。" +
      "\n确实不该出现的，登记到本脚本的 EXCLUDED 并写明理由。",
  );
  process.exit(1);
}

console.log(
  `预览面覆盖检查通过（${files.length - EXCLUDED.size} 个组件全部有条目；` +
    `${EXCLUDED.size} 个按理由排除）`,
);
