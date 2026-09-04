-- ═══════════════════════════════════════════════════════════════════════════
-- 98_column_locks.sql — 锚点列列级不可变锁（TD-018，铁律八 §2.2.4 落地）
-- 权威依据：data_platform_100_architecture.md §2.2.4 铁律八 + §3.2.4 检测器 #4；
--   deploy/database/ddl/97_service_roles.sql（platform_svc 非-owner 角色，本文件
--   的 REVOKE/GRANT 只对它生效——对 owner `vxture` 无效，DDL/迁移仍以 owner 执行）。
--
-- 判定规则（按下列 4 类结构性规则 + 1 项显式标注特例，覆盖全部 106 张表）：
--   ① 主键列（含复合主键、1:1 子表 PK=FK，如 user_profiles.user_id）；
--   ② 任意 `_no` 后缀列（外部可视码，铁律二——可经受控/直连库改，但不可经应用
--      UPDATE 改写；含非严格"用户展示码"但同为一次写入不变的关联单号，如
--      billing.transactions.related_no）；
--   ③ `created_at`（一次写入，约定不再更新）；
--   ④ `created_by`（创建者，一次写入不变；后续变更走 updated_by，非本列）；
--   ⑤ 显式标注的安全语义列：目前仅 `admin.operator_role.rank`（见 80_admin.sql
--      列注释"锚点列：不可经 API 改写"）。
--   ②' 规则②的例外——"晚绑定 `_no`"：INSERT 之后才有值、那一次写是 UPDATE 的单号
--      （发票快递单号/电子发票号、网关单号）。清单在
--      scripts/guardrails/column-locks.shared.mjs LATE_BOUND_WRITABLE，两个守卫共用。
--      2026-09-02 生产实测：把它们当锚点会让整条业务动作 42501（确认收款事务因
--      invoices.transaction_no 整体回滚——那一列不列入例外，写侧改为不回写、读侧派生）。
--
-- ⚠ 列锁只对非-owner 角色生效：开发/CI 若以 owner 连库，锁在那里是摆设，代码里碰
--   锚点列的 UPDATE 只会在生产（platform_svc）炸。所以还有第二个守卫
--   scripts/guardrails/check-anchor-writes.mjs 静态扫应用代码里的 UPDATE 语句。
-- append-only 表（billing.transactions/support.audit_logs/safety.moderation_logs
-- 等）已有 95_triggers.sql 的 BEFORE UPDATE/DELETE 硬阻断（对 owner 也生效，触发
-- 器与 GRANT 机制正交）；本文件仍按统一规则加列锁，双重防御、不特例化。
--
-- 生成方式：规则化脚本解析 10_*.sql..80_*.sql 的 CREATE TABLE 块（含 PARTITION BY
-- 分区父表），逐表输出 REVOKE UPDATE + GRANT UPDATE(可写列白名单)；输出经人工逐条
-- 核对（含分区父表/复合主键的脚本 bug 修复）后落此文件，非脚本直接落库。
-- 幂等：REVOKE/GRANT 每次 apply 重新执行（--reset 重建 18 schema 后表是新的，
-- 权限需重新授予）。仅覆盖非空 GRANT——若某表全部列均为锚点则只 REVOKE（本次无
-- 此情形，106 表均保留 ≥1 可写列）。
-- ═══════════════════════════════════════════════════════════════════════════

-- account.users  [anchor: id, user_no, level_no, created_at]
REVOKE UPDATE ON account.users FROM platform_svc;
GRANT UPDATE (account, email, email_verified_at, phone, phone_verified_at, account_changed_at, account_login_disabled, status, source, updated_at, deleted_at, deletion_requested_at) ON account.users TO platform_svc;

-- account.user_profiles  [anchor: user_id, created_at]
REVOKE UPDATE ON account.user_profiles FROM platform_svc;
GRANT UPDATE (display_name, avatar_url, avatar_hash, gender, birthday, bio, language, timezone, theme, preferences, extra, updated_at) ON account.user_profiles TO platform_svc;

-- account.user_avatars  [anchor: user_id]
REVOKE UPDATE ON account.user_avatars FROM platform_svc;
GRANT UPDATE (data, content_type, hash, source, updated_at) ON account.user_avatars TO platform_svc;

-- account.user_product_favorites  [anchor: user_id, product_id, created_at]（全锚：只 REVOKE）
REVOKE UPDATE ON account.user_product_favorites FROM platform_svc;

-- identity.identities  [anchor: id, created_at]
REVOKE UPDATE ON identity.identities FROM platform_svc;
GRANT UPDATE (user_id, provider, provider_subject, metadata, updated_at) ON identity.identities TO platform_svc;

-- identity.oauth_providers  [anchor: id, created_at]
REVOKE UPDATE ON identity.oauth_providers FROM platform_svc;
GRANT UPDATE (code, name, client_id, client_secret, scope, auth_url, token_url, account_info_url, redirect_uri, field_mapping, is_enabled, sort, name_key, is_customer_visible, is_workforce_visible, updated_at) ON identity.oauth_providers TO platform_svc;

-- identity.oauth_states  [anchor: id, created_at]
REVOKE UPDATE ON identity.oauth_states FROM platform_svc;
GRANT UPDATE (provider_code, state, redirect_uri, code_verifier, nonce, ip_address, expires_at) ON identity.oauth_states TO platform_svc;

-- credential.user_credentials  [anchor: user_id, created_at]
REVOKE UPDATE ON credential.user_credentials FROM platform_svc;
GRANT UPDATE (password_hash, password_changed_at, force_password_change, updated_at) ON credential.user_credentials TO platform_svc;

-- credential.user_mfas  [anchor: user_id, created_at]
REVOKE UPDATE ON credential.user_mfas FROM platform_svc;
GRANT UPDATE (policy, totp_secret, totp_enabled, webauthn_required, updated_at) ON credential.user_mfas TO platform_svc;

-- credential.user_webauthn_credentials  [anchor: id, created_at]
REVOKE UPDATE ON credential.user_webauthn_credentials FROM platform_svc;
GRANT UPDATE (user_id, credential_id, public_key, sign_count, transports, device_name, last_used_at) ON credential.user_webauthn_credentials TO platform_svc;

-- credential.user_recovery_codes  [anchor: id, created_at]
REVOKE UPDATE ON credential.user_recovery_codes FROM platform_svc;
GRANT UPDATE (user_id, code_hash, used_at) ON credential.user_recovery_codes TO platform_svc;

-- kyc.user_kycs  [anchor: user_id, created_at]
REVOKE UPDATE ON kyc.user_kycs FROM platform_svc;
GRANT UPDATE (real_name, id_type, id_no_encrypted, status, verified_at, reviewer_id, reject_reason, updated_at) ON kyc.user_kycs TO platform_svc;

-- kyc.tenant_verifications  [anchor: id, business_license_no, created_at]
REVOKE UPDATE ON kyc.tenant_verifications FROM platform_svc;
GRANT UPDATE (tenant_id, verification_type, business_license_image_ref, legal_person_name, status, reviewer_id, reviewed_at, reject_reason, updated_at) ON kyc.tenant_verifications TO platform_svc;

-- kyc.verification_policies  [anchor: id, created_at]
REVOKE UPDATE ON kyc.verification_policies FROM platform_svc;
GRANT UPDATE (product_id, tenant_type, require_verification, required_type, updated_at) ON kyc.verification_policies TO platform_svc;

-- access.roles  [anchor: id, created_by, created_at]
REVOKE UPDATE ON access.roles FROM platform_svc;
GRANT UPDATE (role_code, scope, role_name, role_name_key, description, description_key, is_system, status, sort, updated_by, is_customer_visible, is_workforce_visible, updated_at) ON access.roles TO platform_svc;

-- access.permissions  [anchor: id, created_by, created_at]
REVOKE UPDATE ON access.permissions FROM platform_svc;
GRANT UPDATE (parent_id, perm_code, perm_name, perm_name_key, perm_type, route_path, component, icon, category, description, is_active, is_system, sort, updated_by, description_key, is_customer_visible, is_workforce_visible, updated_at) ON access.permissions TO platform_svc;

-- access.role_permissions  [anchor: role_id, permission_id, created_by, created_at]
REVOKE UPDATE ON access.role_permissions FROM platform_svc;
GRANT UPDATE (is_system) ON access.role_permissions TO platform_svc;

-- tenancy.tenants  [anchor: id, tenant_no, created_at]
REVOKE UPDATE ON tenancy.tenants FROM platform_svc;
GRANT UPDATE (name, type, owner_user_id, status, verification_status, verification_type, workspace_counter, updated_at, deleted_at) ON tenancy.tenants TO platform_svc;  -- workspace_counter:95 触发器以调用者身份递增,需此授权

-- tenancy.tenant_profiles  [anchor: tenant_id, created_at]
REVOKE UPDATE ON tenancy.tenant_profiles FROM platform_svc;
GRANT UPDATE (description, industry, scale, website, country_code, address, postal_code, is_billing_recipient, timezone, language, currency, updated_at) ON tenancy.tenant_profiles TO platform_svc;

-- tenancy.tenant_contacts  [anchor: id, created_at]
REVOKE UPDATE ON tenancy.tenant_contacts FROM platform_svc;
GRANT UPDATE (tenant_id, contact_type, name, title, email, phone, user_id, updated_at) ON tenancy.tenant_contacts TO platform_svc;

-- tenancy.tenant_logos  [anchor: tenant_id, kind]
REVOKE UPDATE ON tenancy.tenant_logos FROM platform_svc;
GRANT UPDATE (data, content_type, hash, source, updated_at) ON tenancy.tenant_logos TO platform_svc;

-- tenancy.tenant_branding  [anchor: tenant_id, created_at]
REVOKE UPDATE ON tenancy.tenant_branding FROM platform_svc;
GRANT UPDATE (logo_url, logo_dark_url, icon_url, favicon_url, email_logo_url, brand_color, brand_color_dark, updated_by, updated_at) ON tenancy.tenant_branding TO platform_svc;

-- tenancy.workspaces  [anchor: id, workspace_no, created_at]
REVOKE UPDATE ON tenancy.workspaces FROM platform_svc;
GRANT UPDATE (tenant_id, name, is_default, description, icon, status, updated_at, deleted_at) ON tenancy.workspaces TO platform_svc;

-- tenancy.tenant_memberships  [anchor: id, employee_no, created_at]
REVOKE UPDATE ON tenancy.tenant_memberships FROM platform_svc;
GRANT UPDATE (tenant_id, user_id, role_id, role_scope, status, default_workspace_id, title, department, job_level, member_extra, updated_at) ON tenancy.tenant_memberships TO platform_svc;

-- tenancy.workspace_memberships  [anchor: id, created_at]
REVOKE UPDATE ON tenancy.workspace_memberships FROM platform_svc;
GRANT UPDATE (workspace_id, tenant_id, user_id, role_id, role_scope, status, updated_at) ON tenancy.workspace_memberships TO platform_svc;

-- tenancy.invitations  [anchor: id, created_by, created_at]
REVOKE UPDATE ON tenancy.invitations FROM platform_svc;
GRANT UPDATE (scope, tenant_id, workspace_id, target_type, target, role_id, role_scope, status, token_hash, expires_at, accepted_at, updated_at) ON tenancy.invitations TO platform_svc;

-- appoidc.oidc_clients  [anchor: id, created_at]
REVOKE UPDATE ON appoidc.oidc_clients FROM platform_svc;
GRANT UPDATE (client_id, client_secret_hash, realm, product_id, client_kind, release_channel, name, display_name, logo_url, redirect_uris, post_logout_redirect_uris, allowed_scopes, access_token_ttl, refresh_token_ttl, pkce_required, token_endpoint_auth_method, slo_participation, back_channel_logout_uri, status, updated_at) ON appoidc.oidc_clients TO platform_svc;

-- appoidc.signing_keys  [anchor: kid, created_at]
REVOKE UPDATE ON appoidc.signing_keys FROM platform_svc;
GRANT UPDATE (algorithm, public_jwk, status, activated_at, retiring_at, retired_at) ON appoidc.signing_keys TO platform_svc;

-- appoidc.oidc_consents  [anchor: id, created_at]
REVOKE UPDATE ON appoidc.oidc_consents FROM platform_svc;
GRANT UPDATE (user_id, client_id, scopes, granted_at, revoked_at, updated_at) ON appoidc.oidc_consents TO platform_svc;

-- session.auth_sessions  [anchor: id, created_at]
REVOKE UPDATE ON session.auth_sessions FROM platform_svc;
GRANT UPDATE (sid, user_id, realm, auth_method, ip_address, user_agent, status, last_active_at, expires_at, revoked_at) ON session.auth_sessions TO platform_svc;

-- session.refresh_tokens  [anchor: id, created_at]
REVOKE UPDATE ON session.refresh_tokens FROM platform_svc;
GRANT UPDATE (user_id, session_id, client_id, token_hash, rotated_from, status, expires_at) ON session.refresh_tokens TO platform_svc;

-- session.user_verifications  [anchor: id, created_at]
REVOKE UPDATE ON session.user_verifications FROM platform_svc;
GRANT UPDATE (user_id, target_type, target, purpose, code_hash, attempt_count, expires_at, used_at) ON session.user_verifications TO platform_svc;

-- session.password_reset_tokens  [anchor: id, created_at]
REVOKE UPDATE ON session.password_reset_tokens FROM platform_svc;
GRANT UPDATE (user_id, token_hash, expires_at, used_at) ON session.password_reset_tokens TO platform_svc;

-- session.login_attempts  [anchor: id, created_at]
REVOKE UPDATE ON session.login_attempts FROM platform_svc;
GRANT UPDATE (user_id, identifier, auth_method, result, ip_address, country_code, user_agent) ON session.login_attempts TO platform_svc;

-- loyalty.level_policies  [anchor: level_no]
REVOKE UPDATE ON loyalty.level_policies FROM platform_svc;
GRANT UPDATE (max_owned_org_tenant, base_discount_percent, description, level_name, level_name_key, description_key, is_customer_visible, is_workforce_visible) ON loyalty.level_policies TO platform_svc;

-- loyalty.level_thresholds  [anchor: level_no]
REVOKE UPDATE ON loyalty.level_thresholds FROM platform_svc;
GRANT UPDATE (min_points) ON loyalty.level_thresholds TO platform_svc;

-- loyalty.user_points  [anchor: user_id]
REVOKE UPDATE ON loyalty.user_points FROM platform_svc;
GRANT UPDATE (total_points, updated_at) ON loyalty.user_points TO platform_svc;

-- loyalty.point_ledgers  [anchor: id, created_at]
REVOKE UPDATE ON loyalty.point_ledgers FROM platform_svc;
GRANT UPDATE (user_id, source_type, source_ref_id, points_delta, balance_after, remark) ON loyalty.point_ledgers TO platform_svc;

-- loyalty.task_progresses  [anchor: id, created_at]
REVOKE UPDATE ON loyalty.task_progresses FROM platform_svc;
GRANT UPDATE (user_id, progress_type, current_value, target_value, last_updated_at, reset_at) ON loyalty.task_progresses TO platform_svc;

-- loyalty.user_tags  [anchor: id, created_at]
REVOKE UPDATE ON loyalty.user_tags FROM platform_svc;
GRANT UPDATE (user_id, tag, source) ON loyalty.user_tags TO platform_svc;

-- product.product_categories  [anchor: id, created_at]
REVOKE UPDATE ON product.product_categories FROM platform_svc;
GRANT UPDATE (parent_id, code, name, sort, name_key, is_customer_visible, is_workforce_visible) ON product.product_categories TO platform_svc;

-- product.products  [anchor: id, created_by, created_at]
REVOKE UPDATE ON product.products FROM platform_svc;
GRANT UPDATE (product_code, product_type, category_id, product_name, product_nick, description, capability_keys, tags, standalone_subscribable, icon_url, sort, config, release_version, build_number, released_at, status, updated_by, description_key, is_customer_visible, is_workforce_visible, origin, origin_provider, release_stage, marketing, updated_at, deleted_at) ON product.products TO platform_svc;

-- product.product_metrics  [anchor: id, created_at]
REVOKE UPDATE ON product.product_metrics FROM platform_svc;
GRANT UPDATE (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period) ON product.product_metrics TO platform_svc;

-- product.platform_metrics  [anchor: metric_key, created_at]
REVOKE UPDATE ON product.platform_metrics FROM platform_svc;
GRANT UPDATE (kind, consume_mode, metric_unit, reset_period, status) ON product.platform_metrics TO platform_svc;

-- product.addon_packs  [anchor: id, created_by, created_at]
REVOKE UPDATE ON product.addon_packs FROM platform_svc;
GRANT UPDATE (pack_code, pack_name, metric_key, amount, validity_days, price, currency, status, sort, updated_by, updated_at) ON product.addon_packs TO platform_svc;

-- metering.addon_purchases  [anchor: id, order_no, created_at]  (快照列一次写入靠写路径纪律,列锁按统一规则)
REVOKE UPDATE ON metering.addon_purchases FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, pack_id, pack_code, pack_name, metric_key, amount, validity_days, price, currency, status, payment_ttl_minutes, invoice_id, quota_pool_id, activated_at, cancelled_at, cancel_reason, created_by_type, created_by_id, updated_at) ON metering.addon_purchases TO platform_svc;

-- metering.resource_sharing_policies  [anchor: id, created_at]  (a policy row is add/remove, not mutate)
REVOKE UPDATE ON metering.resource_sharing_policies FROM platform_svc;
GRANT UPDATE (workspace_id, tenant_id, metric_key, product_id, created_by_type, created_by_id) ON metering.resource_sharing_policies TO platform_svc;

-- metering.usage_gauges  [anchor: id, created_at]  (水位表:LWW upsert 实写 value/observed_at/updated_at;身份列不变)
REVOKE UPDATE ON metering.usage_gauges FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, value, observed_at, updated_at) ON metering.usage_gauges TO platform_svc;

-- product.plans  [anchor: id, created_by, created_at]
REVOKE UPDATE ON product.plans FROM platform_svc;
GRANT UPDATE (plan_code, plan_name, description, current_version_id, is_public, status, updated_by, plan_name_key, description_key, is_customer_visible, is_workforce_visible, updated_at, deleted_at) ON product.plans TO platform_svc;

-- product.plan_versions  [anchor: id, version_no, created_by, created_at]
-- status = publish lifecycle (draft|published, product_320); the admin publish
-- flow flips it alongside is_locked, so it is writable (not an anchor).
REVOKE UPDATE ON product.plan_versions FROM platform_svc;
GRANT UPDATE (plan_id, status, is_locked, trial_cycle_unit, trial_cycle_count) ON product.plan_versions TO platform_svc;

-- product.plan_prices  [anchor: id, created_at]
REVOKE UPDATE ON product.plan_prices FROM platform_svc;
GRANT UPDATE (plan_version_id, cycle_unit, cycle_count, price, currency) ON product.plan_prices TO platform_svc;

-- product.plan_components  [anchor: id, created_at]
REVOKE UPDATE ON product.plan_components FROM platform_svc;
GRANT UPDATE (plan_version_id, product_id, tier, component_role, source_profile_code, priority, features, quota, sort_order) ON product.plan_components TO platform_svc;

-- product.solutions  [anchor: id, created_by, created_at]（2026-08-31 admin 解决方案）
REVOKE UPDATE ON product.solutions FROM platform_svc;
GRANT UPDATE (solution_code, solution_name, description, industry, scenario, customer_segment, owner_team, tags, delivery_mode, delivery_boundaries, status, is_public, is_customer_visible, is_workforce_visible, sort, updated_by, updated_at, deleted_at) ON product.solutions TO platform_svc;

-- product.solution_products  [anchor: solution_id, product_id, created_at]
REVOKE UPDATE ON product.solution_products FROM platform_svc;
GRANT UPDATE (role, sort) ON product.solution_products TO platform_svc;

-- product.solution_plans  [anchor: solution_id, tier, created_at]
REVOKE UPDATE ON product.solution_plans FROM platform_svc;
GRANT UPDATE (plan_id) ON product.solution_plans TO platform_svc;

-- product.product_webhooks  [anchor: product_id, created_at]
REVOKE UPDATE ON product.product_webhooks FROM platform_svc;
GRANT UPDATE (home_url, webhook_url, webhook_secret_ref, updated_at) ON product.product_webhooks TO platform_svc;

-- product.launch_checklist_items  [anchor: item_code, created_at]
REVOKE UPDATE ON product.launch_checklist_items FROM platform_svc;
GRANT UPDATE (item_name, description, is_required, sort, item_name_key, description_key) ON product.launch_checklist_items TO platform_svc;

-- product.product_launch_statuses  [anchor: product_id, item_code, created_at]
REVOKE UPDATE ON product.product_launch_statuses FROM platform_svc;
GRANT UPDATE (is_satisfied, checked_at, checked_by, remark, updated_at) ON product.product_launch_statuses TO platform_svc;

-- metering.subscriptions  [anchor: id, created_at]
REVOKE UPDATE ON metering.subscriptions FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count, start_at, end_at, trial_end_at, had_trial_at, status, auto_renew, activation_method, next_renewal_at, renewal_source, payment_mandate_id, pay_amount, product_id, paid_amount, current_order_id, currency, created_by_type, created_by_id, updated_at, deleted_at) ON metering.subscriptions TO platform_svc;

-- metering.subscription_histories  [anchor: id, created_at]
REVOKE UPDATE ON metering.subscription_histories FROM platform_svc;
GRANT UPDATE (tenant_id, subscription_id, change_type, from_plan_version_id, to_plan_version_id, from_status, to_status, actor_type, actor_id, remark, client_ip) ON metering.subscription_histories TO platform_svc;

-- metering.subscription_renewals  [anchor: id, created_at]
REVOKE UPDATE ON metering.subscription_renewals FROM platform_svc;
GRANT UPDATE (subscription_id, tenant_id, cycle_seq, scheduled_at, renewal_source, status, attempt_count, max_attempts, next_retry_at, dunning_stage, amount, result_transaction_id, result_invoice_id, new_period_end, failure_reason, updated_at) ON metering.subscription_renewals TO platform_svc;

-- metering.subscription_entitlement_overrides  [anchor: id, created_at]
REVOKE UPDATE ON metering.subscription_entitlement_overrides FROM platform_svc;
GRANT UPDATE (subscription_id, product_id, override_tier_code, operator_id, reason, expires_at, updated_at) ON metering.subscription_entitlement_overrides TO platform_svc;

-- metering.quota_pools  [anchor: id, created_at]
REVOKE UPDATE ON metering.quota_pools FROM platform_svc;
GRANT UPDATE (workspace_id, subscription_id, product_id, metric_key, quota_limit, quota_used, priority, component_role, pool_source, reset_period, period_anchor, current_period_start, status, retired_at, granted_by, grant_reason, effective_at, expires_at, updated_at) ON metering.quota_pools TO platform_svc;

-- metering.quota_pool_resets  [anchor: id]
REVOKE UPDATE ON metering.quota_pool_resets FROM platform_svc;
GRANT UPDATE (pool_id, period_start, used_before_reset, reset_at) ON metering.quota_pool_resets TO platform_svc;

-- metering.usage_events  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_events FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, total_amount, requested_amount, idempotency_key, request_id, end_user_id) ON metering.usage_events TO platform_svc;

-- metering.usage_event_pools  [anchor: event_id, event_created_at, quota_pool_id]
REVOKE UPDATE ON metering.usage_event_pools FROM platform_svc;
GRANT UPDATE (took) ON metering.usage_event_pools TO platform_svc;

-- metering.usage_idempotencies  [anchor: idempotency_key, created_at]
REVOKE UPDATE ON metering.usage_idempotencies FROM platform_svc;
GRANT UPDATE (event_id, event_created_at, consumed, per_pool) ON metering.usage_idempotencies TO platform_svc;

-- metering.usage_summary_hours  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_summary_hours FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, period_hour, total_amount, updated_at) ON metering.usage_summary_hours TO platform_svc;

-- metering.usage_summary_days  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_summary_days FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, period_day, total_amount, updated_at) ON metering.usage_summary_days TO platform_svc;

-- metering.usage_summary_weeks  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_summary_weeks FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, period_week, total_amount, updated_at) ON metering.usage_summary_weeks TO platform_svc;

-- metering.usage_summary_months  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_summary_months FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, period_month, total_amount, updated_at) ON metering.usage_summary_months TO platform_svc;

-- metering.usage_summary_years  [anchor: id, created_at]
REVOKE UPDATE ON metering.usage_summary_years FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, metric_key, period_year, total_amount, updated_at) ON metering.usage_summary_years TO platform_svc;

-- metering.entitlement_caches  [anchor: id]
REVOKE UPDATE ON metering.entitlement_caches FROM platform_svc;
GRANT UPDATE (workspace_id, product_id, payload, resolved_at, expires_at) ON metering.entitlement_caches TO platform_svc;

-- billing.transactions  [anchor: id, transaction_no, related_no, created_at]
REVOKE UPDATE ON billing.transactions FROM platform_svc;
GRANT UPDATE (tenant_id, bill_id, trade_type, source_method, amount, currency, balance_before, balance_after, trade_status, remark, actor_type, actor_id, client_ip) ON billing.transactions TO platform_svc;

-- billing.credits  [anchor: id, created_at]
REVOKE UPDATE ON billing.credits FROM platform_svc;
GRANT UPDATE (tenant_id, billing_mode, currency, balance, total_granted, total_consumed, version, updated_at) ON billing.credits TO platform_svc;

-- billing.billing_addresses  [anchor: id, created_by, created_at]
-- tax_no 是客户可编辑的抬头资料（纳税人识别号），不是系统签发的码——规则②' 例外，可写。
REVOKE UPDATE ON billing.billing_addresses FROM platform_svc;
GRANT UPDATE (tenant_id, invoice_tax_type, title, tax_no, phone, address, bank_name, bank_account, is_default, updated_by, updated_at, deleted_at) ON billing.billing_addresses TO platform_svc;

-- billing.payment_methods  [anchor: id, created_by, created_at]
REVOKE UPDATE ON billing.payment_methods FROM platform_svc;
GRANT UPDATE (tenant_id, method_type, status, display_name, external_id, is_default, last_used_at, updated_by, updated_at, deleted_at) ON billing.payment_methods TO platform_svc;

-- billing.payment_mandates  [anchor: id, gateway_agreement_no, created_at]
REVOKE UPDATE ON billing.payment_mandates FROM platform_svc;
GRANT UPDATE (tenant_id, user_id, payment_method_id, status, signed_at, expires_at, max_amount_per_cycle, updated_at, deleted_at) ON billing.payment_mandates TO platform_svc;

-- billing.invoices  [anchor: id, bill_no, transaction_no, created_at]
REVOKE UPDATE ON billing.invoices FROM platform_svc;
GRANT UPDATE (tenant_id, subscription_id, order_id, bill_cycle, cycle_start_date, cycle_end_date, total_amount, discount_amount, payable_amount, paid_amount, currency, bill_status, bill_type, paid_at, payment_method, created_by_type, created_by_id, operate_remark, updated_at, deleted_at) ON billing.invoices TO platform_svc;

-- billing.invoice_items  [anchor: id, created_at]
REVOKE UPDATE ON billing.invoice_items FROM platform_svc;
GRANT UPDATE (bill_id, tenant_id, workspace_id, subscription_id, product_id, metric_key, item_name, item_type, item_unit, quantity, unit_price, total_amount, usage_cycle_start, usage_cycle_end, remark, updated_at, deleted_at) ON billing.invoice_items TO platform_svc;

-- billing.invoice_receipts  [anchor: id, invoice_no, tax_no, created_at]
-- invoice_electronic_no / express_no 是晚绑定 `_no`（开具 / 寄出时才有值，那一次写是
-- UPDATE）——列入 scripts/guardrails/column-locks.shared.mjs LATE_BOUND_WRITABLE，可写。
REVOKE UPDATE ON billing.invoice_receipts FROM platform_svc;
GRANT UPDATE (tenant_id, bill_id, invoice_type, invoice_tax_type, invoice_title, company_info, bank_info, address_info, invoice_amount, tax_amount, currency, invoice_status, status_remark, invoice_code, invoice_electronic_no, invoice_file_url, issued_at, express_company, express_no, send_at, created_by_type, created_by_id, auditor_id, audit_at, updated_at, deleted_at) ON billing.invoice_receipts TO platform_svc;

-- billing.payments  [anchor: id, pay_order_no, created_at]
-- channel_order_no / channel_transaction_no 是晚绑定 `_no`（网关回调时才有值），同上可写。
REVOKE UPDATE ON billing.payments FROM platform_svc;
GRANT UPDATE (tenant_id, bill_id, transaction_id, pay_source, pay_channel, pay_method, offline_pay_type, offline_payer_name, offline_pay_time, offline_evidence_url, total_amount, paid_amount, currency, pay_status, status_msg, channel_order_no, channel_transaction_no, channel_raw_data, pay_expire_at, paid_at, closed_at, actor_type, actor_id, operate_remark, updated_at) ON billing.payments TO platform_svc;

-- billing.refunds  [anchor: id, refund_no, channel_refund_no, created_at]
REVOKE UPDATE ON billing.refunds FROM platform_svc;
GRANT UPDATE (tenant_id, bill_id, pay_record_id, transaction_id, order_id, refund_amount, currency, refund_reason, refund_type, audit_status, audit_remark, auditor_id, audit_at, refund_status, refund_at, created_by_type, created_by_id, updated_at) ON billing.refunds TO platform_svc;

-- billing.order_events  [anchor: id, created_at]  (product_330 P1-b2：订单阶段 append-only 审计)
REVOKE UPDATE ON billing.order_events FROM platform_svc;
GRANT UPDATE (order_id, event_type, from_status, to_status, actor_type, actor_id, remark, client_ip) ON billing.order_events TO platform_svc;

-- billing.orders  [anchor: id, order_no, created_at]  (product_330：订单实体；状态/金额/履约由 OrderService 单一入口改)
REVOKE UPDATE ON billing.orders FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit, cycle_count, from_subscription_id, subscription_id, list_amount, credit_amount, payable_amount, leftover_amount, currency, proration, status, payment_ttl_minutes, auto_renew, declared_at, paid_at, fulfilled_at, closed_at, close_reason, created_by_type, created_by_id, operator_remark, updated_at) ON billing.orders TO platform_svc;

-- billing.prepaid_charges  [anchor: id, created_at]
REVOKE UPDATE ON billing.prepaid_charges FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, window_start, window_end, idempotency_key, amount, currency, breakdown, transaction_id, status) ON billing.prepaid_charges TO platform_svc;

-- provisioning.provisionings  [anchor: id, created_at]
REVOKE UPDATE ON provisioning.provisionings FROM platform_svc;
GRANT UPDATE (workspace_id, tenant_id, product_id, status, version, provisioned_at, deprovisioned_at, metadata, updated_at) ON provisioning.provisionings TO platform_svc;

-- provisioning.webhook_deliveries  [anchor: id, created_at]
REVOKE UPDATE ON provisioning.webhook_deliveries FROM platform_svc;
GRANT UPDATE (idempotency_key, provisioning_id, provisioning_version, workspace_id, tenant_id, product_id, event_type, payload, status, attempts, max_attempts, response_code, last_error, signature, leased_by, leased_until, last_attempt_at, next_retry_at, delivered_at, updated_at) ON provisioning.webhook_deliveries TO platform_svc;

-- provisioning.background_jobs  [anchor: job_name]
-- 主键即业务名（job_name），不是代理键——所以锚只有它一列，其余全部可写。
REVOKE UPDATE ON provisioning.background_jobs FROM platform_svc;
GRANT UPDATE (status, interval_ms, last_started_at, last_finished_at, last_duration_ms, last_items_processed, last_error, run_count, failure_count, updated_at) ON provisioning.background_jobs TO platform_svc;

-- promotion.voucher_batches  [anchor: id, created_by, created_at]
REVOKE UPDATE ON promotion.voucher_batches FROM platform_svc;
GRANT UPDATE (tenant_id, kind, name, code_prefix, effect, total_count, issued_count, per_user_limit, valid_from, valid_until, status, updated_at) ON promotion.voucher_batches TO platform_svc;

-- promotion.vouchers  [anchor: id, created_at]
REVOKE UPDATE ON promotion.vouchers FROM platform_svc;
GRANT UPDATE (batch_id, code, status, max_uses, used_count, assigned_workspace_id, assigned_user_id, expires_at, redeemed_at) ON promotion.vouchers TO platform_svc;

-- promotion.voucher_redemptions  [anchor: id, redemption_no]
REVOKE UPDATE ON promotion.voucher_redemptions FROM platform_svc;
GRANT UPDATE (voucher_id, tenant_id, workspace_id, user_id, kind, effect_snapshot, transaction_id, subscription_id, invoice_item_id, payment_id, redeemed_at) ON promotion.voucher_redemptions TO platform_svc;




-- safety.moderation_policies  [anchor: id, created_by, created_at]
REVOKE UPDATE ON safety.moderation_policies FROM platform_svc;
GRANT UPDATE (tenant_id, rules, is_active, updated_at) ON safety.moderation_policies TO platform_svc;

-- safety.moderation_logs  [anchor: id, created_at]
REVOKE UPDATE ON safety.moderation_logs FROM platform_svc;
GRANT UPDATE (request_id, direction, result, detail) ON safety.moderation_logs TO platform_svc;

-- support.tickets  [anchor: id, ticket_no, created_at]
REVOKE UPDATE ON support.tickets FROM platform_svc;
GRANT UPDATE (tenant_id, account_id, category, priority, source, status, title, description, reporter_name, assignee_id, assignee_name, tags, satisfaction_score, satisfaction_comment, sla_breach_at, first_response_at, due_at, resolved_at, closed_at, updated_at, deleted_at) ON support.tickets TO platform_svc;

-- support.ticket_comments  [anchor: id, created_at]
REVOKE UPDATE ON support.ticket_comments FROM platform_svc;
GRANT UPDATE (ticket_id, event_type, actor_type, actor_id, actor_name, payload) ON support.ticket_comments TO platform_svc;

-- support.audit_logs  [anchor: id, created_at]
REVOKE UPDATE ON support.audit_logs FROM platform_svc;
GRANT UPDATE (actor_type, actor_id, actor_console, tenant_id, action, result, resource_type, resource_id, error_code, before, after, request_id, duration_ms, ip_address, user_agent) ON support.audit_logs TO platform_svc;

-- support.notification_logs  [anchor: id, created_at]
REVOKE UPDATE ON support.notification_logs FROM platform_svc;
GRANT UPDATE (tenant_id, account_id, channel, template_code, status, reference_type, reference_id, recipient, subject, provider, provider_message_id, error_message, retry_count, delivered_at, opened_at) ON support.notification_logs TO platform_svc;

-- support.inbox_messages  [anchor: id, created_at]
REVOKE UPDATE ON support.inbox_messages FROM platform_svc;
GRANT UPDATE (tenant_id, account_id, template_code, title, body, link, reference_type, reference_id, read_at) ON support.inbox_messages TO platform_svc;

-- admin.operator_role  [anchor: id, rank, created_by, created_at]
REVOKE UPDATE ON admin.operator_role FROM platform_svc;
GRANT UPDATE (role_code, status, role_name, role_name_key, description, description_key, is_system, sort, mfa_min_level, updated_by, is_customer_visible, is_workforce_visible, updated_at) ON admin.operator_role TO platform_svc;

-- admin.operator_permission  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.operator_permission FROM platform_svc;
GRANT UPDATE (parent_id, perm_code, perm_name, perm_name_key, perm_type, route_path, component, icon, category, description, is_active, is_system, sort, updated_by, description_key, is_customer_visible, is_workforce_visible, requires_step_up, updated_at) ON admin.operator_permission TO platform_svc;

-- admin.operator_account  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.operator_account FROM platform_svc;
GRANT UPDATE (role_id, username, email, email_verified, phone, phone_verified, display_name, status, account_type, sort, last_login_at, last_login_ip, remark, updated_by, is_customer_visible, is_workforce_visible, updated_at, deleted_at) ON admin.operator_account TO platform_svc;

-- admin.operator_credential  [anchor: operator_id, created_at]
REVOKE UPDATE ON admin.operator_credential FROM platform_svc;
GRANT UPDATE (password_hash, password_changed_at, force_password_change, failed_attempts, locked_until, updated_at) ON admin.operator_credential TO platform_svc;

-- admin.operator_mfa  [anchor: operator_id, created_at]
REVOKE UPDATE ON admin.operator_mfa FROM platform_svc;
GRANT UPDATE (policy, totp_secret, totp_enabled, totp_confirmed_at, webauthn_required, enrolled_at, updated_at) ON admin.operator_mfa TO platform_svc;

-- admin.operator_webauthn_credential  [anchor: id, created_at]
REVOKE UPDATE ON admin.operator_webauthn_credential FROM platform_svc;
GRANT UPDATE (operator_id, credential_id, public_key, sign_count, aaguid, transports, label, last_used_at) ON admin.operator_webauthn_credential TO platform_svc;

-- admin.operator_recovery_code  [anchor: id, created_at]
REVOKE UPDATE ON admin.operator_recovery_code FROM platform_svc;
GRANT UPDATE (operator_id, code_hash, used_at) ON admin.operator_recovery_code TO platform_svc;

-- admin.operator_verification  [anchor: id, created_at]
REVOKE UPDATE ON admin.operator_verification FROM platform_svc;
GRANT UPDATE (operator_id, target_type, target, purpose, code_hash, attempt_count, expires_at, used_at) ON admin.operator_verification TO platform_svc;

-- admin.operator_login_attempt  [anchor: id, created_at]
REVOKE UPDATE ON admin.operator_login_attempt FROM platform_svc;
GRANT UPDATE (operator_id, identifier, auth_method, result, ip_address, user_agent) ON admin.operator_login_attempt TO platform_svc;

-- admin.operator_refresh_token  [anchor: id, created_at]
REVOKE UPDATE ON admin.operator_refresh_token FROM platform_svc;
GRANT UPDATE (operator_id, session_id, client_id, token_hash, rotated_from, status, expires_at) ON admin.operator_refresh_token TO platform_svc;

-- admin.operator_role_permission  [anchor: role_id, permission_id, created_by, created_at]
REVOKE UPDATE ON admin.operator_role_permission FROM platform_svc;
GRANT UPDATE (is_system) ON admin.operator_role_permission TO platform_svc;

-- admin.settings  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.settings FROM platform_svc;
GRANT UPDATE (config_group, config_key, value_type, config_value, is_sensitive, is_encrypted, is_readonly, validation_rule, description, updated_by, description_key, updated_at) ON admin.settings TO platform_svc;

-- admin.feature_flags  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.feature_flags FROM platform_svc;
GRANT UPDATE (flag_key, category, environment, description, is_globally_enabled, is_archived, rollout_percentage, tenant_overrides, expires_at, updated_by, description_key, updated_at) ON admin.feature_flags TO platform_svc;

-- admin.announcements  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.announcements FROM platform_svc;
GRANT UPDATE (announcement_type, severity, status, lang, title, content, cta_label, cta_url, target_plans, target_tenant_types, is_dismissible, publish_at, expires_at, meta, updated_at, deleted_at) ON admin.announcements TO platform_svc;

-- admin.maintenance_windows  [anchor: id, created_by, created_at]
REVOKE UPDATE ON admin.maintenance_windows FROM platform_svc;
GRANT UPDATE (severity, status, title, description, impact_description, affected_services, start_at, end_at, actual_end_at, updated_by, updated_at) ON admin.maintenance_windows TO platform_svc;

-- admin.risk_records  [anchor: id, created_at]
REVOKE UPDATE ON admin.risk_records FROM platform_svc;
GRANT UPDATE (tenant_id, risk_level, risk_score, scope, reason, reviewer_id, tags, source_table, source_id, updated_at, deleted_at) ON admin.risk_records TO platform_svc;

-- admin.compliance_events  [anchor: id, created_at]
REVOKE UPDATE ON admin.compliance_events FROM platform_svc;
GRANT UPDATE (tenant_id, event_type, status, regulation_code, evidence_url, handler_id, detail, tags, updated_at, deleted_at) ON admin.compliance_events TO platform_svc;


-- sharing.grants  [anchor: id, created_at]
REVOKE UPDATE ON sharing.grants FROM platform_svc;
GRANT UPDATE (tenant_id, resource_type, resource_product_id, resource_workspace_id, resource_ref, grantee_type, grantee_workspace_id, grantee_product_id, scope, status, expires_at, created_by_type, created_by_id, revoked_at, revoked_by_type, revoked_by_id, updated_at) ON sharing.grants TO platform_svc;

-- sharing.visible_set_current  [anchor: id]
REVOKE UPDATE ON sharing.visible_set_current FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, product_id, resource_type, resource_product_id, resource_workspace_id, resource_ref, scope, expires_at, refreshed_at) ON sharing.visible_set_current TO platform_svc;

-- sharing.visible_set_refresh  [anchor: id, created_at]
REVOKE UPDATE ON sharing.visible_set_refresh FROM platform_svc;
GRANT UPDATE (tenant_id, workspace_id, product_id, refreshed_at, updated_at) ON sharing.visible_set_refresh TO platform_svc;
