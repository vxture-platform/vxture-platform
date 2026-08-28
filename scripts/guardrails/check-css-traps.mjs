#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 两类**不报错的**样式缺陷：CSS 注释提前收口、以及踩了主题的关键字工具类
//
// 这两类的共同点是**代码侧的门全部放行**。tsc 看不见 CSS 与 class 字符串；
// `next build` 走 Lightning CSS，遇到坏注释会自行恢复、照常打包成功；Tailwind
// 对「这个类名解析出了荒谬的值」没有意见——它只是照表查了一下。所以它们只在人
// 打开页面时现形，而且现形的样子是「布局莫名其妙」，不是报错。
//
// ── 一、CSS 根本解析不了 ─────────────────────────────────────────────────
//
// CSS 注释不能嵌套：`/* a /* b */ c */` 里第一个 `*/` 就把注释关掉了，`c */`
// 变成垃圾声明。两种踩法都在这个仓里真实发生过（2026-08-27 同一天扫出）：
//
//   1. 往已有注释块**中间**插了一段新注释（脚本改令牌文件时干的）——内层 `*/`
//      提前收口，后半句落进 CSS，Turbopack 直接拒收、admin dev 起不来。而
//      `next build` 是过的，所以提交时一切看起来正常。
//   2. 注释正文里写了 `.ac-*/.screen` 这样的选择器列举——那个 `*/` 同样收口，
//      后半段中文说明全部变成 CSS。console 的遗留样式表里躺了很久。
//   3. 悬空的选择器列表（`.a,` `.b > span,` 然后文件就结束了，没有 `{}`）——
//      更早一次用正则删多选择器规则时逗号和块都没收拾干净，从断点到文件尾
//      整段失效。这一条是换成 postcss 后才报出来的：我第一版手写的注释计数器
//      只认得我当时想到的那一种坏法，解析器认得所有坏法。
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
import { createRequire } from 'node:module';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCAN = ['portals', 'packages'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage']);
const CODE_EXT = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);

/**
 * `none` 档是否还被注册在 spacing 命名空间里 —— 直接读**实际装着的** tokens。
 *
 * 这是上面第二类坑的**根因**，不是症状：字面词 `none` 一旦进了 `--spacing-*`，
 * 凡是读 spacing 档的工具类族都会把 `X-none` 解析成 0，`max-w-none` 与
 * `leading-none` 一起遭殃。`@vxture/design-tokens@3.0.0`（2026-08-28）把这一档
 * 摘掉了，那两个类随之回到 CSS 原义——**禁令也就该跟着失效**，否则守卫会一直
 * 拦着正确的写法。
 *
 * 所以不写死，按装着的包判：
 *   - 装的是旧 tokens（仍注册 none）→ 两条禁令生效，且额外报一条根因提醒
 *   - 装的是新 tokens                → 两条禁令自动解除
 *
 * `max-w-md`…`max-w-5xl` 与此无关，恒为陷阱：`md`/`lg`/`xl` 本来就是间距档名，
 * `max-w-md` 永远解析成 `var(--space-md)`(16px) 而不是上游的 32rem。
 */
function spacingNoneRegistered() {
  // pnpm 的严格布局下 tokens 不在顶层 node_modules，而在 design-system 的私有
  // node_modules 里；且它的 package.json 不在 exports 白名单，只能从伞包的入口
  // 反推目录。**解析不到就抛**——一个悄悄退回默认值的守卫是最坏的那种守卫：
  // 它永远绿，永远什么都没查。
  const require_ = createRequire(join(ROOT, 'portals/admin/package.json'));
  const dsEntry = require_.resolve('@vxture/design-system');
  const dsDir = dsEntry.slice(0, dsEntry.indexOf(`${sep}@vxture${sep}design-system${sep}`));
  // 发布出来的样式在 `src/styles/`（包的 exports 只开了 tokens.css / tailwind.css
  // 两个入口，theme.css 是被 tokens.css 引进去的，拿不到 export 路径），故直接
  // 按目录取。
  const theme = join(
    dsDir, '@vxture', 'design-tokens', 'src', 'styles', 'theme.css',
  );
  return /^\s*--spacing-none\s*:/m.test(readFileSync(theme, 'utf8'));
}

const NONE_SHADOWED = spacingNoneRegistered();

/** 关键字被主题踩掉的类 → 该改成什么。 */
const TRAPS = new Map([
  ...(NONE_SHADOWED
    ? [
        ['max-w-none', '`max-w-[none]`，或域内梯子 `max-w-page-*` / `max-w-content-*`'],
        ['leading-none', '`leading-[1]`'],
      ]
    : []),
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
 * 结构断裂：CSS 根本解析不了。
 *
 * 用 postcss，不是我手写的判据。第一版这里只有下面那个注释配对计数器，它抓到了
 * 注释那两处，却漏了 `admin-tenant-detail-config-review-admin.css` 里一段**悬空的
 * 选择器列表**（`.a,` `.b > span,` 然后文件就结束了，没有块）——那是更早一次用
 * 正则删多选择器规则时留下的，逗号和块都没收拾干净。换 postcss 一次就报了出来：
 * 手写的判据只认得我当时想到的那一种坏法，解析器认得所有坏法。
 */
function checkParses(src, rel) {
  try {
    postcss.parse(src, { from: rel });
  } catch (e) {
    const where = e.line ? `${rel}:${e.line}` : rel;
    problems.push(`${where}  CSS 解析失败：${e.reason ?? e.message}`);
  }
}

/**
 * 注释提前收口：解析器**容忍**，但语义已经错了。
 *
 * 这一条不能省掉换成解析器——实测 postcss 对上面说的两种注释踩法都不报错，它跟
 * Lightning CSS 一样会自行恢复。而 Turbopack 对第一种是直接拒收的，第二种则悄悄
 * 吞掉一条规则。所以两个判据是互补的，不是替代关系：
 *
 *   checkParses    抓结构断裂（谁都解析不了）
 *   checkComments  抓「宽松解析器放过、但含义已被改写」的
 *
 * （本注释里刻意不写出那个收口符。第一版写了，于是它把自己这段注释提前关掉了
 * ——正是本函数要抓的那类错。）
 */
function checkComments(src, rel) {
  let depth = 0;
  for (let i = 0; i < src.length - 1; ) {
    const two = src.slice(i, i + 2);
    if (two === '/*') {
      if (depth > 0) {
        problems.push(`${rel}:${lineOf(src, i)}  注释里又出现 \`/*\`——外层注释已被更早的收口符关掉`);
      }
      depth += 1;
      i += 2;
    } else if (two === '*/') {
      if (depth === 0) {
        problems.push(`${rel}:${lineOf(src, i)}  多出来的收口符——多半是上面某处注释正文里写了它（如选择器列举 \`.ac-*\` 后面紧跟斜杠）`);
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

    if (ext === '.css') {
      checkParses(src, rel);
      checkComments(src, rel);
    }

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

if (NONE_SHADOWED) {
  // 不算失败——旧 tokens 下 TRAPS 已经在拦症状了，这里只是把根因说出来，
  // 免得后人以为「不能写 max-w-none」是个天生的规矩。
  console.warn(
    '\n  NOTE   装着的 @vxture/design-tokens 仍注册 `--spacing-none`，' +
      '`max-w-none` / `leading-none` 会被解析成 0，故这两条禁令仍生效。\n' +
      '         升到 design-tokens@3.0.0 及以上即自动解除（那一版摘掉了这一档）。\n',
  );
}

if (problems.length) {
  console.error(`\n  ERROR  发现 ${problems.length} 处静默失效的样式写法：\n`);
  for (const p of problems) console.error('         ' + p);
  console.error('\n         这两类都不会让构建失败，只会让页面长歪。判据与来由见本文件头部注释。\n');
  process.exit(1);
}
console.log('✓ CSS 陷阱检查通过（样式表均可解析，无踩关键字的工具类）。');
