-- ═══════════════════════════════════════════════════════════════════════════
-- 前向迁移 — 暂停 episode 表 + 最长暂停期参数
--
-- 【为什么】
-- owner 2026-09-25 定了三条：不做退钱；客户不承担暂停期间的代价；暂停是平台动作，客户
-- 不能控制。前两条合起来意味着**平台原因的暂停要顺延服务期**。
--
-- 但「一律顺延」是错的：平台因**客户违规**暂停，顺延等于让违规者白得那些天。所以顺不顺
-- 延取决于「那一次是谁的错」——而今天代码里暂停**没有原因轴**，`suspended` 就是
-- `suspended`。这条迁移加的就是那根轴。
--
-- 【为什么是一张表，不是 subscriptions 上加两列】
-- **原因是「一次暂停」的属性，不是订阅的属性。** 挂在订阅行上只存得住最近一次，同一条
-- 订阅先后因两种原因被暂停就丢了信息；而「本周期累计顺延几天」「到点了该恢复还是终止」
-- 都要按次聚合。metering.subscriptions 一列都不加，也就没有「最近一次覆盖前一次」。
--
-- 【extends_term 为什么落库】
-- 它由 reason 派生，但**写下就不再跟着政策变**：owner 以后若改主意说争议审查也顺延，
-- 已经发生的那几次暂停不该被改写。同 plan_versions 不可变的道理。
--
-- 【最长暂停期】
-- 没上限的话，有效到期日会随暂停时长一直往后走，那条订阅永不到期、永不释放、也永不再
-- 计费——2026-09-25 批 2 刚修掉的死胡同会以另一种形态回来。参数走 admin.settings（与
-- refund.window_hours 同一个机制，代码侧兜底默认值），默认 60 天。**本迁移只把参数灌进
-- 去，到点处置的作业与顺延计算是后续两步。**
--
-- 幂等：建表、建索引、加约束、灌参数全部先查再做；列锁按 98 的统一规则重放。跑第二遍全部
-- 跳过。迁移每次 deploy 全量重放。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. episode 表 ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metering.subscription_suspensions (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id   uuid          NOT NULL REFERENCES metering.subscriptions(id) ON DELETE CASCADE,
    tenant_id         uuid          NOT NULL,
    reason            varchar(32)   NOT NULL,
    reason_note       text,
    extends_term      boolean       NOT NULL,
    paused_at         timestamptz   NOT NULL DEFAULT now(),
    resumed_at        timestamptz,
    granted_seconds   bigint,
    actor_type        varchar(16)   NOT NULL DEFAULT 'operator',
    actor_id          uuid,
    client_ip         varchar(64),
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- 约束逐条先查再加（CREATE TABLE IF NOT EXISTS 在表已存在时不会补约束）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'metering.subscription_suspensions'::regclass
                    AND conname = 'chk_subscription_suspensions_reason') THEN
    ALTER TABLE metering.subscription_suspensions
      ADD CONSTRAINT chk_subscription_suspensions_reason
      CHECK (reason IN ('platform_ops','dispute_review','customer_violation','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'metering.subscription_suspensions'::regclass
                    AND conname = 'chk_subscription_suspensions_actor_type') THEN
    ALTER TABLE metering.subscription_suspensions
      ADD CONSTRAINT chk_subscription_suspensions_actor_type
      CHECK (actor_type IN ('system','customer','operator'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'metering.subscription_suspensions'::regclass
                    AND conname = 'chk_subscription_suspensions_window') THEN
    ALTER TABLE metering.subscription_suspensions
      ADD CONSTRAINT chk_subscription_suspensions_window
      CHECK (resumed_at IS NULL OR resumed_at >= paused_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'metering.subscription_suspensions'::regclass
                    AND conname = 'chk_subscription_suspensions_granted') THEN
    ALTER TABLE metering.subscription_suspensions
      ADD CONSTRAINT chk_subscription_suspensions_granted
      CHECK (granted_seconds IS NULL OR granted_seconds >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'metering.subscription_suspensions'::regclass
                    AND conname = 'chk_subscription_suspensions_settle_order') THEN
    ALTER TABLE metering.subscription_suspensions
      ADD CONSTRAINT chk_subscription_suspensions_settle_order
      CHECK (resumed_at IS NOT NULL OR granted_seconds IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_suspensions_subscription
  ON metering.subscription_suspensions (subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_suspensions_tenant_id
  ON metering.subscription_suspensions (tenant_id);
-- 一条订阅同时只能有一次「进行中」的暂停：两次并存会让有效到期日算两遍。
CREATE UNIQUE INDEX IF NOT EXISTS uidx_subscription_suspensions_open
  ON metering.subscription_suspensions (subscription_id) WHERE resumed_at IS NULL;

-- ── 2. 列锁（98 的统一规则）─────────────────────────────────────────────────
-- 锚点：id / subscription_id / tenant_id / reason / extends_term / paused_at / actor_* /
-- created_at 写下就不改。可变的只有收尾那几列。reason 与 extends_term 锁住是有意的——
-- 改政策不该改写已经发生的那一次暂停。
REVOKE UPDATE ON metering.subscription_suspensions FROM platform_svc;
GRANT UPDATE (reason_note, resumed_at, granted_seconds, updated_at)
  ON metering.subscription_suspensions TO platform_svc;

-- ── 3. 最长暂停期参数 ───────────────────────────────────────────────────────
-- 与 refund.window_hours 同一个机制（admin.settings，代码侧兜底默认值）。默认 60 天：
-- 平台运维类的暂停应当以天计，争议审查可能要几周，60 天给两者都留了余地而不至于让一条
-- 订阅无限挂着。owner 可随时在运营台改，不需要发版。
INSERT INTO admin.settings (config_group, config_key, value_type, config_value, description, description_key, created_by, created_at, updated_at)
VALUES
  ('commerce', 'subscription.max_suspend_days', 'int', '60',
   'Maximum days a single suspension episode may stay open before the platform must act.',
   'ops.setting.subscription.max_suspend_days.desc', NULL, now(), now())
ON CONFLICT (config_key) DO NOTHING;

COMMIT;

-- ── 审计：证明装上的东西在管事，不只是「建出来了」 ──────────────────────────
DO $$
DECLARE n int; def text; has_open_idx boolean; v text;
BEGIN
  -- 表与四条 CHECK
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'metering.subscription_suspensions'::regclass AND contype = 'c';
  IF n < 5 THEN
    RAISE EXCEPTION '[suspension-episodes] CHECK 约束只有 % 条，少于预期的 5 条', n;
  END IF;

  -- reason 值域必须是那四个：只断言「有个叫这名字的约束」不够，同名约束可以写着别的谓词
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'metering.subscription_suspensions'::regclass
     AND conname = 'chk_subscription_suspensions_reason';
  IF def IS NULL OR def NOT LIKE '%platform_ops%' OR def NOT LIKE '%customer_violation%' THEN
    RAISE EXCEPTION '[suspension-episodes] reason 值域不是那四档：%', def;
  END IF;

  -- 「同时只有一次进行中」那条部分唯一索引
  SELECT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'metering' AND tablename = 'subscription_suspensions'
                    AND indexname = 'uidx_subscription_suspensions_open') INTO has_open_idx;
  IF NOT has_open_idx THEN
    RAISE EXCEPTION '[suspension-episodes] 进行中唯一索引不在';
  END IF;

  -- 列锁：锚点列不该可 UPDATE
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema = 'metering' AND table_name = 'subscription_suspensions'
     AND grantee = 'platform_svc' AND privilege_type = 'UPDATE'
     AND column_name IN ('id','subscription_id','tenant_id','reason','extends_term',
                         'paused_at','actor_type','actor_id','created_at');
  IF n <> 0 THEN
    RAISE EXCEPTION '[suspension-episodes] 锚点列仍可 UPDATE（% 列）—— 列锁没生效', n;
  END IF;

  -- 参数
  SELECT config_value INTO v FROM admin.settings WHERE config_key = 'subscription.max_suspend_days';
  IF v IS NULL THEN
    RAISE EXCEPTION '[suspension-episodes] 最长暂停期参数没灌进去';
  END IF;

  RAISE NOTICE '[suspension-episodes] OK —— episode 表就位（reason 四档 + 进行中唯一 + 锚点列已锁），最长暂停期 = % 天', v;
END $$;
