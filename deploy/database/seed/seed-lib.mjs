/**
 * seed-lib.mjs — shared helpers for the split platform seed (raw `pg`, NOT Prisma).
 *
 * Target: the 18-schema hand-written DDL under deploy/database/ddl/ (target-state data
 * foundation). The seed is split into two separately-runnable, idempotent scripts:
 *   ① seed-catalog.mjs — system catalog (governance RBAC access.*, operator realm admin.*,
 *      appoidc oidc_clients/signing_keys, product/model catalog, identity.oauth_providers,
 *      loyalty level config, kyc verification baseline).
 *   ② seed-sample.mjs   — sample data (test user + personal tenant + default workspace + owner memberships).
 * seed.mjs is a thin orchestrator that runs ① then ② in one transaction.
 *
 * Container note: the seed runs in a pg-only container; no hashing libs. Password hashes
 * are precomputed constants or injected via env.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Resolve DATABASE_URL (env first, then .env.local upward) ───────────────────
export function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const __dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(__dir, '../'.repeat(i), '.env.local');
    try {
      const content = readFileSync(candidate, 'utf-8');
      const match = content.match(/^DATABASE_URL=(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      // not found, keep walking up
    }
  }
  throw new Error('DATABASE_URL not found. Set it in environment or .env.local');
}

// ── Dynamically load pg (pnpm virtual store fallback) ──────────────────────────
export async function loadPg() {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);

  try { return req('pg'); } catch { /* fall through */ }

  // pnpm virtual-store fallback: walk up from this file looking for the repo's node_modules.
  const __dir = dirname(fileURLToPath(import.meta.url));
  const tried = [];
  for (let i = 1; i <= 5; i++) {
    const pgPath = resolve(__dir, '../'.repeat(i), 'node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js');
    tried.push(pgPath);
    try { return req(pgPath); } catch { /* keep walking up */ }
  }

  throw new Error(`Cannot find pg. Tried:\n${tried.join('\n')}`);
}

// ── Run a seed fn inside a single transaction ─────────────────────────────────
export async function runSeed(label, fn) {
  const databaseUrl = loadDatabaseUrl();
  const pg = await loadPg();
  const { Client } = pg.default ?? pg;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log(`\n[${label}] Connected to: ${databaseUrl.replace(/:([^:@]+)@/, ':***@')}\n`);

  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
    console.log(`\n✓  [${label}] Seed completed successfully.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n✗  [${label}] Seed failed, rolled back.\n`, err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// ── Detect "run directly" (ESM) so a file can both export and self-run ─────────
export function isMain(importMetaUrl) {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
  const self = fileURLToPath(importMetaUrl);
  return invoked === self;
}

// ── Fixed UUIDs (idempotency) ─────────────────────────────────────────────────
// Only constants actually referenced by the new seed are kept (the legacy per-app
// plan/feature UUIDs were dropped — the product seed now mints plan/product ids with
// gen_random_uuid on a plan_code / product_code natural key).
export const ID = {
  // operator realm — system catalog (admin.operator_*)
  roleSystem:        '00000000-0000-4000-a000-000000000001', // admin.operator_role sys_config
  roleSuperAdmin:    '00000000-0000-4000-a000-000000000002', // admin.operator_role super_admin
  adminSystem:       '00000000-0000-4000-a000-000000000010', // admin.operator_account systemadmin (meta anchor / createdBy)
  adminSuperAdmin:   '00000000-0000-4000-a000-000000000011', // admin.operator_account superadmin
  // model providers / models
  providerDoubao:    '00000000-0000-4000-a000-000000000500',
  providerAnthropic: '00000000-0000-4000-a000-000000000501',
  providerOpenai:    '00000000-0000-4000-a000-000000000502',
  providerDeepseek:  '00000000-0000-4000-a000-000000000503', // domestic, direct egress
  providerMinimax:   '00000000-0000-4000-a000-000000000504', // domestic, direct egress
  providerGoogle:    '00000000-0000-4000-a000-000000000505', // overseas, registered closed (pending egress+compliance)
  modelDoubaoPro:    '00000000-0000-4000-a000-000000000510',
  modelClaudeSonnet: '00000000-0000-4000-a000-000000000511',
  modelGpt4o:        '00000000-0000-4000-a000-000000000512',
  modelDeepseekChat: '00000000-0000-4000-a000-000000000513',
  modelMinimaxText:  '00000000-0000-4000-a000-000000000514',
  modelGeminiFlash:  '00000000-0000-4000-a000-000000000515',
  // identity oauth providers (inbound federation broker config)
  oauthFeishu:       '00000000-0000-4000-a000-000000000900',
  oauthDingtalk:     '00000000-0000-4000-a000-000000000901',
  oauthGoogle:       '00000000-0000-4000-a000-000000000902',
  // sample: user / tenant / workspace / memberships (②)
  userZhangsan:      '00000000-0000-4000-a000-000000000100',
  tenantZhangsan:    '00000000-0000-4000-a000-000000000200',
  workspaceZhangsan: '00000000-0000-4000-a000-000000000210',
  tenantMemZhangsan: '00000000-0000-4000-a000-000000000300',
  wsMemZhangsan:     '00000000-0000-4000-a000-000000000310',
};

// SYS = created_by for system-init data (the admin "systemadmin" meta account).
export const SYS = ID.adminSystem;
