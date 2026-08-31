#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 破坏性动作的确认门 linter
//
// DS 9.0 起，`Button`/`ActionMenuItem` 上的 `danger`/`variant="destructive"` 带一条
// 类型义务：**要么给 `confirm`，要么给 `confirmExempt` 写明为什么不用确认**。
// 类型系统能保证「两者必居其一」，但保证不了另外两件事，这个脚本管那两件：
//
//   ① 豁免不会悄悄变多。`confirmExempt` 是给「停用可再启用」这类真可逆动作留
//      的门，不是给赶时间的人留的。它一旦好写，就会被当成绕过确认的捷径——
//      而每一次绕过在界面上都看不出来。所以把数目钉死：加一处豁免必须同时改
//      这个脚本里的数字，也就必须在 code review 里被人看见一次。
//
//   ② 原生对话框不会回潮。`window.confirm` / `window.alert` 看着像确认，实际上
//      是另一回事：它没有主语（「确定删除？」——删哪个、删完什么后果，一个字
//      都没有）、样式不受控、而且会阻塞整个页面。accounts 的通行密钥删除曾经
//      就是这样一句话，2026-08 换成 DS 确认契约。这里钉住 0，防回潮。
//
// 判据取「豁免总数」而不是「豁免占比」：占比会随着新增确认自动稀释，那正好
// 让豁免可以不被发现地增长——要盯的是绝对数目。
//
// 运行：  node scripts/guardrails/check-destructive-confirmations.mjs
// 退出码：豁免数超过基线、豁免理由写不出、或出现原生对话框 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCAN_ROOTS = ['portals', 'packages'];
const rel = (f) => f.slice(REPO_ROOT.length + 1).split('\\').join('/');

/**
 * 豁免基线。**改这个数字之前先回答一句：这处动作真的可逆吗？**
 *
 * 当前六处，全部是「停用 / 只打开表单」这类可撤回的动作：
 *   · opera product/clients      —— 停用 client，密钥与授权原样保留
 *   · opera product/entitlements —— 停用授权路由，授权行与配置原样保留
 *   · opera product/entitlements —— 同一个动作的第二个入口（2026-08-31「未登记产品的
 *                                    授权」报表里的 Atlas 行）：同样是软停用、可再启用
 *   · admin invoices             —— 只打开红冲登记表单，红冲发生在提交时（那一步走 step-up）
 *   · admin billing/detail       —— 同上，同一个表单的另一个入口
 *   · opera product/catalog      —— 「删除」菜单项只打开两步删除的预览对话框；删除发生在
 *                                    对话框确认时，那一步走 step-up + 二次确认（2026-08-31）
 */
const EXEMPT_BASELINE = 6;

/** 原生对话框：不是「不推荐」，是这个仓里不许有。 */
const NATIVE_DIALOG = /\bwindow\.(?:confirm|alert)\s*\(/;

/** `confirmExempt` 作为属性/prop 出现（后面跟 `:` 或 `=`），而不是作为词出现。 */
const EXEMPT_DECL = /\bconfirmExempt\s*[:=]/;

/**
 * 把注释挖空但保持行号不变——只认代码位置的出现，不认注释里提到这个词的
 * （本脚本自己的头注、以及各调用点解释为什么豁免的那几段，都在其列）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(REPO_ROOT, r)));
const exemptions = [];
const natives = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  if (!raw.includes('confirmExempt') && !raw.includes('window.')) continue;
  const lines = stripComments(raw).split('\n');
  lines.forEach((line, i) => {
    if (EXEMPT_DECL.test(line)) {
      // 理由可能换行写在下一行，往后看两行取到第一个字符串字面量为止
      const reason = [line, lines[i + 1] ?? '', lines[i + 2] ?? '']
        .join(' ')
        .match(/["'`]([^"'`]*)["'`]/);
      exemptions.push({ file, line: i + 1, reason: reason ? reason[1] : '' });
    }
    if (NATIVE_DIALOG.test(line)) natives.push({ file, line: i + 1, text: line.trim() });
  });
}

const findings = [];

// ① 豁免数目
if (exemptions.length > EXEMPT_BASELINE) {
  findings.push(
    `\`confirmExempt\` 有 ${exemptions.length} 处，基线是 ${EXEMPT_BASELINE}。\n` +
      `         新增的那处若确实可逆，把 EXEMPT_BASELINE 改成 ${exemptions.length}，并在头注的清单里写上它；\n` +
      `         若不可逆，它要的是 \`confirm\`，不是豁免。`,
  );
}

// ② 豁免必须写得出理由。类型只保证「有个字符串」，保证不了那串字有内容。
for (const e of exemptions) {
  if (e.reason.trim().length < 12) {
    findings.push(
      `${rel(e.file)}:${e.line}  豁免理由太短（「${e.reason}」）——要写清这个动作为什么可撤回。`,
    );
  }
}

// ③ 原生对话框
for (const n of natives) {
  findings.push(
    `${rel(n.file)}:${n.line}  用了原生对话框：${n.text}\n` +
      `         它没有主语、样式不受控、而且阻塞页面。改走 DS 的 \`confirm\` 契约。`,
  );
}

console.log('══ 破坏性动作确认门检查（check-destructive-confirmations）══');
console.log(
  `扫描 ${files.length} 个源文件；confirmExempt ${exemptions.length}/${EXEMPT_BASELINE} 处，原生对话框 ${natives.length} 处。`,
);
for (const e of exemptions) {
  console.log(`  · ${rel(e.file)}:${e.line}  ${e.reason.slice(0, 56)}`);
}

if (findings.length === 0) {
  console.log('✓ 未发现问题。');
} else {
  console.log('');
  for (const f of findings) console.log(`  ERROR  ${f}`);
  console.log('');
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
