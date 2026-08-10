/**
 * seed-catalog.mjs — ① SYSTEM CATALOG seed (idempotent).
 *
 * Identity Platform rebuild; field-level authority docs/design/platform-data-architecture-schema.md §5 iam +
 * docs/design/platform-data-architecture-schema.md §5 iam (RBAC seed).
 *
 * Seeds platform-level catalog data (NOT sample tenants):
 *   iam      — global governance role(6) + permission(9) + role_permission (two-level RBAC)
 *            + oidc_client (platform RPs) + signing_key (env-injected or dev placeholder)
 *   ops      — operator realm: role(sys_config/super_admin) + admin(system/superadmin)  [ported]
 *   product  — application + free plan + features + price                                [ported]
 *   model    — provider + model + price_rule (active models for readiness)               [ported]
 *   identity — oauth_provider inbound federation broker config (feishu/dingtalk/google)  [ported]
 *
 * Run directly:  DATABASE_URL=... node seed-catalog.mjs
 */

import { runSeed, isMain, ID, SYS } from './seed-lib.mjs';

// ── Governance permission catalog (§8.4 / data-model §5.5) ────────────────────
const PERMISSIONS = [
  ['org.member.manage',        'Manage organization members'],
  ['org.role.assign',          'Assign organization roles'],
  ['org.workspace.manage',     'Manage workspaces in the organization'],
  ['org.billing.manage',       'Manage organization billing & subscriptions'],
  ['org.settings.manage',      'Manage organization settings'],
  ['org.delete',               'Delete the organization'],
  ['workspace.member.manage',  'Manage workspace members'],
  ['workspace.role.assign',    'Assign workspace roles'],
  ['workspace.settings.manage','Manage workspace settings'],
];

// ── Role catalog: two-level, global (§8.3) ────────────────────────────────────
const ROLES = [
  ['org',       'owner',   'Organization Owner'],
  ['org',       'manager', 'Organization Manager'],
  ['org',       'member',  'Organization Member'],
  ['workspace', 'owner',   'Workspace Owner'],
  ['workspace', 'manager', 'Workspace Manager'],
  ['workspace', 'member',  'Workspace Member'],
];

// ── Role → permission mapping (§5.5). member roles get none. ───────────────────
const ORG_ALL = PERMISSIONS.filter((p) => p[0].startsWith('org.')).map((p) => p[0]);
const WS_ALL  = PERMISSIONS.filter((p) => p[0].startsWith('workspace.')).map((p) => p[0]);
const ROLE_PERMS = {
  'org:owner':       [...ORG_ALL, ...WS_ALL],
  'org:manager':     ['org.member.manage', 'org.role.assign', 'org.workspace.manage', 'org.settings.manage'],
  'org:member':      [],
  'workspace:owner': [...WS_ALL],
  'workspace:manager': ['workspace.member.manage', 'workspace.settings.manage'],
  'workspace:member': [],
};

export async function seedCatalog(client) {
  // ── 1. operator realm: operator_role + operator_account + operator_credential ─
  //   (see docs/design/identity-platform-operator.md §6). Two built-in accounts:
  //   • systemadmin — account_type=system_builtin, status=disabled, NO credential:
  //     a meta anchor / created_by for system-init rows; never logs in.
  //   • superadmin  — account_type=system, status=active: the ONLY username+password
  //     login at bootstrap (sign in before phone/email OTP is wired). Password
  //     defaults to Admin@2026 (force_password_change=true → change after first
  //     login) in NON-production only — the default is public in this repo, so
  //     the 23/29 seed runners fail closed unless OPERATOR_SUPERADMIN_PASSWORD_HASH
  //     is set (2026-07-21 gate).
  //   The seed container has no hashing libs, so the default is a precomputed
  //   Argon2id PHC string (hash-wasm, m=65536 t=3 p=1, self-verified).
  const DEFAULT_SUPERADMIN_HASH =
    '$argon2id$v=19$m=65536,t=3,p=1$Z2riL/tYwCUFpQK5jq/uVQ$l6hiSqwHPlc8IgK5DDBT9qPAveujOQak9lHVHUI+icE'; // Admin@2026
  const envHash =
    (process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH || '').startsWith('$argon2')
      ? process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH
      : null;
  const superadminHash = envHash ?? DEFAULT_SUPERADMIN_HASH;
  const forcePwChange = !envHash; // default password → must change after first login

  // super_admin is high-privilege → role MFA floor = required (enforced once P2 lands).
  await client.query(`
    insert into admin.operator_role (id, role_code, status, name_en, name_i18n_key, description, is_system, sort, mfa_min_level)
    values
      ($1, 'sys_config',  'active', 'System Config', 'ops.role.sys_config',
       'Platform self-governance config meta-role, used as createdBy for system-init data.', true, 0, 'optional'),
      ($2, 'super_admin', 'active', 'Super Admin',   'ops.role.super_admin',
       'Platform built-in super admin with all permissions.', true, 1, 'required')
    on conflict (role_code) do nothing
  `, [ID.roleSystem, ID.roleSuperAdmin]);

  const roleRes = await client.query(
    `select id, role_code from admin.operator_role where role_code in ('sys_config','super_admin') and status='active'`);
  const opsRoleMap = Object.fromEntries(roleRes.rows.map((r) => [r.role_code, r.id]));

  // systemadmin: meta anchor — disabled + no credential ⇒ cannot log in.
  // superadmin: active, created_by systemadmin; contact seeded for recovery/notifications.
  await client.query(`
    insert into admin.operator_account
      (id, role_id, username, display_name, status, account_type, email, phone, created_by, remark, sort, created_at, updated_at)
    values
      ($1, $3, 'systemadmin', 'systemadmin', 'disabled', 'system_builtin', null, null, null,
       'Platform meta account / created_by for system-init data. Disabled, no credential — never logs in.', 0, now(), now()),
      ($2, $4, 'superadmin',  'Super Admin', 'active',   'system',         $5,   $6,   $1,
       'Built-in super admin. Bootstrap username+password login; all platform permissions.', 1, now(), now())
    on conflict (username) do update set
      email = coalesce(excluded.email, admin.operator_account.email),
      phone = coalesce(excluded.phone, admin.operator_account.phone),
      updated_at = now()
  `, [ID.adminSystem, ID.adminSuperAdmin,
      opsRoleMap['sys_config'] ?? ID.roleSystem, opsRoleMap['super_admin'] ?? ID.roleSuperAdmin,
      // Contact env-projected (owner PII no longer hardcoded, 2026-07-21);
      // null keeps existing DB values via the coalesce in on-conflict.
      process.env.OPERATOR_SUPERADMIN_EMAIL || null,
      process.env.OPERATOR_SUPERADMIN_PHONE || null]);

  // Credential (Argon2id; 1-1). Only superadmin gets one (systemadmin never auths).
  // do-nothing on conflict so an idempotent re-seed never resets a changed password.
  await client.query(`
    insert into admin.operator_credential (operator_id, password_hash, force_password_change, created_at, updated_at)
    values ($1, $2, $3, now(), now())
    on conflict (operator_id) do nothing
  `, [ID.adminSuperAdmin, superadminHash, forcePwChange]);
  console.log(`✓  ops — operator_role + operator_account (systemadmin/superadmin) + credential (password=${envHash ? 'env override' : 'default Admin@2026'})`);

  // Platform default operator MFA policy (resolver floor; §2.2). effective =
  // max(this, operator_role.mfa_min_level, operator_mfa.policy).
  await client.query(`
    insert into admin.setting (config_group, config_key, value_type, config_value, description, created_by, created_at, updated_at)
    values ('operator_security', 'operator.mfa.policy', 'string', 'optional',
            'Platform default operator MFA policy: disabled|optional|required.', $1, now(), now())
    on conflict (config_key) do nothing
  `, [SYS]);
  console.log('✓  ops — setting operator.mfa.policy=optional');

  // ── 2. iam.permission (governance catalog) ──────────────────────────────────
  for (const [code, description] of PERMISSIONS) {
    await client.query(`
      insert into iam.permission (code, description, created_at)
      values ($1, $2, now()) on conflict (code) do nothing
    `, [code, description]);
  }

  // ── 3. iam.role (two-level global) ──────────────────────────────────────────
  for (const [scope, code, name] of ROLES) {
    await client.query(`
      insert into iam.role (scope, code, name, created_at, updated_at)
      values ($1, $2, $3, now(), now()) on conflict (scope, code) do nothing
    `, [scope, code, name]);
  }

  // ── 4. iam.role_permission (mapping) ────────────────────────────────────────
  const permRes = await client.query(`select id, code from iam.permission`);
  const permMap = Object.fromEntries(permRes.rows.map((r) => [r.code, r.id]));
  const roleRows = await client.query(`select id, scope, code from iam.role`);
  for (const r of roleRows.rows) {
    const codes = ROLE_PERMS[`${r.scope}:${r.code}`] ?? [];
    for (const code of codes) {
      const permId = permMap[code];
      if (!permId) continue;
      await client.query(`
        insert into iam.role_permission (role_id, permission_id, created_at)
        values ($1, $2, now()) on conflict (role_id, permission_id) do nothing
      `, [r.id, permId]);
    }
  }
  console.log('✓  iam — 9 permissions + 6 roles + role_permission mapping');

  // ── identity growth config (§6.1.2/6.1.3): level policy + thresholds (placeholder) ─
  // max_owned_org_tenant / min_points are placeholder values pending business input
  // (runbook §6.5); thresholds must stay distinct (UNIQUE) and monotonic.
  await client.query(`
    insert into identity.user_level_policy (level_no, max_owned_org_tenant, description) values
      (1, 1, 'L1'), (2, 1, 'L2'), (3, 1, 'L3'), (4, 1, 'L4'), (5, 1, 'L5')
    on conflict (level_no) do nothing
  `);
  await client.query(`
    insert into identity.user_level_threshold (level_no, min_points) values
      (1, 0), (2, 1), (3, 2), (4, 3), (5, 4)
    on conflict (level_no) do nothing
  `);
  console.log('✓  identity — user_level_policy + user_level_threshold (5 levels, placeholder)');

  // ── commerce baseline KYC policy (§6.3.2): platform baseline rows (product_id NULL) ─
  // NOT EXISTS guard keeps this idempotent before the B15 partial-unique index exists.
  for (const [ttype, rtype] of [['personal', 'individual'], ['organization', 'enterprise']]) {
    await client.query(`
      insert into commerce.verification_policy (product_id, tenant_type, require_verification, required_type)
      select null, $1::varchar, true, $2::varchar
       where not exists (
         select 1 from commerce.verification_policy where product_id is null and tenant_type = $1::varchar)
    `, [ttype, rtype]);
  }
  console.log('✓  commerce — verification_policy baseline (personal/organization)');

  // ── 5. iam.oidc_client (platform RPs; secret hash injected via env) ─────────
  // Base URL helpers: build redirect_uris for prod + optional beta.
  // Beta URL is only registered when {APP}_BETA_BASE_URL env is set; omitting it
  // in dev/staging prevents stale URIs from being registered.
  function appUris(prod, betaEnv) {
    const uris = [`${prod}/auth/callback`];
    if (betaEnv) uris.push(`${betaEnv}/auth/callback`);
    return uris;
  }

  const B = {
    website:  process.env.WEBSITE_BASE_URL  || 'http://localhost:3000',
    console:  process.env.CONSOLE_BASE_URL  || 'http://localhost:3001',
    admin:    process.env.ADMIN_BASE_URL    || 'http://localhost:3002',
    // ruyin.ai — platform-level cross-domain RP; no beta variant (prod only).
    // See docs/design/identity-platform-rp-integration.md §11.
    ruyin:    process.env.RUYIN_BASE_URL    || 'http://localhost:3080',
    // New saas apps — prod + optional beta
    runos:    process.env.RUNOS_BASE_URL     || 'http://localhost:3081',
    nocus:    process.env.NOCUS_BASE_URL    || 'http://localhost:3082',
    atlas:    process.env.ATLAS_BASE_URL    || 'http://localhost:3083',
    ontos:    process.env.ONTOS_BASE_URL    || 'http://localhost:3084',
    raven:    process.env.RAVEN_BASE_URL    || 'http://localhost:3085',
    anlan:    process.env.ANLAN_BASE_URL    || 'http://localhost:3086',
    forge:    process.env.FORGE_BASE_URL    || 'http://localhost:3087',
    xuanzhen: process.env.XUANZHEN_BASE_URL || 'http://localhost:3088',
    arda:     process.env.ARDA_BASE_URL     || 'http://localhost:3089',
  };
  const betaB = {
    runos:    process.env.RUNOS_BETA_BASE_URL     || null,
    nocus:    process.env.NOCUS_BETA_BASE_URL    || null,
    atlas:    process.env.ATLAS_BETA_BASE_URL    || null,
    ontos:    process.env.ONTOS_BETA_BASE_URL    || null,
    raven:    process.env.RAVEN_BETA_BASE_URL    || null,
    anlan:    process.env.ANLAN_BETA_BASE_URL    || null,
    forge:    process.env.FORGE_BETA_BASE_URL    || null,
    xuanzhen: process.env.XUANZHEN_BETA_BASE_URL || null,
    arda:     process.env.ARDA_BETA_BASE_URL     || null,
  };

  // Unified post-logout surface (accounts). In prod the issuer IS the accounts
  // origin; the IdP validates post_logout_redirect_uri (origin+path) against this.
  const accountsBase = process.env.ACCOUNTS_BASE_URL || 'http://localhost:3040';
  const postLogout = `${accountsBase}/logout`;

  const oidcClients = [
    // post_logout_redirect_uris includes the website home so the BFF can send users
    // directly there on sign-out without an intermediate accounts/logout hop.
    { clientId: 'website',  name: 'Vxture Website',  displayName: 'Vxture Website',  realm: 'customer',
      redirectUris: [`${B.website}/auth/callback`],
      scopes: ['openid', 'profile'],
      postLogoutUris: [`${B.website}/`, postLogout] },
    { clientId: 'console',  name: 'Vxture Console',  displayName: 'Vxture Console',  realm: 'customer',
      redirectUris: [`${B.console}/auth/callback`],
      scopes: ['openid', 'profile', 'console'] },
    { clientId: 'admin',    name: 'Vxture Admin',    displayName: 'Vxture Admin',    realm: 'workforce',
      redirectUris: [`${B.admin}/auth/callback`],
      scopes: ['openid', 'profile', 'admin'] },
    // ruyin: platform-level, cross-domain (mode B). No beta — single prod URI only.
    // Sends post_logout to ruyin home + unified accounts/logout.
    // ruyin: platform-level cross-domain (mode B). No beta — single prod URI only.
    // 'ruyin' kept for backward compat; remove once ruyin RP requests 'ruyin:subscription'.
    { clientId: 'ruyin',    name: 'Ruyin',    displayName: 'Ruyin',    realm: 'customer',
      redirectUris: [`${B.ruyin}/auth/callback`],
      scopes: ['openid', 'profile', 'email', 'phone', 'ruyin', 'ruyin:subscription'],
      postLogoutUris: [`${B.ruyin}/`, postLogout] },
    // New saas apps — prod + beta redirect_uris; subscription scope per app.
    { clientId: 'runos',    name: 'Runos',     displayName: 'Runos',     realm: 'customer',
      redirectUris: appUris(B.runos, betaB.runos),
      scopes: ['openid', 'profile', 'email', 'runos:subscription'] },
    { clientId: 'nocus',    name: 'Nocus',    displayName: 'Nocus',    realm: 'customer',
      redirectUris: appUris(B.nocus, betaB.nocus),
      scopes: ['openid', 'profile', 'email', 'nocus:subscription'] },
    { clientId: 'atlas',    name: 'Atlas',    displayName: 'Atlas',    realm: 'customer',
      redirectUris: appUris(B.atlas, betaB.atlas),
      scopes: ['openid', 'profile', 'email', 'atlas:subscription'] },
    { clientId: 'ontos',    name: 'Ontos',    displayName: 'Ontos',    realm: 'customer',
      redirectUris: appUris(B.ontos, betaB.ontos),
      scopes: ['openid', 'profile', 'email', 'ontos:subscription'] },
    { clientId: 'raven',    name: 'Raven',    displayName: 'Raven',    realm: 'customer',
      redirectUris: appUris(B.raven, betaB.raven),
      scopes: ['openid', 'profile', 'email', 'raven:subscription'] },
    { clientId: 'anlan',    name: 'Anlan',    displayName: 'Anlan',    realm: 'customer',
      redirectUris: appUris(B.anlan, betaB.anlan),
      scopes: ['openid', 'profile', 'email', 'anlan:subscription'] },
    { clientId: 'forge',    name: 'Forge',    displayName: 'Forge',    realm: 'customer',
      redirectUris: appUris(B.forge, betaB.forge),
      scopes: ['openid', 'profile', 'email', 'forge:subscription'] },
    { clientId: 'xuanzhen', name: 'Xuanzhen', displayName: 'Xuanzhen', realm: 'customer',
      redirectUris: appUris(B.xuanzhen, betaB.xuanzhen),
      scopes: ['openid', 'profile', 'email', 'xuanzhen:subscription'] },
    // arda prod — single redirect_uri so back_channel_logout_uri maps to the prod BFF only.
    // arda-beta is a separate entry below so it gets its own back_channel_logout_uri pointing
    // at the beta BFF. Sharing redirectUris in one client causes back-channel logout to only
    // notify the first URI's BFF, leaving the other BFF's RP sessions alive after logout.
    { clientId: 'arda',     name: 'Arda',     displayName: 'Arda',     realm: 'customer',
      redirectUris: [`${B.arda}/auth/callback`],
      scopes: ['openid', 'profile', 'email', 'arda:subscription'],
      postLogoutUris: [`${B.arda}/`, postLogout] },
    // arda-beta — only registered when ARDA_BETA_BASE_URL is set in the environment.
    ...(betaB.arda ? [{ clientId: 'arda-beta', name: 'Arda Beta', displayName: 'Arda (Beta)', realm: 'customer',
      redirectUris: [`${betaB.arda}/auth/callback`],
      scopes: ['openid', 'profile', 'email', 'arda:subscription'],
      postLogoutUris: [`${betaB.arda}/`, postLogout] }] : []),
  ];
  for (const c of oidcClients) {
    // Normalize hyphenated clientIds to underscore for env var lookup (e.g. arda-beta → ARDA_BETA).
    const envKey = c.clientId.toUpperCase().replace(/-/g, '_');
    const secretHash = process.env[`OIDC_CLIENT_SECRET_HASH_${envKey}`] || null;
    const postLogoutUris = c.postLogoutUris || [postLogout];
    await client.query(`
      insert into iam.oidc_client
        (client_id, name, display_name, logo_url, realm, client_secret_hash, redirect_uris,
         post_logout_redirect_uris, back_channel_logout_uri, allowed_scopes, is_enabled, created_at, updated_at)
      values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, true, now(), now())
      on conflict (client_id) do update set
        name = excluded.name,
        display_name = excluded.display_name,
        logo_url = excluded.logo_url,
        realm = excluded.realm,
        client_secret_hash = coalesce(excluded.client_secret_hash, iam.oidc_client.client_secret_hash),
        redirect_uris = excluded.redirect_uris,
        post_logout_redirect_uris = excluded.post_logout_redirect_uris,
        back_channel_logout_uri = excluded.back_channel_logout_uri,
        allowed_scopes = excluded.allowed_scopes,
        updated_at = now()
    `, [c.clientId, c.name, c.displayName, c.realm, secretHash,
        c.redirectUris, postLogoutUris,
        `${c.redirectUris[0].replace('/auth/callback', '')}/auth/backchannel-logout`,
        c.scopes]);
    console.log(`✓  iam.oidc_client — ${c.clientId} (realm=${c.realm}, secret=${secretHash ? 'set' : 'unset'})`);
  }

  // ── 6. iam.signing_key (RS256 JWKS public key; private key stays in secret mgr) ─
  // Only seed a key when a REAL public JWK is injected (SIGNING_KEY_PUBLIC_JWK).
  // Otherwise generate one with `node provision-signing-key.mjs` (which also emits
  // the private key for the auth-bff env). No fake placeholder — it would pollute
  // /oidc/jwks with an unusable key.
  const signJwkRaw = process.env.SIGNING_KEY_PUBLIC_JWK || null;
  if (signJwkRaw) {
    const signJwk = JSON.parse(signJwkRaw);
    const signKid = process.env.SIGNING_KEY_KID || signJwk.kid;
    await client.query(`
      insert into iam.signing_key (kid, algorithm, public_jwk, status, activated_at, created_at)
      values ($1, 'RS256', $2, 'active', now(), now())
      on conflict (kid) do nothing
    `, [signKid, JSON.stringify(signJwk)]);
    console.log(`✓  iam.signing_key — ${signKid} (status=active, from env)`);
  } else {
    console.log('•  iam.signing_key — skipped (run provision-signing-key.mjs to generate a real RS256 key)');
  }

  // ── 7. product (§7): placeholder rebuild for the new unified model ──────────
  // Business catalog (real product_code / branding / tiers / pricing) is TBD
  // (runbook §18.2#5); this seeds a minimal valid graph for the empty domain.
  await client.query(`
    insert into product.product_category (id, parent_id, code, name, sort) values
      (1, null, 'agent', '智能体', 10),
      (2, null, 'platform', '平台', 20)
    on conflict (id) do nothing
  `);
  const PRODUCTS = [
    { code: 'ruyin', type: 'agent',         cat: 1, zh: '如影', zhNick: '如影',     en: 'Ruyin', enNick: 'Ruyin' },
    { code: 'runos', type: 'capability_platform', cat: 2, zh: '鲁诺斯', zhNick: '鲁诺斯', en: 'Runos',  enNick: 'Runos' },
    { code: 'data',  type: 'data_platform', cat: 2, zh: '数据', zhNick: '数据平台', en: 'Data',  enNick: 'Data Platform' },
  ];
  for (const p of PRODUCTS) {
    await client.query(`
      insert into product.product (id, product_code, product_type, category_id, status, created_by, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, 'active', $4, now(), now())
      on conflict (product_code) do nothing
    `, [p.code, p.type, p.cat, SYS]);
  }
  const prodRes = await client.query(`select id, product_code from product.product`);
  const prodMap = Object.fromEntries(prodRes.rows.map((r) => [r.product_code, r.id]));
  for (const p of PRODUCTS) {
    const pid = prodMap[p.code];
    if (!pid) continue;
    await client.query(`
      insert into product.product_i18n (product_id, locale, product_name, product_nick) values
        ($1, 'zh-CN', $2, $3), ($1, 'en-US', $4, $5)
      on conflict (product_id, locale) do nothing
    `, [pid, p.zh, p.zhNick, p.en, p.enNick]);
  }
  console.log(`✓  product — ${PRODUCTS.length} products + i18n (placeholder)`);

  // launch checklist catalog (§7.8)
  await client.query(`
    insert into product.launch_checklist_item (item_code, item_name, is_required, sort) values
      ('verification_policy', '认证策略已配置', true, 10),
      ('i18n_complete', '多语言文案已覆盖所有 locale', true, 20)
    on conflict (item_code) do nothing
  `);

  // one representative free plan → draft version → bundled_free component → publish.
  // Order matters (§7.6 trg_plan_component_guard_lock): plan_component can only be
  // written while the version is DRAFT; publishing freezes it. So build the
  // component first, publish last. Idempotent: only build+publish a NEWLY created
  // version (RETURNING id is empty on the conflict re-seed path).
  await client.query(`
    insert into product.plan (id, plan_code, plan_name, billing_cycle, is_public, status, created_by, created_at, updated_at)
    values (gen_random_uuid(), 'ruyin-free', 'Ruyin Free', 'monthly', true, 'active', $1, now(), now())
    on conflict (plan_code) do nothing
  `, [SYS]);
  const planRes = await client.query(`select id from product.plan where plan_code = 'ruyin-free' limit 1`);
  const planId = planRes.rows[0]?.id;
  const ruyinId = prodMap['ruyin'];
  if (planId && ruyinId) {
    const pvIns = await client.query(`
      insert into product.plan_version (id, plan_id, version_no, price, currency, status, created_by, created_at)
      values (gen_random_uuid(), $1, 1, 0, 'CNY', 'draft', $2, now())
      on conflict (plan_id, version_no) do nothing
      returning id
    `, [planId, SYS]);
    if (pvIns.rows.length > 0) {
      const pvId = pvIns.rows[0].id;
      await client.query(`
        insert into product.plan_component
          (id, plan_version_id, product_id, tier, billing_kind, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, 'standard', 'bundled_free', 100, '{}', '{}'::jsonb, 0, now())
      `, [pvId, ruyinId]);
      await client.query(
        `update product.plan_version set status = 'published', published_at = now() where id = $1`, [pvId]);
      await client.query(
        `update product.plan set current_version_id = $2 where id = $1 and current_version_id is null`,
        [planId, pvId]);
    }
  }
  console.log('✓  product — checklist + ruyin-free plan/version/component (placeholder)');

  // ── 8. model — provider + model + price_rule (ported; per-tenant grant OUT) ──
  // NOTE: model_grant was keyed by tenant_id; tenant retired. Re-keying grants to
  // org/workspace is a model-domain follow-up (OUT of identity MVP); omitted here.
  await client.query(`
    insert into model.model_provider (id, provider_code, provider_type, provider_name, description, is_active, created_by, created_at, updated_at)
    values
      ($1, 'doubao',    'online', 'Volcano Doubao', 'ByteDance Volcano model service', true, $4, now(), now()),
      ($2, 'anthropic', 'online', 'Anthropic',      'Claude model family',             true, $4, now(), now()),
      ($3, 'openai',    'online', 'OpenAI',         'GPT model family',                true, $4, now(), now())
    on conflict (provider_code) do nothing
  `, [ID.providerDoubao, ID.providerAnthropic, ID.providerOpenai, SYS]);
  const provRes = await client.query(`select id, provider_code from model.model_provider`);
  const provMap = Object.fromEntries(provRes.rows.map((r) => [r.provider_code, r.id]));
  await client.query(`
    insert into model.model
      (id, provider_id, model_code, model_type, protocol, model_name, endpoint_url, context_window, max_output_tokens, capabilities, is_active, sort, created_by, created_at, updated_at)
    values
      ($1, $4, 'doubao-pro-32k', 'chat', 'openai', 'Doubao Pro 32k',
       'https://ark.cn-beijing.volces.com/api/v3', 32768, 4096, ARRAY['chat','tools'], true, 1, $7, now(), now()),
      ($2, $5, 'claude-sonnet-4', 'chat', 'anthropic', 'Claude Sonnet 4',
       'https://api.anthropic.com', 200000, 8192, ARRAY['chat','tools','vision'], true, 2, $7, now(), now()),
      ($3, $6, 'gpt-4o', 'chat', 'openai', 'GPT-4o',
       'https://api.openai.com/v1', 128000, 16384, ARRAY['chat','tools','vision'], true, 3, $7, now(), now())
    on conflict (model_code) do nothing
  `, [ID.modelDoubaoPro, ID.modelClaudeSonnet, ID.modelGpt4o,
      provMap['doubao'] ?? null, provMap['anthropic'] ?? null, provMap['openai'] ?? null, SYS]);
  const modelRes = await client.query(`select id, model_code from model.model`);
  const modelMap = Object.fromEntries(modelRes.rows.map((r) => [r.model_code, r.id]));
  for (const code of ['doubao-pro-32k', 'claude-sonnet-4', 'gpt-4o']) {
    const modelId = modelMap[code];
    if (!modelId) continue;
    await client.query(`
      insert into model.model_price_rule (id, model_id, billing_mode, currency, unit_tokens, input_unit_price, output_unit_price, is_active, effective_at, created_by, created_at, updated_at)
      select gen_random_uuid(), $1, 'token', 'CNY', 1000000, 0, 0, true, now(), $2, now(), now()
      where not exists (select 1 from model.model_price_rule where model_id = $1)
    `, [modelId, SYS]);
  }
  console.log('✓  model — 3 providers + 3 active models + price rules');

  // ── 9. identity.oauth_provider — inbound federation broker config (ported) ──
  const ssoProviders = [
    { id: ID.oauthFeishu, code: 'feishu', name: 'Feishu', sort: 1,
      scope: 'contact:user.base:readonly contact:user.email:readonly contact:user.phone:readonly contact:user.id:readonly',
      authUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      tokenUrl: 'https://accounts.feishu.cn/oauth/v3/token',
      accountInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
      clientId: process.env.FEISHU_APP_ID || null,
      clientSecret: process.env.FEISHU_APP_SECRET || null,
      redirectUri: process.env.FEISHU_REDIRECT_URI || null },
    { id: ID.oauthDingtalk, code: 'dingtalk', name: 'DingTalk', sort: 2,
      scope: 'openid',
      authUrl: 'https://login.dingtalk.com/oauth2/auth',
      tokenUrl: 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
      accountInfoUrl: 'https://api.dingtalk.com/v1.0/contact/users/me',
      clientId: process.env.DINGTALK_APP_KEY || null,
      clientSecret: process.env.DINGTALK_APP_SECRET || null,
      redirectUri: process.env.DINGTALK_REDIRECT_URI || null },
    { id: ID.oauthGoogle, code: 'google', name: 'Google', sort: 3,
      scope: 'openid email profile',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      accountInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientId: process.env.GOOGLE_CLIENT_ID || null,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || null },
  ];
  for (const p of ssoProviders) {
    // Compliance: Google federation is disabled platform-wide, regardless of whether
    // GOOGLE_CLIENT_ID/SECRET are present. feishu/dingtalk keep cred-derived enablement.
    const enabled =
      p.code === "google" ? false : Boolean(p.clientId && p.clientSecret);
    await client.query(`
      insert into identity.oauth_provider
        (id, code, name, scope, auth_url, token_url, account_info_url,
         client_id, client_secret, redirect_uri, is_enabled, sort, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
      on conflict (code) do update set
        name = excluded.name, scope = excluded.scope,
        auth_url = excluded.auth_url, token_url = excluded.token_url,
        account_info_url = excluded.account_info_url,
        client_id = coalesce(excluded.client_id, identity.oauth_provider.client_id),
        client_secret = coalesce(excluded.client_secret, identity.oauth_provider.client_secret),
        redirect_uri = coalesce(excluded.redirect_uri, identity.oauth_provider.redirect_uri),
        is_enabled = excluded.is_enabled, updated_at = now()
    `, [p.id, p.code, p.name, p.scope, p.authUrl, p.tokenUrl, p.accountInfoUrl,
        p.clientId, p.clientSecret, p.redirectUri, enabled, p.sort]);
    console.log(`✓  identity.oauth_provider — ${p.code} (is_enabled=${enabled})`);
  }
}

if (isMain(import.meta.url)) {
  runSeed('catalog', seedCatalog);
}
