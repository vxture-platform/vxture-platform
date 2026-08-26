#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// i18n 铺开进度的**棘轮**：硬编码中文串只许变少，不许变多
//
// 机制层已经统一（五个门户都在 next-intl 上），但铺开是个跨多次会话的活——
// 6000 多条串、150 多个文件。这种长跑最典型的失败方式不是「做得慢」，是
// **一边抽一边加**：这周抽掉两百条，下周新页面又写进去三百条，半年后总数
// 没动，而每个人都觉得自己在推进。
//
// 所以这里不设目标、只设棘轮：每个门户记一个当前数，**超过就报错**。抽完一批
// 就把数字调下去，那一步是提交的一部分，改不改得动一目了然。
//
// ## 判据：代码位置，不是文件
//
// 这个仓的注释全是中文，按「含中文的文件数」统计会被污染得毫无意义（opera
// 58/58 个文件都含中文，但那大半是注释）。所以先把注释挖空（保持行号），再数
// 三类：双引号/反引号字面量、以及 JSX 文本节点。
//
// 会有少量误判——比如 `RISK_LEVEL_META` 里 `label: "read"` 那种技术标识不该翻译，
// 但它本来就不含中文，不进统计。真正的误判是「注释里带引号的中文被算进代码」，
// 挖空注释已经处理掉了。宁可略高估，不可低估：低估会让棘轮松掉。
//
// 运行：  node scripts/guardrails/check-i18n-coverage.mjs
// 别名：  pnpm lint:i18n-coverage
// 退出码：任一门户超过基线 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORTALS_DIR = join(REPO_ROOT, 'portals');

/**
 * 每个门户当前的硬编码中文串数。**这是棘轮，只许调小。**
 *
 * 抽完一批之后把数字改成新的实测值，和代码改动在同一个提交里。调大它需要一个
 * 理由，而写下那个理由的时候多半会发现不该调大。
 *
 * 2026-08-26 基线（i18n 基座落地时实测）：
 *   console / website 已基本抽完；admin 与 opera 是主战场；accounts 抽了一条竖切。
 * 2026-08-26 opera 2106 → 1826：抽掉跨文件重复的通用词汇（列表页外壳、通用动作、
 *   列头、状态词）一批 280 处 / 22 个文件。
 * 2026-08-26 admin 4125 → 3844：同一套共享命名空间的扫描，281 处 / 43 个文件。
 *   两个门户的 `common` / `columns` / `filters` / `actions` / `status.generic` 形状
 *   刻意一致——同一个词在两边该是同一个键。
 * 2026-08-26 第二轮扫中低频重复：opera 1826 → 1795（31 处），admin 3844 → 3799
 *   （45 处）。剩下的跨文件重复主要是三类，都不该机械扫：导航标签（结构归
 *   `opera-navigation-design.md` 裁）、领域名词（要先有词表）、以及宿主不是组件
 *   的那些（模块级常量表 / 普通函数，要先做结构改造）。
 * 2026-08-26 admin 3799 → 3756：五个「状态 → 中文」的顶层函数删掉，改成词条查表
 *   （映射本来就是恒等，函数没有任何判断可言）。
 * 2026-08-26 admin 3756 → 3668：PlatformGovernanceListPage 的四套治理域配置搬进
 *   词条，图标与语气留在代码里（同 opera `status.ts` 的判据）。
 * 2026-08-27 admin 3668 → 3660：视觉验证时抓到的混合语言（`还没有${objectLabel}`
 *   在英文下渲染成「还没有Secret」），连同两处同形的一起抽掉。
 * 2026-08-27 admin 3660 → 3661：**计数口径变了，不是多写了一条。** CommerceOverviewPage
 *   的「个订阅」原本是 `<small>{formatNumber(n)} 个订阅</small>`——JSX 文本节点里
 *   带插值时 `JSX_TEXT` 的 `[^<>{}
]*` 匆匆跑掉，一直没被数到；手搜网格换成
 *   `TableTitleCell` 后它成了 `description` 的模板串，于是被 `LITERAL` 数到了。
 *   这正是本文件开头说的「宁可略高估」：高估修正一次，比为了压住数字把代码写回
 *   正则看不见的形状好。
 */
const BASELINE = {
  console: 32,
  website: 54,
  admin: 3661,
  opera: 1795,
  accounts: 263,
};

const CJK = '[\u4e00-\u9fff]';
const LITERAL = new RegExp(`"[^"\\n]*${CJK}[^"\\n]*"|\`[^\`\\n]*${CJK}[^\`\\n]*\``, 'g');
const JSX_TEXT = new RegExp(`>\\s*[^<>{}\\n]*${CJK}[^<>{}\\n]*?\\s*<`, 'g');

/** 挖空注释但保持行号——只数代码位置的中文。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

function countPortal(name) {
  const src = join(PORTALS_DIR, name, 'src');
  if (!existsSync(src)) return null;
  let total = 0;
  const worst = [];
  for (const file of walk(src)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const n =
      (code.match(LITERAL) ?? []).length + (code.match(JSX_TEXT) ?? []).length;
    if (n) {
      total += n;
      worst.push({ n, file: file.slice(src.length + 1).replace(/\\/g, '/') });
    }
  }
  worst.sort((a, b) => b.n - a.n);
  return { total, files: worst.length, worst: worst.slice(0, 3) };
}

const findings = [];
const rows = [];

for (const [portal, baseline] of Object.entries(BASELINE)) {
  const r = countPortal(portal);
  if (!r) {
    findings.push(`${portal}: 门户目录不存在——BASELINE 里的条目该删了。`);
    continue;
  }
  rows.push({ portal, ...r, baseline });
  if (r.total > baseline) {
    findings.push(
      `${portal}: 硬编码中文 ${r.total} 条，超过基线 ${baseline}（多了 ${r.total - baseline}）。\n` +
        `         新写的界面文案要走 \`t()\`，不要直接写进代码。若这一批确实只增不减\n` +
        `         （比如整页新增且暂缓翻译），把 BASELINE.${portal} 改成 ${r.total} 并说明理由。\n` +
        `         串最多的文件：` +
        r.worst.map((w) => `${w.file}(${w.n})`).join('、'),
    );
  }
}

// 反向：抽完了没调数字。不报错，但要说出来——否则棘轮会松着不知道。
const stale = rows.filter((r) => r.total < r.baseline);

console.log('══ i18n 铺开棘轮（check-i18n-coverage）══');
for (const r of rows) {
  const delta = r.total - r.baseline;
  const mark = delta > 0 ? '✗' : delta < 0 ? '↓' : '·';
  console.log(
    `  ${mark} ${r.portal.padEnd(9)} ${String(r.total).padStart(5)} / ${String(r.baseline).padEnd(5)}` +
      `  (${r.files} 个文件)`,
  );
}

if (stale.length) {
  console.log('');
  for (const r of stale) {
    console.log(
      `  提示 ${r.portal}: 已降到 ${r.total}，基线还写着 ${r.baseline}——把 BASELINE 调下去，` +
        `棘轮才咬得住新增的那部分。`,
    );
  }
}

if (findings.length === 0) {
  console.log('✓ 未发现问题（没有门户超过基线）。');
} else {
  console.log('');
  for (const f of findings) console.log(`  ERROR  ${f}`);
  console.log('');
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
