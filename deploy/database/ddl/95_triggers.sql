-- ═══════════════════════════════════════════════════════════════════════════
-- 95_triggers.sql — 触发器 / 函数（不可变 append-only / plan 锁 / 配额归零等）
-- apply 顺序：在域表建成之后。幂等（CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS）。
-- 一律 RAISE 硬失败，禁用 DO INSTEAD NOTHING RULE（静默吞写）。按批次分节增长。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B1：identity.oauth_states append-only（握手态一次写定；禁 UPDATE，放行 DELETE 供
--         单次消费失效 + 过期 TTL 回收）──────────────────────────────────────────
CREATE OR REPLACE FUNCTION identity.forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on identity.% is forbidden', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oauth_states_append_only ON identity.oauth_states;
CREATE TRIGGER trg_oauth_states_append_only
  BEFORE UPDATE ON identity.oauth_states
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_update();

-- ── B1：session.login_attempts append-only（风控证据；禁 UPDATE + DELETE）──────────
CREATE OR REPLACE FUNCTION session.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % not allowed',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_login_attempts_append_only ON session.login_attempts;
CREATE TRIGGER trg_login_attempts_append_only
  BEFORE UPDATE OR DELETE ON session.login_attempts
  FOR EACH ROW EXECUTE FUNCTION session.reject_mutation();


-- ═══════════════════════════════════════════════════════════════════════════
-- B2–B6 触发器
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ product ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- product 触发器（plan 版本锁 / 编排期优先级硬约束，data_product_200 §7）
-- 目标态采用 plan_versions.is_locked boolean 模型（取代已落地 status='published'）。
-- 幂等：CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS。一律 RAISE 硬失败。
-- 触发器命名 'g'(guard) 排在 'p'(priority) 之前 → 锁守卫先于优先级校验触发。
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. 版本已锁 → 禁增/改/删其 plan_components；同一函数复用于 plan_prices（按 plan_version_id 查 is_locked）
CREATE OR REPLACE FUNCTION product.guard_locked_plan_component()
RETURNS trigger AS $$
DECLARE v_locked boolean;
BEGIN
  SELECT is_locked INTO v_locked FROM product.plan_versions
    WHERE id = COALESCE(NEW.plan_version_id, OLD.plan_version_id);
  IF v_locked THEN
    RAISE EXCEPTION 'plan_version % is locked (immutable); cannot add/modify/delete its % — open a new version',
      COALESCE(NEW.plan_version_id, OLD.plan_version_id), TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_component_guard_lock ON product.plan_components;
CREATE TRIGGER trg_plan_component_guard_lock
  BEFORE INSERT OR UPDATE OR DELETE ON product.plan_components
  FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_component();

DROP TRIGGER IF EXISTS trg_plan_price_guard_lock ON product.plan_prices;
CREATE TRIGGER trg_plan_price_guard_lock
  BEFORE INSERT OR UPDATE OR DELETE ON product.plan_prices
  FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_component();

-- 1b. 已锁版本禁清 is_locked + version_no/plan_id/trial 冻结（价格已移出 plan_versions → 见 plan_prices 守卫）
CREATE OR REPLACE FUNCTION product.guard_locked_plan_version()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked THEN
    IF NOT NEW.is_locked THEN
      RAISE EXCEPTION 'plan_version % is locked; is_locked cannot be cleared', OLD.id;
    END IF;
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.trial_cycle_unit IS DISTINCT FROM OLD.trial_cycle_unit
       OR NEW.trial_cycle_count IS DISTINCT FROM OLD.trial_cycle_count THEN
      RAISE EXCEPTION 'plan_version % is locked; version_no/plan_id/trial frozen — open a new version', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_version_guard_lock ON product.plan_versions;
CREATE TRIGGER trg_plan_version_guard_lock
  BEFORE UPDATE ON product.plan_versions
  FOR EACH ROW EXECUTE FUNCTION product.guard_locked_plan_version();

-- 2. 编排期财务级硬约束（D6，原按 billing_kind）：单版本内 max(bundled priority) <
--    min(primary priority)——bundled 支撑件的池必须先于 primary 主体件被扣减（product_220
--    §4.2 burn 顺序;consume order-by 的 role tiebreaker 是二道防线，本守卫防 priority 反设）。
CREATE OR REPLACE FUNCTION product.check_plan_component_priority()
RETURNS trigger AS $$
DECLARE min_primary int; max_bundled int;
BEGIN
  SELECT MIN(priority) INTO min_primary FROM product.plan_components
    WHERE plan_version_id = NEW.plan_version_id AND component_role = 'primary';
  SELECT MAX(priority) INTO max_bundled FROM product.plan_components
    WHERE plan_version_id = NEW.plan_version_id AND component_role = 'bundled';
  IF min_primary IS NOT NULL AND max_bundled IS NOT NULL AND max_bundled >= min_primary THEN
    RAISE EXCEPTION 'bundled priority(%) must be < primary priority(%), plan_version=%',
      max_bundled, min_primary, NEW.plan_version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_component_priority ON product.plan_components;
CREATE TRIGGER trg_plan_component_priority
  BEFORE INSERT OR UPDATE ON product.plan_components
  FOR EACH ROW EXECUTE FUNCTION product.check_plan_component_priority();

-- ═══ metering ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- 追加至 95_triggers.sql — metering append-only 强制（§2 / §6 / §7）
-- 一律 RAISE 硬失败，禁用 DO INSTEAD NOTHING RULE（静默吞写）。幂等。
-- 分区父表挂 FOR EACH ROW 触发器 → 传播全部子分区（PG11+）。
-- ═══════════════════════════════════════════════════════════════════════════

-- 共享 append-only 守卫：禁 UPDATE / DELETE（RAISE，非 RULE 静默吞写）。
CREATE OR REPLACE FUNCTION metering.forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on metering.% is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- §6 用量事件头（分区父，传播全分区）
DROP TRIGGER IF EXISTS trg_usage_events_append_only ON metering.usage_events;
CREATE TRIGGER trg_usage_events_append_only
  BEFORE UPDATE OR DELETE ON metering.usage_events
  FOR EACH ROW EXECUTE FUNCTION metering.forbid_mutation();

-- §7 用量明细（分区父，传播全分区；护 quota_used=SUM(命中池 took) 不变量）
DROP TRIGGER IF EXISTS trg_usage_event_pools_append_only ON metering.usage_event_pools;
CREATE TRIGGER trg_usage_event_pools_append_only
  BEFORE UPDATE OR DELETE ON metering.usage_event_pools
  FOR EACH ROW EXECUTE FUNCTION metering.forbid_mutation();

-- §2 订阅变更审计（append-only）
DROP TRIGGER IF EXISTS trg_subscription_histories_append_only ON metering.subscription_histories;
CREATE TRIGGER trg_subscription_histories_append_only
  BEFORE UPDATE OR DELETE ON metering.subscription_histories
  FOR EACH ROW EXECUTE FUNCTION metering.forbid_mutation();

-- ═══ billing ═══
-- ── B-billing：billing.transactions append-only 不可变账本（法律证据；禁 UPDATE + DELETE）──
--   RAISE 硬失败，禁 DO INSTEAD NOTHING RULE（静默吞写会让篡改被悄悄无视）；
--   更正走追加冲正流水（trade_type=adjust/refund）。幂等（CREATE OR REPLACE + DROP TRIGGER IF EXISTS）。
CREATE OR REPLACE FUNCTION billing.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only ledger %.%: % not allowed (correct via reversal transaction trade_type=adjust/refund)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_append_only ON billing.transactions;
CREATE TRIGGER trg_transactions_append_only
  BEFORE UPDATE OR DELETE ON billing.transactions
  FOR EACH ROW EXECUTE FUNCTION billing.reject_mutation();

-- ═══ provisioning ═══
-- （无）provisioning 域两表均为可变工作队列，非 append-only（设计 §2 明确）：
--   provisionings 状态机行随订阅回流可 UPDATE（version 乐观锁）；
--   webhook_deliveries 是 retry/lease 工作队列，attempts/status/lease 字段持续更新。
-- 故不设 append-only / forbid_update 触发器，亦无分区归零等约束触发器。

-- ═══ promotion ═══
-- promotion 域无触发器。
-- 三表均非 append-only 硬约束表：
--   · voucher_batches / vouchers 为可变状态机实体（状态迁移、used_count 自增/回退），本就允许 UPDATE。
--   · voucher_redemptions 语义上核销即写定，但设计 §5.1 允许 reserved→支付成功时回填 invoice_item_id，
--     故不设 BEFORE UPDATE/DELETE RAISE 触发器；插入一次性由应用层事务保证（§5.2 受影响行数=1 抢占）。
-- 若后续将 voucher_redemptions 收敛为严格不可变审计流水，再按 session.reject_mutation 模式补 append-only 触发器。

-- ═══ model ═══
-- model schema 无 append-only 不可变表：model_price_rules/model_policies 为版本化配置，
-- is_active 可翻、旧行可置 expires_at（可更），非严格不可变，故不设 BEFORE UPDATE/DELETE 触发器。
-- （无内容）

-- ═══ safety ═══
-- ── safety.moderation_logs append-only（审核证据；禁 UPDATE + DELETE，行不可变）───────
CREATE OR REPLACE FUNCTION safety.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % not allowed',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_moderation_logs_append_only ON safety.moderation_logs;
CREATE TRIGGER trg_moderation_logs_append_only
  BEFORE UPDATE OR DELETE ON safety.moderation_logs
  FOR EACH ROW EXECUTE FUNCTION safety.reject_mutation();

-- ═══ support ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- support 域 append-only 触发器（10-deferred-ddl.sql 追加块，幂等可重跑）
-- 用 RAISE（非 DO INSTEAD NOTHING RULE——rule 会静默吞写）。
-- ticket_comments：仅封 UPDATE，保留 ON DELETE CASCADE 供父表 purge。
-- audit_logs：封 UPDATE+DELETE；分区父声明的行级触发器传播至全分区。
-- ═══════════════════════════════════════════════════════════════════════════

-- 共享 append-only 守卫：禁止其所挂事件（UPDATE/DELETE）。
CREATE OR REPLACE FUNCTION support.forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on support.% is forbidden', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- ticket_comments：仅封 UPDATE（DELETE 保留，供 tickets 留存到期 CASCADE purge）
DROP TRIGGER IF EXISTS trg_ticket_comments_append_only ON support.ticket_comments;
CREATE TRIGGER trg_ticket_comments_append_only
  BEFORE UPDATE ON support.ticket_comments
  FOR EACH ROW EXECUTE FUNCTION support.forbid_mutation();

-- audit_logs：封 UPDATE+DELETE（合规不可变；清理靠 DROP PARTITION，非逐行 DELETE）
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON support.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON support.audit_logs
  FOR EACH ROW EXECUTE FUNCTION support.forbid_mutation();

-- ═══ admin ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- admin schema — append-only 守卫触发器（归 triggers_ddl，禁 DO INSTEAD NOTHING RULE）。
-- 依据样板 session.login_attempts + 10-deferred-ddl.sql commerce.forbid_mutation 模式。
-- ═══════════════════════════════════════════════════════════════════════════

-- append-only 通用守卫：禁 UPDATE/DELETE（RAISE，不用 rule 静默吞写）。
CREATE OR REPLACE FUNCTION admin.forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on admin.% is forbidden', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- operator_login_attempt：运营登录风控流水，不可变审计（append-only）。
DROP TRIGGER IF EXISTS trg_operator_login_attempt_append_only ON admin.operator_login_attempt;
CREATE TRIGGER trg_operator_login_attempt_append_only
  BEFORE UPDATE OR DELETE ON admin.operator_login_attempt
  FOR EACH ROW EXECUTE FUNCTION admin.forbid_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- M5（sharing 域）触发器 — tenant 一致性（org 内机制硬约束）
-- 依据 data_sharing_200 §3：FK 只保证行存在，保不住三角一致；跨 org grant 在
-- 结构上不可写入（product_110 §3.1 硬边界的存储层兜底）。
-- ═══════════════════════════════════════════════════════════════════════════

-- sharing.grants：resource_workspace_id 与 grantee_workspace_id（如非空）均须属于 tenant_id
CREATE OR REPLACE FUNCTION sharing.enforce_grants_tenant_coherence() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenancy.workspaces w
     WHERE w.id = NEW.resource_workspace_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sharing.grants: resource_workspace_id % does not belong to tenant %',
      NEW.resource_workspace_id, NEW.tenant_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.grantee_workspace_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenancy.workspaces w
     WHERE w.id = NEW.grantee_workspace_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sharing.grants: grantee_workspace_id % does not belong to tenant % (cross-org grant forbidden)',
      NEW.grantee_workspace_id, NEW.tenant_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_grants_tenant_coherence ON sharing.grants;
CREATE TRIGGER trg_grants_tenant_coherence
  BEFORE INSERT OR UPDATE ON sharing.grants
  FOR EACH ROW EXECUTE FUNCTION sharing.enforce_grants_tenant_coherence();

-- sharing.visible_set_current：调用方 workspace_id 与 resource_workspace_id 均须属于 tenant_id（防重算代码回归）
CREATE OR REPLACE FUNCTION sharing.enforce_visible_set_tenant_coherence() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenancy.workspaces w
     WHERE w.id = NEW.workspace_id AND w.tenant_id = NEW.tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM tenancy.workspaces w
     WHERE w.id = NEW.resource_workspace_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sharing.visible_set_current: workspace/resource_workspace not in tenant %',
      NEW.tenant_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_visible_set_current_tenant_coherence ON sharing.visible_set_current;
CREATE TRIGGER trg_visible_set_current_tenant_coherence
  BEFORE INSERT OR UPDATE ON sharing.visible_set_current
  FOR EACH ROW EXECUTE FUNCTION sharing.enforce_visible_set_tenant_coherence();


-- ═══════════════════════════════════════════════════════════════════════════
-- D7（L0 资源目录）触发器 — 产品级 product_metrics 不得声明 platform_metrics 已有键
-- 依据 product_220 §4/§8#6：键的归属目录决定池作用域，单一定义点由结构强制而非 lint。
-- 方向单一（platform 为权威）：升格流程 = 先插 platform 行、再删产品行，不会被反向阻塞。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION product.forbid_platform_metric_shadow() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM product.platform_metrics plm WHERE plm.metric_key = NEW.metric_key) THEN
    RAISE EXCEPTION 'product_metrics may not declare platform metric key % (owned by product.platform_metrics, product_220 §4)',
      NEW.metric_key USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_metrics_no_platform_shadow ON product.product_metrics;
CREATE TRIGGER trg_product_metrics_no_platform_shadow
  BEFORE INSERT OR UPDATE ON product.product_metrics
  FOR EACH ROW EXECUTE FUNCTION product.forbid_platform_metric_shadow();

-- ── B9:可视码分配(2026-08-19 编号定版 v3「人租同号」,§11)────────────────────
-- tenant_no:个人租户继承 owner 的 user_no(人租同号);组织租户自取主体号
--   (与 user_no 共享 account.principal_no_seq,号空间统一,跨表永不撞号)。
-- workspace_no = 完整 12 位租户号 ×1000 + 租户内终身序号(001-999;号不复用,15 位)。
-- 计数器 tenants.workspace_counter 原子递增,超 999 由 chk_tenants_workspace_counter 硬拦。
-- 显式携号插入放行(迁移/修复用)。注意:ON CONFLICT DO NOTHING 的跳过行也会烧掉一个
-- 计数(BEFORE 触发器先于冲突判定),幂等 seed 重跑每次至多烧 1,可接受。
CREATE OR REPLACE FUNCTION tenancy.assign_tenant_no() RETURNS trigger AS $$
DECLARE
  v_user_no bigint;
BEGIN
  IF NEW.tenant_no IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.type = 'personal' THEN
    SELECT user_no INTO v_user_no FROM account.users WHERE id = NEW.owner_user_id;
    IF v_user_no IS NULL THEN
      RAISE EXCEPTION 'tenant_no: owner user % not found', NEW.owner_user_id;
    END IF;
    NEW.tenant_no := v_user_no;
  ELSE
    NEW.tenant_no := nextval('account.principal_no_seq') * 1000 + floor(random()*1000)::bigint;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_assign_no ON tenancy.tenants;
CREATE TRIGGER trg_tenants_assign_no
  BEFORE INSERT ON tenancy.tenants
  FOR EACH ROW EXECUTE FUNCTION tenancy.assign_tenant_no();
CREATE OR REPLACE FUNCTION tenancy.assign_workspace_no() RETURNS trigger AS $$
DECLARE
  v_counter   int;
  v_tenant_no bigint;
BEGIN
  IF NEW.workspace_no IS NOT NULL THEN RETURN NEW; END IF;
  UPDATE tenancy.tenants
     SET workspace_counter = workspace_counter + 1
   WHERE id = NEW.tenant_id
  RETURNING workspace_counter, tenant_no INTO v_counter, v_tenant_no;
  IF v_counter IS NULL THEN
    RAISE EXCEPTION 'workspace_no: tenant % not found', NEW.tenant_id;
  END IF;
  NEW.workspace_no := v_tenant_no * 1000 + v_counter;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workspaces_assign_no ON tenancy.workspaces;
CREATE TRIGGER trg_workspaces_assign_no
  BEFORE INSERT ON tenancy.workspaces
  FOR EACH ROW EXECUTE FUNCTION tenancy.assign_workspace_no();

-- ── B9b:个人转组织「号跟人」换发(A 方案,owner 定案 2026-08-19,§11)──────────
-- 个人租户认证升级为组织时:user_no 是人的终身号,留给人;租户行换发独立主体号
-- (组织从此有自己的号,与创始人解耦,归属查 owner_user_id)。释放的 user_no 由
-- 之后重建的个人租户经 assign_tenant_no 自动收回。显式携号更新(type 与 tenant_no
-- 同时改)放行不换发(迁移/修复通道)。组织→个人为未定义流程,硬拦。
-- 注:BEFORE 触发器改 NEW 列不受 98 列锁限制(列锁只约束语句显式目标列)。
CREATE OR REPLACE FUNCTION tenancy.reissue_tenant_no_on_conversion() RETURNS trigger AS $$
BEGIN
  IF OLD.type = 'personal' AND NEW.type = 'organization' AND NEW.tenant_no = OLD.tenant_no THEN
    NEW.tenant_no := nextval('account.principal_no_seq') * 1000 + floor(random()*1000)::bigint;
  ELSIF OLD.type = 'organization' AND NEW.type = 'personal' THEN
    RAISE EXCEPTION 'tenant type downgrade organization -> personal is not a defined flow (tenant %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_reissue_no_on_conversion ON tenancy.tenants;
CREATE TRIGGER trg_tenants_reissue_no_on_conversion
  BEFORE UPDATE OF type ON tenancy.tenants
  FOR EACH ROW WHEN (OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION tenancy.reissue_tenant_no_on_conversion();

-- ── B9c:空间号前缀跟随租户号(任何 tenant_no 变更,含换发/修复)────────────────
-- 不变量:workspace_no 前 12 位恒等于所属租户现行 tenant_no。注意不能用 UPDATE OF
-- tenant_no 列限定——BEFORE 触发器改写的 NEW.tenant_no 不算语句目标列,OF 会漏触发。SECURITY DEFINER:
-- workspace_no 对 platform_svc 是列锁锚点,跟随改号是唯一合法通路,以 owner 身份执行。
CREATE OR REPLACE FUNCTION tenancy.reprefix_workspace_nos() RETURNS trigger
  SECURITY DEFINER SET search_path = tenancy, pg_temp AS $$
BEGIN
  UPDATE tenancy.workspaces
     SET workspace_no = NEW.tenant_no * 1000 + (workspace_no % 1000),
         updated_at = now()
   WHERE tenant_id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_reprefix_ws ON tenancy.tenants;
CREATE TRIGGER trg_tenants_reprefix_ws
  AFTER UPDATE ON tenancy.tenants
  FOR EACH ROW WHEN (OLD.tenant_no IS DISTINCT FROM NEW.tenant_no)
  EXECUTE FUNCTION tenancy.reprefix_workspace_nos();
