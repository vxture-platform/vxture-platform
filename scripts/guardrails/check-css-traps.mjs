#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 两类**不报错的**样式缺陷：CSS 注释提前收口、以及踩了主题的关键字工具类
//
// 这两类的共同点是**代码侧的门全部放行**。tsc 看不见 CSS 与 class 字符串；
// `next build` 走 Lightning CSS，遇到坏注释会自行恢复、照常打包成功；Tailwind
// 对「这个类名解析出了荒谬的值」没有意见——它只是照表查了一下。所以它们只在人
// 打开页面时现形，而且现形的样子是「布局莫名其妙」，不是报错。
//
// ── 一、注释嵌套 / 提前收口 ──────────────────────────────────────────────
//
// CSS 注释不能嵌套：`/* a /* b */ c */` 里第一个 `*/` 就把注释关掉了，`c */`
// 变成垃圾声明。两种踩法都在这个仓里真实发生过（2026-08-27 同一天扫出）：
//
//   1. 往已有注释块**中间**插了一段新注释（脚本改令牌文件时干的）——内层 `*/`
//      提前收口，后半句落进 CSS，Turbopack 直接拒收、admin dev 起不来。而
//      `next build` 是过的，所以提交时一切看起来正常。
//   2. 注释正文里写了 `.ac-*/.screen` 这样的选择器列举——那个 `*/` 同样收口，
//      后半段中文说明全部变成 CSS。console 的遗留样式表里躺了很久。
//
// ── 二、被主题踩掉的关键字类 ────────────────────────────────────────────
//
// Tailwind v4 解 `max-w-<名>` 时**先查 `--spacing-*`、再查 `--container-*`**。
// DS 注册了 `--space-none: 0px` 与 `--space-md/lg/xl/2xl…`，于是：
//
//   max-w-none   → max-width: 0      （不是关键字 none）
//   max-w-lg     → max-width: 24px   （不是 32rem）
//   leading-none → line-height: 0
//
// 实测（2026-08-27，admin 运行时）：三个角色/权限对话框写着 `max-w-none`，本意
// 是「去掉 DS 的默认上限、让 __panel 的宽度令牌说了算」，实际把面板从 896px 夹
// 成 34px。一直没人报——除非你正好打开那个对话框，页面别处一切正常。
//
// 要关键字语义就写方括号任意值（`max-w-[none]`）：它不过主题查表。要具体宽度就
// 用域内梯子（`max-w-page-*` / `max-w-content-*` / `max-w-panel-*` /
// `max-w-website-*`）。坑的完整来由记在
// `portals/website/assets/legacy-tokens/tokens-website.css`。
//
// 运行：  node scripts/guardrails/check-css-traps.mjs
// 别名：  pnpm lint:css-traps
// 退出码：任一条命中 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCAN = ['portals', 'packages'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage']);
const CODE_EXT = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);

/** 关键字被主题踩掉的类 → 该改成什么。 */
const TRAPS = new Map([
  ['max-w-none', '`max-w-[none]`，或域内梯子 `max-w-page-*` / `max-w-content-*`'],
  ['leading-none', '`leading-[1]`'],
  ['max-w-md', '域内梯子，如 `max-w-panel-sm`'],
  ['max-w-lg', '域内梯子，如 `max-w-panel-md`'],
  ['max-w-xl', '域内梯子，如 `max-w-panel-lg`'],
  ['max-w-2xl', '域内梯子，如 `max-w-panel-xl`'],
  ['max-w-3xl', '域内梯子，如 `max-w-page-sm`'],
  ['max-w-4xl', '域内梯子，如 `max-w-page-md`'],
  ['max-w-5xl', '域内梯子，如 `max-w-page-lg`'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 把注释挖空成同长空白，保住行号——否则本文件自己的说明会被当成命中。 */
function blankComments(src, alsoLineComments) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (alsoLineComments) s = s.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  return s;
}

const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const problems = [];

/**
 * CSS 注释配对：既报嵌套，也报多出来的收口符。
 *
 * （本注释里刻意不写出那两个字符。第一版写了，于是它把自己这段注释
 * 提前关掉了——正是本函数要抓的那类错。）
 */
function checkComments(src, rel) {
  let depth = 0;
  for (let i = 0; i < src.length - 1; ) {
    const two = src.slice(i, i + 2);
    if (two === '/*') {
      if (depth > 0) {
        problems.push(`${rel}:${lineOf(src, i)}  注释里又出现 \`/*\`——外层注释已被更早的 \`*/\` 收口`);
      }
      depth += 1;
      i += 2;
    } else if (two === '*/') {
      if (depth === 0) {
        problems.push(`${rel}:${lineOf(src, i)}  多出来的 \`*/\`——多半是上面某处注释正文里写了 \`*/\`（如选择器列举 \`.ac-*/\`）`);
      } else {
        depth -= 1;
      }
      i += 2;
    } else {
      i += 1;
    }
  }
  if (depth !== 0) problems.push(`${rel}  文件结束时还有 ${depth} 个注释没有关闭`);
}

for (const top of SCAN) {
  let files;
  try {
    files = walk(join(ROOT, top));
  } catch {
    continue;
  }
  for (const file of files) {
    const ext = extname(file);
    if (!CODE_EXT.has(ext)) continue;
    const rel = file.slice(ROOT.length + 1).split(sep).join('/');
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    if (ext === '.css') checkComments(src, rel);

    const code = blankComments(src, ext !== '.css');
    for (const [cls, better] of TRAPS) {
      // 整词匹配；`max-w-[none]` 不会命中（后面跟着 `[`），`max-w-page-md` 也不会。
      const re = new RegExp(`(?<![\\w-])${cls}(?![\\w-])`, 'g');
      for (const m of code.matchAll(re)) {
        problems.push(`${rel}:${lineOf(code, m.index)}  \`${cls}\` 被主题踩成错值，改用 ${better}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\n  ERROR  发现 ${problems.length} 处静默失效的样式写法：\n`);
  for (const p of problems) console.error('         ' + p);
  console.error('\n         这两类都不会让构建失败，只会让页面长歪。判据与来由见本文件头部注释。\n');
  process.exit(1);
}
console.log('✓ CSS 陷阱检查通过（注释配对正常，无踩关键字的工具类）。');
