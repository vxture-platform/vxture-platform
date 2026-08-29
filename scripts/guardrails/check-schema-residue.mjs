#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// check-schema-residue.mjs — 守 SQL-DDL 单一权威：flag 代码里对「退役 schema / 已搬迁表」
//   的残留引用。目标态权威 = deploy/database/ddl/（见 data_platform_320）。
//   任何仍写旧 schema.table 的运行时代码，reset 到新库后会断裂 → 必须锁步改。
//
//   两条扫描路径：
//   ① dotted-reference（.ts/.mjs/.js/.sql）：裸写 `schema.table` 的 raw-pg 代码。
//   ② Prisma schema（.prisma）：模型经 @@schema()+@@map() 映射物理库，退役 schema 不以
//      `schema.table` 形式出现，路径①扫不到 —— 这正是 model-platform cutover 漏网的根因
//      （2026-07-04：自带 Prisma schema，@@schema("commerce")/@@map 旧名，裸串扫描无感，
//      直到生产 readiness 才炸）。故独立解析 datasource.schemas / @@schema / @@map。
// 用法：node scripts/guardrails/check-schema-residue.mjs   （pnpm lint:schema-residue）
//   退出码 1 = 发现残留（regression gate）。清完应为 0。
// ════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['services', 'bff', 'packages', 'deploy'];
const EXCLUDE = [
  `deploy${sep}database${sep}prisma`, // 旧 Prisma 权威已 SUPERSEDED（历史参考，不 apply）
  `packages${sep}core${sep}database${sep}prisma`, // 同上，旧 prisma 副本 + seed.sql
  `deploy${sep}database${sep}ddl`, // 新 DDL 权威本身（modelruntime 已迁 Atlas）；注释用「commerce.metering」是域分组 prose，非残留
  'node_modules', `${sep}.prisma${sep}`, 'generated', 'dist', '.turbo', '.next', // `\.prisma\` = 生成的 client 目录；勿写裸 '.prisma'（会连 schema.prisma 源文件一起排掉）

];
const EXTS = ['.ts', '.mjs', '.js', '.sql'];

// 退役 schema（新 DDL 中不存在）→ 迁往
const RETIRED_SCHEMAS = {
  iam: 'access（role/permission/role_permission）/ appoidc（oidc_client/signing_key）',
  commerce: 'metering / billing / provisioning / promotion（去 tenant_ 前缀）',
  ops: 'admin（已改名，2026-07-02）',
};
// identity schema 保留，但这些表已搬出（identity 仅剩 identities/oauth_providers/oauth_states）
const MOVED_IDENTITY_TABLES = {
  users: 'account.users', user_profile: 'account.user_profiles', user_avatar: 'account.user_avatars',
  user_credential: 'credential.user_credentials',
  tenant: 'tenancy.tenants', tenant_profile: 'tenancy.tenant_profiles', workspaces: 'tenancy.workspaces',
  tenant_membership: 'tenancy.tenant_memberships', workspace_memberships: 'tenancy.workspace_memberships',
  invitation: 'tenancy.invitations',
  auth_session: 'session.auth_sessions', refresh_token: 'session.refresh_tokens',
  user_verification: 'session.user_verifications', password_reset_token: 'session.password_reset_tokens',
  login_attempt: 'session.login_attempts', audit_event: 'support.audit_logs',
  user_points: 'loyalty.user_points', user_points_ledger: 'loyalty.point_ledgers',
  user_level_policy: 'loyalty.level_policies', user_level_threshold: 'loyalty.level_thresholds',
  user_task_progress: 'loyalty.task_progresses',
};

// 排除 TS/Nest 代码结构后缀（iam.module / ops.service / *.types 等非 SQL 引用）
const CODE_SUFFIXES = new Set([
  'module', 'service', 'types', 'type', 'repository', 'controller', 'resolver',
  'spec', 'dto', 'entity', 'guard', 'interface', 'config', 'util', 'utils',
  'constants', 'const', 'mock', 'fixture', 'helper', 'factory', 'strategy',
  'middleware', 'pipe', 'decorator', 'index', 'ts', 'mjs', 'js', 'json',
  'mapper', 'adapter', 'handler', 'validator', 'builder', 'options', 'context',
  'registry', 'router', 'routes', 'app', 'main', 'env', 'schema', 'client',
  'store', 'hook', 'hooks', 'component', 'page', 'style', 'css', 'test',
]);
// product schema 保留，但这些旧表名已改名/复数化（新表见 40_product.sql）
const MOVED_PRODUCT_TABLES = {
  application: 'product.products', plan: 'product.plans', plan_version: 'product.plan_versions',
  plan_component: 'product.plan_components', plan_price: 'product.plan_prices',
  product_i18n: 'product.products（双名列 product_name/product_nick）',
  product_metric: 'product.product_metrics', product_webhook: 'product.product_webhooks',
  launch_checklist_item: 'product.launch_checklist_items', product_launch_status: 'product.product_launch_statuses',
};
const reRetired = new RegExp(`\\b(${Object.keys(RETIRED_SCHEMAS).join('|')})\\.([a-z_][a-z0-9_]*)`, 'g');
const reMovedId = new RegExp(`\\bidentity\\.(${Object.keys(MOVED_IDENTITY_TABLES).join('|')})\\b`, 'g');
const reMovedProd = new RegExp(`\\bproduct\\.(${Object.keys(MOVED_PRODUCT_TABLES).join('|')})\\b`, 'g');

// ── 规则③（2026-07-06，oauth_provider 单数残留事故）：SQL 动词上下文里的
//    `schema.table` 必须存在于权威 DDL。同 schema 表改名（单→复数等）不在
//    retired/moved 清单里，靠"存在性"这一层兜底。上下文限定 from|join|into|update
//    规避 TS 属性访问（session.tenant 等）误报。
const DDL_DIR = join(ROOT, 'deploy', 'database', 'ddl');
const DDL_TABLES = new Set();
const LIVE_SCHEMAS = new Set();
for (const df of readdirSync(DDL_DIR).filter((x) => /^[0-9].*\.sql$/.test(x))) {
  const sql = readFileSync(join(DDL_DIR, df), 'utf8');
  for (const m of sql.matchAll(/^CREATE TABLE ([a-z_]+)\.([a-z_]+)/gm)) {
    DDL_TABLES.add(`${m[1]}.${m[2]}`);
    LIVE_SCHEMAS.add(m[1]);
  }
}
// 规则③白名单：设计上有意未建的表（代码经 to_regclass 探测优雅空态，非残留）。
const DESIGN_PENDING_TABLES = new Set([
  // 2026-08-31 清空：admin.governance_record 的唯一读者 platform-governance.router
  // 已随审批中心 / 平台密钥两页退役，不再有代码探测这张从未建过的表。
]);
const reSqlRef = new RegExp(
  `\\b(?:from|join|into|update)\\s+(${[...LIVE_SCHEMAS].join('|')})\\.([a-z_][a-z0-9_]*)\\b`,
  'gi',
);

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const rel = relative(ROOT, p);
    if (EXCLUDE.some((x) => rel.includes(x))) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.some((x) => e.endsWith(x)) || e.endsWith('.prisma')) out.push(p);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

const hits = [];

// ── Prisma schema 残留解析（路径②）────────────────────────────────────────────
//   模型体内无嵌套 {}（字段属性用 () / []），故 `(model|view|enum|type) X { ... }` 用
//   [^}]* 单块匹配即安全。物理表名 = @@map 值（无则模型名小写）；schema = @@schema 值。
//   注意：绝不对 .prisma 跑 dotted-reference 扫描 —— prose 注释里会写「旧 commerce.xxx」，
//   会误报；@@schema()/@@map() 是指令，不受注释干扰。
function scanPrisma(f) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const text = readFileSync(f, 'utf8');
  const lineAt = (idx) => text.slice(0, idx).split(/\r?\n/).length;

  // (a) datasource `schemas = [...]` 列出退役 schema（文件级强信号）。
  const dsm = /schemas\s*=\s*\[([^\]]*)\]/.exec(text);
  if (dsm) {
    for (const s of Object.keys(RETIRED_SCHEMAS)) {
      if (new RegExp(`["']${s}["']`).test(dsm[1])) {
        hits.push({ rel, line: lineAt(dsm.index), kind: 'retired-schema',
          ref: `datasource.schemas ["${s}"]`, to: RETIRED_SCHEMAS[s] });
      }
    }
  }

  // (b) 逐 model/view/enum/type 块：@@schema + @@map（或模型名）→ 物理 schema.table。
  const blockRe = /\b(?:model|view|enum|type)\s+(\w+)\s*\{([^}]*)\}/g;
  let bm;
  while ((bm = blockRe.exec(text))) {
    const modelName = bm[1], body = bm[2];
    const schemaM = /@@schema\(\s*["']([^"']+)["']\s*\)/.exec(body);
    const mapM = /@@map\(\s*["']([^"']+)["']\s*\)/.exec(body);
    const schema = schemaM ? schemaM[1] : null;
    const table = mapM ? mapM[1] : modelName.toLowerCase();
    const line = lineAt(bm.index);
    if (schema && RETIRED_SCHEMAS[schema]) {
      hits.push({ rel, line, kind: 'retired-schema',
        ref: `@@schema("${schema}") → ${table}`, to: RETIRED_SCHEMAS[schema] });
    } else if (schema === 'identity' && MOVED_IDENTITY_TABLES[table]) {
      hits.push({ rel, line, kind: 'moved-table', ref: `identity.${table}`, to: MOVED_IDENTITY_TABLES[table] });
    } else if (schema === 'product' && MOVED_PRODUCT_TABLES[table]) {
      hits.push({ rel, line, kind: 'moved-table', ref: `product.${table}`, to: MOVED_PRODUCT_TABLES[table] });
    }
  }
}

for (const f of files) {
  if (f.endsWith('.prisma')) { scanPrisma(f); continue; }
  const rel = relative(ROOT, f).split(sep).join('/');
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // 跳纯注释行：迁移 FLAG/JSDoc 常写「旧 commerce.xxx → 新表」的 prose，非可执行查询（误报源）。
    if (/^\s*(\/\/|\/\*|\*|--|#)/.test(line)) return;
    let m;
    reRetired.lastIndex = 0;
    while ((m = reRetired.exec(line))) {
      if (CODE_SUFFIXES.has(m[2])) continue; // TS 模块/文件引用，非 SQL schema.table
      if (line[m.index + m[0].length] === '.') continue; // 三段点分（如 'ops.role.sys_config' 字符串标识符 / 域.schema prose），非两段 SQL schema.table
      hits.push({ rel, line: i + 1, kind: 'retired-schema', ref: `${m[1]}.${m[2]}`, to: RETIRED_SCHEMAS[m[1]] });
    }
    reMovedId.lastIndex = 0;
    while ((m = reMovedId.exec(line))) {
      hits.push({ rel, line: i + 1, kind: 'moved-table', ref: `identity.${m[1]}`, to: MOVED_IDENTITY_TABLES[m[1]] });
    }
    reMovedProd.lastIndex = 0;
    while ((m = reMovedProd.exec(line))) {
      if (line[m.index + m[0].length] === '.') continue; // 三段点分
      hits.push({ rel, line: i + 1, kind: 'moved-table', ref: `product.${m[1]}`, to: MOVED_PRODUCT_TABLES[m[1]] });
    }
    reSqlRef.lastIndex = 0;
    while ((m = reSqlRef.exec(line))) {
      const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
      if (DDL_TABLES.has(key)) continue;
      if (DESIGN_PENDING_TABLES.has(key)) continue;
      const plural = `${key}s`;
      const to = DDL_TABLES.has(plural) ? plural : '（DDL 中无此表，核对权威 DDL）';
      hits.push({ rel, line: i + 1, kind: 'unknown-table', ref: key, to });
    }
  });
}

const prismaN = files.filter((f) => f.endsWith('.prisma')).length;
console.log('══ SQL-DDL 单一权威残留检查（check-schema-residue）══');
console.log(`扫描 ${files.length} 个源文件（含 ${prismaN} 个 live .prisma，${SCAN_DIRS.join('/')}，排除旧 prisma/generated）。`);
console.log('路径①裸 schema.table（raw-pg） · 路径② Prisma @@schema/@@map（防 model-platform 类漏网）。\n');

if (hits.length === 0) {
  console.log('✓ 未发现退役 schema / 已搬迁表 的残留引用。单一权威锁步完成。');
  process.exit(0);
}

const byFile = {};
for (const h of hits) (byFile[h.rel] ??= []).push(h);
for (const [rel, hs] of Object.entries(byFile).sort()) {
  console.log(`● ${rel}  (${hs.length})`);
  const seen = new Set();
  for (const h of hs) {
    const k = h.ref;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`    ${h.ref}  →  ${h.to}`);
  }
}
const files_n = Object.keys(byFile).length;
console.log(`\n── 汇总 ──\n残留引用 ${hits.length} 处，跨 ${files_n} 文件。`);
console.log('权威 = deploy/database/ddl/；请把上列旧 schema.table 锁步改为新名（见 data_platform_320 §3/§5）。');
process.exit(1);
