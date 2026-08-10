/**
 * seed-lib.mjs — shared helpers for the split seed scripts.
 *
 * Identity Platform rebuild (docs/design/identity-platform-architecture.md): the seed is
 * split into two separately-runnable, idempotent scripts —
 *   ① seed-catalog.mjs — system catalog (governance roles/permissions,
 *      oidc_client, signing_key, + ported ops/product/model catalog)
 *   ② seed-sample.mjs   — sample data (test user + personal org + default workspace)
 * seed.mjs is a thin orchestrator that runs ① then ② for backward compatibility.
 *
 * Container note: the seed runs in a pg-only container (23-seed-platform-database.sh);
 * no hashing libs. Password hashes are precomputed constants or injected via env.
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

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const pgPath = resolve(repoRoot, 'node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js');
  try { return req(pgPath); } catch { /* fall through */ }

  throw new Error(`Cannot find pg. Tried: ${pgPath}`);
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
export const ID = {
  // ops (operator realm — system catalog)
  roleSystem:        '00000000-0000-4000-a000-000000000001',
  roleSuperAdmin:    '00000000-0000-4000-a000-000000000002',
  adminSystem:       '00000000-0000-4000-a000-000000000010',
  adminSuperAdmin:   '00000000-0000-4000-a000-000000000011',
  // product — applications
  appRuyin:          '00000000-0000-4000-a000-0000000003a0',
  appXuanzhen:       '00000000-0000-4000-a000-0000000003a1',
  appHermes:         '00000000-0000-4000-a000-0000000003a2',
  appArda:           '00000000-0000-4000-a000-0000000003a3',
  appRunos:           '00000000-0000-4000-a000-0000000003a4',
  appNocus:          '00000000-0000-4000-a000-0000000003a5',
  appAtlas:          '00000000-0000-4000-a000-0000000003a6',
  appOntos:          '00000000-0000-4000-a000-0000000003a7',
  appRaven:          '00000000-0000-4000-a000-0000000003a8',
  appAnlan:          '00000000-0000-4000-a000-0000000003a9',
  appForge:          '00000000-0000-4000-a000-0000000003aa',
  // product — plans (app offset 30–39; slot 01=free 02=starter 03=pro 04=business 05=enterprise)
  // ruyin: free kept at legacy planFree UUID for backward compat with existing subscriptions
  planFree:             '00000000-0000-4000-a000-000000000400', // ruyin-free (legacy alias)
  planRuyinStarter:        '00000000-0000-4000-a000-000000300002',
  planRuyinPro:            '00000000-0000-4000-a000-000000300003',
  planRuyinBusiness:       '00000000-0000-4000-a000-000000300004',
  planRuyinEnterprise:     '00000000-0000-4000-a000-000000300005',
  planXuanzhenFree:        '00000000-0000-4000-a000-000000380001',
  planXuanzhenStarter:     '00000000-0000-4000-a000-000000380002',
  planXuanzhenPro:         '00000000-0000-4000-a000-000000380003',
  planXuanzhenBusiness:    '00000000-0000-4000-a000-000000380004',
  planXuanzhenEnterprise:  '00000000-0000-4000-a000-000000380005',
  planRunosFree:            '00000000-0000-4000-a000-000000310001',
  planRunosStarter:         '00000000-0000-4000-a000-000000310002',
  planRunosPro:             '00000000-0000-4000-a000-000000310003',
  planRunosBusiness:        '00000000-0000-4000-a000-000000310004',
  planRunosEnterprise:      '00000000-0000-4000-a000-000000310005',
  planNocusFree:           '00000000-0000-4000-a000-000000320001',
  planNocusStarter:        '00000000-0000-4000-a000-000000320002',
  planNocusPro:            '00000000-0000-4000-a000-000000320003',
  planNocusBusiness:       '00000000-0000-4000-a000-000000320004',
  planNocusEnterprise:     '00000000-0000-4000-a000-000000320005',
  planAtlasFree:           '00000000-0000-4000-a000-000000330001',
  planAtlasStarter:        '00000000-0000-4000-a000-000000330002',
  planAtlasPro:            '00000000-0000-4000-a000-000000330003',
  planAtlasBusiness:       '00000000-0000-4000-a000-000000330004',
  planAtlasEnterprise:     '00000000-0000-4000-a000-000000330005',
  planOntosFree:           '00000000-0000-4000-a000-000000340001',
  planOntosStarter:        '00000000-0000-4000-a000-000000340002',
  planOntosPro:            '00000000-0000-4000-a000-000000340003',
  planOntosBusiness:       '00000000-0000-4000-a000-000000340004',
  planOntosEnterprise:     '00000000-0000-4000-a000-000000340005',
  planRavenFree:           '00000000-0000-4000-a000-000000350001',
  planRavenStarter:        '00000000-0000-4000-a000-000000350002',
  planRavenPro:            '00000000-0000-4000-a000-000000350003',
  planRavenBusiness:       '00000000-0000-4000-a000-000000350004',
  planRavenEnterprise:     '00000000-0000-4000-a000-000000350005',
  planAnlanFree:           '00000000-0000-4000-a000-000000360001',
  planAnlanStarter:        '00000000-0000-4000-a000-000000360002',
  planAnlanPro:            '00000000-0000-4000-a000-000000360003',
  planAnlanBusiness:       '00000000-0000-4000-a000-000000360004',
  planAnlanEnterprise:     '00000000-0000-4000-a000-000000360005',
  planForgeFree:           '00000000-0000-4000-a000-000000370001',
  planForgeStarter:        '00000000-0000-4000-a000-000000370002',
  planForgePro:            '00000000-0000-4000-a000-000000370003',
  planForgeBusiness:       '00000000-0000-4000-a000-000000370004',
  planForgeEnterprise:     '00000000-0000-4000-a000-000000370005',
  planArdaFree:            '00000000-0000-4000-a000-000000390001',
  planArdaStarter:         '00000000-0000-4000-a000-000000390002',
  planArdaPro:             '00000000-0000-4000-a000-000000390003',
  planArdaBusiness:        '00000000-0000-4000-a000-000000390004',
  planArdaEnterprise:      '00000000-0000-4000-a000-000000390005',
  featureAiTokens:   '00000000-0000-4000-a000-000000000410',
  featureAgents:     '00000000-0000-4000-a000-000000000411',
  // model providers / models
  providerDoubao:    '00000000-0000-4000-a000-000000000500',
  providerAnthropic: '00000000-0000-4000-a000-000000000501',
  providerOpenai:    '00000000-0000-4000-a000-000000000502',
  modelDoubaoPro:    '00000000-0000-4000-a000-000000000510',
  modelClaudeSonnet: '00000000-0000-4000-a000-000000000511',
  modelGpt4o:        '00000000-0000-4000-a000-000000000512',
  // identity oauth providers (inbound federation broker config)
  oauthFeishu:       '00000000-0000-4000-a000-000000000900',
  oauthDingtalk:     '00000000-0000-4000-a000-000000000901',
  oauthGoogle:       '00000000-0000-4000-a000-000000000902',
  // sample: user / org / workspace / memberships (②)
  userZhangsan:      '00000000-0000-4000-a000-000000000100',
  orgZhangsan:       '00000000-0000-4000-a000-000000000200',
  workspaceZhangsan: '00000000-0000-4000-a000-000000000210',
  orgMemZhangsan:    '00000000-0000-4000-a000-000000000300',
  wsMemZhangsan:     '00000000-0000-4000-a000-000000000310',
};

// SYS = createdBy for system-init data (the ops "system" meta account)
export const SYS = ID.adminSystem;
