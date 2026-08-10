/**
 * seed-catalog.mjs — ① SYSTEM CATALOG seed (idempotent, raw `pg`).
 *
 * Target-state 18-schema DDL (deploy/database/ddl/). Seeds platform-level catalog data
 * (NOT sample tenants):
 *   admin    — operator realm: operator_role(7 preset +rank) + operator_permission(3-seg catalog)
 *              + operator_role_permission (super_admin full-grant, self-checked) + operator_account
 *              (systemadmin/superadmin built-ins) + operator_credential + settings (MFA policy)
 *   access   — customer governance RBAC: roles(10 = 5 ×2 scope tenant/workspace) + permissions(9)
 *              + role_permissions mapping (owner/manager only; member/readonly/guest empty)
 *   loyalty  — level_policies + level_thresholds (5 levels, placeholder growth config)
 *   kyc      — verification_policies baseline (platform, per tenant_type)
 *   appoidc  — oidc_clients (platform RPs) + signing_keys (env-injected, dev placeholder skipped)
 *   product  — product_categories + products + launch_checklist_items + plans/versions/prices/components
 *   model    — model_providers + models + model_price_rules (active models for readiness)
 *   identity — oauth_providers inbound federation broker config (feishu/dingtalk/google)
 *
 * Run directly:  DATABASE_URL=... node seed-catalog.mjs
 */

import { runSeed, isMain, ID, SYS } from "./seed-lib.mjs";

// ── Governance permission catalog (access.permissions) ────────────────────────
// [code, category, description]. category ∈ billing/member/security/settings (open label).
// NOTE (org→tenant rename): the retired 'org' scope became 'tenant' (access.roles CHECK is
// tenant/workspace), so the old `org.*` permission codes were renamed to `tenant.*` to stay
// consistent with the scope. Role↔permission is now by uuid (role_id/permission_id).
const PERMISSIONS = [
  ["tenant.member.manage", "member", "Manage tenant members"],
  ["tenant.role.assign", "security", "Assign tenant roles"],
  ["tenant.workspace.manage", "settings", "Manage workspaces in the tenant"],
  ["tenant.billing.manage", "billing", "Manage tenant billing & subscriptions"],
  ["tenant.settings.manage", "settings", "Manage tenant settings"],
  ["tenant.delete", "security", "Delete the tenant"],
  ["workspace.member.manage", "member", "Manage workspace members"],
  ["workspace.role.assign", "security", "Assign workspace roles"],
  ["workspace.settings.manage", "settings", "Manage workspace settings"],
];

// ── Role catalog: two-level, scope tenant/workspace (access.roles) ─────────────
// [scope, code, name]. All is_system=true (predefined, is_system-guarded, not deletable).
// 5 built-in roles per scope (design data_identity_200 §6.4): owner/manager/member/readonly/guest.
// readonly = internal view-all-no-write; guest = external/limited (design-complete; usage is business-side).
const ROLES = [
  // [scope, code, name, description] — i18n keys derived: access.role.{scope}.{code} (+.desc)
  [
    "tenant",
    "owner",
    "Tenant Owner",
    "Full control of the tenant, including all workspaces and governance settings.",
  ],
  [
    "tenant",
    "manager",
    "Tenant Manager",
    "Manages tenant members, roles, workspaces and settings.",
  ],
  [
    "tenant",
    "member",
    "Tenant Member",
    "Regular tenant member; business access only, no governance permissions.",
  ],
  [
    "tenant",
    "readonly",
    "Tenant Viewer",
    "Read-only visibility across the tenant; no write operations.",
  ],
  [
    "tenant",
    "guest",
    "Tenant Guest",
    "External or limited collaborator with restricted tenant access.",
  ],
  [
    "workspace",
    "owner",
    "Workspace Owner",
    "Full control of the workspace and its governance settings.",
  ],
  [
    "workspace",
    "manager",
    "Workspace Manager",
    "Manages workspace members and settings.",
  ],
  [
    "workspace",
    "member",
    "Workspace Member",
    "Regular workspace member; business access only.",
  ],
  [
    "workspace",
    "readonly",
    "Workspace Viewer",
    "Read-only visibility within the workspace.",
  ],
  [
    "workspace",
    "guest",
    "Workspace Guest",
    "External or limited collaborator within the workspace.",
  ],
];

// ── Role → permission mapping. ────────────────────────────────────────────────
// Governance RBAC only gates governance actions ("治理 RBAC ≠ 业务授权", data_identity_200 §6).
// member/readonly/guest get NO governance perms by design — they differ at the business-auth
// layer (OUT) + by role identity, not here. Only owner/manager carry governance perms.
const TENANT_ALL = PERMISSIONS.filter((p) => p[0].startsWith("tenant.")).map(
  (p) => p[0],
);
const WS_ALL = PERMISSIONS.filter((p) => p[0].startsWith("workspace.")).map(
  (p) => p[0],
);
const ROLE_PERMS = {
  "tenant:owner": [...TENANT_ALL, ...WS_ALL],
  "tenant:manager": [
    "tenant.member.manage",
    "tenant.role.assign",
    "tenant.workspace.manage",
    "tenant.settings.manage",
  ],
  "tenant:member": [],
  "tenant:readonly": [],
  "tenant:guest": [],
  "workspace:owner": [...WS_ALL],
  "workspace:manager": ["workspace.member.manage", "workspace.settings.manage"],
  "workspace:member": [],
  "workspace:readonly": [],
  "workspace:guest": [],
};

// ══ Operator realm RBAC (admin.operator_*) — design data_admin_200 §4 ══════════
// perm_code = three-segment {domain}:{resource}.{action}; .manage ⊇ .read (both granted
// when a role has manage). 危 = high-risk (step-up enforced app-side). perm_type='api'.
// [perm_code, perm_name].
const OPERATOR_PERMISSIONS = [
  ["tenant:profile.read", "View tenant profiles"],
  ["tenant:profile.manage", "Manage tenant profiles"],
  ["tenant:verification.review", "Review tenant verification"],
  ["tenant:quota.read", "View tenant quota"],
  ["tenant:quota.manage", "Adjust tenant quota"],
  ["tenant:lifecycle.suspend", "Suspend/close tenant (high-risk)"],
  ["tenant:risk.read", "View tenant risk records"],
  ["tenant:risk.manage", "Manage tenant risk records"],
  ["user:profile.read", "View users (masked)"],
  ["user:pii.read", "View plaintext PII (high-risk)"],
  [
    "user:account.manage",
    "Manage customer account (disable/enable/force-logout)",
  ],
  ["commerce:subscription.read", "View subscriptions"],
  ["commerce:subscription.manage", "Manage subscriptions"],
  ["commerce:order.read", "View orders"],
  [
    "commerce:order.void",
    "Void unpaid order",
    "Void / reject an unpaid offline order (high-risk)",
  ],
  [
    "commerce:order.restore",
    "Restore voided order",
    "Restore a voided/expired offline order back to pending (high-risk)",
  ],
  ["commerce:billing.read", "View bills"],
  ["commerce:billing.manage", "Manage bills"],
  ["commerce:billing.discount", "Discount / write off a bill (high-risk)"],
  ["commerce:invoice.read", "View invoices"],
  ["commerce:invoice.manage", "Manage invoices"],
  ["commerce:invoice.void", "Void an issued invoice (high-risk)"],
  ["commerce:payment.read", "View payments"],
  ["commerce:payment.manage", "Manage payments"],
  ["commerce:payment.settle", "Settle / confirm a payment (high-risk)"],
  ["commerce:refund.execute", "Execute refund (high-risk)"],
  ["promotion:campaign.read", "View voucher batches / redemptions"],
  ["promotion:campaign.manage", "Create voucher batches / assign vouchers (high-risk)"],
  ["product:plan.read", "View plans"],
  ["product:plan.manage", "Manage plans"],
  ["product:price.read", "View pricing"],
  ["product:price.manage", "Manage pricing"],
  ["model:provider.read", "View model providers"],
  ["model:provider.manage", "Manage model providers"],
  ["model:model.read", "View models"],
  ["model:model.manage", "Manage models"],
  ["release:feature_flag.read", "View feature flags"],
  ["release:feature_flag.manage", "Manage feature flags"],
  ["release:maintenance.read", "View maintenance windows"],
  ["release:maintenance.manage", "Manage maintenance windows"],
  ["platform:setting.read", "View platform settings (sensitive masked)"],
  ["platform:setting.manage", "Manage platform settings (system config)"],
  ["content:announcement.read", "View announcements"],
  ["content:announcement.manage", "Manage announcements"],
  ["notification:log.read", "View notification delivery logs"],
  ["support:ticket.read", "View tickets"],
  ["support:ticket.manage", "Manage tickets"],
  ["support:impersonate", "Impersonate customer (high-risk)"],
  ["compliance:event.read", "View compliance events"],
  ["compliance:event.manage", "Manage compliance events"],
  ["security:signing_key.manage", "Manage signing keys (high-risk)"],
  ["security:oidc_client.manage", "Manage OIDC clients (high-risk)"],
  ["operator:account.manage", "Manage operator accounts (high-risk)"],
  ["operator:role.manage", "Manage operator roles (high-risk)"],
  ["audit:read", "View audit logs"],
];

// Operator roles: [role_code, rank, name_en, i18n_key, description, sort, mfa_min_level].
// rank = tier for cross-operator gating (strictly-greater to manage); manage capability is
// carried by operator:account.manage (super_admin only), independent of rank. sys_config = meta
// role (rank 0, non-login). Values per data_admin_200 §4.1.
const OPERATOR_ROLES = [
  // sys_config rank=999 (2026-07-05 owner): highest tier so no rank-gate can ever manage
  // the meta anchor; the role itself carries ZERO permissions, so the high rank confers
  // no capability (re-derived from the old "rank=0 cosmetic" stance).
  [
    "sys_config",
    999,
    "System Config",
    "ops.role.sys_config",
    "Platform self-governance config meta-role, used as createdBy for system-init data.",
    0,
    "optional",
  ],
  [
    "super_admin",
    100,
    "Super Admin",
    "ops.role.super_admin",
    "Platform built-in super admin with all permissions.",
    1,
    "required",
  ],
  [
    "admin",
    80,
    "Admin",
    "ops.role.admin",
    "Platform admin: all business domains, excludes operator management and security keys.",
    2,
    "required",
  ],
  [
    "operation",
    60,
    "Operation",
    "ops.role.operation",
    "Tenant / plan / content / growth operations.",
    3,
    "required",
  ],
  [
    "finance",
    60,
    "Finance",
    "ops.role.finance",
    "Subscriptions / orders / refunds / invoices / revenue reports.",
    4,
    "required",
  ],
  [
    "tech_ops",
    50,
    "SRE",
    "ops.role.tech_ops",
    "Model supply / release / maintenance windows / system settings.",
    5,
    "required",
  ],
  [
    "support",
    30,
    "Support",
    "ops.role.support",
    "Tickets / masked tenant lookup / notifications.",
    6,
    "optional",
  ],
  [
    "auditor",
    10,
    "Auditor",
    "ops.role.auditor",
    "Read-only across all domains + audit logs, zero write.",
    7,
    "required",
  ],
];

// Operator role → perm_code mapping (design data_admin_200 §4.3). super_admin computed = ALL.
const OP_ALL = OPERATOR_PERMISSIONS.map((p) => p[0]);
const OPERATOR_ROLE_PERMS = {
  sys_config: [],
  super_admin: [...OP_ALL], // §4.4 explicit full grant (no code bypass)
  admin: [
    "tenant:profile.read",
    "tenant:profile.manage",
    "tenant:verification.review",
    "tenant:quota.read",
    "tenant:quota.manage",
    "tenant:lifecycle.suspend",
    "tenant:risk.read",
    "tenant:risk.manage",
    "compliance:event.read",
    "compliance:event.manage",
    "user:profile.read",
    "user:pii.read",
    "user:account.manage",
    "commerce:subscription.read",
    "commerce:subscription.manage",
    "commerce:order.read",
    "commerce:order.void",
    "commerce:order.restore",
    "commerce:billing.read",
    "commerce:billing.manage",
    "commerce:billing.discount",
    "commerce:invoice.read",
    "commerce:invoice.manage",
    "commerce:invoice.void",
    "commerce:payment.read",
    "commerce:payment.manage",
    "commerce:payment.settle",
    "commerce:refund.execute",
    "promotion:campaign.read",
    "promotion:campaign.manage",
    "product:plan.read",
    "product:plan.manage",
    "product:price.read",
    "product:price.manage",
    "model:provider.read",
    "model:provider.manage",
    "model:model.read",
    "model:model.manage",
    "release:feature_flag.read",
    "release:feature_flag.manage",
    "release:maintenance.read",
    "release:maintenance.manage",
    "platform:setting.read",
    "content:announcement.read",
    "content:announcement.manage",
    "notification:log.read",
    "support:ticket.read",
    "support:ticket.manage",
    "support:impersonate",
    "audit:read",
  ],
  operation: [
    "tenant:profile.read",
    "tenant:profile.manage",
    "tenant:verification.review",
    "tenant:quota.read",
    "tenant:quota.manage",
    "tenant:risk.read",
    "tenant:risk.manage",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "promotion:campaign.read",
    "product:plan.read",
    "product:plan.manage",
    "product:price.read",
    "product:price.manage",
    "model:provider.read",
    "model:model.read",
    "release:feature_flag.read",
    "release:maintenance.read",
    "content:announcement.read",
    "content:announcement.manage",
    "support:ticket.read",
  ],
  finance: [
    "tenant:profile.read",
    "tenant:quota.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:subscription.manage",
    "commerce:order.read",
    "commerce:order.void",
    "commerce:order.restore",
    "commerce:billing.read",
    "commerce:billing.manage",
    "commerce:billing.discount",
    "commerce:invoice.read",
    "commerce:invoice.manage",
    "commerce:invoice.void",
    "commerce:payment.read",
    "commerce:payment.manage",
    "commerce:payment.settle",
    "commerce:refund.execute",
    "promotion:campaign.read",
    "promotion:campaign.manage",
    "product:plan.read",
    "product:price.read",
  ],
  tech_ops: [
    "tenant:profile.read",
    "tenant:quota.read",
    "model:provider.read",
    "model:provider.manage",
    "model:model.read",
    "model:model.manage",
    "release:feature_flag.read",
    "release:feature_flag.manage",
    "release:maintenance.read",
    "release:maintenance.manage",
    "platform:setting.read",
    "platform:setting.manage",
    "content:announcement.read",
    "notification:log.read",
  ],
  support: [
    "tenant:profile.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "support:ticket.read",
    "support:ticket.manage",
    "notification:log.read",
  ],
  auditor: [
    "tenant:profile.read",
    "tenant:quota.read",
    "tenant:risk.read",
    "compliance:event.read",
    "user:profile.read",
    "commerce:subscription.read",
    "commerce:order.read",
    "commerce:billing.read",
    "commerce:invoice.read",
    "commerce:payment.read",
    "product:plan.read",
    "product:price.read",
    "model:provider.read",
    "model:model.read",
    "release:feature_flag.read",
    "release:maintenance.read",
    "platform:setting.read",
    "content:announcement.read",
    "notification:log.read",
    "support:ticket.read",
    "audit:read",
  ],
};

export async function seedCatalog(client) {
  // ── 0. Live column-width patch (2026-07-30) ───────────────────────────────
  //   DDL baseline (80_admin.sql / 18_access.sql) now declares perm_name
  //   varchar(128); this repo's clean-baseline apply.sh only CREATEs on
  //   --reset (destructive, not viable against a live prod DB with real data),
  //   so a safe metadata-only ALTER COLUMN TYPE rides along in the seed path
  //   instead (idempotent, no-op once already widened). After this runs once
  //   against a given DB, also run `action=restamp-ddl-baseline` in db-init.yml
  //   (deploy/scripts/28c-restamp-ddl-baseline.sh) so 30-verify's [B0] DDL
  //   fingerprint check reflects reality instead of staying permanently red.
  await client.query(
    `alter table admin.operator_permission alter column perm_name type varchar(128)`,
  );
  await client.query(
    `alter table access.permissions alter column perm_name type varchar(128)`,
  );

  // ── 1. operator realm: operator_role + operator_account + operator_credential ─
  //   Two built-in accounts:
  //   • systemadmin — account_type=system_builtin, status=disabled, NO credential:
  //     a meta anchor / created_by for system-init rows; never logs in.
  //   • superadmin  — account_type=system, status=active: the ONLY username+password
  //     login at bootstrap. Password defaults to Admin@2026 (force_password_change=true)
  //     in NON-production only — the default is public in this repo, so the 23/29
  //     seed runners fail closed unless OPERATOR_SUPERADMIN_PASSWORD_HASH is set
  //     (2026-07-21 gate).
  //   The seed container has no hashing libs, so the default is a precomputed Argon2id PHC.
  const DEFAULT_SUPERADMIN_HASH =
    "$argon2id$v=19$m=65536,t=3,p=1$Z2riL/tYwCUFpQK5jq/uVQ$l6hiSqwHPlc8IgK5DDBT9qPAveujOQak9lHVHUI+icE"; // Admin@2026
  const envHash = (
    process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH || ""
  ).startsWith("$argon2")
    ? process.env.OPERATOR_SUPERADMIN_PASSWORD_HASH
    : null;
  const superadminHash = envHash ?? DEFAULT_SUPERADMIN_HASH;
  const forcePwChange = !envHash; // default password → must change after first login

  // 7 preset roles + rank (design data_admin_200 §4.1). Anchor rows sys_config/super_admin
  // keep pinned sentinel UUIDs (referenced by accounts); the rest use gen_random_uuid + role_code
  // natural key. High-privilege roles → MFA floor required (enforced once P2 lands).
  const OP_ROLE_PINNED = {
    sys_config: ID.roleSystem,
    super_admin: ID.roleSuperAdmin,
  };
  for (const [
    code,
    rank,
    roleName,
    nameKey,
    desc,
    sort,
    mfa,
  ] of OPERATOR_ROLES) {
    await client.query(
      `
      insert into admin.operator_role
        (id, role_code, status, role_name, role_name_key, description, description_key, is_system, sort, rank, mfa_min_level, is_workforce_visible)
      values (coalesce($1::uuid, gen_random_uuid()), $2, 'active', $3, $4, $5, $6, true, $7, $8, $9, $10)
      on conflict (role_code) do update set rank = excluded.rank, is_workforce_visible = excluded.is_workforce_visible
    `,
      [
        OP_ROLE_PINNED[code] ?? null,
        code,
        roleName,
        nameKey,
        desc,
        `${nameKey}.desc`,
        sort,
        rank,
        mfa,
        code !== "sys_config",
      ],
    );
  }

  const roleRes = await client.query(
    `select id, role_code from admin.operator_role`,
  );
  const opsRoleMap = Object.fromEntries(
    roleRes.rows.map((r) => [r.role_code, r.id]),
  );

  // systemadmin: meta anchor — disabled + no credential ⇒ cannot log in.
  // superadmin: active, created_by systemadmin; contact seeded for recovery/notifications.
  // superadmin contact is seed-trusted → email_verified/phone_verified = true so
  // out-of-band reset can target it from bootstrap (TD-017 §③).
  await client.query(
    `
    insert into admin.operator_account
      (id, role_id, username, display_name, status, account_type, email, email_verified, phone, phone_verified, created_by, remark, sort, is_workforce_visible, created_at, updated_at)
    values
      ($1, $3, 'systemadmin', 'systemadmin', 'disabled', 'system_builtin', null, false, null, false, null,
       'Platform meta account / created_by for system-init data. Disabled, no credential — never logs in.', 0, false, now(), now()),
      ($2, $4, 'superadmin',  'Super Admin', 'active',   'system',         $5::varchar,   $5 is not null,  $6::varchar,   $6 is not null,  $1,
       'Built-in super admin. Bootstrap username+password login; all platform permissions.', 1, true, now(), now())
    on conflict (username) do update set
      email = coalesce(excluded.email, admin.operator_account.email),
      phone = coalesce(excluded.phone, admin.operator_account.phone),
      is_workforce_visible = excluded.is_workforce_visible,
      updated_at = now()
  `,
    [
      ID.adminSystem,
      ID.adminSuperAdmin,
      opsRoleMap["sys_config"] ?? ID.roleSystem,
      opsRoleMap["super_admin"] ?? ID.roleSuperAdmin,
      // Contact env-projected by 23/29 (owner PII no longer hardcoded in the
      // repo, 2026-07-21). null → fresh seed leaves them unset and a re-seed
      // keeps the existing DB values via the coalesce in on-conflict.
      process.env.OPERATOR_SUPERADMIN_EMAIL || null,
      process.env.OPERATOR_SUPERADMIN_PHONE || null,
    ],
  );

  // Credential (Argon2id; 1-1). Only superadmin gets one (systemadmin never auths).
  // do-nothing on conflict so an idempotent re-seed never resets a changed password.
  await client.query(
    `
    insert into admin.operator_credential (operator_id, password_hash, force_password_change, created_at, updated_at)
    values ($1, $2, $3, now(), now())
    on conflict (operator_id) do nothing
  `,
    [ID.adminSuperAdmin, superadminHash, forcePwChange],
  );
  console.log(
    `✓  admin — 7 operator_role (+rank) + operator_account (systemadmin/superadmin) + credential (password=${envHash ? "env override" : "default Admin@2026"})`,
  );

  // ── operator_permission catalog (three-segment perm_code; perm_type=api) ─────
  // gen_random_uuid + perm_code natural key (no pinned UUIDs; mapping resolves by code).
  // created_by/updated_by = SYS (systemadmin meta; bare value, no FK).
  // Third tuple element is an optional longer description (up to varchar(255));
  // omitted → description mirrors the short display name, same as before.
  for (const [code, name, description] of OPERATOR_PERMISSIONS) {
    await client.query(
      `
      insert into admin.operator_permission
        (perm_code, perm_type, perm_name, perm_name_key, is_system, description, description_key, created_by, updated_by, created_at, updated_at)
      values ($1, 'api', $2, $3, true, $6, $4, $5, $5, now(), now())
      on conflict (perm_code) do nothing
    `,
      [
        code,
        name,
        `ops.perm.${code.replace(/:/g, ".")}`,
        `ops.perm.${code.replace(/:/g, ".")}.desc`,
        SYS,
        description ?? name,
      ],
    );
  }

  // ── operator_role_permission mapping (resolve role/perm ids by natural key) ──
  const opPermRes = await client.query(
    `select id, perm_code from admin.operator_permission`,
  );
  const opPermMap = Object.fromEntries(
    opPermRes.rows.map((r) => [r.perm_code, r.id]),
  );
  for (const [roleCode, roleId] of Object.entries(opsRoleMap)) {
    for (const code of OPERATOR_ROLE_PERMS[roleCode] ?? []) {
      const pid = opPermMap[code];
      if (!pid) continue;
      await client.query(
        `
        insert into admin.operator_role_permission (role_id, permission_id, is_system, created_by, created_at)
        values ($1, $2, true, $3, now()) on conflict (role_id, permission_id) do nothing
      `,
        [roleId, pid, SYS],
      );
    }
  }

  // ── super_admin explicit full-grant self-check (design data_admin_200 §4.4) ──
  // No hardcoded bypass in auth: super_admin must map to EVERY operator_permission or it
  // self-locks (capabilities=[] → 403). Fail the seed loudly if the invariant is violated.
  const saRoleId = opsRoleMap["super_admin"];
  const saGrantCnt = (
    await client.query(
      `select count(*)::int c from admin.operator_role_permission where role_id = $1`,
      [saRoleId],
    )
  ).rows[0].c;
  const permTotal = (
    await client.query(`select count(*)::int c from admin.operator_permission`)
  ).rows[0].c;
  if (saGrantCnt !== permTotal) {
    throw new Error(
      `super_admin full-grant invariant violated (data_admin_200 §4.4): mapped ${saGrantCnt}/${permTotal} permissions`,
    );
  }
  console.log(
    `✓  admin — ${OPERATOR_PERMISSIONS.length} operator_permission + role_permission mapping (super_admin full-grant ${saGrantCnt}/${permTotal})`,
  );

  // Platform default operator MFA policy (resolver floor). effective =
  // max(this, operator_role.mfa_min_level, operator_mfa.policy).
  await client.query(
    `
    insert into admin.settings (config_group, config_key, value_type, config_value, description, description_key, created_by, created_at, updated_at)
    values ('operator_security', 'operator.mfa.policy', 'string', 'optional',
            'Platform default operator MFA policy: disabled|optional|required.',
            'ops.setting.operator.mfa.policy.desc', $1, now(), now())
    on conflict (config_key) do nothing
  `,
    [SYS],
  );
  console.log("✓  admin — settings operator.mfa.policy=optional");

  // ── 2. access.permissions (governance catalog; unified fields, console-mode) ─
  // perm_name = human label; render fields (perm_type/route/component/icon) left null,
  // wired when tenant console menu is built (铁律四). is_system=true, created_by=SYS.
  for (const [code, category, description] of PERMISSIONS) {
    await client.query(
      `
      insert into access.permissions (perm_code, perm_name, perm_name_key, category, description, description_key, is_system, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $2, $5, true, $6, now(), now()) on conflict (perm_code) do nothing
    `,
      [
        code,
        description,
        `access.perm.${code}`,
        category,
        `access.perm.${code}.desc`,
        SYS,
      ],
    );
  }

  // ── 3. access.roles (two-level; scope tenant/workspace; is_system) ──────────
  for (const [scope, code, name, description] of ROLES) {
    const nameKey = `access.role.${scope}.${code}`;
    await client.query(
      `
      insert into access.roles
        (scope, role_code, role_name, role_name_key, description, description_key, is_system, created_by, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, true, $7, now(), now()) on conflict (scope, role_code) do nothing
    `,
      [scope, code, name, nameKey, description, `${nameKey}.desc`, SYS],
    );
  }

  // ── 4. access.role_permissions (mapping by uuid role_id/permission_id) ──────
  const permRes = await client.query(
    `select id, perm_code from access.permissions`,
  );
  const permMap = Object.fromEntries(
    permRes.rows.map((r) => [r.perm_code, r.id]),
  );
  const roleRows = await client.query(
    `select id, scope, role_code from access.roles`,
  );
  for (const r of roleRows.rows) {
    const codes = ROLE_PERMS[`${r.scope}:${r.role_code}`] ?? [];
    for (const code of codes) {
      const permId = permMap[code];
      if (!permId) continue;
      await client.query(
        `
        insert into access.role_permissions (role_id, permission_id, is_system, created_by)
        values ($1, $2, true, $3) on conflict (role_id, permission_id) do nothing
      `,
        [r.id, permId, SYS],
      );
    }
  }
  console.log(
    `✓  access — ${PERMISSIONS.length} permissions + ${ROLES.length} roles (owner/manager/member/readonly/guest ×2 scope) + role_permissions mapping`,
  );

  // ── 5. loyalty growth config: level_policies + level_thresholds (placeholder) ─
  // max_owned_org_tenant / min_points are placeholders pending business input;
  // thresholds must stay distinct (UNIQUE min_points) and monotonic.
  // level_name = platform-defined display catalog (placeholder set pending growth design);
  // i18n keys derived loyalty.level.{n} (+.desc).
  await client.query(`
    insert into loyalty.level_policies
      (level_no, max_owned_org_tenant, level_name, level_name_key, description, description_key) values
      (1, 1, 'Starter',  'loyalty.level.1', 'L1', 'loyalty.level.1.desc'),
      (2, 1, 'Bronze',   'loyalty.level.2', 'L2', 'loyalty.level.2.desc'),
      (3, 1, 'Silver',   'loyalty.level.3', 'L3', 'loyalty.level.3.desc'),
      (4, 1, 'Gold',     'loyalty.level.4', 'L4', 'loyalty.level.4.desc'),
      (5, 1, 'Platinum', 'loyalty.level.5', 'L5', 'loyalty.level.5.desc')
    on conflict (level_no) do nothing
  `);
  await client.query(`
    insert into loyalty.level_thresholds (level_no, min_points) values
      (1, 0), (2, 1), (3, 2), (4, 3), (5, 4)
    on conflict (level_no) do nothing
  `);
  console.log(
    "✓  loyalty — level_policies + level_thresholds (5 levels, placeholder)",
  );

  // ── 6. kyc.verification_policies baseline (platform rows, product_id NULL) ───
  // NOT EXISTS guard keeps this idempotent (also covered by the platform-baseline partial unique).
  for (const [ttype, rtype] of [
    ["personal", "individual"],
    ["organization", "enterprise"],
  ]) {
    await client.query(
      `
      insert into kyc.verification_policies (product_id, tenant_type, require_verification, required_type)
      select null, $1::varchar, true, $2::varchar
       where not exists (
         select 1 from kyc.verification_policies where product_id is null and tenant_type = $1::varchar)
    `,
      [ttype, rtype],
    );
  }
  console.log(
    "✓  kyc — verification_policies baseline (personal/organization)",
  );

  // ── 7. appoidc.oidc_clients (platform RPs; secret hash injected via env) ─────
  // Beta URL only registered when {APP}_BETA_BASE_URL env is set.
  function appUris(prod, betaEnv) {
    const uris = [`${prod}/auth/callback`];
    if (betaEnv) uris.push(`${betaEnv}/auth/callback`);
    return uris;
  }

  const B = {
    website: process.env.WEBSITE_BASE_URL || "http://localhost:3000",
    console: process.env.CONSOLE_BASE_URL || "http://localhost:3001",
    admin: process.env.ADMIN_BASE_URL || "http://localhost:3002",
    // Capability Console (OSS-side operator shell, product_250 M-4). The prod
    // hostname is repo-external by policy (hardening: placeholder-only) and
    // arrives via OPERA_BASE_URL runtime env.
    opera: process.env.OPERA_BASE_URL || "http://localhost:3050",
    // ruyin = NEW client-side product surface (ruyin.vxture.com); the legacy
    // cross-domain RP at ruyin.ai is `umbra` (product_300 §2, U line).
    ruyin: process.env.RUYIN_BASE_URL || "http://localhost:3080",
    umbra: process.env.UMBRA_BASE_URL || "http://localhost:3082",
    runos: process.env.RUNOS_BASE_URL || "http://localhost:3081",
    atlas: process.env.ATLAS_BASE_URL || "http://localhost:3083",
    ontos: process.env.ONTOS_BASE_URL || "http://localhost:3084",
    raven: process.env.RAVEN_BASE_URL || "http://localhost:3085",
    anlan: process.env.ANLAN_BASE_URL || "http://localhost:3086",
    forge: process.env.FORGE_BASE_URL || "http://localhost:3087",
    xuanzhen: process.env.XUANZHEN_BASE_URL || "http://localhost:3088",
    arda: process.env.ARDA_BASE_URL || "http://localhost:3089",
    karda: process.env.KARDA_BASE_URL || "http://localhost:3090",
  };
  const betaB = {
    ruyin: process.env.RUYIN_BETA_BASE_URL || null,
    runos: process.env.RUNOS_BETA_BASE_URL || null,
    atlas: process.env.ATLAS_BETA_BASE_URL || null,
    ontos: process.env.ONTOS_BETA_BASE_URL || null,
    raven: process.env.RAVEN_BETA_BASE_URL || null,
    anlan: process.env.ANLAN_BETA_BASE_URL || null,
    forge: process.env.FORGE_BETA_BASE_URL || null,
    xuanzhen: process.env.XUANZHEN_BETA_BASE_URL || null,
    arda: process.env.ARDA_BETA_BASE_URL || null,
    // deferred — no beta host assigned yet (TD-001 in vxture-karda)
    karda: process.env.KARDA_BETA_BASE_URL || null,
  };

  const accountsBase = process.env.ACCOUNTS_BASE_URL || "http://localhost:3040";
  const postLogout = `${accountsBase}/logout`;

  // U-line fail-fast (product_300 §2.4): RUYIN_BASE_URL changed meaning — it now
  // names the NEW ruyin surface (ruyin.vxture.com); ruyin.ai belongs to
  // UMBRA_BASE_URL. A stale ruyin.ai value here would register the new ruyin
  // client with umbra's callback — abort instead of seeding a misbinding.
  if (B.ruyin.includes("ruyin.ai")) {
    throw new Error(
      "RUYIN_BASE_URL points at ruyin.ai — that domain is umbra's (UMBRA_BASE_URL). " +
        "Migrate .env.auth-bff per product_300 §2.3 #4 before seeding.",
    );
  }

  const oidcClients = [
    {
      clientId: "website",
      name: "Vxture Website",
      displayName: "Vxture Website",
      realm: "customer",
      redirectUris: [`${B.website}/auth/callback`],
      scopes: ["openid", "profile"],
      postLogoutUris: [`${B.website}/`, postLogout],
    },
    {
      clientId: "console",
      name: "Vxture Console",
      displayName: "Vxture Console",
      realm: "customer",
      redirectUris: [`${B.console}/auth/callback`],
      scopes: ["openid", "profile", "console"],
    },
    {
      clientId: "admin",
      name: "Vxture Admin",
      displayName: "Vxture Admin",
      realm: "workforce",
      redirectUris: [`${B.admin}/auth/callback`],
      scopes: ["openid", "profile", "admin"],
    },
    // Capability Console shell — second workforce RP (product_250 M-4). Same
    // operator claims surface as admin; its BFF additionally runs the
    // operator-OBO exchange (M-1) for mounted provider modules.
    {
      clientId: "opera",
      name: "Vxture Capability Console",
      displayName: "Vxture Capability Console",
      realm: "workforce",
      redirectUris: [`${B.opera}/auth/callback`],
      scopes: ["openid", "profile", "admin"],
    },
    // umbra — the cross-domain RP at ruyin.ai (ex-`ruyin`; renamed in place by the
    // U-line migration below, product_300 §2). No beta — single prod URI only.
    {
      clientId: "umbra",
      name: "umbra",
      displayName: "umbra",
      realm: "customer",
      redirectUris: [`${B.umbra}/auth/callback`],
      scopes: [
        "openid",
        "profile",
        "email",
        "phone",
        "umbra",
        "umbra:subscription",
      ],
      postLogoutUris: [`${B.umbra}/`, postLogout],
    },
    // ruyin — NEW client-side product surface on ruyin.vxture.com (mode A,
    // same-site). No subscription scope: client products stay out of the
    // entitlement engine (product_100 §5).
    {
      clientId: "ruyin",
      name: "Ruyin",
      displayName: "Ruyin",
      realm: "customer",
      redirectUris: appUris(B.ruyin, betaB.ruyin),
      scopes: ["openid", "profile", "email"],
    },
    {
      clientId: "runos",
      name: "Runos",
      displayName: "Runos",
      realm: "customer",
      redirectUris: appUris(B.runos, betaB.runos),
      scopes: ["openid", "profile", "email", "runos:subscription"],
    },
    {
      clientId: "atlas",
      name: "Atlas",
      displayName: "Atlas",
      realm: "customer",
      redirectUris: appUris(B.atlas, betaB.atlas),
      // D12: product commercial scope retired, no {product}:subscription carried in
      // product tokens; aligned to karda's actual 4-scope registration (product_240 §6#20).
      scopes: ["openid", "profile", "email", "phone"],
    },
    {
      clientId: "ontos",
      name: "Ontos",
      displayName: "Ontos",
      realm: "customer",
      redirectUris: appUris(B.ontos, betaB.ontos),
      scopes: ["openid", "profile", "email", "ontos:subscription"],
    },
    {
      clientId: "raven",
      name: "Raven",
      displayName: "Raven",
      realm: "customer",
      redirectUris: appUris(B.raven, betaB.raven),
      scopes: ["openid", "profile", "email", "raven:subscription"],
    },
    {
      clientId: "anlan",
      name: "Anlan",
      displayName: "Anlan",
      realm: "customer",
      redirectUris: appUris(B.anlan, betaB.anlan),
      scopes: ["openid", "profile", "email", "anlan:subscription"],
    },
    {
      clientId: "forge",
      name: "Forge",
      displayName: "Forge",
      realm: "customer",
      redirectUris: appUris(B.forge, betaB.forge),
      scopes: ["openid", "profile", "email", "forge:subscription"],
    },
    {
      clientId: "xuanzhen",
      name: "Xuanzhen",
      displayName: "Xuanzhen",
      realm: "customer",
      redirectUris: appUris(B.xuanzhen, betaB.xuanzhen),
      scopes: ["openid", "profile", "email", "xuanzhen:subscription"],
    },
    {
      clientId: "arda",
      name: "Arda",
      displayName: "Arda",
      realm: "customer",
      redirectUris: [`${B.arda}/auth/callback`],
      // D12 (arda reply-06 §3): the `arda:subscription` scope is retired —
      // tokens carry zero commercial fields; entitlements are C2-only.
      scopes: ["openid", "profile", "email", "phone"],
      postLogoutUris: [`${B.arda}/`, postLogout],
    },
    // arda-beta — only registered when ARDA_BETA_BASE_URL is set; release_channel=beta.
    ...(betaB.arda
      ? [
          {
            clientId: "arda-beta",
            name: "Arda Beta",
            displayName: "Arda (Beta)",
            realm: "customer",
            releaseChannel: "beta",
            redirectUris: [`${betaB.arda}/auth/callback`],
            // D12: `arda:subscription` retired (see the stable client above).
            scopes: ["openid", "profile", "email", "phone"],
            postLogoutUris: [`${betaB.arda}/`, postLogout],
          },
        ]
      : []),
    // karda — registration request A段 (docs/80-liaison/20-2607222338-karda-
    // platform-registration-a.md §3.2). No `karda:subscription` scope — D12
    // products are C2-only.
    {
      clientId: "karda",
      name: "Karda",
      displayName: "Karda",
      realm: "customer",
      redirectUris: [`${B.karda}/auth/callback`],
      scopes: ["openid", "profile", "email", "phone"],
      postLogoutUris: [`${B.karda}/`, postLogout],
    },
    // karda-beta — deferred (TD-001); only registers once KARDA_BETA_BASE_URL is set.
    ...(betaB.karda
      ? [
          {
            clientId: "karda-beta",
            name: "Karda Beta",
            displayName: "Karda (Beta)",
            realm: "customer",
            releaseChannel: "beta",
            redirectUris: [`${betaB.karda}/auth/callback`],
            scopes: ["openid", "profile", "email", "phone"],
            postLogoutUris: [`${betaB.karda}/`, postLogout],
          },
        ]
      : []),
  ];
  // U-line (product_300 §2): migrate the legacy cross-domain RP row ruyin → umbra
  // BEFORE the upsert loop, so the fresh `ruyin` entry above can never inherit the
  // legacy row (nor its secret hash). The legacy row is identified by its ruyin.ai
  // redirect; both statements no-op once migrated (and on a fresh database).
  // oidc_consents.client_id FK has no ON UPDATE CASCADE — drop legacy consents
  // first (users re-consent under umbra), then rename the parent in place so the
  // secret hash rides along with the row.
  await client.query(`
    delete from appoidc.oidc_consents oc
     using appoidc.oidc_clients c
     where oc.client_id = 'ruyin' and c.client_id = 'ruyin'
       and exists (select 1 from unnest(c.redirect_uris) u where u like 'https://ruyin.ai/%')
  `);
  await client.query(`
    update appoidc.oidc_clients
       set client_id = 'umbra', updated_at = now()
     where client_id = 'ruyin'
       and exists (select 1 from unnest(redirect_uris) u where u like 'https://ruyin.ai/%')
       and not exists (select 1 from appoidc.oidc_clients c2 where c2.client_id = 'umbra')
  `);
  console.log(
    "✓  appoidc.oidc_clients — U-line legacy ruyin → umbra (guarded; no-op when done)",
  );

  // runa → runos (platform#205, ADR-004). Same guarded shape as the umbra rename above,
  // and it must run BEFORE the loop below: the loop's `on conflict (client_id) do update` keys
  // on the NEW id, so on a live database it would insert a second client and leave `runa`
  // standing — the split catalog the issue explicitly asked us to avoid. Renaming in place also
  // keeps client_secret_hash attached to the row, which a delete-and-recreate would not: that
  // answers the "does a client-id rename preserve the secret" question with yes, this way.
  await client.query(`
    update appoidc.oidc_clients
       set client_id = 'runos', updated_at = now()
     where client_id = 'runa'
       and not exists (select 1 from appoidc.oidc_clients c2 where c2.client_id = 'runos')
  `);
  console.log(
    "✓  appoidc.oidc_clients — runa → runos (guarded; secret preserved; no-op when done)",
  );

  for (const c of oidcClients) {
    const envKey = c.clientId.toUpperCase().replace(/-/g, "_");
    const secretHash = process.env[`OIDC_CLIENT_SECRET_HASH_${envKey}`] || null;
    const postLogoutUris = c.postLogoutUris || [postLogout];
    const releaseChannel = c.releaseChannel || "stable";
    const backChannelUri = `${c.redirectUris[0].replace("/auth/callback", "")}/auth/backchannel-logout`;
    await client.query(
      `
      insert into appoidc.oidc_clients
        (client_id, name, display_name, logo_url, realm, release_channel, client_secret_hash,
         redirect_uris, post_logout_redirect_uris, back_channel_logout_uri, allowed_scopes, status,
         created_at, updated_at)
      values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, 'active', now(), now())
      on conflict (client_id) do update set
        name = excluded.name,
        display_name = excluded.display_name,
        logo_url = excluded.logo_url,
        realm = excluded.realm,
        release_channel = excluded.release_channel,
        client_secret_hash = coalesce(excluded.client_secret_hash, appoidc.oidc_clients.client_secret_hash),
        redirect_uris = excluded.redirect_uris,
        post_logout_redirect_uris = excluded.post_logout_redirect_uris,
        back_channel_logout_uri = excluded.back_channel_logout_uri,
        allowed_scopes = excluded.allowed_scopes,
        updated_at = now()
    `,
      [
        c.clientId,
        c.name,
        c.displayName,
        c.realm,
        releaseChannel,
        secretHash,
        c.redirectUris,
        postLogoutUris,
        backChannelUri,
        c.scopes,
      ],
    );
    console.log(
      `✓  appoidc.oidc_clients — ${c.clientId} (realm=${c.realm}, secret=${secretHash ? "set" : "unset"})`,
    );
  }

  // M2 (product_300 §1): retire the legacy `nocus` client — the name has no slot
  // in the final product matrix (product_100 §6#2); Karda registers a fresh
  // client on its own onboarding instead of reusing this row.
  await client.query(`
    update appoidc.oidc_clients set status = 'disabled', updated_at = now()
     where client_id = 'nocus' and status <> 'disabled'
  `);
  console.log(
    "✓  appoidc.oidc_clients — nocus retired (status=disabled if present)",
  );

  // ── 8. appoidc.signing_keys (RS256 JWKS public key; private key stays in secret mgr) ─
  // Only seed a key when a REAL public JWK is injected (SIGNING_KEY_PUBLIC_JWK).
  // Otherwise generate one with provision-signing-key.mjs. No fake placeholder — it
  // would pollute /oidc/jwks with an unusable key.
  const signJwkRaw = process.env.SIGNING_KEY_PUBLIC_JWK || null;
  if (signJwkRaw) {
    const signJwk = JSON.parse(signJwkRaw);
    const signKid = process.env.SIGNING_KEY_KID || signJwk.kid;
    await client.query(
      `
      insert into appoidc.signing_keys (kid, algorithm, public_jwk, status, activated_at, created_at)
      values ($1, 'RS256', $2, 'active', now(), now())
      on conflict (kid) do nothing
    `,
      [signKid, JSON.stringify(signJwk)],
    );
    console.log(
      `✓  appoidc.signing_keys — ${signKid} (status=active, from env)`,
    );
  } else {
    console.log(
      "•  appoidc.signing_keys — skipped (run provision-signing-key.mjs to generate a real RS256 key)",
    );
  }

  // ── 9. product: minimal valid catalog graph (placeholder) ───────────────────
  // New unified model: product_name(主)+product_nick(副) as two columns (no product_i18n table).
  await client.query(`
    insert into product.product_categories (id, parent_id, code, name, name_key, sort) values
      (1, null, 'agent', '智能体', 'product.category.agent', 10),
      (2, null, 'platform', '平台', 'product.category.platform', 20)
    on conflict (id) do nothing
  `);
  // M1 (product_300 §1): rename the placeholder product code data -> arda in
  // place (row UUID is the stable anchor, code is mutable; final name per
  // product_100 v1.0). Guarded so it no-ops once arda exists.
  await client.query(`
    update product.products
       set product_code = 'arda', product_nick = 'Arda',
           description_key = 'product.product.arda.desc', updated_at = now()
     where product_code = 'data'
       and not exists (select 1 from product.products where product_code = 'arda')
  `);
  // U-line (product_300 §2): rename the legacy product ruyin -> umbra in place
  // (UUID anchor kept, M1 pattern). The `product_type = 'agent'` guard pins the
  // legacy row — the NEW client-side ruyin inserted below is type=client, so a
  // re-run can never rename it.
  await client.query(`
    update product.products
       set product_code = 'umbra', product_type = 'external', category_id = null,
           product_name = 'umbra', product_nick = 'umbra',
           description = 'Boundary VPN product (ruyin.ai).',
           description_key = 'product.product.umbra.desc', updated_at = now()
     where product_code = 'ruyin' and product_type = 'agent'
       and not exists (select 1 from product.products where product_code = 'umbra')
  `);

  const PRODUCTS = [
    // desc = placeholder external copy; i18n key derived product.product.{code}.desc
    {
      code: "ruyin",
      type: "client",
      cat: 1,
      name: "如影",
      nick: "Ruyin",
      desc: "Client-side (desktop) product.",
    },
    {
      code: "umbra",
      type: "external",
      cat: null,
      name: "umbra",
      nick: "umbra",
      desc: "Boundary VPN product (ruyin.ai).",
    },
    {
      code: "runos",
      type: "agent",
      cat: 1,
      name: "Runos",
      nick: "Runos",
      desc: "Multimodal assistant agent.",
    },
    {
      code: "arda",
      type: "data_platform",
      cat: 2,
      name: "数据平台",
      nick: "Arda",
      desc: "Enterprise data platform.",
    },
    {
      code: "karda",
      type: "knowledge_platform",
      cat: 2,
      name: "知识平台",
      nick: "Karda",
      desc: "Enterprise knowledge platform.",
    },
    {
      // Atlas repo-split prep (see docs/30-design/platform/40-model-platform.md §13):
      // v1 DRAFT/unlocked/unpublished, same two-phase pattern as karda's A段 registration —
      // catalog row + OIDC client land now, plan tiers stay empty until Atlas's own repo
      // and product definition are ready. C2 resolves atlas as "unsubscribed" until published.
      code: "atlas",
      type: "model_platform",
      cat: 1,
      name: "模型平台",
      nick: "Atlas",
      desc: "Unified model access, routing, quota and metering platform.",
    },
  ];
  // runa → runos (platform#205). Must precede the loop: its `on conflict (product_code) do
  // nothing` keys on the NEW code, so on a live database it inserts a second product row and
  // leaves `runos` behind — two catalog entries for one product, which is exactly what the issue
  // asked us not to create. Renaming in place keeps the row's uuid, so plans, oidc_clients,
  // product_webhooks and product_metrics all keep pointing at it (they reference product_id,
  // never the code). Guarded and idempotent: a no-op once done, and a no-op if both exist.
  await client.query(`
    update product.products
       set product_code = 'runos',
           product_name = 'Runos', product_nick = 'Runos',
           description_key = 'product.product.runos.desc', updated_at = now()
     where product_code = 'runa'
       and not exists (select 1 from product.products p2 where p2.product_code = 'runos')
  `);
  console.log(
    "✓  product.products — runa → runos (guarded; uuid + downstream refs preserved)",
  );
  for (const p of PRODUCTS) {
    await client.query(
      `
      insert into product.products
        (id, product_code, product_type, category_id, product_name, product_nick, description, description_key, status, created_by, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'active', $8, now(), now())
      on conflict (product_code) do nothing
    `,
      [
        p.code,
        p.type,
        p.cat,
        p.name,
        p.nick,
        p.desc,
        `product.product.${p.code}.desc`,
        SYS,
      ],
    );
  }
  const prodRes = await client.query(
    `select id, product_code from product.products`,
  );
  const prodMap = Object.fromEntries(
    prodRes.rows.map((r) => [r.product_code, r.id]),
  );
  console.log(
    `✓  product — ${PRODUCTS.length} products + categories (placeholder)`,
  );

  // appoidc.oidc_clients.product_id backfill (T1, product_210 §2/§3): links each
  // product-owned OIDC client back to its product row so token-exchange derives
  // act.sub/aud from the DB (not a runtime client_id string-normalization hack).
  // Runs after oidc_clients + product.products are both seeded. Matches by
  // client_id minus a -beta/-canary release-channel suffix (arda-beta -> arda);
  // platform-level clients (website/console/admin/umbra/ruyin) have no product
  // row to match and stay product_id=NULL, per the DDL's own "NULL=平台级" contract.
  for (const [code, id] of Object.entries(prodMap)) {
    await client.query(
      `update appoidc.oidc_clients set product_id = $1, updated_at = now()
        where product_id is distinct from $1
          and (client_id = $2 or client_id = $2 || '-beta' or client_id = $2 || '-canary')`,
      [id, code],
    );
  }
  console.log("✓  appoidc.oidc_clients — product_id backfill (T1)");

  // product_webhooks — platform→product provisioning push config (product_310
  // P2.3). webhook_url follows the business-app contract path (rp-integration
  // §4: POST /provisioning/webhook); webhook_secret_ref is an env-var name on
  // the dispatcher host (admin-bff), resolved by the default secret resolver.
  // ARDA_WEBHOOK_BASE_URL (product_230 §3.1 / D11): tailnet delivery target,
  // decoupled from ARDA_BASE_URL because the latter also seeds the OIDC
  // redirect_uris (must stay public). Unset → falls back to the public base.
  const ardaWebhookBase = process.env.ARDA_WEBHOOK_BASE_URL || B.arda;
  await client.query(
    `
    insert into product.product_webhooks (product_id, home_url, webhook_url, webhook_secret_ref, created_at, updated_at)
    select id, $1, $2, $3, now(), now() from product.products where product_code = 'arda'
    on conflict (product_id) do update set
      home_url = excluded.home_url,
      webhook_url = excluded.webhook_url,
      webhook_secret_ref = excluded.webhook_secret_ref,
      updated_at = now()
  `,
    [
      B.arda,
      `${ardaWebhookBase}/provisioning/webhook`,
      "ARDA_PROVISION_WEBHOOK_SECRET",
    ],
  );
  console.log("✓  product — product_webhooks (arda provisioning endpoint)");

  // karda — registration request B段 (docs/80-liaison/40-2607230909-karda-
  // platform-registration-b.md §3.2): tailnet delivery target explicitly given
  // (http://vx-worker-02:3240, migrated from :3233 on 2026-07-24 port-plan
  // revision), not derived from B.karda (which stays public
  // for the OIDC redirect_uris). Only seeded once karda's product row exists.
  if (prodMap["karda"]) {
    const kardaWebhookBase =
      process.env.KARDA_WEBHOOK_BASE_URL || B.karda;
    await client.query(
      `
      insert into product.product_webhooks (product_id, home_url, webhook_url, webhook_secret_ref, created_at, updated_at)
      select id, $1, $2, $3, now(), now() from product.products where product_code = 'karda'
      on conflict (product_id) do update set
        home_url = excluded.home_url,
        webhook_url = excluded.webhook_url,
        webhook_secret_ref = excluded.webhook_secret_ref,
        updated_at = now()
    `,
      [
        B.karda,
        `${kardaWebhookBase}/provisioning/webhook`,
        "KARDA_PROVISION_WEBHOOK_SECRET",
      ],
    );
    console.log("✓  product — product_webhooks (karda provisioning endpoint)");

    // karda — metering registry keys (docs/80-liaison/120-2607261820-karda-
    // platform-registration-c.md §2): registered in product_metrics ahead of
    // plan quota_pools wiring — the key existing here is what unblocks
    // POST /usage/consume from rejecting karda's reports, independent of
    // whether the karda-* plans are published yet. karda.ingest is the only
    // one actually producing usage today; search/ask are declared ahead of
    // their own activation (recall / A4 wiring on karda's side).
    const KARDA_METRICS = [
      // [metric_key, merge_strategy, consume_mode, unit, reset_period]
      ["karda.ingest", "pool", "divisible", "docs", "month"],
      ["karda.search", "pool", "divisible", "calls", "month"],
      ["karda.ask", "pool", "divisible", "calls", "month"],
    ];
    for (const [key, strategy, mode, unit, reset] of KARDA_METRICS) {
      await client.query(
        `
        insert into product.product_metrics
          (id, product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period, created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        on conflict (product_id, metric_key) do update set
          merge_strategy = excluded.merge_strategy,
          consume_mode   = excluded.consume_mode,
          metric_unit    = excluded.metric_unit,
          reset_period   = excluded.reset_period
      `,
        [prodMap["karda"], key, strategy, mode, unit, reset],
      );
    }
    console.log(
      "✓  product — product_metrics (karda.ingest / karda.search / karda.ask)",
    );
  }

  // launch checklist catalog
  await client.query(`
    insert into product.launch_checklist_items
      (item_code, item_name, item_name_key, description, description_key, is_required, sort) values
      ('verification_policy', '认证策略已配置', 'product.checklist.verification_policy',
       'A verification policy is configured for the product.', 'product.checklist.verification_policy.desc', true, 10),
      ('pricing_set', '定价已配置', 'product.checklist.pricing_set',
       'Pricing is configured for the product.', 'product.checklist.pricing_set.desc', true, 20)
    on conflict (item_code) do nothing
  `);

  // Ensure plan_versions.status exists before the catalog seed touches it. The
  // clean-baseline ddl/ apply is create-once (won't ALTER an existing table), and
  // prisma migrations are retired — so this idempotent additive column keeps the
  // `seed` action self-sufficient on a LIVE DB too (fresh builds get it from
  // ddl/40_product.sql; here it's a no-op). Backfill: the version a plan points
  // at (current_version_id) is its live/published one. (product_320)
  await client.query(
    `alter table product.plan_versions add column if not exists status varchar(32) not null default 'draft'`,
  );
  await client.query(`
    update product.plan_versions pv set status = 'published'
      from product.plans p
     where p.current_version_id = pv.id and pv.status <> 'published'
  `);
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'chk_plan_versions_status') then
        alter table product.plan_versions
          add constraint chk_plan_versions_status check (status in ('draft','published'));
      end if;
    end $$;
  `);

  // Live-DB increments for the two structural changes #186 (2026-08-07) declared in ddl/ but
  // that never reached a database built before it — exactly the create-once gap the
  // plan_versions.status block above exists for, missed on that PR. Confirmed absent on
  // worker-01 on 2026-08-10, which is why [B0] of the baseline audit had gone red: the audit
  // was right, and restamping the fingerprint would have buried a real finding.
  //
  // redemption_no is not merely latent — admin-bff's PROMOTION_REDEMPTIONS_SQL already selects
  // rd.redemption_no, so the redemption ledger errors on any live database missing the column.
  await client.query(
    `alter table promotion.voucher_redemptions add column if not exists redemption_no varchar(64)`,
  );
  // NOT NULL only once nothing violates it. Production has zero rows, so this promotes on the
  // first run; a database with legacy rows keeps the column nullable rather than failing the
  // whole seed, and promotes itself once those rows are given codes.
  await client.query(`
    do $$ begin
      if not exists (select 1 from promotion.voucher_redemptions where redemption_no is null) then
        alter table promotion.voucher_redemptions alter column redemption_no set not null;
      end if;
    end $$;
  `);
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'uq_voucher_redemptions_redemption_no') then
        alter table promotion.voucher_redemptions
          add constraint uq_voucher_redemptions_redemption_no unique (redemption_no);
      end if;
    end $$;
  `);
  // 'expiring' joined chk_subscriptions_status in ddl/50_metering.sql on the same PR. No code
  // writes it yet, so this is latent rather than broken — but a constraint that silently
  // rejects a value the DDL says is legal is the kind of drift that surfaces at the worst time.
  await client.query(`
    do $$ begin
      if exists (
        select 1 from pg_constraint
         where conname = 'chk_subscriptions_status'
           and pg_get_constraintdef(oid) not like '%expiring%'
      ) then
        alter table metering.subscriptions drop constraint chk_subscriptions_status;
        alter table metering.subscriptions add constraint chk_subscriptions_status
          check (status in ('active','expiring','trialing','overdue','suspended','expired','cancelled'));
      end if;
    end $$;
  `);

  // product_321 PR2 — live-DB self-sufficiency (ddl/ apply is create-once):
  // ① pay_source CHECK gains 'voucher' (the settlement leg, P7). Drop+add is
  //    safe: the constraint only widens, existing rows all satisfy it.
  await client.query(`
    do $$ begin
      alter table billing.payments drop constraint if exists chk_payments_pay_source;
      alter table billing.payments
        add constraint chk_payments_pay_source
        check (pay_source in ('online','offline','voucher'));
    end $$;
  `);
  // ② TD-020 service-role schema whitelists (97_service_roles is apply-once;
  //    live roles need the same widening — no-op when the roles don't exist
  //    yet). console-bff +promotion+provisioning, platform-api +billing
  //    +promotion, admin-bff +provisioning (320-era gap, product_321 §3).
  await client.query(`
    do $$
    declare
      spec record;
    begin
      for spec in
        select * from (values
          ('svc_console_bff',  array['promotion','provisioning']),
          ('svc_platform_api', array['billing','promotion']),
          ('svc_admin_bff',    array['provisioning'])
        ) as t(role_name, schemas)
      loop
        if exists (select from pg_roles where rolname = spec.role_name) then
          execute format('grant usage on schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('grant select, insert, update, delete on all tables in schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('grant usage, select on all sequences in schema %s to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('alter default privileges in schema %s grant select, insert, update, delete on tables to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
          execute format('alter default privileges in schema %s grant usage, select on sequences to %I',
            array_to_string(spec.schemas, ', '), spec.role_name);
        end if;
      end loop;
    end $$;
  `);
  console.log(
    "✓  product_321 — payments.pay_source +'voucher', svc role whitelists widened",
  );

  // one representative free plan → draft version → bundled_free component + month price.
  // Version stays unlocked (is_locked=false) — no subscription references it yet; the
  // plan_component / plan_price lock guard (§7 triggers) only bites once is_locked=true.
  // Idempotent: only build a NEWLY created version (RETURNING id empty on conflict re-seed).
  // Tier vocabulary migration (owner 2026-07-07): the commercial ladder is
  // free/starter/pro/business/enterprise; 'standard' is renamed -- existing
  // free-entry components become 'free' ('bundled' is reserved for backing
  // components inside future agent plans). Guarded + skips locked versions.
  await client.query(`
    update product.plan_components pc
       set tier = 'free'
      from product.plan_versions pv
     where pv.id = pc.plan_version_id and pv.is_locked = false
       and pc.tier = 'standard'
  `);

  // U-line (product_300 §2): rename plan ruyin-free -> umbra-free in place
  // (subscription references are id-based; guarded like the product rename).
  await client.query(`
    update product.plans
       set plan_code = 'umbra-free', plan_name = 'Umbra Free',
           plan_name_key = 'product.plan.umbra-free',
           description = 'Free tier for umbra.',
           description_key = 'product.plan.umbra-free.desc', updated_at = now()
     where plan_code = 'ruyin-free'
       and not exists (select 1 from product.plans where plan_code = 'umbra-free')
  `);
  await client.query(
    `
    insert into product.plans
      (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
    values (gen_random_uuid(), 'umbra-free', 'Umbra Free', 'product.plan.umbra-free',
            'Free tier for umbra.', 'product.plan.umbra-free.desc', true, 'active', $1, now(), now())
    on conflict (plan_code) do nothing
  `,
    [SYS],
  );
  const planRes = await client.query(
    `select id from product.plans where plan_code = 'umbra-free' limit 1`,
  );
  const planId = planRes.rows[0]?.id;
  const umbraId = prodMap["umbra"];
  if (planId && umbraId) {
    const pvIns = await client.query(
      `
      insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
      values (gen_random_uuid(), $1, 1, 'published', false, $2, now())
      on conflict (plan_id, version_no) do nothing
      returning id
    `,
      [planId, SYS],
    );
    if (pvIns.rows.length > 0) {
      const pvId = pvIns.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, 'free', 'primary', 100, '{}', '{}'::jsonb, 0, now())
      `,
        [pvId, umbraId],
      );
      await client.query(
        `
        insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
        values (gen_random_uuid(), $1, 'month', 1, 0, 'CNY', now())
        on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
      `,
        [pvId],
      );
      await client.query(
        `update product.plans set current_version_id = $2 where id = $1 and current_version_id is null`,
        [planId, pvId],
      );
    }
  }

  // ── L0 platform resource catalog (D7, product_220 §4.1) ──────────────────
  // Single definition point for cross-product shared metrics; product plan
  // components only CONTRIBUTE amounts (quota jsonb keys). reserved rows are
  // key-name placeholders (no pools until a metering entrant exists).
  const PLATFORM_METRICS = [
    // [metric_key, kind, consume_mode, unit, reset_period, status]
    ["storage.bytes", "gauge", null, "bytes", "none", "active"],
    ["ai.credit", "counter", "atomic", "credits", "month", "active"],
    ["compute.gpu", null, null, null, "none", "reserved"],
    ["compute.cpu", null, null, null, "none", "reserved"],
    ["egress.bytes", null, null, null, "none", "reserved"],
    ["ingress.bytes", null, null, null, "none", "reserved"],
  ];
  for (const [key, kind, mode, unit, reset, status] of PLATFORM_METRICS) {
    await client.query(
      `
      insert into product.platform_metrics (metric_key, kind, consume_mode, metric_unit, reset_period, status, created_at)
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (metric_key) do update set
        kind = excluded.kind, consume_mode = excluded.consume_mode,
        metric_unit = excluded.metric_unit, reset_period = excluded.reset_period,
        status = excluded.status
    `,
      [key, kind, mode, unit, reset, status],
    );
  }
  console.log(
    "✓  product — platform_metrics (L0 resource catalog: 2 active + 4 reserved)",
  );

  // ── arda catalog (arda-biz-260 §3 + reply-01 §6; product_310 P2.5 precondition) ──
  // Five commercial tiers + the beta public-test plan (definition.md §5.1).
  // product_metrics: 5 max-caps + 3 tiered caps (non-numeric, best-plan-wins)
  // + 4 pools (counters monthly per R5; storage.bytes = interim pool until the
  // D5 gauge lands -- arda does not report it, display-only).
  // v1 prices are 0 placeholders (superseded by the pricing-v2 block below,
  // product_320 §1.2; price never feeds C2/C3).
  // Versions are LOCKED once filled (C2 only resolves locked versions); content
  // changes after lock require a new version -- rerun is a no-op on locked v1.
  const ardaId2 = prodMap["arda"];
  if (ardaId2) {
    const ARDA_METRICS = [
      // [metric_key, merge_strategy, consume_mode, unit, reset_period]
      ["member.max", "max", null, "seats", "none"],
      ["dataset.max", "max", null, "count", "none"],
      ["datasource.max", "max", null, "count", "none"],
      ["service_endpoint.max", "max", null, "count", "none"],
      ["retention.days", "max", null, "days", "none"],
      ["varda.enabled", "tiered", null, "flag", "none"],
      ["varda.readonly", "tiered", null, "flag", "none"],
      ["sync.frequency", "tiered", null, "level", "none"],
      ["service.api.call", "pool", "divisible", "calls", "month"],
      ["quality.check.run", "pool", "divisible", "runs", "month"],
      // storage.bytes + ai.credit are L0 platform metrics (D7) — contributed
      // via plan quota keys below, never declared here (95 shadow guard).
    ];
    for (const [key, strategy, mode, unit, reset] of ARDA_METRICS) {
      await client.query(
        `
        insert into product.product_metrics
          (id, product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period, created_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
        on conflict (product_id, metric_key) do update set
          merge_strategy = excluded.merge_strategy,
          consume_mode   = excluded.consume_mode,
          metric_unit    = excluded.metric_unit,
          reset_period   = excluded.reset_period
      `,
        [ardaId2, key, strategy, mode, unit, reset],
      );
    }

    const GIB = 1024 * 1024 * 1024;
    // [plan_code, plan_name, tier, is_public, features, quota]
    const ARDA_PLANS = [
      [
        "arda-free",
        "Arda Free",
        "free",
        true,
        ["governance.quality"],
        {
          "member.max": 1,
          "dataset.max": 50,
          "datasource.max": 2,
          "service_endpoint.max": 0,
          "retention.days": 30,
          "varda.enabled": false,
          "varda.readonly": true,
          "sync.frequency": "manual",
          "storage.bytes": 1 * GIB,
          "service.api.call": 1000,
          "quality.check.run": 100,
          "ai.credit": 0,
        },
      ],
      [
        "arda-starter",
        "Arda Starter",
        "starter",
        true,
        ["governance.quality", "governance.standards", "governance.lineage"],
        {
          "member.max": 1,
          "dataset.max": 500,
          "datasource.max": 5,
          "service_endpoint.max": 1,
          "retention.days": 90,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "daily",
          "storage.bytes": 10 * GIB,
          "service.api.call": 20000,
          "quality.check.run": 1000,
          "ai.credit": 50,
        },
      ],
      [
        "arda-pro",
        "Arda Pro",
        "pro",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
        ],
        {
          "member.max": 1,
          "dataset.max": 5000,
          "datasource.max": 20,
          "service_endpoint.max": 10,
          "retention.days": 365,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "hourly",
          "storage.bytes": 100 * GIB,
          "service.api.call": 200000,
          "quality.check.run": 10000,
          "ai.credit": 500,
        },
      ],
      // business seats preset = 10 (member.max / varda.credit scale with purchased
      // seats at ops time; initial presets per biz-260 §3 "tune after real usage").
      [
        "arda-business",
        "Arda Business",
        "business",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
          "governance.mdm",
        ],
        {
          "member.max": 10,
          "dataset.max": -1,
          "datasource.max": 100,
          "service_endpoint.max": -1,
          "retention.days": -1,
          "varda.enabled": true,
          "varda.readonly": false,
          "sync.frequency": "realtime",
          "storage.bytes": 1024 * GIB,
          "service.api.call": 2000000,
          "quality.check.run": 100000,
          "ai.credit": 50000,
        },
      ],
      // enterprise = negotiated; caps use the -1 unlimited sentinel, pools are
      // generous presets (real values set per contract at ops time).
      [
        "arda-enterprise",
        "Arda Enterprise",
        "enterprise",
        true,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
          "governance.mdm",
          "governance.custom",
        ],
        {
          "member.max": -1,
          "dataset.max": -1,
          "datasource.max": -1,
          "service_endpoint.max": -1,
          "retention.days": -1,
          "varda.enabled": true,
          "varda.readonly": false,
          "sync.frequency": "realtime",
          "storage.bytes": 10240 * GIB,
          "service.api.call": 20000000,
          "quality.check.run": 1000000,
          "ai.credit": 500000,
        },
      ],
      // beta public-test plan (definition.md §5.1): pro-shaped capabilities with
      // tiny pools; not publicly purchasable (operator_grant trial carrier).
      [
        "arda-beta-trial",
        "Arda Beta Trial",
        "pro",
        false,
        [
          "governance.quality",
          "governance.standards",
          "governance.lineage",
          "governance.security",
          "governance.policies",
        ],
        {
          "member.max": 1,
          "dataset.max": 5000,
          "datasource.max": 20,
          "service_endpoint.max": 10,
          "retention.days": 365,
          "varda.enabled": true,
          "varda.readonly": true,
          "sync.frequency": "hourly",
          "storage.bytes": 1 * GIB,
          "service.api.call": 1000,
          "quality.check.run": 100,
          "ai.credit": 100,
        },
      ],
    ];
    for (const [code, name, tier, isPublic, features, quota] of ARDA_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Arda.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'published', false, $2, now())
        on conflict (plan_id, version_no) do nothing
      `,
        [pId, SYS],
      );
      const pvRow = await client.query(
        `select id, is_locked from product.plan_versions where plan_id = $1 and version_no = 1`,
        [pId],
      );
      const pv = pvRow.rows[0];
      if (!pv) continue;
      if (!pv.is_locked) {
        // unlocked v1: (re)write the component deterministically, then lock.
        await client.query(
          `delete from product.plan_components where plan_version_id = $1`,
          [pv.id],
        );
        await client.query(
          `
          insert into product.plan_components
            (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
          values (gen_random_uuid(), $1, $2, $3, 'primary', 100, $4, $5::jsonb, 0, now())
          on conflict (plan_version_id, product_id, tier) do update set
            component_role = excluded.component_role, priority = excluded.priority,
            features = excluded.features, quota = excluded.quota
        `,
          [pv.id, ardaId2, tier, features, JSON.stringify(quota)],
        );
        await client.query(
          `
          insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
          values (gen_random_uuid(), $1, 'month', 1, 0, 'CNY', now())
          on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
        `,
          [pv.id],
        );
        await client.query(
          `update product.plan_versions set is_locked = true where id = $1`,
          [pv.id],
        );
      }
      await client.query(
        `update product.plans set current_version_id = $2 where id = $1 and current_version_id is null`,
        [pId, pv.id],
      );
    }

    // ── arda pricing v2 (product_320) — PLACEHOLDER draft ───────────────────
    // Owner directive (2026-07-15): seed v2 as an UNPUBLISHED, UNLOCKED draft
    // with every quota param and every price = 1; the real prices/quotas are
    // set and the version is PUBLISHED from the admin backend. Per paid plan:
    // copy v1's component shape but force every quota value to 1, add month &
    // year price rows = 1, keep v2 UNLOCKED (locking would make §7 triggers
    // reject admin edits) and do NOT repoint current_version_id (admin
    // publishes). enterprise keeps NO price rows (contact-sales). Non-
    // clobbering: only a NEWLY inserted v2 is written, so a re-run never
    // overwrites values the admin has already edited/published.
    const ARDA_V2_PLANS = [
      "arda-starter",
      "arda-pro",
      "arda-business",
      "arda-enterprise",
    ];
    const ARDA_V2_PRICED = new Set([
      "arda-starter",
      "arda-pro",
      "arda-business",
    ]);
    for (const code of ARDA_V2_PLANS) {
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      const v1Row = await client.query(
        `select id from product.plan_versions where plan_id = $1 and version_no = 1`,
        [pId],
      );
      const v1Id = v1Row.rows[0]?.id;
      if (!v1Id) continue;
      const v2Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 2, false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      // only a freshly inserted draft — never clobber an existing v2 that the
      // admin may already have edited or published.
      if (v2Ins.rows.length === 0) continue;
      const v2Id = v2Ins.rows[0].id;
      // copy v1's component shape, but force every quota value to 1.
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        select gen_random_uuid(), $2, product_id, tier, component_role, priority, features,
               coalesce((select jsonb_object_agg(key, 1) from jsonb_each(quota)), '{}'::jsonb),
               sort_order, now()
        from product.plan_components
        where plan_version_id = $1
      `,
        [v1Id, v2Id],
      );
      // placeholder month & year price = 1 (self-serve plans only; enterprise
      // stays price-less = contact-sales).
      if (ARDA_V2_PRICED.has(code)) {
        for (const cycleUnit of ["month", "year"]) {
          await client.query(
            `
            insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
            values (gen_random_uuid(), $1, $2, 1, 1, 'CNY', now())
            on conflict (plan_version_id, cycle_unit, cycle_count, currency) do nothing
          `,
            [v2Id, cycleUnit],
          );
        }
      }
      // v2 stays UNLOCKED and current_version_id is NOT repointed — the admin
      // backend sets the real values and publishes the version.
    }
  }

  // ── karda catalog — SKELETON ONLY (registration request A段 §3.1,
  // docs/80-liaison/20-2607222338-karda-platform-registration-a.md) ──────────
  // karda's own product-definition doc (docs/20-specs/10-product-definition.md
  // in vxture-karda) is still in draft; there is no metrics/entitlement mapping
  // to seed yet. This only creates the 5 tier plan rows + a DRAFT, UNLOCKED,
  // UNPUBLISHED v1 (empty features/quota, no price) so the admin backend has
  // something to open and fill in once karda supplies the real mapping.
  // plans.current_version_id is intentionally left unset — C2 resolves nothing
  // for karda until a real version is published.
  const kardaId = prodMap["karda"];
  if (kardaId) {
    // [plan_code, plan_name, tier, is_public]
    const KARDA_PLANS = [
      ["karda-free", "Karda Free", "free", true],
      ["karda-starter", "Karda Starter", "starter", true],
      ["karda-pro", "Karda Pro", "pro", true],
      ["karda-business", "Karda Business", "business", true],
      ["karda-enterprise", "Karda Enterprise", "enterprise", true],
    ];
    for (const [code, name, tier, isPublic] of KARDA_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Karda.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      // draft v1: unlocked, unpublished, empty component — never overwritten
      // once inserted (admin owns everything past this point).
      const v1Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      if (v1Ins.rows.length === 0) continue;
      const v1Id = v1Ins.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, $3, 'primary', 100, ARRAY[]::text[], '{}'::jsonb, 0, now())
        on conflict (plan_version_id, product_id, tier) do nothing
      `,
        [v1Id, kardaId, tier],
      );
    }
    console.log(
      "✓  product — karda catalog skeleton (5 plans; v1 DRAFT/unlocked/unpublished, empty features+quota — admin fills in once karda's product definition lands)",
    );
  }

  // ── atlas catalog — SKELETON ONLY (Atlas repo-split prep, same A段 pattern as
  // karda above: docs/30-design/platform/40-model-platform.md §13 / product_240 §5) ──
  // Atlas's own product definition (plan tiers, quota semantics for the four
  // call types embedding/parse/rerank/generation) is not decided yet — this only
  // creates the 5 tier plan rows + a DRAFT, UNLOCKED, UNPUBLISHED v1 (empty
  // features/quota, no price) so the admin backend has something to open once
  // the Atlas repo lands its own product definition. plans.current_version_id
  // is intentionally left unset — C2 resolves nothing for atlas until a real
  // version is published.
  const atlasId = prodMap["atlas"];
  if (atlasId) {
    // [plan_code, plan_name, tier, is_public]
    const ATLAS_PLANS = [
      ["atlas-free", "Atlas Free", "free", true],
      ["atlas-starter", "Atlas Starter", "starter", true],
      ["atlas-pro", "Atlas Pro", "pro", true],
      ["atlas-business", "Atlas Business", "business", true],
      ["atlas-enterprise", "Atlas Enterprise", "enterprise", true],
    ];
    for (const [code, name, tier, isPublic] of ATLAS_PLANS) {
      await client.query(
        `
        insert into product.plans
          (id, plan_code, plan_name, plan_name_key, description, description_key, is_public, status, created_by, created_at, updated_at)
        values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, now(), now())
        on conflict (plan_code) do nothing
      `,
        [
          code,
          name,
          "product.plan." + code,
          name + " tier for Atlas.",
          "product.plan." + code + ".desc",
          isPublic,
          SYS,
        ],
      );
      const planRow = await client.query(
        `select id from product.plans where plan_code = $1 limit 1`,
        [code],
      );
      const pId = planRow.rows[0]?.id;
      if (!pId) continue;
      // draft v1: unlocked, unpublished, empty component — never overwritten
      // once inserted (admin owns everything past this point).
      const v1Ins = await client.query(
        `
        insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_by, created_at)
        values (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
        on conflict (plan_id, version_no) do nothing
        returning id
      `,
        [pId, SYS],
      );
      if (v1Ins.rows.length === 0) continue;
      const v1Id = v1Ins.rows[0].id;
      await client.query(
        `
        insert into product.plan_components
          (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
        values (gen_random_uuid(), $1, $2, $3, 'primary', 100, ARRAY[]::text[], '{}'::jsonb, 0, now())
        on conflict (plan_version_id, product_id, tier) do nothing
      `,
        [v1Id, atlasId, tier],
      );
    }
    console.log(
      "✓  product — atlas catalog skeleton (5 plans; v1 DRAFT/unlocked/unpublished, empty features+quota — admin fills in once Atlas repo-split lands a product definition)",
    );
  }

  console.log(
    "✓  product — checklist + umbra-free + arda catalog (6 plans; v1 current/locked, v2 seeded as UNPUBLISHED placeholder draft on starter/pro/business/enterprise — all quota params & prices = 1, admin sets real values + publishes; 10 product metrics + 2 L0 contributions)",
  );

  // ── 10. model — model_providers + models + model_price_rules (per-tenant grant OUT) ─
  // config.upstreamModel (2026-08-10, §1.1 of the same plan, answering liaison platform#152):
  // model_code is a dispatch key, never a promise about the wire value. Providers reject the
  // prefixed form — Volcano Ark wants `doubao-seed-2-0-lite-260428`, not `doubao/...` — so any
  // row whose model_code carries a provider prefix must also say what to actually send, and
  // adapters read config.upstreamModel in preference to model_code. The legacy unprefixed rows
  // keep config NULL on purpose: for them the fallback to model_code is already the right value,
  // and writing it twice would just be a second place to forget to update.
  // Note this only reaches a fresh database. The insert is `on conflict (model_code) do nothing`,
  // so a live database that already has these rows keeps config NULL until an explicit UPDATE is
  // run through db-init — a reseed will not backfill it.
  //
  // model_code convention (2026-07-27, see docs/30-design/platform/42-model-provider-registry-plan.md):
  // `{provider_code}/{vendor_model_name}` — namespaced so callers/logs/dashboards never collide across
  // vendors and the prefix doubles as the provider-adapter dispatch key.
  // Domestic providers (doubao/deepseek/minimax) are `config.egressRoute = 'direct'` and active — this
  // is the current focus. Overseas providers (anthropic/openai/google) are registered so the catalog/UI
  // shape is ready, but `is_active = false` ("registered closed") until cross-border network egress +
  // data-export compliance posture are resolved (owner-gated, see same design doc §3) — do NOT flip
  // these to active without that sign-off. Exact vendor model codes below are placeholders; confirm
  // real current model identifiers/pricing before any is switched on.
  await client.query(
    `
    insert into model.model_providers (id, provider_code, provider_type, provider_name, description, description_key, is_active, config, created_by, created_at, updated_at)
    values
      ($1, 'doubao',    'online', 'Volcano Doubao', 'ByteDance Volcano model service', 'model.provider.doubao.desc',    true,  '{"egressRoute":"direct"}'::jsonb, $7, now(), now()),
      ($2, 'deepseek',  'online', 'DeepSeek',        'DeepSeek model family',           'model.provider.deepseek.desc',  true,  '{"egressRoute":"direct"}'::jsonb, $7, now(), now()),
      ($3, 'minimax',   'online', 'MiniMax',         'MiniMax model family',            'model.provider.minimax.desc',   true,  '{"egressRoute":"direct"}'::jsonb, $7, now(), now()),
      ($4, 'anthropic', 'online', 'Anthropic',      'Claude model family',             'model.provider.anthropic.desc', false, '{"egressRoute":"overseas-proxy","status":"registered-closed-pending-egress-and-compliance"}'::jsonb, $7, now(), now()),
      ($5, 'openai',    'online', 'OpenAI',         'GPT model family',                'model.provider.openai.desc',    false, '{"egressRoute":"overseas-proxy","status":"registered-closed-pending-egress-and-compliance"}'::jsonb, $7, now(), now()),
      ($6, 'google',    'online', 'Google',         'Gemini model family',             'model.provider.google.desc',    false, '{"egressRoute":"overseas-proxy","status":"registered-closed-pending-egress-and-compliance"}'::jsonb, $7, now(), now())
    on conflict (provider_code) do nothing
  `,
    [
      ID.providerDoubao,
      ID.providerDeepseek,
      ID.providerMinimax,
      ID.providerAnthropic,
      ID.providerOpenai,
      ID.providerGoogle,
      SYS,
    ],
  );
  // The insert above is a no-op on environments where anthropic/openai already exist
  // (ON CONFLICT (provider_code) DO NOTHING) — force the "registered closed" state
  // explicitly so re-running this seed always converges, not just on a fresh DB.
  await client.query(
    `
    update model.model_providers
       set is_active = false,
           config = '{"egressRoute":"overseas-proxy","status":"registered-closed-pending-egress-and-compliance"}'::jsonb,
           updated_at = now()
     where provider_code in ('anthropic', 'openai', 'google')
  `,
  );
  const provRes = await client.query(
    `select id, provider_code from model.model_providers`,
  );
  const provMap = Object.fromEntries(
    provRes.rows.map((r) => [r.provider_code, r.id]),
  );
  await client.query(
    `
    insert into model.models
      (id, provider_id, model_code, model_type, protocol, model_name, description, description_key, endpoint_url, context_window, max_output_tokens, capabilities, config, is_active, sort, created_by, created_at, updated_at)
    values
      ($1, $7,  'doubao-pro-32k', 'chat', 'openai', 'Doubao Pro 32k',
       'General chat model, 32k context. NOTE: model_code kept unprefixed (legacy row, already live) — same reason as claude-sonnet-4/gpt-4o below.', 'model.model.doubao-pro-32k.desc',
       'https://ark.cn-beijing.volces.com/api/v3', 32768, 4096, ARRAY['chat','tools'], NULL, true, 1, $10, now(), now()),
      ($2, $8,  'deepseek/deepseek-chat', 'chat', 'openai', 'DeepSeek Chat',
       'General chat model (placeholder model code, confirm current vendor identifier before enabling billing).', 'model.model.deepseek-chat.desc',
       'https://api.deepseek.com', 64000, 8192, ARRAY['chat','tools'], '{"upstreamModel":"deepseek-chat"}'::jsonb, true, 2, $10, now(), now()),
      ($3, $9,  'minimax/minimax-text-01', 'chat', 'openai', 'MiniMax Text 01',
       'General chat model (placeholder model code, confirm current vendor identifier before enabling billing).', 'model.model.minimax-text-01.desc',
       'https://api.minimax.chat/v1', 245000, 8192, ARRAY['chat','tools'], '{"upstreamModel":"minimax-text-01"}'::jsonb, true, 3, $10, now(), now()),
      ($4, $11, 'claude-sonnet-4', 'chat', 'anthropic', 'Claude Sonnet 4',
       'Balanced chat model with vision and tools, 200k context. Registered closed — see model_providers.config. NOTE: model_code kept unprefixed (legacy row, already live) — do not rename to the provider/model convention in-place (same fixed id + different model_code would collide with the existing primary key on any environment where this row already exists); rename requires an explicit UPDATE migration, not a reseed.', 'model.model.claude-sonnet-4.desc',
       'https://api.anthropic.com', 200000, 8192, ARRAY['chat','tools','vision'], NULL, false, 11, $10, now(), now()),
      ($5, $12, 'gpt-4o', 'chat', 'openai', 'GPT-4o',
       'Multimodal chat model with vision and tools, 128k context. Registered closed — see model_providers.config. NOTE: model_code kept unprefixed for the same reason as claude-sonnet-4 above.', 'model.model.gpt-4o.desc',
       'https://api.openai.com/v1', 128000, 16384, ARRAY['chat','tools','vision'], NULL, false, 12, $10, now(), now()),
      ($6, $13, 'google/gemini-2.5-flash', 'chat', 'openai', 'Gemini 2.5 Flash',
       'Multimodal chat model, fast tier. Registered closed — see model_providers.config (placeholder model code).', 'model.model.gemini-2.5-flash.desc',
       'https://generativelanguage.googleapis.com', 1000000, 8192, ARRAY['chat','tools','vision'], '{"upstreamModel":"gemini-2.5-flash"}'::jsonb, false, 13, $10, now(), now())
    on conflict (model_code) do nothing
  `,
    [
      ID.modelDoubaoPro,
      ID.modelDeepseekChat,
      ID.modelMinimaxText,
      ID.modelClaudeSonnet,
      ID.modelGpt4o,
      ID.modelGeminiFlash,
      provMap["doubao"] ?? null,
      provMap["deepseek"] ?? null,
      provMap["minimax"] ?? null,
      SYS,
      provMap["anthropic"] ?? null,
      provMap["openai"] ?? null,
      provMap["google"] ?? null,
    ],
  );
  // Same convergence-on-rerun reasoning as the provider update above.
  await client.query(
    `
    update model.models
       set is_active = false, updated_at = now()
     where model_code in ('claude-sonnet-4', 'gpt-4o', 'google/gemini-2.5-flash')
  `,
  );
  // Live-database increment for config.upstreamModel (standard §7: increments are embedded in
  // seed so `db-init seed` is self-sufficient on a live database). The insert above is
  // `on conflict (model_code) do nothing`, so it never reaches rows that already exist — on any
  // database seeded before 2026-08-10 the three prefixed rows still have config NULL, and an
  // adapter following §1.1 falls back to model_code and sends the prefixed string upstream.
  // Idempotent twice over: it only writes where upstreamModel is absent, so a rerun is a no-op,
  // and a value someone set by hand is never overwritten. `||` merges rather than replaces, so
  // any other key already in config survives.
  await client.query(
    `
    update model.models m
       set config = coalesce(m.config, '{}'::jsonb) || jsonb_build_object('upstreamModel', v.upstream),
           updated_at = now()
      from (values
        ('deepseek/deepseek-chat',  'deepseek-chat'),
        ('minimax/minimax-text-01', 'minimax-text-01'),
        ('google/gemini-2.5-flash', 'gemini-2.5-flash')
      ) as v(code, upstream)
     where m.model_code = v.code
       and coalesce(m.config ->> 'upstreamModel', '') = ''
  `,
  );
  const modelRes = await client.query(
    `select id, model_code from model.models`,
  );
  const modelMap = Object.fromEntries(
    modelRes.rows.map((r) => [r.model_code, r.id]),
  );
  for (const code of [
    "doubao-pro-32k",
    "deepseek/deepseek-chat",
    "minimax/minimax-text-01",
    "claude-sonnet-4",
    "gpt-4o",
    "google/gemini-2.5-flash",
  ]) {
    const modelId = modelMap[code];
    if (!modelId) continue;
    await client.query(
      `
      insert into model.model_price_rules (id, model_id, billing_mode, currency, unit_tokens, input_unit_price, output_unit_price, is_active, effective_at, created_by, created_at, updated_at)
      select gen_random_uuid(), $1, 'token', 'CNY', 1000000, 0, 0, true, now(), $2, now(), now()
      where not exists (select 1 from model.model_price_rules where model_id = $1)
    `,
      [modelId, SYS],
    );
  }
  console.log(
    "✓  model — 6 providers (3 domestic active: doubao/deepseek/minimax; 3 overseas registered-closed: anthropic/openai/google) + 6 models + price rules",
  );

  // ── 11. identity.oauth_providers — inbound federation broker config ─────────
  const ssoProviders = [
    {
      id: ID.oauthFeishu,
      code: "feishu",
      name: "Feishu",
      sort: 1,
      scope:
        "contact:user.base:readonly contact:user.email:readonly contact:user.phone:readonly contact:user.id:readonly",
      authUrl: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
      tokenUrl: "https://accounts.feishu.cn/oauth/v3/token",
      accountInfoUrl: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      clientId: process.env.FEISHU_APP_ID || null,
      clientSecret: process.env.FEISHU_APP_SECRET || null,
      redirectUri: process.env.FEISHU_REDIRECT_URI || null,
    },
    {
      id: ID.oauthDingtalk,
      code: "dingtalk",
      name: "DingTalk",
      sort: 2,
      scope: "openid",
      authUrl: "https://login.dingtalk.com/oauth2/auth",
      tokenUrl: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
      accountInfoUrl: "https://api.dingtalk.com/v1.0/contact/users/me",
      clientId: process.env.DINGTALK_APP_KEY || null,
      clientSecret: process.env.DINGTALK_APP_SECRET || null,
      redirectUri: process.env.DINGTALK_REDIRECT_URI || null,
    },
    {
      id: ID.oauthGoogle,
      code: "google",
      name: "Google",
      sort: 3,
      scope: "openid email profile",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      accountInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      clientId: process.env.GOOGLE_CLIENT_ID || null,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
    },
  ];
  for (const p of ssoProviders) {
    // Compliance: Google federation is disabled platform-wide, regardless of creds.
    // feishu/dingtalk keep cred-derived enablement.
    const enabled =
      p.code === "google" ? false : Boolean(p.clientId && p.clientSecret);
    await client.query(
      `
      insert into identity.oauth_providers
        (id, code, name, name_key, scope, auth_url, token_url, account_info_url,
         client_id, client_secret, redirect_uri, is_enabled, sort, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
      on conflict (code) do update set
        name = excluded.name, name_key = excluded.name_key, scope = excluded.scope,
        auth_url = excluded.auth_url, token_url = excluded.token_url,
        account_info_url = excluded.account_info_url,
        client_id = coalesce(excluded.client_id, identity.oauth_providers.client_id),
        client_secret = coalesce(excluded.client_secret, identity.oauth_providers.client_secret),
        redirect_uri = coalesce(excluded.redirect_uri, identity.oauth_providers.redirect_uri),
        is_enabled = excluded.is_enabled, updated_at = now()
    `,
      [
        p.id,
        p.code,
        p.name,
        `identity.provider.${p.code}`,
        p.scope,
        p.authUrl,
        p.tokenUrl,
        p.accountInfoUrl,
        p.clientId,
        p.clientSecret,
        p.redirectUri,
        enabled,
        p.sort,
      ],
    );
    console.log(
      `✓  identity.oauth_providers — ${p.code} (is_enabled=${enabled})`,
    );
  }
}

if (isMain(import.meta.url)) {
  runSeed("catalog", seedCatalog);
}
