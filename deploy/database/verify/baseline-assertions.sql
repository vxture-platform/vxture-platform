-- ═══════════════════════════════════════════════════════════════════════════
-- baseline-assertions.sql — live-DB baseline audit (data_platform_320 §9.5-③)
-- Asserts the live database matches the target-state design on four axes:
--   A.  schema set  == the 19 target schemas exactly (no orphans, none missing)
--   B0. DDL baseline fingerprint == hash of the authoritative DDL (stamped by
--       apply.sh into public.vx_ddl_baseline; catches column-level drift that
--       leaves counts unchanged — the §9 upgraded finding)
--   B.  table count == derived from the authoritative DDL (passed as :expected_tables)
--   C.  seed baseline — design-doc catalog floors (data_admin_200 §4 operator RBAC,
--       data_identity_200 §6 access RBAC, oidc_clients, oauth_providers, kyc/loyalty/
--       product/model) + super_admin full-grant equality.
--   C2. column completeness on seeded rows — i18n *_key / display content must be
--       non-NULL (2026-07-05 seed-correction line: row floors alone let whole
--       columns stay silently NULL).
-- Any failure raises ONE exception listing every failed assertion → psql exit 3
-- (ON_ERROR_STOP) → 30-verify wrapper red → db-init run red.
-- Read-only: no writes, safe against production at any time.
-- NOTE: trigger/FK counts deliberately NOT asserted yet — 97/98 (TD-018) live
--       switch is separately gated, making those counts environment-dependent.
--       Tighten after the TD-018 switch (see §9.5 note).
-- Floors are DESIGN floors — update them together with the design docs, never
-- loosen to make a broken environment pass.
-- ═══════════════════════════════════════════════════════════════════════════

-- psql does not interpolate :vars inside dollar-quoted bodies, so hand the
-- expectations to the DO block via session GUCs (interpolated here, outside).
SET vx.expected_tables = :expected_tables;
SET vx.expected_ddl_hash = :'expected_ddl_hash';

DO $$
DECLARE
  targets text[] := ARRAY[
    'account','identity','credential','kyc','tenancy','access','appoidc','session','loyalty',
    'metering','billing','provisioning','promotion','product','model','safety','support','admin',
    'sharing'];
  expected int := current_setting('vx.expected_tables')::int;
  fails    text := '';
  missing  text;
  extras   text;
  ddlhash  text;
  cnt      int;
  cnt2     int;
  cnt3     int;
  chk      record;
BEGIN
  -- ── A. schema set == target set ────────────────────────────────────────────
  SELECT string_agg(s, ', ') INTO missing
    FROM unnest(targets) s
   WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s);
  IF missing IS NOT NULL THEN
    fails := fails || format('[A] missing target schemas: %s; ', missing);
  END IF;

  SELECT string_agg(nspname, ', ') INTO extras
    FROM pg_namespace
   WHERE nspname NOT LIKE 'pg\_%'
     AND nspname NOT IN ('public', 'information_schema')
     AND nspname <> ALL (targets);
  IF extras IS NOT NULL THEN
    fails := fails || format('[A] orphan schemas (retired/unknown, must be dropped): %s; ', extras);
  END IF;

  -- ── B0. DDL baseline fingerprint (catches column-level drift; §9 lesson:
  --        counts alone passed while 80_admin columns had been renamed) ───────
  BEGIN
    SELECT ddl_hash INTO ddlhash FROM public.vx_ddl_baseline WHERE id = 1;
  EXCEPTION WHEN undefined_table THEN
    ddlhash := NULL;
  END;
  IF ddlhash IS NULL THEN
    fails := fails || '[B0] no DDL baseline stamp (DB predates stamped apply, or built out-of-band — structure version unknown); ';
  ELSIF ddlhash <> current_setting('vx.expected_ddl_hash') THEN
    fails := fails || format('[B0] DDL baseline hash mismatch: live=%s expected=%s (live built from a different DDL version — clean-baseline reset required); ',
                             ddlhash, current_setting('vx.expected_ddl_hash'));
  END IF;

  -- ── B. table count == DDL-derived expectation ─────────────────────────────
  SELECT count(*) INTO cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY (targets);
  IF cnt <> expected THEN
    fails := fails || format('[B] table count %s <> DDL expectation %s; ', cnt, expected);
  END IF;

  -- ── C. seed baseline floors (catalog must exist even before features ship) ─
  FOR chk IN
    SELECT * FROM (VALUES
      ('admin.operator_role',        7),  -- data_admin_200 §4 preset roles
      ('admin.operator_permission', 30),  -- 3-seg perm catalog (33 as of 2026-07-05)
      ('admin.operator_role_permission', 30),  -- ≥ super_admin full-grant alone
      ('admin.operator_account',     2),  -- systemadmin/superadmin built-ins
      ('admin.settings',             1),  -- operator.mfa.policy
      ('access.roles',              10),  -- 5 roles × 2 scopes (data_identity_200 §6)
      ('access.permissions',         9),
      ('access.role_permissions',    1),
      ('appoidc.oidc_clients',      10),  -- platform RPs + partner apps
      ('identity.oauth_providers',   3),  -- feishu/dingtalk/google
      ('kyc.verification_policies',  2),  -- personal/organization
      ('loyalty.level_policies',     5),
      ('loyalty.level_thresholds',   5),
      ('product.products',           1),
      ('product.plans',              1)
    ) v(tbl, floor_cnt)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s', chk.tbl) INTO cnt;
    IF cnt < chk.floor_cnt THEN
      fails := fails || format('[C] %s = %s < design floor %s; ', chk.tbl, cnt, chk.floor_cnt);
    END IF;
  END LOOP;

  -- ── C2. column completeness (i18n keys / display content on SEEDED rows) ────
  --   Second axis after row floors (§9 lesson round 2: rows can hit the floor while
  --   whole display/i18n columns silently stay NULL). Scope predicates confine the
  --   assertions to seed-owned rows: operator-created rows (custom roles, admin-made
  --   plans, ...) legitimately carry no locale keys.
  FOR chk IN
    SELECT * FROM (VALUES
      ('access.roles',                   'role_name_key',   'is_system = true'),
      ('access.roles',                   'description',     'is_system = true'),
      ('access.roles',                   'description_key', 'is_system = true'),
      ('access.permissions',             'perm_name_key',   'is_system = true'),
      ('access.permissions',             'description_key', 'is_system = true'),
      ('admin.operator_role',            'role_name_key',   'is_system = true'),
      ('admin.operator_role',            'description_key', 'is_system = true'),
      ('admin.operator_permission',      'perm_name_key',   'is_system = true'),
      ('admin.operator_permission',      'description_key', 'is_system = true'),
      ('loyalty.level_policies',         'level_name',      'true'),
      ('loyalty.level_policies',         'level_name_key',  'true'),
      ('loyalty.level_policies',         'description_key', 'true'),
      ('identity.oauth_providers',       'name_key',        'true'),
      ('product.product_categories',     'name_key',        'true'),
      ('product.products',               'description_key', 'created_by = ''00000000-0000-4000-a000-000000000010'''),
      ('product.plans',                  'plan_name_key',   'created_by = ''00000000-0000-4000-a000-000000000010'''),
      ('product.plans',                  'description_key', 'created_by = ''00000000-0000-4000-a000-000000000010'''),
      ('product.launch_checklist_items', 'item_name_key',   'true'),
      ('admin.settings',                 'description_key', 'true')
    ) v(tbl, col, scope_pred)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s WHERE (%s) AND (%I IS NULL OR %I = '''')',
      chk.tbl, chk.scope_pred, chk.col, chk.col) INTO cnt;
    IF cnt > 0 THEN
      fails := fails || format('[C2] %s.%s: %s seeded row(s) NULL/empty; ', chk.tbl, chk.col, cnt);
    END IF;
  END LOOP;

  -- super_admin full-grant: no hardcoded auth bypass, so super_admin must map
  -- to EVERY operator_permission (seed self-check mirrored here as a live gate).
  SELECT count(*) INTO cnt
    FROM admin.operator_role_permission rp
    JOIN admin.operator_role r ON r.id = rp.role_id
   WHERE r.role_code = 'super_admin';
  SELECT count(*) INTO cnt2 FROM admin.operator_permission;
  IF cnt2 = 0 OR cnt <> cnt2 THEN
    fails := fails || format('[C] super_admin grant %s/%s not full; ', cnt, cnt2);
  END IF;

  -- platform RPs must carry real secrets (28b restore / 27-provision applied).
  -- umbra = ex-ruyin (product_300 §2 U-line); its hash rides the renamed row/env key.
  SELECT count(*) INTO cnt
    FROM appoidc.oidc_clients
   WHERE client_id IN ('umbra', 'console', 'admin') AND client_secret_hash IS NOT NULL;
  IF cnt < 3 THEN
    fails := fails || format('[C] confidential RP secrets set: %s/3 (umbra/console/admin); ', cnt);
  END IF;

  -- U-line ownership (product_300 §2.3 #5): ruyin.ai belongs to umbra; the NEW
  -- ruyin client (ruyin.vxture.com) must never carry it. Guards the
  -- RUYIN_BASE_URL meaning-change footgun from silently passing.
  SELECT count(*) INTO cnt
    FROM appoidc.oidc_clients c
   WHERE c.client_id = 'umbra'
     AND EXISTS (SELECT 1 FROM unnest(c.redirect_uris) u WHERE u LIKE 'https://ruyin.ai/%');
  IF cnt <> 1 THEN
    fails := fails || '[C] umbra redirect_uris must carry https://ruyin.ai/...; ';
  END IF;
  SELECT count(*) INTO cnt
    FROM appoidc.oidc_clients c
   WHERE c.client_id = 'ruyin'
     AND EXISTS (SELECT 1 FROM unnest(c.redirect_uris) u WHERE u LIKE '%ruyin.ai%');
  IF cnt > 0 THEN
    fails := fails || '[C] new ruyin client must NOT point at ruyin.ai (that is umbra''s domain); ';
  END IF;

  -- ── C3. visibility axis (two-realm; independent of status/is_active/enable) ──
  --   Meta anchors must be workforce-invisible; realm isolation makes the whole
  --   workforce realm customer-invisible (structural const-false).
  SELECT count(*) INTO cnt FROM admin.operator_role
   WHERE role_code = 'sys_config' AND is_workforce_visible = false;
  IF cnt <> 1 THEN
    fails := fails || '[C3] admin.operator_role sys_config must be is_workforce_visible=false; ';
  END IF;
  SELECT count(*) INTO cnt FROM admin.operator_account
   WHERE username = 'systemadmin' AND is_workforce_visible = false;
  IF cnt <> 1 THEN
    fails := fails || '[C3] admin.operator_account systemadmin must be is_workforce_visible=false; ';
  END IF;
  -- real operational roles/accounts must stay workforce-visible.
  SELECT count(*) INTO cnt FROM admin.operator_role
   WHERE role_code = 'super_admin' AND is_workforce_visible = true;
  IF cnt <> 1 THEN
    fails := fails || '[C3] admin.operator_role super_admin must be is_workforce_visible=true; ';
  END IF;
  -- realm isolation: no workforce row may be customer-visible.
  SELECT count(*) INTO cnt FROM admin.operator_role WHERE is_customer_visible = true;
  SELECT count(*) INTO cnt3 FROM admin.operator_account WHERE is_customer_visible = true;
  IF cnt > 0 OR cnt3 > 0 THEN
    fails := fails || format('[C3] realm isolation breach: %s operator_role + %s operator_account customer-visible; ', cnt, cnt3);
  END IF;

  -- ── verdict ────────────────────────────────────────────────────────────────
  IF fails <> '' THEN
    RAISE EXCEPTION 'baseline audit FAILED: %', fails;
  END IF;
  RAISE NOTICE 'baseline audit OK — schema set exact (19 targets), table count == DDL (%), seed catalog floors met, super_admin full-grant (%/%)', expected, cnt2, cnt2;
END $$;
