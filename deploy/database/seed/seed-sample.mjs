/**
 * seed-sample.mjs — ② SAMPLE DATA seed (idempotent, raw `pg`).
 *
 * Target-state 18-schema DDL (deploy/database/ddl/). Creates one end-to-end sample identity
 * (personal tenant auto-gets a default workspace + owner membership at both levels):
 *   account.users + credential.user_credentials + account.user_profiles + loyalty.user_points
 *   tenancy.tenants (type=personal) + tenancy.workspaces (default)
 *   tenancy.tenant_memberships(owner) + tenancy.workspace_memberships(owner)
 *
 * NOT for production by default (test data). Run directly:
 *   DATABASE_URL=... node seed-sample.mjs
 *
 * REQUIRES seed-catalog.mjs to have run first: tenant/workspace memberships now carry a real
 * composite FK (role_id, role_scope) → access.roles(id, scope), so the tenant/workspace owner
 * roles must already exist (unlike the old inline role-code model).
 */

import { runSeed, isMain, ID } from './seed-lib.mjs';

// Sample login identity. Fake but complete. SECURITY: the password is NOT hardcoded —
// its Argon2id PHC hash must be supplied via SAMPLE_USER_PASSWORD_HASH (a runtime secret)
// so no public credential ships in the repo.
const SAMPLE = {
  account: 'stonesmoker',
  email: 'yanhaoguo@gmail.com',
  phone: '+8618092907523',
  name: 'Stone Smoker',
  passwordHash: (process.env.SAMPLE_USER_PASSWORD_HASH || '').startsWith('$argon2')
    ? process.env.SAMPLE_USER_PASSWORD_HASH
    : null,
};

export async function seedSample(client) {
  // No credential configured → skip the sample user rather than seed a login-broken /
  // public-default account. Loud warning so misconfig is visible.
  if (!SAMPLE.passwordHash) {
    console.warn(
      '⚠  SAMPLE_USER_PASSWORD_HASH not set — skipping sample user (stonesmoker). ' +
        'Set it (Argon2id PHC hash) in the runtime secret to seed it.',
    );
    return;
  }

  // ── 1. account.users (phone = verified strong anchor; email may be unverified) ─
  await client.query(`
    insert into account.users
      (id, account, email, email_verified_at, phone, phone_verified_at, status, created_at, updated_at)
    values ($1, $2, $3, now(), $4, now(), 'active', now(), now())
    on conflict (account) do nothing
  `, [ID.sampleUser, SAMPLE.account, SAMPLE.email, SAMPLE.phone]);

  const userRes = await client.query(
    `select id from account.users where account = $1 limit 1`, [SAMPLE.account]);
  const userId = userRes.rows[0]?.id ?? ID.sampleUser;

  await client.query(`
    insert into credential.user_credentials (user_id, password_hash, created_at, updated_at)
    values ($1, $2, now(), now()) on conflict (user_id) do nothing
  `, [userId, SAMPLE.passwordHash]);

  // display_name lives on the 1:1 account.user_profiles; loyalty.user_points balance row.
  await client.query(`
    insert into account.user_profiles
      (user_id, display_name, gender, bio, language, timezone, theme, created_at, updated_at)
    values ($1, $2, 'unknown', 'Sample user for integration testing.', 'zh-CN', 'Asia/Shanghai', 'system', now(), now())
    on conflict (user_id) do nothing
  `, [userId, SAMPLE.name]);
  await client.query(`
    insert into loyalty.user_points (user_id, total_points, updated_at)
    values ($1, 0, now()) on conflict (user_id) do nothing
  `, [userId]);
  console.log('✓  account.users + user_credentials + user_profiles + loyalty.user_points — stonesmoker');

  // ── 2. governance owner roles (composite FK targets for memberships) ────────
  const tOwnerRes = await client.query(
    `select id from access.roles where scope = 'tenant' and role_code = 'owner' limit 1`);
  const wOwnerRes = await client.query(
    `select id from access.roles where scope = 'workspace' and role_code = 'owner' limit 1`);
  const tenantOwnerRoleId = tOwnerRes.rows[0]?.id;
  const wsOwnerRoleId = wOwnerRes.rows[0]?.id;
  if (!tenantOwnerRoleId || !wsOwnerRoleId) {
    throw new Error(
      'access.roles owner roles not found — run seed-catalog.mjs before seed-sample.mjs ' +
        '(memberships require access.roles(id, scope) composite FK targets).',
    );
  }

  // ── 3. tenancy.tenants (personal) ───────────────────────────────────────────
  await client.query(`
    insert into tenancy.tenants (id, name, type, owner_user_id, status, created_at, updated_at)
    values ($1, $2, 'personal', $3, 'active', now(), now())
    on conflict (id) do nothing
  `, [ID.sampleTenant, SAMPLE.name, userId]);

  // ── 4. tenancy.workspaces (default) ─────────────────────────────────────────
  await client.query(`
    insert into tenancy.workspaces (id, tenant_id, name, is_default, status, created_at, updated_at)
    values ($1, $2, 'Default', true, 'active', now(), now())
    on conflict (id) do nothing
  `, [ID.sampleWorkspace, ID.sampleTenant]);

  // ── 5. memberships (owner at both levels; role via composite FK) ────────────
  // tenant_membership must exist before workspace_membership (composite FK
  // workspace_memberships.(tenant_id,user_id) → tenant_memberships).
  await client.query(`
    insert into tenancy.tenant_memberships (id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
    values ($1, $2, $3, $4, 'tenant', 'active', now(), now())
    on conflict (tenant_id, user_id) do nothing
  `, [ID.sampleTenantMem, ID.sampleTenant, userId, tenantOwnerRoleId]);
  await client.query(`
    insert into tenancy.workspace_memberships (id, workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
    values ($1, $2, $3, $4, $5, 'workspace', 'active', now(), now())
    on conflict (workspace_id, user_id) do nothing
  `, [ID.sampleWsMem, ID.sampleWorkspace, ID.sampleTenant, userId, wsOwnerRoleId]);
  console.log('✓  tenancy.tenants(personal) + default workspace + owner memberships');
}

if (isMain(import.meta.url)) {
  runSeed('sample', seedSample);
}
