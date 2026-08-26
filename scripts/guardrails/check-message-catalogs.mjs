#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 消息目录 linter —— 中英词条必须逐键对齐，且英文档里不许躺着中文
//
// 平台的语言定义只有一份（`@vxture-platform/shared` 的 `SUPPORTED_LOCALES`），
// 但每个门户的 `messages/<locale>.json` 是手写的，会各自漂。这个脚本管两件
// 类型系统够不着的事：
//
//   ① **键必须齐。** 中文本加了一条、英文本忘了跟，代码里 `t("x.y")` 在英文下
//      渲染出的是键名本身（`modelKeysPage.x.y` 这样一串），或者更糟——静默回落
//      到中文，于是「英文界面」里混着中文，而没有任何东西会报错。
//
//   ② **英文档里不许是中文。** 键齐了不代表翻了：把中文原样复制进 en-US.json
//      能骗过第①条。这是「假双语」最常见的形态，而它在中文环境下**永远不会**
//      被发现——写的人看不见，测的人也看不见。
//
// 例外只有一类：语言的自称。「简体中文」在英文界面里也该写「简体中文」，
// 那是它的名字，不是没翻译。判据不靠猜——写在 `NATIVE_NAME_KEYS` 里。
//
// 运行：  node scripts/guardrails/check-message-catalogs.mjs
// 别名：  pnpm lint:messages
// 退出码：有键缺失、有多余键、或英文档里有未豁免的中文 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORTALS_DIR = join(REPO_ROOT, 'portals');

/** 原文语言。其余语言都以它为准对齐——它多一条键，别人就少一条。 */
const SOURCE_LOCALE = 'zh-CN';

const CJK = /[一-鿿]/;

/**
 * 允许在非中文词条里出现中文的键。**只收语言自称。**
 *
 * 「简体中文」在英文界面上仍然写作「简体中文」——语言的名字用它自己的文字写，
 * 是国际化的惯例，不是漏翻。除此之外没有第二类豁免：任何「这句不用翻」的想法
 * 都该先问一句「英文用户看到它会怎么想」。
 */
const NATIVE_NAME_KEYS = new Set([
  'preferences.locale.zh-CN',
  'preferences.locale.zhCN',
  'profilePage.language.zhCN',
  'tenantPage.language.zhCN',
]);

function flatten(obj, prefix = '') {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [ik, iv] of flatten(v, key)) out.set(ik, iv);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

/** 门户 = portals/<name>/messages/ 下有 `<SOURCE_LOCALE>.json` 的那些。 */
function findPortals() {
  if (!existsSync(PORTALS_DIR)) return [];
  return readdirSync(PORTALS_DIR)
    .filter((name) => statSync(join(PORTALS_DIR, name)).isDirectory())
    .map((name) => ({ name, dir: join(PORTALS_DIR, name, 'messages') }))
    .filter((p) => existsSync(join(p.dir, `${SOURCE_LOCALE}.json`)));
}

const findings = [];
const portals = findPortals();
let checkedPairs = 0;

for (const portal of portals) {
  const source = flatten(
    JSON.parse(readFileSync(join(portal.dir, `${SOURCE_LOCALE}.json`), 'utf8')),
  );

  const others = readdirSync(portal.dir)
    .filter((f) => f.endsWith('.json') && f !== `${SOURCE_LOCALE}.json`)
    .map((f) => f.replace(/\.json$/, ''));

  if (others.length === 0) {
    findings.push(
      `${portal.name}: 只有 ${SOURCE_LOCALE}.json，没有任何其它语言。` +
        `\n         单语的目录不是「还没翻」，是这个门户还没真的支持第二门语言。`,
    );
    continue;
  }

  for (const locale of others) {
    checkedPairs += 1;
    const target = flatten(
      JSON.parse(readFileSync(join(portal.dir, `${locale}.json`), 'utf8')),
    );

    const missing = [...source.keys()].filter((k) => !target.has(k));
    const extra = [...target.keys()].filter((k) => !source.has(k));

    if (missing.length) {
      findings.push(
        `${portal.name}/${locale}.json 缺 ${missing.length} 条键（${SOURCE_LOCALE} 有、它没有）：\n` +
          missing.slice(0, 8).map((k) => `           · ${k}`).join('\n') +
          (missing.length > 8 ? `\n           …另有 ${missing.length - 8} 条` : ''),
      );
    }
    if (extra.length) {
      findings.push(
        `${portal.name}/${locale}.json 多 ${extra.length} 条键（${SOURCE_LOCALE} 里没有，多半是原文删了没跟）：\n` +
          extra.slice(0, 8).map((k) => `           · ${k}`).join('\n') +
          (extra.length > 8 ? `\n           …另有 ${extra.length - 8} 条` : ''),
      );
    }

    const untranslated = [...target.entries()].filter(
      ([k, v]) =>
        typeof v === 'string' && CJK.test(v) && !NATIVE_NAME_KEYS.has(k),
    );
    if (untranslated.length) {
      findings.push(
        `${portal.name}/${locale}.json 有 ${untranslated.length} 条值仍是中文——键齐了但没翻：\n` +
          untranslated
            .slice(0, 8)
            .map(([k, v]) => `           · ${k} = ${String(v).slice(0, 30)}`)
            .join('\n') +
          (untranslated.length > 8
            ? `\n           …另有 ${untranslated.length - 8} 条`
            : '') +
          `\n         若确属语言自称（如「简体中文」），加进脚本的 NATIVE_NAME_KEYS。`,
      );
    }
  }
}

console.log('══ 消息目录检查（check-message-catalogs）══');
console.log(
  `扫描 ${portals.length} 个有词条目录的门户（${portals.map((p) => p.name).join(' / ')}），` +
    `共 ${checkedPairs} 组语言对照。`,
);

if (findings.length === 0) {
  console.log('✓ 未发现问题（键逐一对齐，非中文词条里没有未豁免的中文）。');
} else {
  console.log('');
  for (const f of findings) console.log(`  ERROR  ${f}`);
  console.log('');
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
