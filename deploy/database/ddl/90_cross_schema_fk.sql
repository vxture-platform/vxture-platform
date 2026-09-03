-- ═══════════════════════════════════════════════════════════════════════════
-- 90_cross_schema_fk.sql — 全部跨 schema / 复合跨 schema FK（铁律一）
-- apply 顺序：在所有域表（10..80）建成之后。幂等（duplicate_object 吞掉）。
-- 权威机制：SQL DDL 单一权威（跨 schema FK 集中于此，域内 FK 内联在各域文件）。
-- 按批次分节增长；跨 realm 身份 FK 一律禁止（铁律七，session.*/operator.* 对 account 裸 UUID）。
-- 「B2-pending」块引用尚未建成的域（product 等），随该批次上线后取消注释。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B0：tenancy → account ────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE tenancy.tenants ADD CONSTRAINT fk_tenants_owner_user
    FOREIGN KEY (owner_user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenancy.tenant_memberships ADD CONSTRAINT fk_tenant_memberships_user
    FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenancy.invitations ADD CONSTRAINT fk_invitations_created_by
    FOREIGN KEY (created_by) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenancy.tenant_contacts ADD CONSTRAINT fk_tenant_contacts_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B1：tenancy → access（role 复合 FK，锁 tenant 成员不能挂 workspace 角色）──────
DO $$ BEGIN
  ALTER TABLE tenancy.tenant_memberships ADD CONSTRAINT fk_tenant_memberships_role
    FOREIGN KEY (role_id, role_scope) REFERENCES access.roles(id, scope);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenancy.workspace_memberships ADD CONSTRAINT fk_workspace_memberships_role
    FOREIGN KEY (role_id, role_scope) REFERENCES access.roles(id, scope);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenancy.invitations ADD CONSTRAINT fk_invitations_role
    FOREIGN KEY (role_id, role_scope) REFERENCES access.roles(id, scope);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B1：identity / credential / kyc / appoidc / loyalty → account|tenancy ──────
DO $$ BEGIN
  ALTER TABLE identity.identities ADD CONSTRAINT fk_identities_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE credential.user_credentials ADD CONSTRAINT fk_user_credentials_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE credential.user_mfas ADD CONSTRAINT fk_user_mfas_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE credential.user_webauthn_credentials ADD CONSTRAINT fk_user_webauthn_credentials_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE credential.user_recovery_codes ADD CONSTRAINT fk_user_recovery_codes_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE kyc.user_kycs ADD CONSTRAINT fk_user_kycs_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE kyc.tenant_verifications ADD CONSTRAINT fk_tenant_verifications_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appoidc.oidc_consents ADD CONSTRAINT fk_oidc_consents_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE loyalty.user_points ADD CONSTRAINT fk_user_points_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE loyalty.point_ledgers ADD CONSTRAINT fk_point_ledgers_user
    FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE loyalty.task_progresses ADD CONSTRAINT fk_task_progresses_user
    FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE loyalty.user_tags ADD CONSTRAINT fk_user_tags_user
    FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── session → account：铁律七 + 边界#2 realm 隔离，一律裸 UUID，不建 FK ───────────
--   session.auth_sessions/refresh_tokens/user_verifications/password_reset_tokens/
--   login_attempts 的 user_id → account.users：不建外键（与 admin.operator_* 会话对称隔离）。
--   refresh_tokens.session_id → session.auth_sessions.id 为域内真 FK，已内联在 24_session.sql。

-- ── B1→product（product 域已建，取消注释）：kyc / appoidc → product ───────────────
DO $$ BEGIN
  ALTER TABLE kyc.verification_policies ADD CONSTRAINT fk_verification_policies_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE appoidc.oidc_clients ADD CONSTRAINT fk_oidc_clients_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- B2–B6：product/metering/billing/provisioning/promotion/model/safety/support/admin
-- （全 18 schema 已建，本节所有跨 schema FK 均可 apply）
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ product ═══
-- ── product 域：无出向真 FK ─────────────────────────────────────────────────
-- 本域全部 FK 均为域内内联（含互引用 plans↔plan_versions，已在 30_product.sql 内 ALTER 回填）。
-- 下列引用刻意「不建 FK」，仅登记于此（铁律七 / 边界#2）：
--
--  * product.products.{created_by,updated_by}          → admin.operator_accounts.id   裸 UUID，不建 FK
--  * product.plans.{created_by,updated_by}             → admin.operator_accounts.id   裸 UUID，不建 FK
--  * product.plan_versions.created_by                  → admin.operator_accounts.id   裸 UUID，不建 FK
--  * product.product_launch_statuses.checked_by        → admin.operator_accounts.id   裸 UUID，不建 FK
--    （产品目录运营专属，realm=operator 确定；跨 realm 身份 FK 禁止，边界#2）
--
-- ── 被引用（入向真 FK 定义在各来源 schema 的 90 段，非本域职责，此处仅备忘）──────
--  * commerce.metering.subscriptions.plan_version_id   → product.plan_versions.id
--  * commerce.billing.invoice_items.product_id         → product.products.id
--  * commerce.provisioning.webhook_deliveries          → product.product_webhooks.product_id（join 取端点/密钥）
--  * promotion.*.grant_plan_version_id                 → product.plan_versions.id
--  * kyc.verification_policies.product_id              → product.products.id（product_id IS NULL=平台基准值）

-- ═══ metering ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- 追加至 90_cross_schema_fk.sql — metering 域跨 schema / 复合跨 schema FK（铁律一）
-- apply 顺序：在 metering 域表 + tenancy/product/billing 域表建成之后。幂等（duplicate_object 吞掉）。
-- 分区父表（metering.usage_events）ADD CONSTRAINT 传播到全部子分区（PG11+）。
-- 跨 realm 身份引用一律裸 UUID 不建 FK（边界#2，铁律七）——见文末注释。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── metering → tenancy（workspace_id 成本中心 / tenant_id 账单反查）──────────────
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscription_histories ADD CONSTRAINT fk_subscription_histories_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscription_renewals ADD CONSTRAINT fk_subscription_renewals_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.quota_pools ADD CONSTRAINT fk_quota_pools_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_events ADD CONSTRAINT fk_usage_events_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_hours ADD CONSTRAINT fk_usage_summary_hours_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_days ADD CONSTRAINT fk_usage_summary_days_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_weeks ADD CONSTRAINT fk_usage_summary_weeks_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_months ADD CONSTRAINT fk_usage_summary_months_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_years ADD CONSTRAINT fk_usage_summary_years_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.entitlement_caches ADD CONSTRAINT fk_entitlement_caches_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── metering → product（plan_version 不可变版本 / products）─────────────────────
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_plan_version
    FOREIGN KEY (plan_version_id) REFERENCES product.plan_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscription_entitlement_overrides ADD CONSTRAINT fk_subscription_overrides_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.quota_pools ADD CONSTRAINT fk_quota_pools_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_events ADD CONSTRAINT fk_usage_events_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_hours ADD CONSTRAINT fk_usage_summary_hours_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_days ADD CONSTRAINT fk_usage_summary_days_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_weeks ADD CONSTRAINT fk_usage_summary_weeks_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_months ADD CONSTRAINT fk_usage_summary_months_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_summary_years ADD CONSTRAINT fk_usage_summary_years_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.entitlement_caches ADD CONSTRAINT fk_entitlement_caches_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── metering → billing（自动续订跨 schema，铁律一）─────────────────────────────
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_payment_mandate
    FOREIGN KEY (payment_mandate_id) REFERENCES billing.payment_mandates(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscription_renewals ADD CONSTRAINT fk_subscription_renewals_transaction
    FOREIGN KEY (result_transaction_id) REFERENCES billing.transactions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscription_renewals ADD CONSTRAINT fk_subscription_renewals_invoice
    FOREIGN KEY (result_invoice_id) REFERENCES billing.invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── product_330：订单实体（billing.orders）与订阅冗余列的跨 schema FK ────────────
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.subscriptions ADD CONSTRAINT fk_subscriptions_current_order
    FOREIGN KEY (current_order_id) REFERENCES billing.orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_plan_version
    FOREIGN KEY (plan_version_id) REFERENCES product.plan_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_from_subscription
    FOREIGN KEY (from_subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.orders ADD CONSTRAINT fk_orders_subscription
    FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 裸 UUID 边界#2（realm 硬隔离，铁律七）：一律不建 FK ──────────────────────────
--   metering.subscriptions.created_by_id                         → account.users | admin.operator_accounts（按 created_by_type）
--   metering.subscription_histories.actor_id                     → account.users | admin.operator_accounts（按 actor_type）
--   metering.subscription_entitlement_overrides.operator_id      → admin.operator_accounts（运营专属操作）
--   metering.quota_pools.granted_by                              → admin.operator_accounts（逻辑引用）
--   可视码 subscriptions.order_no / subscription_entitlement_overrides.override_tier_code 永不作 FK 目标（铁律二）。
--   subscription_histories.from_plan_version_id / to_plan_version_id：历史快照（product.plan_versions 不可变），
--     §12 速查表未列为真 FK，按快照裸值处理，不建 FK。

-- ═══ billing ═══
-- ── B-billing：billing → tenancy（tenant_id 一律真 FK，铁律一 sweep）──────────────
DO $$ BEGIN
  ALTER TABLE billing.transactions ADD CONSTRAINT fk_transactions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.credits ADD CONSTRAINT fk_credits_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.billing_addresses ADD CONSTRAINT fk_billing_addresses_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payment_methods ADD CONSTRAINT fk_payment_methods_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payment_mandates ADD CONSTRAINT fk_payment_mandates_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.invoices ADD CONSTRAINT fk_invoices_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.invoice_items ADD CONSTRAINT fk_invoice_items_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.invoice_receipts ADD CONSTRAINT fk_invoice_receipts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payments ADD CONSTRAINT fk_payments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.refunds ADD CONSTRAINT fk_refunds_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.prepaid_charges ADD CONSTRAINT fk_prepaid_charges_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B-billing：billing → tenancy.workspaces（成本归集，仅明细/预付批次）───────────────
DO $$ BEGIN
  ALTER TABLE billing.invoice_items ADD CONSTRAINT fk_invoice_items_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.prepaid_charges ADD CONSTRAINT fk_prepaid_charges_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B-billing：billing → metering.subscriptions（可空，跨 schema）──────────────────
DO $$ BEGIN
  ALTER TABLE billing.invoices ADD CONSTRAINT fk_invoices_subscription
    FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.invoice_items ADD CONSTRAINT fk_invoice_items_subscription
    FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B-billing：billing → product.products（明细行商品，跨 schema）───────────────────
DO $$ BEGIN
  ALTER TABLE billing.invoice_items ADD CONSTRAINT fk_invoice_items_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── B-billing：billing → account.users（客户 realm 确定，财务配置/签约自管，专名 FK）────
DO $$ BEGIN
  ALTER TABLE billing.billing_addresses ADD CONSTRAINT fk_billing_addresses_created_by
    FOREIGN KEY (created_by) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.billing_addresses ADD CONSTRAINT fk_billing_addresses_updated_by
    FOREIGN KEY (updated_by) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payment_methods ADD CONSTRAINT fk_payment_methods_created_by
    FOREIGN KEY (created_by) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payment_methods ADD CONSTRAINT fk_payment_methods_updated_by
    FOREIGN KEY (updated_by) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE billing.payment_mandates ADD CONSTRAINT fk_payment_mandates_user
    FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── billing → admin/operator + account（跨 realm/多态身份，一律裸 UUID 不建 FK，边界#2/铁律七）──
--   transactions.actor_id / payments.actor_id：actor_type=operator→admin.operator_accounts，
--     actor_type=customer→account.users（同列多态，不建 FK）。
--   invoices.created_by_id / invoice_receipts.created_by_id / refunds.created_by_id：
--     created_by_type=operator→admin.operator_accounts，=customer→account.users（不建 FK）。
--   invoice_receipts.auditor_id / refunds.auditor_id：审核人恒为 operator→admin.operator_accounts（不建 FK）。
--   transactions.bill_id → billing.invoices：逻辑引用（跨分区/已删场景），刻意不建 FK。
--   invoices.transaction_no → transactions.transaction_no：可视码，永不做 FK 目标（铁律二）。

-- ═══ provisioning ═══
-- ── provisioning → tenancy / product（铁律一：跨 schema FK 不内联，集中于此，幂等）─────────
-- provisionings：workspace_id → tenancy.workspaces；tenant_id → tenancy.tenants；product_id → product.products。
DO $$ BEGIN
  ALTER TABLE provisioning.provisionings ADD CONSTRAINT fk_provisionings_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provisioning.provisionings ADD CONSTRAINT fk_provisionings_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provisioning.provisionings ADD CONSTRAINT fk_provisionings_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- webhook_deliveries：workspace_id → tenancy.workspaces；tenant_id → tenancy.tenants；product_id → product.products。
--   provisioning_id → provisioning.provisionings 为域内真 FK，已内联在 tables_ddl。
DO $$ BEGIN
  ALTER TABLE provisioning.webhook_deliveries ADD CONSTRAINT fk_webhook_deliveries_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provisioning.webhook_deliveries ADD CONSTRAINT fk_webhook_deliveries_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE provisioning.webhook_deliveries ADD CONSTRAINT fk_webhook_deliveries_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 注：product.products 属 product 域，须在 product 域表建成之后再 apply 本节（否则 undefined_table）。
--   若 product 域尚未上线，将上述 3 处 product_id FK 块暂注释，随该批次上线取消注释（同 90 的 B2-pending 惯例）。

-- ═══ promotion ═══
-- ── promotion → tenancy / account（普通引用，客户 realm 真 FK）──────────────────
DO $$ BEGIN
  ALTER TABLE promotion.voucher_batches ADD CONSTRAINT fk_voucher_batches_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_assigned_workspace
    FOREIGN KEY (assigned_workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.vouchers ADD CONSTRAINT fk_vouchers_assigned_user
    FOREIGN KEY (assigned_user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_user
    FOREIGN KEY (user_id) REFERENCES account.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── promotion → billing / metering（效果追溯真 FK，铁律一；按 kind 填，均可空）──────
-- 依赖：billing / metering 域表须先于本节 apply（commerce 域同批次落地）。
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_transaction
    FOREIGN KEY (transaction_id) REFERENCES billing.transactions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_subscription
    FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_invoice_item
    FOREIGN KEY (invoice_item_id) REFERENCES billing.invoice_items(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promotion.voucher_redemptions ADD CONSTRAINT fk_voucher_redemptions_payment
    FOREIGN KEY (payment_id) REFERENCES billing.payments(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── promotion → admin（运营身份）：铁律七 + 边界#2，一律裸 UUID，不建 FK ────────────
--   promotion.voucher_batches.created_by → admin.operator_accounts.id：不建外键
--   （运营专属操作，realm=operator，与客户 realm 硬隔离；仅逻辑引用）。

-- ═══ model ═══ 已随 Atlas 拆仓退役(2026-08-18):schema 不复存在,FK 无从建。


-- ═══ safety ═══
-- ── B?：safety → tenancy（审核策略归属租户；NULL=平台默认，普通引用真 FK，铁律一）─────
DO $$ BEGIN
  ALTER TABLE safety.moderation_policies ADD CONSTRAINT fk_moderation_policies_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── safety → operator/admin：铁律七 + 边界#2，不建 FK ──────────────────────────────
--   safety.moderation_policies.created_by → operator（运营）：裸 UUID，不建外键（跨 realm 身份 FK 禁止）。
-- ── safety.moderation_logs.request_id：§17 单一跨库关联键（边界#1），裸 varchar，不建 FK。

-- ═══ support ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- 90_cross_schema_fk.sql 追加块 — support 域跨 schema 真 FK（幂等，铁律一）
-- 仅 support.*.tenant_id → tenancy.tenants 建真 FK（tenant 软删，FK 安全）。
-- ON DELETE 不设（默认 NO ACTION）：tenant 走软删(deleted_at)不硬删，无需 CASCADE。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER TABLE support.tickets
    ADD CONSTRAINT fk_tickets_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE support.notification_logs
    ADD CONSTRAINT fk_notification_logs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 以下为刻意「裸值不建 FK」清单（注释留痕，非真 FK） ────────────────────────
-- support.tickets.account_id              → account.users.id         裸值（边界#3：报单者可注销，工单留存）
-- support.tickets.assignee_id             → admin.operator_accounts  裸值（边界#2：跨 realm workforce 隔离，铁律七）
-- support.ticket_comments.actor_id        → account.users / operator 裸值（边界#2/#3：按 actor_type 跨 realm）
-- support.audit_logs.tenant_id            → tenancy.tenants          裸值（边界#3：合规不可变，须活过租户注销）
-- support.audit_logs.actor_id             → account.users / operator 裸值（边界#3 + 边界#2：跨 realm）
-- support.notification_logs.account_id    → account.users.id         裸值（边界#3：收件人可注销）
-- support.audit_logs.request_id           → reqlog/usage_events/…    裸值（边界#1：跨库单一关联键）

-- ═══ admin ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- admin schema — 跨 schema / 跨 realm 引用清单（结论：无真 FK，全部裸 UUID / 按值解析）。
-- 依据 docs/design/data_admin_200_schema.md §0 红线 + §3 FK/边界速查表。
-- 本 schema 不向 90_cross_schema_fk.sql 贡献任何 ADD CONSTRAINT —— 以下为审计说明，非可执行 DDL。
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1) admin.operator_*  →  客户 realm 各 schema
--    (account / identity / tenancy / credential / kyc / access / session / loyalty)
--    = 零 FK（边界#2 realm 硬隔离红线，不得回退）。两套账号体系完全隔离；operator 自带
--      operator_role / operator_permission，不引用 access.roles|permissions。
--    运营 session/refresh/verification/login_attempt 全部落 admin，绝不落客户 realm。
--
-- 2) admin.risk_records.tenant_id / admin.compliance_events.tenant_id  →  tenancy.tenants(id)
--    = 裸值，不建 FK（边界#3：治理/合规记录须活过租户注销）。
--
-- 3) admin.feature_flags.tenant_overrides(key) / admin.announcements.target_plans /
--    admin.announcements.target_tenant_types  →  tenancy.tenants / product.plans
--    = 裸值（jsonb key / 数组元素），按值解析，不建 FK（边界#4）。
--
-- 4) admin.*.created_by / updated_by（settings/feature_flags/announcements/maintenance_windows/
--    operator_role/operator_permission/operator_account/operator_role_permission）
--    → admin.operator_account(id)：doc §3 汇总表标真 FK，但 §2 字段级规格与在产 CUR 均为裸 uuid
--      （无 @relation）。为匹配在产实态 + 规避 seed 期循环依赖（operator_account.role_id →
--      operator_role.created_by → operator_account），此处采字段级口径保留裸 uuid，不建 FK。
--      仅 risk_records.reviewer_id / compliance_events.handler_id 按 §2.5/§2.6 字段级建域内真 FK（已内联）。
--
-- 5) 审计：admin 域不建审计表，运营全链路审计复用 support.audit_logs(actor_type='operator')，无 FK。
-- 6) 共享基础设施：iam.oidc_clients(admin) + iam.signing_keys（RS256 JWKS 双 realm 共用），对 operator 账号无 FK。
-- resource_sharing_policies → tenancy / product（D8，铁律一：跨 schema FK 集中于此，幂等）。
-- metric_key → product.platform_metrics 为 loose 引用（策略路由，不建 FK；表可先于策略存在）。
DO $$ BEGIN
  ALTER TABLE metering.resource_sharing_policies ADD CONSTRAINT fk_resource_sharing_policies_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.resource_sharing_policies ADD CONSTRAINT fk_resource_sharing_policies_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.resource_sharing_policies ADD CONSTRAINT fk_resource_sharing_policies_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- usage_gauges → tenancy / product（D5，铁律一）。metric_key → platform_metrics 为 loose 引用。
DO $$ BEGIN
  ALTER TABLE metering.usage_gauges ADD CONSTRAINT fk_usage_gauges_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.usage_gauges ADD CONSTRAINT fk_usage_gauges_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- addon_purchases → tenancy / product.addon_packs / billing.invoices（加油包购买单,
-- owner 2026-08-20 用量配额线;铁律一集中)。order_no 可视码不作 FK;created_by_id 裸值(边界#2)。
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_pack
    FOREIGN KEY (pack_id) REFERENCES product.addon_packs(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE metering.addon_purchases ADD CONSTRAINT fk_addon_purchases_invoice
    FOREIGN KEY (invoice_id) REFERENCES billing.invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══ sharing ═══
-- ── sharing → tenancy / product（铁律一：跨 schema FK 不内联，集中于此，幂等）─────────
-- 依据 docs/design/data_sharing_200_schema.md §5：tenancy/product 引用均真 FK；
-- resource_ref（业务面资产 id，边界#1）与 created_by_id/revoked_by_id（边界#2，按 type 解引用）为裸值，不建 FK。
DO $$ BEGIN
  ALTER TABLE sharing.grants ADD CONSTRAINT fk_grants_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.grants ADD CONSTRAINT fk_grants_resource_workspace
    FOREIGN KEY (resource_workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.grants ADD CONSTRAINT fk_grants_grantee_workspace
    FOREIGN KEY (grantee_workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.grants ADD CONSTRAINT fk_grants_resource_product
    FOREIGN KEY (resource_product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.grants ADD CONSTRAINT fk_grants_grantee_product
    FOREIGN KEY (grantee_product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- visible_set_current / visible_set_refresh：物化非 SoT，仍建真 FK（普通引用；TRUNCATE 重建不受影响）。
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_current ADD CONSTRAINT fk_visible_set_current_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_current ADD CONSTRAINT fk_visible_set_current_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_current ADD CONSTRAINT fk_visible_set_current_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_current ADD CONSTRAINT fk_visible_set_current_resource_workspace
    FOREIGN KEY (resource_workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_current ADD CONSTRAINT fk_visible_set_current_resource_product
    FOREIGN KEY (resource_product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_refresh ADD CONSTRAINT fk_visible_set_refresh_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_refresh ADD CONSTRAINT fk_visible_set_refresh_workspace
    FOREIGN KEY (workspace_id) REFERENCES tenancy.workspaces(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sharing.visible_set_refresh ADD CONSTRAINT fk_visible_set_refresh_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE account.user_product_favorites ADD CONSTRAINT fk_user_product_favorites_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
