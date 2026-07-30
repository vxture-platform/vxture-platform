#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed 幂等 + perm_code 命名 linter
//
// 把「seed/init 数据约定」（data_platform_100_architecture.md §2.2.5）与
// 「perm_code 三段式」（§3.2.2 / data_admin_200 §4.2）从文字固化为可执行检查：
//   ① 幂等：deploy/database/seed/*.mjs 里每个 `insert into` 语句必须带 `on conflict`
//      （唯一自然键 + on conflict = 普适幂等保证，防重复初始化）。
//   ② perm_code：运营 realm 权限码（OPERATOR_PERMISSIONS）必须匹配三段式
//      `{domain}:{...}`（冒号分顶域）。客户 realm 点分式历史码 grandfather，不在此查。
//   ③ perm_name 长度：OPERATOR_PERMISSIONS 每项第二元素（同时写入
//      admin.operator_permission.perm_name/description）须 ≤64 字符，匹配
//      80_admin.sql 的 `perm_name varchar(64)` 列宽——超长在 seed 期直接 22001
//      报错回滚，此前一次线上 reseed 就是这样炸的（2026-07-30）。
//
// 设计目标可扩展：新问题 → 加一条 check。
// 运行：  node scripts/guardrails/check-seed-idempotency.mjs
// 别名：  pnpm lint:seed
// 退出码：存在 error → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SEED_DIR = join(REPO_ROOT, 'deploy', 'database', 'seed');
const rel = (f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');

// 运营 realm perm_code 合法形态：{domain}:{path}，domain=[a-z_]+，path=点分 [a-z_.]+。
// 接受 operator:account.manage / support:impersonate / audit:read / tenant:profile.read。
const PERM_CODE_RE = /^[a-z][a-z_]*:[a-z][a-z_.]*$/;

const findings = [];
function report(file, line, msg) {
  findings.push({ file, line, msg });
}

// 行号定位：给定字符 offset 返回 1-based 行号。
function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function checkFile(file) {
  const content = readFileSync(file, 'utf8');

  // ── ① 幂等：每个含 `insert into` 的反引号模板块须有可识别的幂等机制 ─────────
  // 认可的机制：块内 `on conflict` / `where not exists`；或条件式创建（前置窗口含
  // `rows.length` 守卫 / `returning id` / 显式 `idempotent` 注释——"仅父行新建才插子行"）。
  // 三者皆无 → 重跑会重复插入，报错。
  const tplRe = /`([^`]*)`/g;
  let m;
  while ((m = tplRe.exec(content))) {
    const block = m[1];
    if (!/insert\s+into/i.test(block)) continue;
    if (/on\s+conflict/i.test(block) || /not\s+exists/i.test(block)) continue;
    // 前置窗口（约 12 行）识别条件式创建幂等
    const before = content.slice(Math.max(0, m.index - 640), m.index);
    if (/rows\.length|returning\s+id|idempotent/i.test(before)) continue;
    const insIdx = m.index + block.search(/insert\s+into/i);
    const tbl = (block.match(/insert\s+into\s+([\w.]+)/i) || [, '?'])[1];
    report(file, lineOf(content, insIdx),
      `insert into ${tbl} 无幂等机制（缺 on conflict / not exists / 条件式守卫）→ 违反 seed 幂等约定（§2.2.5），重跑会重复插入`);
  }

  // ── ② perm_code 三段式 + ③ perm_name 长度（仅 OPERATOR_PERMISSIONS 运营 realm）──
  // 80_admin.sql: admin.operator_permission.perm_name varchar(128)（2026-07-30 64→128）。
  // 每项 [code, name] 或 [code, name, description]（description 独立列 varchar(255)，不受此限）。
  const PERM_NAME_MAX = 128;
  const opBlock = content.match(/const\s+OPERATOR_PERMISSIONS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (opBlock) {
    const body = opBlock[1];
    const baseLine = lineOf(content, opBlock.index);
    // 逐项（非逐行）解析：一个项可能跨多行（长 name/description 换行书写）。
    const itemRe =
      /\[\s*['"]([^'"]+)['"]\s*,\s*['"]((?:[^'"\\]|\\.)*)['"]\s*(?:,\s*['"](?:[^'"\\]|\\.)*['"]\s*)?,?\s*\]/g;
    let im;
    while ((im = itemRe.exec(body))) {
      const [, code, name] = im;
      const line = baseLine + lineOf(body, im.index) - 1;
      if (!PERM_CODE_RE.test(code)) {
        report(file, line, `operator perm_code「${code}」不匹配三段式 {domain}:{resource}.{action}（冒号分顶域）`);
      }
      if (name.length > PERM_NAME_MAX) {
        report(file, line, `operator perm_code「${code}」的 name「${name}」长度 ${name.length} 超过 perm_name varchar(${PERM_NAME_MAX})，reseed 会 22001 回滚`);
      }
    }
  }
}

const files = existsSync(SEED_DIR)
  ? readdirSync(SEED_DIR).filter((n) => n.endsWith('.mjs') && !n.includes('lib')).map((n) => join(SEED_DIR, n))
  : [];
for (const f of files) checkFile(f);

console.log('══ seed 幂等 + perm_code 检查（check-seed-idempotency）══');
console.log(`扫描 ${files.length} 个 seed .mjs（${rel(SEED_DIR)}）。\n`);

if (findings.length === 0) {
  console.log('✓ 未发现问题。');
} else {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`● ${rel(file)}`);
    for (const f of list.sort((a, b) => a.line - b.line)) {
      console.log(`  ERROR L${f.line}  ${f.msg}`);
    }
    console.log('');
  }
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
